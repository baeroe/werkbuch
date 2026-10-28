/*
 * The preview panel (spec 5.2): an item next to the list, on tracing paper over the page, while
 * `useUiStore.peekItemId` is set. The host places the panel and closes it (Escape in scope detail, or a new route);
 * `ItemPeek` (Task 8) fills it. The list stays usable beside it, so the panel takes no focus when it opens; when it
 * closes while the focus was inside, the focus goes back to where it came from.
 */

import { lazy, Suspense, useEffect, useLayoutEffect, useRef } from 'react';
import { useLocation } from 'react-router';
import { Skeleton, SkeletonGroup } from '@/components/ui/Skeleton';
import { useShortcut } from '@/lib/shortcuts/useShortcut';
import { useUiStore } from '@/store/ui';

const ItemPeek = lazy(() => import('@/features/item-detail/ItemPeek').then((module) => ({ default: module.ItemPeek })));

/** Escape closes the preview; registered only while it is open, so the help lists it only then. */
function CloseOnEscape() {
  useShortcut({ id: 'peek.close', keys: 'escape', scope: 'detail', label: 'Vorschau schließen', group: 'Item', run: () => useUiStore.getState().openPeek(null) });
  return null;
}

export function PeekHost() {
  const itemId = useUiStore((state) => state.peekItemId);
  const { pathname } = useLocation();
  const panel = useRef<HTMLElement>(null);
  const open = itemId !== null;

  // a new screen closes the preview
  useEffect(() => {
    useUiStore.getState().openPeek(null);
  }, [pathname]);

  useLayoutEffect(() => {
    if (!open) return;
    const opener = document.activeElement;
    const element = panel.current;
    return () => {
      const focus = document.activeElement;
      const lost = !focus || focus === document.body || Boolean(element?.contains(focus));
      if (lost && opener instanceof HTMLElement && opener.isConnected) opener.focus();
    };
  }, [open]);

  if (!itemId) return null;
  return (
    <aside
      ref={panel}
      aria-label="Vorschau"
      className="tracing fixed inset-x-2 top-16 bottom-2 z-30 flex animate-peek-in flex-col rounded-card md:top-8 md:right-2 md:left-auto md:w-[var(--panel-w)]"
    >
      <CloseOnEscape />
      <Suspense
        fallback={
          <SkeletonGroup label="Vorschau wird geladen …" className="p-4">
            <Skeleton className="h-5 w-24" />
            <Skeleton className="mt-6 h-6 w-3/4" />
          </SkeletonGroup>
        }
      >
        <ItemPeek itemId={itemId} />
      </Suspense>
    </aside>
  );
}
