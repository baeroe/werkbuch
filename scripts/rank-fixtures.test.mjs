import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { FIXTURE_PATH, rankFixtures, rankFixturesJson } from './rank-fixtures.mjs';

describe('rank fixtures', () => {
  it('are what the script writes with the installed fractional-indexing', () => {
    expect(fs.readFileSync(FIXTURE_PATH, 'utf8')).toBe(rankFixturesJson());
  });

  it('cover the edges, 200 random and 100 same-spot inserts, runs of 1, 3 and 10 keys and the refused keys', () => {
    const fixtures = rankFixtures();

    expect(fixtures.between[0]).toEqual([null, null, 'a0']);
    expect(fixtures.between.length).toBeGreaterThanOrEqual(300);
    expect(fixtures.nBetween.map(([, , n]) => n)).toEqual([1, 3, 10, 1, 3, 10, 1, 3, 10, 1, 3, 10]);
    expect(fixtures.invalid).toEqual(['', 'a', 'a00', 'A00000000000000000000000000', 'a0 ']);
  });
});
