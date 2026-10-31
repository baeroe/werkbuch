/*
 * The fixture of the PHP rank (app/Domain/Ranking/Rank.php, tests/Unit/Domain/RankTest.php): what fractional-indexing
 * answers for the edge cases, 200 inserts at seeded random spots, 100 inserts at the same spot and a few runs of
 * several keys. The PHP port has to give the very same keys. `ddev exec node scripts/rank-fixtures.mjs` writes
 * tests/Support/rank-fixtures.json; scripts/rank-fixtures.test.mjs checks that the file is what this script writes.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateKeyBetween, generateNKeysBetween } from 'fractional-indexing';

export const FIXTURE_PATH = path.resolve(import.meta.dirname, '../tests/Support/rank-fixtures.json');

/** A small seeded generator (mulberry32, as in the clickdummy's rank.test.ts), so the inserts are the same on every run. */
function seededRandom(seed) {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Keys the PHP rank refuses. fractional-indexing refuses all but `a0 ` as well; it reads the blank as a digit, the PHP
 * rank allows only the 62 digits (RankTest pins that difference).
 */
const INVALID = ['', 'a', 'a00', 'A00000000000000000000000000', 'a0 '];

/** The fixture: `between` as [before, after, result], `nBetween` as [before, after, n, results], `invalid` keys. */
export function rankFixtures() {
  const between = [];
  const record = (before, after) => {
    const result = generateKeyBetween(before, after);
    between.push([before, after, result]);
    return result;
  };

  // (a) the edges: an empty list, before the first, after the last, across the integer parts and at the smallest one
  for (const [before, after] of [
    [null, null],
    [null, 'a0'],
    ['a0', null],
    ['a0', 'a1'],
    ['a0', 'a0V'],
    ['a0V', 'a1'],
    ['Zz', 'a0'],
    ['Zz', null],
    [null, 'Zz'],
    ['az', null],
    ['azz', null],
    [null, 'b00'],
    ['Yzz', 'Zz'],
    ['zzzzzzzzzzzzzzzzzzzzzzzzzzy', null],
    ['zzzzzzzzzzzzzzzzzzzzzzzzzzz', null],
    [null, 'A00000000000000000000000000V'],
    ['a0', 'a01'],
    ['a1', 'a1001'],
    ['a0V', 'a0WV'],
  ]) {
    record(before, after);
  }

  // (b) 200 inserts at spots of a seeded generator
  const random = seededRandom(4);
  const ranks = [];
  for (let i = 0; i < 200; i++) {
    const at = Math.floor(random() * (ranks.length + 1));
    const rank = record(at > 0 ? ranks[at - 1] : null, at < ranks.length ? ranks[at] : null);
    ranks.splice(at, 0, rank);
  }

  // (c) 100 inserts, always right after the same item
  let before = generateKeyBetween(null, null);
  const after = generateKeyBetween(before, null);
  for (let i = 0; i < 100; i++) {
    before = record(before, after);
  }

  // (d) several keys at once
  const nBetween = [];
  for (const [first, last] of [
    [null, null],
    ['a0', null],
    [null, 'a0'],
    ['a0', 'a1'],
  ]) {
    for (const n of [1, 3, 10]) {
      nBetween.push([first, last, n, generateNKeysBetween(first, last, n)]);
    }
  }

  return { between, nBetween, invalid: INVALID };
}

/** The fixture as it is written to the file. */
export function rankFixturesJson() {
  return `${JSON.stringify(rankFixtures(), null, 2)}\n`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  fs.writeFileSync(FIXTURE_PATH, rankFixturesJson());
}
