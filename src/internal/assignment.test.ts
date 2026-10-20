import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { assignmentPoint, assignVariant, fasterHash, simpleHash } from './assignment';

interface RecordedAssignment {
  visitorId: string;
  trackingId: string;
  hashInput: string;
  variants: Array<{ name: string; fraction: number }>;
  expected: string;
}

// Answers recorded from Tailor's own implementation. If one of these fails,
// this package would record a different visitor id than the Tailor tag. The
// file's `assignments` block is the tag's own assignment, kept only so the file
// stays byte-identical to the shared copy; this package assigns differently and
// checks its answers against `assignment.sdk-vectors.json` below.
const vectors = JSON.parse(readFileSync(join(__dirname, 'assignment.vectors.json'), 'utf8')) as {
  simpleHash: Array<{ input: string; output: string }>;
  fasterHash: Array<{ input: string; output: number }>;
};

// This package's own answers. If one of these fails, a release would move
// visitors of a running server-side test into a different variant.
const sdkVectors = JSON.parse(readFileSync(join(__dirname, 'assignment.sdk-vectors.json'), 'utf8')) as {
  assignmentPoint: Array<{ input: string; output: number }>;
  assignments: RecordedAssignment[];
};

const TWO_ARMS = [
  { name: 'control', fraction: 0.5 },
  { name: 'treatment', fraction: 0.5 }
];

describe('assignment matches Tailor', () => {
  it('hashes visitor ids the way the Tailor tag does', () => {
    for (const { input, output } of vectors.simpleHash) expect(simpleHash(input)).toBe(output);
  });

  it('computes the same position for every input', () => {
    for (const { input, output } of vectors.fasterHash) expect(fasterHash(input)).toBe(output);
  });

  it('places every recorded input at the same point', () => {
    for (const { input, output } of sdkVectors.assignmentPoint) expect(assignmentPoint(input)).toBe(output);
  });

  it('picks the same variant for every recorded visitor', () => {
    for (const { visitorId, trackingId, hashInput, variants, expected } of sdkVectors.assignments) {
      expect(simpleHash(visitorId)).toBe(trackingId);
      expect(assignVariant(hashInput, variants)).toBe(expected);
    }
  });

  // Customer ids are often sequential. Before the mix, neighbouring ids shared a
  // variant 92% of the time, so a block of customers who signed up together
  // landed almost entirely in one variant while the overall split still read 50/50.
  it.each([
    ['plain numbers', (i: number) => String(i)],
    ['prefixed numbers', (i: number) => `user-${i}`]
  ])('spreads sequential ids (%s) across variants like random ones', (_label, idFor) => {
    const COUNT = 4000;
    const BLOCK = 50;
    const arms: number[] = Array.from({ length: COUNT }, (_, i) =>
      assignVariant(`NM5o3g--checkout-headline-${simpleHash(idFor(i + 1))}`, TWO_ARMS) === 'treatment' ? 1 : 0
    );

    let sameAsNeighbour = 0;
    for (let i = 1; i < COUNT; i++) if (arms[i] === arms[i - 1]) sameAsNeighbour++;
    // Chance is 0.5 with a standard error under 0.01 at this count.
    expect(sameAsNeighbour / (COUNT - 1)).toBeGreaterThan(0.45);
    expect(sameAsNeighbour / (COUNT - 1)).toBeLessThan(0.55);

    // Each block of 50 consecutive customers should be close to the overall
    // split: chance alone gives a spread of about 0.07 between blocks.
    const shares: number[] = [];
    for (let i = 0; i < COUNT; i += BLOCK) shares.push(arms.slice(i, i + BLOCK).reduce((a, b) => a + b, 0) / BLOCK);
    const mean = shares.reduce((a, b) => a + b, 0) / shares.length;
    const spread = Math.sqrt(shares.reduce((a, b) => a + (b - mean) ** 2, 0) / shares.length);
    expect(spread).toBeLessThan(0.1);
  });

  it('ignores the order variants are listed in', () => {
    const variants = [
      { name: 'variant-1', fraction: 0.5 },
      { name: 'control', fraction: 0.5 }
    ];
    for (const id of ['a', 'b', 'c', 'd']) {
      expect(assignVariant(id, variants)).toBe(assignVariant(id, [...variants].reverse()));
    }
  });

  it('refuses a split that does not add up to 100%', () => {
    expect(
      assignVariant('x', [
        { name: 'control', fraction: 0.5 },
        { name: 'variant-1', fraction: 0.4 }
      ])
    ).toBeNull();
  });

  it('returns nothing for an empty id', () => {
    expect(simpleHash('')).toBeUndefined();
  });
});
