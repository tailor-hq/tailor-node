/**
 * How a visitor is placed in a variant.
 *
 * `simpleHash` and `fasterHash` are copies of the Tailor tag's functions, copied
 * rather than imported because this package ships to customers and carries no
 * dependency on Tailor's private packages. `assignment.vectors.json` holds fixed
 * inputs and the answers Tailor's own code gives for them; this package's test
 * and the monorepo's shared test both read it, so the copies cannot drift.
 * `simpleHash` must agree with the tag: it is the visitor id both sides record.
 *
 * `assignVariant` is this package's own. It mixes `fasterHash` once more before
 * reading a position, because customer ids are often sequential (`1, 2, 3`,
 * `user-41`), their `simpleHash` values differ only in the last characters, and
 * FNV-1a alone leaves those inputs close together: neighbouring customers shared
 * a variant 92% of the time. `assignment.sdk-vectors.json` pins its answers.
 *
 * Sources: `packages/shared/src/util/treatment-assignment.ts` (fasterHash) and
 * `packages/shared/src/util/collections.ts` (simpleHash).
 */

export interface WeightedVariant {
  name: string;
  fraction: number;
}

const FRACTION_SUM_TOLERANCE = 0.0001;

/**
 * The visitor id Tailor stores for a customer-supplied id: a short hash, never
 * the raw id. The Tailor tag computes the same value after
 * `Tailor.init({ userId })`, which is what lets a server decision and the
 * visitor's page events be joined.
 */
export function simpleHash(input: string): string | undefined {
  if (!input) return undefined;
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    hash = (hash << 5) - hash + input.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash).toString(36).substring(0, 8);
}

/** FNV-1a, as an unsigned 32-bit integer. */
function fnv1a(str: string): number {
  const PRIME = 0x01000193;
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, PRIME);
  }
  return hash >>> 0;
}

/** FNV-1a, normalised to [0, 1]. */
export function fasterHash(str: string): number {
  return fnv1a(str) / 0xffffffff;
}

/** MurmurHash3's 32-bit finalizer: every input bit moves every output bit. */
function mix32(hash: number): number {
  let h = hash;
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/** Where `id` falls in [0, 1]: FNV-1a, then mixed. */
export function assignmentPoint(id: string): number {
  return mix32(fnv1a(id)) / 0xffffffff;
}

/**
 * Picks a variant for `id`, deterministically. Variants are walked in name
 * order, so the order a config lists them in never changes anyone's variant.
 * Returns null when the fractions don't add up to 1, which a valid config
 * never produces; the caller treats that as "not tailored".
 */
export function assignVariant(id: string, variants: readonly WeightedVariant[]): string | null {
  if (variants.length === 0) return null;
  const total = variants.reduce((sum, v) => sum + v.fraction, 0);
  if (Math.abs(total - 1) > FRACTION_SUM_TOLERANCE) return null;

  const sorted = [...variants].sort((a, b) => a.name.localeCompare(b.name));
  const point = assignmentPoint(id);
  let cumulative = 0;
  for (const variant of sorted) {
    cumulative += variant.fraction;
    if (point < cumulative) return variant.name;
  }
  return sorted[sorted.length - 1].name;
}
