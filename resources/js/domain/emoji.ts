const SKIN = '\\u{1F3FB}-\\u{1F3FF}';
/** A pictograph shown as an emoji by itself, a text symbol before its selector, a modifier base before a skin tone. */
const LEAD = `(?:(?=\\p{Extended_Pictographic})[\\p{Emoji_Presentation}\\p{Cn}]|\\p{Extended_Pictographic}(?=\\u{FE0F})|\\p{Emoji_Modifier_Base}(?=[${SKIN}]))`;
const MARKS = `[\\u{FE0F}${SKIN}]*`;
const EMOJI = new RegExp(
  `^(?:\\p{Regional_Indicator}{2}|[0-9#*]\\u{FE0F}?\\u{20E3}|\\u{1F3F4}[\\u{E0020}-\\u{E007E}]+\\u{E007F}|${LEAD}${MARKS}(?:\\u{200D}\\p{Extended_Pictographic}${MARKS})*)$`,
  'u',
);
const EMOJI_MAX_BYTES = 64;
const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

/**
 * Exactly one emoji, the rule of `App\Domain\Emoji::is`: one grapheme of at most 64 bytes that is a pictograph (with
 * selector, skin tones and zero-width joins), a flag, a keycap or a subdivision flag. A text symbol (`©`, `‼`) counts
 * only with its selector U+FE0F. The invisible characters are escapes, so no editor can drop them.
 */
export function isEmoji(text: string): boolean {
  return (
    text !== '' &&
    new TextEncoder().encode(text).length <= EMOJI_MAX_BYTES &&
    EMOJI.test(text) &&
    [...graphemes.segment(text)].length === 1
  );
}
