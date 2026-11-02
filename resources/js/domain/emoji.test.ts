import { describe, expect, it } from 'vitest';
import { isEmoji } from './emoji';

/** The lists of tests/Unit/Domain/EmojiTest.php: the browser offers what App\Domain\Emoji::is takes, nothing else. */
describe('isEmoji', () => {
  const longest = ['\u{2764}\u{FE0F}', '\u{2764}\u{FE0F}', ...Array<string>(7).fill('🚀')].join('\u{200D}');

  it.each([
    ['a pictograph', '👍'],
    ['one with a skin tone', '👍🏽'],
    ['a text pictograph with a skin tone', '\u{261D}\u{1F3FD}'],
    ['a sequence of zero-width joins', '👩‍💻'],
    ['a join of a text pictograph with its selector', '🏃\u{200D}\u{2640}\u{FE0F}'],
    ['a join that starts with a selector', '\u{1F441}\u{FE0F}\u{200D}\u{1F5E8}\u{FE0F}'],
    ['a flag', '🇩🇪'],
    ['a subdivision flag', '\u{1F3F4}\u{E0067}\u{E0062}\u{E0073}\u{E0063}\u{E0074}\u{E007F}'],
    ['a keycap', '1\u{FE0F}\u{20E3}'],
    ['a keycap without its selector', '1\u{20E3}'],
    ['a number sign keycap', '#\u{FE0F}\u{20E3}'],
    ['a text pictograph with its selector', '\u{2764}\u{FE0F}'],
    ['a copyright sign with its selector', '\u{00A9}\u{FE0F}'],
    ['a pictograph of Unicode 14', '🫠'],
    ['one of 64 bytes', longest],
  ])('takes %s', (_, text) => {
    expect(isEmoji(text)).toBe(true);
  });

  it.each([
    ['nothing', ''],
    ['a letter', 'a'],
    ['a copyright sign', '\u{00A9}'],
    ['a double exclamation mark', '\u{203C}'],
    ['a trade mark sign', '\u{2122}'],
    ['a heart without its selector', '\u{2764}'],
    ['a copyright sign with a skin tone', '\u{00A9}\u{1F3FD}'],
    ['two emoji', '👍👍'],
    ['an emoji and a space', '👍 '],
    ['an emoji and a line break', '👍\n'],
    ['half a flag', '\u{1F1E9}'],
    ['a skin tone alone', '\u{1F3FD}'],
    ['a keycap on a letter', 'x\u{20E3}'],
    ['a plain digit', '1'],
    ['a subdivision flag without its end', '\u{1F3F4}\u{E0067}\u{E0062}'],
    ['more than 64 bytes', `${longest}\u{200D}🚀`],
  ])('refuses %s', (_, text) => {
    expect(isEmoji(text)).toBe(false);
  });

  it('counts the bytes of the longest emoji it takes', () => {
    expect(new TextEncoder().encode(longest).length).toBe(64);
  });
});
