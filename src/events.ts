import type { Logger } from './logger.js';

/**
 * One event in the shape the Tailor tag sends, so the tracking endpoint and the
 * warehouse treat both the same. `metadata.userId` carries the hashed visitor
 * id, which becomes the event's tracking id.
 */
export interface TailorEventPayload {
  name: string;
  eventType: 'experiment' | 'conversion';
  timestamp: number;
  experiments?: Array<{ experimentId: string; treatment: string }>;
  metadata: {
    orgId: string;
    userId: string;
    source: 'sdk';
    version: string;
    properties: Record<string, unknown>;
  };
}

export interface FlushResult {
  sent: number;
  dropped: number;
}

export interface EventQueueOptions {
  maxEvents: number;
  flushInterval: number;
  logger: Logger;
  /** Overridable in tests; the global fetch otherwise. */
  fetchImpl: typeof fetch;
}

/** The tracking endpoint takes at most this many events in one request. */
export const MAX_EVENTS_PER_REQUEST = 100;
/** Past this many waiting events, new ones are dropped and counted. */
export const MAX_QUEUED_EVENTS = 10_000;
const RETRY_DELAYS_MS = [1_000, 2_000, 4_000];
const REQUEST_TIMEOUT_MS = 10_000;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms).unref?.());

/**
 * Holds events in memory and sends them in batches. Nothing here survives the
 * process exiting, which is why a purchase should be sent from a retryable job
 * or webhook, and why a serverless handler calls `flush()` before it returns.
 */
export class EventQueue {
  private queue: TailorEventPayload[] = [];
  private droppedTotal = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private inFlight: Promise<FlushResult> | null = null;
  private trackingUrl: string | null = null;

  constructor(private readonly options: EventQueueOptions) {}

  setTrackingUrl(url: string): void {
    this.trackingUrl = url;
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.flush();
    }, this.options.flushInterval);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  get dropped(): number {
    return this.droppedTotal;
  }

  get size(): number {
    return this.queue.length;
  }

  push(event: TailorEventPayload): void {
    if (this.queue.length >= MAX_QUEUED_EVENTS) {
      this.droppedTotal += 1;
      return;
    }
    this.queue.push(event);
    // A send under way keeps draining until the queue is empty, so a full batch
    // only needs to start one when none is running.
    if (this.queue.length >= this.options.maxEvents && !this.inFlight) void this.flush();
  }

  /**
   * Sends everything queued so far. Resolves with what was sent and dropped,
   * counting a send that was already under way when it was called.
   */
  flush(): Promise<FlushResult> {
    if (this.inFlight) {
      return this.inFlight.then(async (underWay) => {
        const rest = await this.flush();
        return { sent: underWay.sent + rest.sent, dropped: underWay.dropped + rest.dropped };
      });
    }
    this.inFlight = this.drain().finally(() => {
      this.inFlight = null;
    });
    return this.inFlight;
  }

  private async drain(): Promise<FlushResult> {
    const result: FlushResult = { sent: 0, dropped: 0 };
    while (this.queue.length > 0) {
      if (!this.trackingUrl) {
        // No config has loaded, so there is nowhere to send them yet. They stay
        // queued for the next flush.
        return result;
      }
      const batch = this.queue.splice(0, Math.min(this.options.maxEvents, MAX_EVENTS_PER_REQUEST));
      const ok = await this.send(this.trackingUrl, batch);
      if (ok) {
        result.sent += batch.length;
      } else {
        result.dropped += batch.length;
        this.droppedTotal += batch.length;
        this.options.logger.warn(`[tailor] Dropped ${batch.length} events after retrying.`);
      }
    }
    return result;
  }

  private async send(url: string, events: TailorEventPayload[]): Promise<boolean> {
    for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
      try {
        const response = await this.options.fetchImpl(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ events }),
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
        });
        if (response.ok) return true;
        // A 4xx other than rate limiting will fail the same way again.
        if (response.status >= 400 && response.status < 500 && response.status !== 429) {
          this.options.logger.error(`[tailor] Tracking endpoint refused events with status ${response.status}.`);
          return false;
        }
      } catch {
        // Network error or timeout: retry below.
      }
      if (attempt < RETRY_DELAYS_MS.length) await sleep(RETRY_DELAYS_MS[attempt]);
    }
    return false;
  }
}
