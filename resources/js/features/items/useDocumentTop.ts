import { useCallback, useEffect, useLayoutEffect, useState, type DependencyList, type RefObject } from 'react';

/**
 * Where an element starts in the document: its top in the window plus how far the window scrolled. The layouts of the
 * items screen stand below its bars (toolbar, filter chips, bulk bar, unsaved changes), whose height changes.
 *
 * Measured after a render only when `deps` change (the rows, the width), not after every render: reading a box makes the
 * browser lay out the page there and then (T13-M7, T21-M9). A bar above that grows or goes changes the height of the
 * page: an observer of the body measures then, after the browser laid it out anyway; a resize of the window too.
 */
export function useDocumentTop(element: RefObject<HTMLElement | null>, deps: DependencyList): number {
  const [top, setTop] = useState(0);
  const measure = useCallback(() => {
    const next = Math.round((element.current?.getBoundingClientRect().top ?? 0) + window.scrollY);
    setTop((previous) => (previous === next ? previous : next));
  }, [element]);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- the caller names what moves the element
  useLayoutEffect(measure, deps);
  useEffect(() => {
    window.addEventListener('resize', measure);
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    observer?.observe(document.body);
    return () => {
      window.removeEventListener('resize', measure);
      observer?.disconnect();
    };
  }, [measure]);
  return top;
}
