/*
 * Item keys (spec 4.4, 4.17): the project identifier and the number, `WEB-123`.
 */

/**
 * An identifier has 2-10 letters or digits and starts with a letter; the number is a positive whole number of at most
 * ten digits up to `MAX_NUMBER`, as `ItemKey::parse` reads it (an unsigned int column, A125).
 */
const KEY_PATTERN = /^([A-Za-z][A-Za-z0-9]{1,9})-(\d{1,10})$/;

export const MAX_NUMBER = 4294967295;

/** Reads what a person typed as a key. Case and surrounding space do not matter; null when it is not a key. */
export function parseKey(input: string): { identifier: string; number: number } | null {
  const match = KEY_PATTERN.exec(input.trim());
  if (!match) return null;

  const number = Number(match[2]);
  if (number < 1 || number > MAX_NUMBER) return null;

  return { identifier: match[1].toUpperCase(), number };
}
