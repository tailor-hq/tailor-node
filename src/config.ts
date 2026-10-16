/**
 * The config file the SDK downloads from Tailor's CDN, and the check that runs
 * on every copy before it replaces the one in memory.
 *
 * The file is built by Tailor's backend (`packages/backend/services/server-sdk-config.ts`
 * in the Tailor monorepo) and is the same for every server holding the key.
 * Anyone with the key can read it, so it never carries a secret.
 */

export type TestValue = string | number | boolean | null | TestValue[] | { [key: string]: TestValue };

export interface ConfigVariant {
  /** Stable id for the variant; `control` for the Original Page. */
  key: string;
  /** The name shown in Tailor, e.g. "Original Page" or "Shorter checkout". */
  name: string;
  /** Share of visitors, 0 to 1. The variants of a running test add up to 1. */
  fraction: number;
  /** The values this variant sets, by name. */
  values: Record<string, TestValue>;
}

export interface ConfigTest {
  /** The key customer code passes to `getTest`. */
  key: string;
  name: string;
  status: 'running' | 'ramped';
  /** Tailor's id for the test in its events. Never shown to visitors. */
  trackingKey: string;
  /** Running: every variant, Original Page first. Ramped: only the winner, at 1. */
  variants: ConfigVariant[];
  /** Hashed visitor id → variant key, for preview visitors. */
  previewVisitors: Record<string, string>;
}

export interface ServerSdkConfig {
  schemaVersion: 1;
  /** Changes whenever anything in the account's tests changes. */
  revision: string;
  orgId: string;
  environment: 'production' | 'development';
  /** Where events are posted. */
  trackingUrl: string;
  tests: ConfigTest[];
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isString = (value: unknown): value is string => typeof value === 'string' && value.length > 0;

const FRACTION_SUM_TOLERANCE = 0.0001;

/**
 * Returns the config when it is complete and consistent, or a reason it was
 * refused. A refused config never replaces the last good one.
 */
export function validateConfig(raw: unknown): { config: ServerSdkConfig } | { error: string } {
  if (!isRecord(raw)) return { error: 'config is not an object' };
  if (raw.schemaVersion !== 1) return { error: `unsupported config schemaVersion ${String(raw.schemaVersion)}` };
  if (!isString(raw.revision)) return { error: 'config has no revision' };
  if (!isString(raw.orgId)) return { error: 'config has no orgId' };
  if (raw.environment !== 'production' && raw.environment !== 'development') {
    return { error: 'config has no environment' };
  }
  if (!isString(raw.trackingUrl)) return { error: 'config has no trackingUrl' };
  if (!Array.isArray(raw.tests)) return { error: 'config has no tests list' };

  const keys = new Set<string>();
  for (const test of raw.tests) {
    if (!isRecord(test) || !isString(test.key) || !isString(test.trackingKey) || !isString(test.name)) {
      return { error: 'a test is missing its key, name or trackingKey' };
    }
    if (keys.has(test.key)) return { error: `test key ${test.key} appears twice` };
    keys.add(test.key);
    if (test.status !== 'running' && test.status !== 'ramped') {
      return { error: `test ${test.key} has an unknown status` };
    }
    if (!Array.isArray(test.variants) || test.variants.length === 0) {
      return { error: `test ${test.key} has no variants` };
    }
    let total = 0;
    for (const variant of test.variants) {
      if (
        !isRecord(variant) ||
        !isString(variant.key) ||
        typeof variant.name !== 'string' ||
        typeof variant.fraction !== 'number' ||
        !isRecord(variant.values)
      ) {
        return { error: `test ${test.key} has a malformed variant` };
      }
      total += variant.fraction;
    }
    if (Math.abs(total - 1) > FRACTION_SUM_TOLERANCE) {
      return { error: `test ${test.key}'s split does not add up to 100%` };
    }
    if (!isRecord(test.previewVisitors)) return { error: `test ${test.key} has no previewVisitors map` };
  }

  return { config: raw as unknown as ServerSdkConfig };
}
