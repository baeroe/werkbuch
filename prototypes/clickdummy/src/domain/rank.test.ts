import { describe, expect, it } from 'vitest';
import { rankBetween } from './rank';

/** A small seeded generator (mulberry32), so the "random" inserts are the same on every run. */
function seededRandom(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('rankBetween', () => {
  it('50 random inserts between neighbours stay strictly sorted and unique', () => {
    const random = seededRandom(2026);
    const ranks: string[] = [];

    for (let i = 0; i < 50; i++) {
      const at = Math.floor(random() * (ranks.length + 1));
      const before = at > 0 ? ranks[at - 1] : null;
      const after = at < ranks.length ? ranks[at] : null;
      const rank = rankBetween(before, after);

      // the new rank lies strictly between its neighbours ...
      if (before !== null) expect(rank > before).toBe(true);
      if (after !== null) expect(rank < after).toBe(true);
      ranks.splice(at, 0, rank);
    }

    // ... so the whole list is strictly increasing and has no duplicates
    for (let i = 1; i < ranks.length; i++) {
      expect(ranks[i] > ranks[i - 1]).toBe(true);
    }
    expect(new Set(ranks).size).toBe(ranks.length);
  });

  it('gives a first rank for an empty list', () => {
    expect(rankBetween(null, null)).toBe('a0');
  });

  it('sorts after the last and before the first rank', () => {
    const middle = rankBetween(null, null);

    expect(rankBetween(middle, null) > middle).toBe(true);
    expect(rankBetween(null, middle) < middle).toBe(true);
  });

  it('keeps working when items are always inserted at the same spot', () => {
    let before = rankBetween(null, null);
    const after = rankBetween(before, null);
    const seen = new Set<string>([before, after]);

    for (let i = 0; i < 30; i++) {
      const next = rankBetween(before, after);
      expect(next > before && next < after).toBe(true);
      expect(seen.has(next)).toBe(false);
      seen.add(next);
      before = next;
    }
  });

  it('refuses two neighbours with the same rank', () => {
    expect(() => rankBetween('a0', 'a0')).toThrow(/a0/);
  });
});
