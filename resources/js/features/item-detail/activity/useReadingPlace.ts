/*
 * Keeps the line a person reads in place while lines come in above it (WEBU-37, A690). The activity stands newest
 * first, so a comment or a change of someone else (live) lands on top of the list:
 * - While the start of the list is in sight, the new line shows where it lands (it is meant to be seen).
 * - Once the start is out of sight above (the person reads further down), the view moves by what came in or went above
 *   the first line in sight, so that line stays where it was.
 * The browser's own scroll anchoring is off for the list (`overflow-anchor: none` on it): the two never move the view
 * twice, and Safari, which has none, behaves the same.
 */

import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react';

/** The first line in sight and where it stood. */
type Place = { line: Element; top: number };

/** The element the list scrolls in: the panel of the preview, else the page (`null`). */
export function scrollerOf(element: Element): HTMLElement | null {
  for (let parent = element.parentElement; parent; parent = parent.parentElement) {
    const overflow = getComputedStyle(parent).overflowY;
    if (overflow === 'auto' || overflow === 'scroll') return parent;
  }
  return null;
}

/** The first line in sight while the start of the list is above the view; `null` while the start is in sight. */
export function placeOf(list: HTMLElement): Place | null {
  const scroller = scrollerOf(list);
  const top = scroller ? scroller.getBoundingClientRect().top : 0;
  if (list.getBoundingClientRect().top >= top) return null;
  const line = Array.from(list.children).find((child) => child.getBoundingClientRect().bottom > top);
  return line ? { line, top: line.getBoundingClientRect().top } : null;
}

/** Keeps the first line in sight of `list` in place over every render that adds or takes lines above it. */
export function useReadingPlace(list: RefObject<HTMLElement | null>): void {
  const place = useRef<Place | null>(null);

  useLayoutEffect(() => {
    const current = list.current;
    const before = place.current;
    if (current && before?.line.isConnected) {
      const moved = before.line.getBoundingClientRect().top - before.top;
      if (Math.abs(moved) >= 1) {
        const scroller = scrollerOf(current);
        if (scroller) scroller.scrollTop += moved;
        else window.scrollBy(0, moved);
      }
    }
    place.current = current ? placeOf(current) : null;
  });

  // scrolling (the page or the preview: a scroll event reaches the window in its capture phase) and resizing move it
  useEffect(() => {
    const note = () => {
      place.current = list.current ? placeOf(list.current) : null;
    };
    window.addEventListener('scroll', note, { capture: true, passive: true });
    window.addEventListener('resize', note);
    return () => {
      window.removeEventListener('scroll', note, { capture: true });
      window.removeEventListener('resize', note);
    };
  }, [list]);
}
