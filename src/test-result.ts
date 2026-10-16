import type { TestValue } from './config.js';

/** The variant a visitor got. `key` is `control` for the Original Page. */
export interface Variant {
  key: string;
  name: string;
}

/**
 * The answer `getTest` gives for one visitor and one test. Reading it never
 * makes a network call and never throws.
 */
export class TestResult {
  /** @internal */
  constructor(
    /** The test key that was asked for. */
    readonly key: string,
    /** The variant this visitor gets, or null when the visitor isn't in the test. */
    readonly variant: Variant | null,
    private readonly values: Readonly<Record<string, TestValue>>
  ) {}

  /**
   * True when this visitor gets one of the test's variants: they're in a
   * running test (the Original Page counts) or the test is ramped. The same
   * question the browser's `Tailor.isTailored()` answers for a page.
   */
  isTailored(): boolean {
    return this.variant !== null;
  }

  /**
   * One of the variant's values, or `defaultValue` when the visitor isn't in
   * the test, the variant doesn't set it, or the stored value's type doesn't
   * match the default's.
   */
  getValue<T extends TestValue>(name: string, defaultValue: T): T {
    if (!this.variant || !Object.prototype.hasOwnProperty.call(this.values, name)) return defaultValue;
    const value = this.values[name];
    if (defaultValue === null || defaultValue === undefined) return value as T;
    const expected = Array.isArray(defaultValue) ? 'array' : typeof defaultValue;
    const actual = Array.isArray(value) ? 'array' : value === null ? 'null' : typeof value;
    return actual === expected ? (value as T) : defaultValue;
  }

  /** Every value the variant sets, or an empty object when the visitor isn't in the test. */
  getValues(): Record<string, TestValue> {
    return this.variant ? { ...this.values } : {};
  }
}
