/*
 * WCAG 2.5.3 (Label in Name) as axe-core 4.14 reads it in `label-content-name-mismatch`: the words a control shows
 * stand, in their order and next to each other, in its accessible name. Like axe, the shown text joins the text of the
 * elements without a space between them ("Inbox" and a badge "3" read "Inbox3", one word), words are what
 * `Intl.Segmenter` finds after anything but letters and digits became a space, without case, accents and parentheses.
 * Text a screen reader alone hears (`sr-only`, `hidden`) is not shown; aria-hidden text is. jsdom computes no names, so
 * the name here is `aria-label` or, without one, the text.
 */

import { expect } from 'vitest';

const segmenter = new Intl.Segmenter(undefined, { granularity: 'word' });

function words(text: string): string[] {
  let plain = text.normalize('NFKD');
  for (let previous = ''; previous !== plain; ) {
    previous = plain;
    plain = plain.replace(/\([^()]*\)/g, '');
  }
  plain = plain
    .replace(/[^\p{L}\p{N}]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
  return [...segmenter.segment(plain)].map((part) => part.segment.trim()).filter(Boolean);
}

/** The text an element shows on screen, joined as axe joins it. */
export function visibleText(element: Element): string {
  let text = '';
  for (const node of element.childNodes) {
    if (node.nodeType === Node.TEXT_NODE) text += node.textContent ?? '';
    else if (node instanceof HTMLBRElement) text += ' ';
    else if (node instanceof HTMLElement && !node.hidden && !node.classList.contains('sr-only')) text += visibleText(node);
  }
  return text;
}

/** Whether `name` holds the words of `shown` as one run. */
export function nameHoldsText(name: string, shown: string): boolean {
  const needle = words(shown);
  const haystack = words(name);
  if (needle.length === 0) return true;
  for (let start = 0; start + needle.length <= haystack.length; start++) {
    if (needle.every((word, index) => haystack[start + index] === word)) return true;
  }
  return false;
}

/** Fails when the element's name lacks the words it shows. */
export function expectLabelInName(element: Element): void {
  const name = element.getAttribute('aria-label') ?? element.textContent ?? '';
  const shown = visibleText(element);
  expect(nameHoldsText(name, shown), `“${name}” lacks the shown text “${shown}”`).toBe(true);
}
