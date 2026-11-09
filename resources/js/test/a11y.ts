/*
 * WCAG 2.5.3 (Label in Name) as axe's `label-content-name-mismatch` reads it: the words a control shows stand, in their
 * order and next to each other, in its accessible name. Words are runs of letters and digits, compared without case,
 * accents and parentheses; text a screen reader alone hears (`sr-only`) is not shown. jsdom computes no names, so the
 * name here is `aria-label` or, without one, the text.
 */

import { expect } from 'vitest';

const words = (text: string): string[] =>
  text
    .normalize('NFKD')
    .replace(/\([^()]*\)/g, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .toLowerCase()
    .trim()
    .split(/\s+/)
    .filter(Boolean);

/** The text an element shows on screen: aria-hidden text counts (it is seen), sr-only and hidden text do not. */
export function visibleText(element: Element): string {
  let text = '';
  for (const node of element.childNodes) {
    if (node.nodeType === Node.TEXT_NODE) text += node.textContent ?? '';
    else if (node instanceof HTMLElement && !node.hidden && !node.classList.contains('sr-only')) text += ` ${visibleText(node)} `;
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
  expect(nameHoldsText(name, shown), `“${name}” lacks the shown text “${shown.replace(/\s+/g, ' ').trim()}”`).toBe(true);
}
