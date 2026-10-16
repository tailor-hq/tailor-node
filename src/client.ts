import { randomUUID } from 'node:crypto';

import { type ConfigTest, type ServerSdkConfig, type TestValue, validateConfig } from './config.js';
import { EventQueue, type FlushResult, type TailorEventPayload } from './events.js';
import { assignVariant, simpleHash } from './internal/assignment.js';
import { consoleLogger, type Logger } from './logger.js';
import { TestResult } from './test-result.js';
import { VERSION } from './version.js';

export interface InitOptions {
  /** The SDK key from Settings → Websites & publishing → Server-side testing. */
  sdkKey: string;
  /** How often to check for a new config, in milliseconds. Default 5 minutes, minimum 1 second. */
  pollInterval?: number;
  /** Where problems are reported. Defaults to the console. */
  logger?: Logger;
  /** How events are batched before they're sent. */
  batchEvents?: {
    /** Send once this many are waiting. Default and maximum 100. */
    maxEvents?: number;
    /** Send at least this often, in milliseconds. Default 30 seconds. */
    flushInterval?: number;
  };
  /** Called the first time this process counts a visitor in a test, for your own analytics. */
  onTailored?: (event: TailoredEvent) => void;
  /** @internal Tailor's own testing against a non-production API. */
  apiBaseUrl?: string;
}

export interface TailoredEvent {
  testKey: string;
  variant: { key: string; name: string };
  visitorId: string;
}

export interface VisitorContext {
  /** Your own id for the visitor. Pass the same id to `Tailor.init({ userId })` on the page. */
  id: string;
}

export interface ConvertOptions extends VisitorContext {
  /** Revenue, in `currency`. */
  value?: number;
  /** ISO currency code, e.g. "USD". Defaults to the account's currency. */
  currency?: string;
  /** Your order id. A purchase reported twice with the same order id counts once. */
  orderId?: string;
  /** Extra details kept with the conversion. */
  metadata?: Record<string, string | number | boolean | null>;
}

export interface SdkStatus {
  /** A valid config has loaded. */
  ready: boolean;
  revision: string | null;
  /** Milliseconds since the config was last confirmed current, or null before the first load. */
  configAgeMs: number | null;
  lastError: string | null;
  /** Events waiting to be sent. */
  queuedEvents: number;
  /** Events dropped since start, after retries ran out or the queue filled. */
  droppedEvents: number;
}

const DEFAULT_API_BASE_URL = 'https://cached-api.tailorhq.ai';
const DEFAULT_POLL_INTERVAL_MS = 5 * 60_000;
const MIN_POLL_INTERVAL_MS = 1_000;
const DEFAULT_FLUSH_INTERVAL_MS = 30_000;
const START_TIMEOUT_MS = 3_000;
/** A goal's events are named `conversion-goal-<key>`, the same name the Tailor tag gives them. */
const GOAL_EVENT_NAME_PREFIX = 'conversion-goal-';
const CONFIG_REQUEST_TIMEOUT_MS = 5_000;
/** Remembered (test, visitor) pairs, so one process counts a visitor once. */
const MAX_REMEMBERED_EXPOSURES = 50_000;
const MAX_METADATA_ENTRIES = 20;
const MAX_METADATA_VALUE_LENGTH = 500;

/**
 * Starts the SDK and resolves once the first config has loaded, or after 3
 * seconds, whichever is first. Until a config arrives, every test returns the
 * code defaults and the SDK keeps trying in the background.
 */
export async function init(options: InitOptions): Promise<TailorClient> {
  const client = new TailorClient(options);
  await client.start();
  return client;
}

export class TailorClient {
  private config: ServerSdkConfig | null = null;
  private etag: string | null = null;
  private confirmedAt: number | null = null;
  private lastError: string | null = null;
  private refreshing: Promise<void> | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private readonly counted = new Map<string, true>();
  private readonly warned = new Set<string>();
  private readonly queue: EventQueue;
  private readonly logger: Logger;
  private readonly pollInterval: number;
  private readonly configUrl: string;

  /** @internal Use `init`. */
  constructor(
    private readonly options: InitOptions,
    private readonly fetchImpl: typeof fetch = globalThis.fetch
  ) {
    if (!options?.sdkKey) throw new Error('[tailor] init needs an sdkKey.');
    this.logger = options.logger ?? consoleLogger;
    this.pollInterval = Math.max(options.pollInterval ?? DEFAULT_POLL_INTERVAL_MS, MIN_POLL_INTERVAL_MS);
    const base = (options.apiBaseUrl ?? DEFAULT_API_BASE_URL).replace(/\/+$/, '');
    this.configUrl = `${base}/v1/serving/sdk/${encodeURIComponent(options.sdkKey)}.json`;
    this.queue = new EventQueue({
      maxEvents: Math.min(Math.max(options.batchEvents?.maxEvents ?? 100, 1), 100),
      flushInterval: options.batchEvents?.flushInterval ?? DEFAULT_FLUSH_INTERVAL_MS,
      logger: this.logger,
      fetchImpl
    });
  }

  /** @internal Called by `init`. */
  async start(): Promise<void> {
    this.queue.start();
    this.pollTimer = setInterval(() => {
      void this.refresh();
    }, this.pollInterval);
    this.pollTimer.unref?.();
    const timeout = new Promise<void>((resolve) => setTimeout(resolve, START_TIMEOUT_MS).unref?.());
    await Promise.race([this.refresh(), timeout]);
  }

  /**
   * Which variant of a test this visitor gets. Answers from memory: no network
   * call, never throws. When the test is running, the first call for a visitor
   * counts them in the test, so call it where the variant is actually used.
   */
  getTest(testKey: string, visitor: VisitorContext): TestResult {
    try {
      return this.decide(testKey, visitor);
    } catch (error) {
      this.warnOnce('decide-error', `[tailor] getTest failed and returned the code defaults: ${String(error)}`);
      return new TestResult(testKey, null, {});
    }
  }

  /**
   * Records a goal from your server, for what the page can't see, such as a
   * purchase confirmed by a payment webhook. The goal key is the one shown on
   * the goal in Tailor, the same key `Tailor.convert` takes on a page.
   */
  convert(goalKey: string, options: ConvertOptions): void {
    try {
      this.recordConversion(goalKey, options);
    } catch (error) {
      this.warnOnce('convert-error', `[tailor] convert failed: ${String(error)}`);
    }
  }

  /** Sends every waiting event now. Await it before a serverless handler returns. */
  flush(): Promise<FlushResult> {
    return this.queue.flush();
  }

  status(): SdkStatus {
    return {
      ready: this.config !== null,
      revision: this.config?.revision ?? null,
      configAgeMs: this.confirmedAt === null ? null : Date.now() - this.confirmedAt,
      lastError: this.lastError,
      queuedEvents: this.queue.size,
      droppedEvents: this.queue.dropped
    };
  }

  /** Stops the background timers. Pending events are kept; call `flush()` first to send them. */
  close(): void {
    if (this.pollTimer) clearInterval(this.pollTimer);
    this.pollTimer = null;
    this.queue.stop();
  }

  private decide(testKey: string, visitor: VisitorContext): TestResult {
    this.refreshIfStale();
    const test = this.config?.tests.find((t) => t.key === testKey);
    if (!test) {
      if (this.config) this.warnOnce(`unknown-test:${testKey}`, `[tailor] No running or ramped test has the key "${testKey}".`);
      return new TestResult(testKey, null, {});
    }

    const id = visitor?.id === undefined || visitor?.id === null ? '' : String(visitor.id);
    const trackingId = id ? simpleHash(id) : undefined;

    if (test.status === 'ramped') {
      return this.resultFor(test, test.variants[0].key);
    }

    if (!trackingId) {
      this.warnOnce('no-id', '[tailor] getTest was called without a visitor id, so the code defaults were used.');
      return new TestResult(testKey, null, {});
    }

    const previewKey = test.previewVisitors[trackingId];
    if (previewKey && test.variants.some((v) => v.key === previewKey)) {
      return this.resultFor(test, previewKey);
    }

    const variantKey = assignVariant(
      `${test.trackingKey}-${trackingId}`,
      test.variants.map((v) => ({ name: v.key, fraction: v.fraction }))
    );
    if (!variantKey) return new TestResult(testKey, null, {});

    const result = this.resultFor(test, variantKey);
    this.countVisitor(test, variantKey, trackingId, id, result);
    return result;
  }

  private resultFor(test: ConfigTest, variantKey: string): TestResult {
    const variant = test.variants.find((v) => v.key === variantKey);
    if (!variant) return new TestResult(test.key, null, {});
    return new TestResult(test.key, { key: variant.key, name: variant.name }, variant.values as Record<string, TestValue>);
  }

  private countVisitor(test: ConfigTest, variantKey: string, trackingId: string, id: string, result: TestResult): void {
    const config = this.config;
    if (!config) return;
    const rememberKey = `${test.trackingKey}:${trackingId}`;
    if (this.counted.has(rememberKey)) return;
    if (this.counted.size >= MAX_REMEMBERED_EXPOSURES) {
      const oldest = this.counted.keys().next().value;
      if (oldest !== undefined) this.counted.delete(oldest);
    }
    this.counted.set(rememberKey, true);

    this.queue.push({
      name: 'sdk_exposure',
      eventType: 'experiment',
      timestamp: Date.now(),
      experiments: [{ experimentId: test.trackingKey, treatment: variantKey }],
      metadata: {
        orgId: config.orgId,
        userId: trackingId,
        source: 'sdk',
        version: VERSION,
        properties: this.baseProperties(config, { testKey: test.key, configRevision: config.revision })
      }
    });

    if (this.options.onTailored && result.variant) {
      try {
        this.options.onTailored({ testKey: test.key, variant: result.variant, visitorId: id });
      } catch (error) {
        this.warnOnce('on-tailored-error', `[tailor] onTailored threw: ${String(error)}`);
      }
    }
  }

  private recordConversion(goalKey: string, options: ConvertOptions): void {
    const id = options?.id === undefined || options?.id === null ? '' : String(options.id);
    const trackingId = id ? simpleHash(id) : undefined;
    if (!trackingId) {
      this.warnOnce('convert-no-id', '[tailor] convert was called without a visitor id, so nothing was recorded.');
      return;
    }
    const config = this.config;
    if (!config) {
      this.warnOnce('convert-no-config', '[tailor] convert was called before a config loaded, so nothing was recorded.');
      return;
    }
    if (typeof goalKey !== 'string' || goalKey.length === 0) {
      this.warnOnce('convert-no-goal', '[tailor] convert was called without a goal key, so nothing was recorded.');
      return;
    }
    // The name Tailor records a goal under. Not checked against the account's
    // goals, so a goal made in Tailor counts from its first conversion; a key
    // that names no goal is recorded and counted toward nothing.
    const eventName = `${GOAL_EVENT_NAME_PREFIX}${goalKey}`;

    const properties: Record<string, unknown> = this.baseProperties(config, { conversionGoalKey: goalKey });
    if (typeof options.value === 'number' && Number.isFinite(options.value)) {
      properties.revenueValue = options.value;
      properties.isRevenue = true;
      if (options.currency) properties.revenueCurrency = options.currency.toUpperCase();
    }
    if (options.orderId) properties.orderId = String(options.orderId);
    const metadata = capMetadata(options.metadata);
    if (metadata) properties.callbackMetadata = metadata;

    const event: TailorEventPayload = {
      name: eventName,
      eventType: 'conversion',
      timestamp: Date.now(),
      metadata: { orgId: config.orgId, userId: trackingId, source: 'sdk', version: VERSION, properties }
    };
    this.queue.push(event);
  }

  private baseProperties(config: ServerSdkConfig, extra: Record<string, unknown>): Record<string, unknown> {
    return {
      ...extra,
      orgId: config.orgId,
      sdkEnvironment: config.environment,
      eventId: randomUUID(),
      // The event's time is when the SDK saw it, not when its batch arrived,
      // so a quick conversion can never land before the visit it follows.
      useClientTimestampAsServerTimestamp: 'true'
    };
  }

  private refreshIfStale(): void {
    if (this.confirmedAt === null || Date.now() - this.confirmedAt > this.pollInterval * 2) {
      void this.refresh();
    }
  }

  private refresh(): Promise<void> {
    if (!this.refreshing) {
      this.refreshing = this.load().finally(() => {
        this.refreshing = null;
      });
    }
    return this.refreshing;
  }

  private async load(): Promise<void> {
    try {
      const headers: Record<string, string> = { accept: 'application/json' };
      if (this.etag && this.config) headers['if-none-match'] = this.etag;
      const response = await this.fetchImpl(this.configUrl, {
        headers,
        signal: AbortSignal.timeout(CONFIG_REQUEST_TIMEOUT_MS)
      });
      if (response.status === 304) {
        this.confirmedAt = Date.now();
        this.lastError = null;
        return;
      }
      if (response.status === 404) {
        this.lastError = 'The SDK key was not recognised. Check it in Settings → Websites & publishing.';
        this.warnOnce('bad-key', `[tailor] ${this.lastError}`);
        return;
      }
      if (!response.ok) {
        this.lastError = `Config request failed with status ${response.status}`;
        return;
      }
      const checked = validateConfig(await response.json());
      if ('error' in checked) {
        this.lastError = `Refused a config: ${checked.error}`;
        this.logger.error(`[tailor] ${this.lastError}. Keeping the last good one.`);
        return;
      }
      this.config = checked.config;
      this.etag = response.headers.get('etag');
      this.confirmedAt = Date.now();
      this.lastError = null;
      this.queue.setTrackingUrl(checked.config.trackingUrl);
    } catch (error) {
      this.lastError = `Config request failed: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  private warnOnce(key: string, message: string): void {
    if (this.warned.has(key)) return;
    this.warned.add(key);
    this.logger.warn(message);
  }
}

const capMetadata = (
  metadata: ConvertOptions['metadata']
): Record<string, string | number | boolean | null> | undefined => {
  if (!metadata || typeof metadata !== 'object') return undefined;
  const entries = Object.entries(metadata).slice(0, MAX_METADATA_ENTRIES);
  if (entries.length === 0) return undefined;
  return Object.fromEntries(
    entries.map(([key, value]) => [
      key,
      typeof value === 'string' ? value.slice(0, MAX_METADATA_VALUE_LENGTH) : value
    ])
  );
};
