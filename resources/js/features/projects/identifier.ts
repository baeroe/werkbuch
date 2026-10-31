/*
 * The suggestion for the identifier of a new project (spec 4.4): 2 to 10 capital letters or digits, starting with a
 * letter, and unique. The dialog "Neues Projekt" fills the field with it while the person types the name.
 *
 * The name is spelled out first: umlauts and ß are written as AE, OE, UE and SS (before uppercasing, so `Ärzte` gives
 * AER and not ARZ), other accents are dropped, and everything that is not a letter or a digit separates the words.
 * Then the candidates in this order, the first one that is valid and not taken wins:
 *   1. the first 3 characters of the first word
 *   2. the first 2 characters of the first word and the first character of the second word
 *   3. the initials of all words, at least 2 (and at most 10)
 *   4. candidate 1 with a digit from 2 to 9 appended
 * Words in front of the first one that starts with a letter are left out, because an identifier cannot start with a
 * digit (`2026 Kampagne` gives KAM). Nothing fits, or there is no name yet: an empty string.
 */

const IDENTIFIER = /^[A-Z][A-Z0-9]{1,9}$/;
const MAX_LENGTH = 10;
const GERMAN_SPELLING: [RegExp, string][] = [
  [/Ä/g, 'AE'],
  [/Ö/g, 'OE'],
  [/Ü/g, 'UE'],
  [/ẞ/g, 'SS'],
];

/** The words of a name as capital letters and digits only. */
function wordsOf(name: string): string[] {
  // composed first, so that an "a" with a separate diaeresis counts as Ä; toUpperCase turns ß into SS
  let spelled = name.normalize('NFC').toUpperCase();
  for (const [pattern, replacement] of GERMAN_SPELLING) spelled = spelled.replace(pattern, replacement);
  const words = spelled
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .split(/[^A-Z0-9]+/)
    .filter(Boolean);
  const firstWithLetter = words.findIndex((word) => /^[A-Z]/.test(word));
  return firstWithLetter === -1 ? [] : words.slice(firstWithLetter);
}

/** Suggests an identifier for a project of this name, or '' when nothing fits. `taken` are the existing identifiers. */
export function suggestIdentifier(name: string, taken: string[]): string {
  const words = wordsOf(name);
  if (words.length === 0) return '';
  const [first, second] = words;
  const takenSet = new Set(taken.map((identifier) => identifier.toUpperCase()));

  const base = first.slice(0, 3);
  const candidates = [base];
  if (second) candidates.push(first.slice(0, 2) + second[0]);
  if (words.length >= 2) candidates.push(words.map((word) => word[0]).join('').slice(0, MAX_LENGTH));
  // a base that is no identifier by itself ("W") is not worth a digit: wait for the next letter
  if (IDENTIFIER.test(base)) for (let digit = 2; digit <= 9; digit += 1) candidates.push(`${base}${digit}`);

  return candidates.find((candidate) => IDENTIFIER.test(candidate) && !takenSet.has(candidate)) ?? '';
}
