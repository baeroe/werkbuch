/*
 * A glyph glued to the text after it (WEBU-14): a long page title or file name wraps like text, but never right after
 * its icon. Only the first character goes with the glyph into a span that does not wrap; the rest of the first word
 * follows without a break opportunity of its own, so the whole first word stays with the glyph, and a word longer
 * than the line can still break after its first character (`overflow-wrap: anywhere` of `.rt`).
 */

import type { ReactNode } from 'react';

const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

/** The first character of a text (a whole grapheme, an emoji with its modifiers) and the rest. */
export function splitFirst(text: string): [string, string] {
  const first = graphemes.segment(text)[Symbol.iterator]().next().value?.segment ?? '';
  return [first, text.slice(first.length)];
}

/** `glyph` and the first character of `text` on one line, the rest of `text` free to wrap. */
export function Glued({ glyph, text }: { glyph: ReactNode; text: string }) {
  const [first, rest] = splitFirst(text);
  return (
    <>
      <span className="rt-glued">
        {glyph}
        {first}
      </span>
      {rest}
    </>
  );
}
