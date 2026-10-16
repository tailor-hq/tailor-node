import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { assignVariant, fasterHash, simpleHash } from './assignment';

// Answers recorded from Tailor's own implementation. If one of these fails,
// this copy would put visitors in different variants than Tailor expects.
const vectors = JSON.parse(readFileSync(join(__dirname, 'assignment.vectors.json'), 'utf8')) as {
  simpleHash: Array<{ input: string; output: string }>;
  fasterHash: Array<{ input: string; output: number }>;
  assignments: Array<{
    visitorId: string;
    trackingId: string;
    hashInput: string;
    variants: Array<{ name: string; fraction: number }>;
    expected: string;
  }>;
};

describe('assignment matches Tailor', () => {
  it('hashes visitor ids the way the Tailor tag does', () => {
    for (const { input, output } of vectors.simpleHash) expect(simpleHash(input)).toBe(output);
  });

  it('computes the same position for every input', () => {
    for (const { input, output } of vectors.fasterHash) expect(fasterHash(input)).toBe(output);
  });

  it('picks the same variant for every recorded visitor', () => {
    for (const { visitorId, trackingId, hashInput, variants, expected } of vectors.assignments) {
      expect(simpleHash(visitorId)).toBe(trackingId);
      expect(assignVariant(hashInput, variants)).toBe(expected);
    }
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
