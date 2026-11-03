import { describe, expect, it } from 'vitest';
import { isEmoji } from './emoji';
import fixtures from './emoji-fixtures.json';

/** The cases of emoji-fixtures.json, which tests/Unit/Domain/EmojiTest.php reads as well (T2-M4). */
describe('isEmoji', () => {
  const longest = fixtures.takes['one of 64 bytes'];

  it.each(Object.entries(fixtures.takes))('takes %s', (_, text) => {
    expect(isEmoji(text)).toBe(true);
  });

  it.each(Object.entries(fixtures.refuses))('refuses %s', (_, text) => {
    expect(isEmoji(text)).toBe(false);
  });

  it('counts the bytes of the longest emoji it takes', () => {
    expect(new TextEncoder().encode(longest).length).toBe(64);
  });
});
