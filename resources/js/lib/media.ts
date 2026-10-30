/*
 * Tailwind's md breakpoint (48rem) in code: from md on the sidebar stands beside the page and the preview beside the
 * list; below it the sidebar is a drawer and the preview covers the page. Without matchMedia (jsdom in tests) the
 * screen counts as wide, the same answer everywhere.
 */

import { useSyncExternalStore } from 'react';

const WIDE = '(min-width: 48rem)';

/** Whether the screen is md or wider right now. */
export function isWide(): boolean {
  return typeof window.matchMedia !== 'function' || window.matchMedia(WIDE).matches;
}

function subscribeWide(callback: () => void): () => void {
  if (typeof window.matchMedia !== 'function') return () => {};
  const query = window.matchMedia(WIDE);
  query.addEventListener('change', callback);
  return () => query.removeEventListener('change', callback);
}

/** `isWide`, kept current while the window changes its size. */
export function useIsWide(): boolean {
  return useSyncExternalStore(subscribeWide, isWide, () => true);
}
