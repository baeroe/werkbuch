/*
 * Manual order (spec 4.8, 13): every item carries a rank, a string that sorts between its neighbours. Moving an item
 * only changes its own rank. Ranks are fractional-indexing keys and must be compared as plain strings (`<`), never
 * with a locale-aware comparison.
 */

import { generateKeyBetween } from 'fractional-indexing';

/**
 * A rank that sorts strictly between two neighbours. `null` stands for "no neighbour": `rankBetween(null, null)` is
 * the first rank of an empty list, `rankBetween(last, null)` appends, `rankBetween(null, first)` prepends.
 * Throws when both neighbours have the same rank or when a rank is not a fractional-indexing key.
 */
export function rankBetween(before: string | null, after: string | null): string {
  if (before !== null && before === after) {
    throw new Error(`rankBetween: both neighbours have the rank "${before}"`);
  }
  return generateKeyBetween(before, after);
}
