/*
 * Keeps the line a person reads in place while things grow or go above it (WEBU-37, A690). The activity stands newest
 * first, so a comment or a change of someone else (live) lands on top of the list; a run on top starts, unfolds its
 * log and grows line by line, an image loads, a section above comes late.
 * - While the start of the list is in sight, a new line shows where it lands (it is meant to be seen).
 * - Once the start is out of sight above (the person reads further down), the view moves by what came in, grew or went
 *   above the first line in sight. The hook looks after every render of the activity and whenever the list or the
 *   content of its scroller changes size (`ResizeObserver`), and on every scroll of its own scroller, once per frame:
 *   what moved the line other than the scroll itself is a change of layout and is made good, then the place is noted
 *   anew (a log that unfolds right after a scroll is kept too).
 * - The browser's own scroll anchoring is off for that scroller while the hook watches it (`overflow-anchor: none`):
 *   in Chrome it chose the sticky column of the fields or another element above as its anchor and let the line being
 *   read move by the height of an unfolding log (measured in e2e), and both together moved the view twice. One
 *   mechanism in every browser, Safari (which has none) included.
 */

import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react';

/** The first line in sight, where it stood and how far its scroller had scrolled then. */
type Place = { line: Element; top: number; scrolled: number };

/** The element the list scrolls in: the panel of the preview, else the page (`null`). */
export function scrollerOf(element: Element): HTMLElement | null {
  for (let parent = element.parentElement; parent; parent = parent.parentElement) {
    const overflow = getComputedStyle(parent).overflowY;
    if (overflow === 'auto' || overflow === 'scroll') return parent;
  }
  return null;
}

/** How far the scroller of the list (or the page) has scrolled. */
const scrolledOf = (scroller: HTMLElement | null): number => (scroller ? scroller.scrollTop : window.scrollY);

/** The first line in sight while the start of the list is above the view; `null` while the start is in sight. */
export function placeOf(list: HTMLElement): Place | null {
  const scroller = scrollerOf(list);
  const top = scroller ? scroller.getBoundingClientRect().top : 0;
  if (list.getBoundingClientRect().top >= top) return null;
  const line = Array.from(list.children).find((child) => child.getBoundingClientRect().bottom > top);
  return line ? { line, top: line.getBoundingClientRect().top, scrolled: scrolledOf(scroller) } : null;
}

/** What the hook watches for one list: its scroller, the observer of sizes and the scroll listener. */
type Watch = { list: HTMLElement; stop: () => void };

/** Keeps the first line in sight of `list` in place over every change above it. */
export function useReadingPlace(list: RefObject<HTMLElement | null>): void {
  const place = useRef<Place | null>(null);
  const watch = useRef<Watch | null>(null);
  useLayoutEffect(() => {
    const current = list.current;
    /**
     * Moves the view by what moved the place other than scrolling (a scroll moves it by as much the other way), then
     * notes the place anew. Every watch calls it: a render, a change of size, a scroll; so a change of layout that a
     * scroll notices first is kept too.
     */
    const keep = () => {
      const before = place.current;
      if (current && before?.line.isConnected) {
        const scroller = scrollerOf(current);
        const moved = before.line.getBoundingClientRect().top - before.top + (scrolledOf(scroller) - before.scrolled);
        if (Math.abs(moved) >= 1) {
          if (scroller) scroller.scrollTop += moved;
          else window.scrollBy(0, moved);
        }
      }
      place.current = current ? placeOf(current) : null;
    };
    keep();
    // the list came, went or is another element: watch it (its scroller, the sizes above and in it)
    if (watch.current?.list === current) return;
    watch.current?.stop();
    watch.current = current ? watchList(current, keep) : null;
  });

  useEffect(
    () => () => {
      watch.current?.stop();
      watch.current = null;
    },
    [],
  );
}

/**
 * Calls `keep` when the list or the content of its scroller changes size, and once per frame while it scrolls; the
 * scroller does without the browser's anchoring meanwhile.
 */
function watchList(list: HTMLElement, keep: () => void): Watch {
  const scroller = scrollerOf(list);
  const scrolls: HTMLElement | Window = scroller ?? window;
  // the page's anchoring hangs on the root element or the body, depending on the browser: both
  const roots = scroller ? [scroller] : [document.documentElement, document.body];
  const anchoring = roots.map((root) => root.style.getPropertyValue('overflow-anchor'));
  roots.forEach((root) => root.style.setProperty('overflow-anchor', 'none'));
  let frame = 0;
  const onScroll = () => {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      keep();
    });
  };
  scrolls.addEventListener('scroll', onScroll, { passive: true });
  const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(keep);
  observer?.observe(list);
  // what stands above the list in its scroller (the description, a late section) moves it without changing its size
  observer?.observe(scroller?.firstElementChild ?? document.body);
  return {
    list,
    stop: () => {
      roots.forEach((root, index) => {
        if (anchoring[index]) root.style.setProperty('overflow-anchor', anchoring[index]);
        else root.style.removeProperty('overflow-anchor');
      });
      scrolls.removeEventListener('scroll', onScroll);
      cancelAnimationFrame(frame);
      observer?.disconnect();
    },
  };
}
