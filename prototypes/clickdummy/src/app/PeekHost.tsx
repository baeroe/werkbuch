/*
 * The preview panel (spec 5.2): an item next to the list, on tracing paper over the page, while
 * `useUiStore.peekItemId` is set. The host places the panel and decides when it closes; `ItemPeek` (Task 8) fills it.
 *
 * - Escape: the first Escape in a field (`isTyping`) only moves the focus out of the field to the panel, so a draft
 *   survives; the next Escape closes the preview. A field that handles Escape itself calls `preventDefault()` in its
 *   own onKeyDown; the registry then leaves the key alone.
 * - A new route closes the preview at the moment of the navigation (`closePeekOnNavigation`, wired up by the router),
 *   so `navigate(to); openPeek(id)` keeps it open, and so does a screen that opens it while it mounts.
 * - From md on the list beside the panel stays usable: the panel takes no focus when it opens. Below md it covers the
 *   page and is modal: <main> turns inert and the panel takes the focus.
 * - When it closes while the focus was inside (or lost), the focus goes back to where it came from.
 */

import { lazy, Suspense, useLayoutEffect, useRef, useSyncExternalStore, type RefObject } from 'react';
import type { DataRouter } from 'react-router';
import { Skeleton, SkeletonGroup } from '@/components/ui/Skeleton';
import { isTyping } from '@/lib/shortcuts/registry';
import { useShortcut } from '@/lib/shortcuts/useShortcut';
import { useUiStore } from '@/store/ui';

const ItemPeek = lazy(() => import('@/features/item-detail/ItemPeek').then((module) => ({ default: module.ItemPeek })));

/** From md on (Tailwind's md breakpoint). Without matchMedia (tests) the screen counts as wide. */
const WIDE = '(min-width: 48rem)';
const isWide = () => typeof window.matchMedia !== 'function' || window.matchMedia(WIDE).matches;
function subscribeWide(callback: () => void): () => void {
  if (typeof window.matchMedia !== 'function') return () => {};
  const query = window.matchMedia(WIDE);
  query.addEventListener('change', callback);
  return () => query.removeEventListener('change', callback);
}

/**
 * Closes the preview when the route changes (not when only the search or hash changes). It listens to the router
 * itself: navigations without loaders change its state synchronously inside `navigate()`, so whatever opens the
 * preview after that call, or in the new screen, comes later and stays open.
 */
export function closePeekOnNavigation(router: Pick<DataRouter, 'state' | 'subscribe'>): () => void {
  let shown = router.state.location.pathname;
  return router.subscribe((state) => {
    if (state.location.pathname === shown) return;
    shown = state.location.pathname;
    useUiStore.getState().openPeek(null);
  });
}

/** Escape: first out of a field, then the preview closes. Registered only while it is open, so the help lists it only then. */
function CloseOnEscape({ panel }: { panel: RefObject<HTMLElement | null> }) {
  useShortcut({
    id: 'peek.close',
    keys: 'escape',
    scope: 'detail',
    label: 'Vorschau schließen',
    group: 'Item',
    run: (event) => {
      if (isTyping(event.target)) panel.current?.focus();
      else useUiStore.getState().openPeek(null);
    },
  });
  return null;
}

export function PeekHost() {
  const itemId = useUiStore((state) => state.peekItemId);
  const wide = useSyncExternalStore(subscribeWide, isWide, () => true);
  const panel = useRef<HTMLElement>(null);
  const open = itemId !== null;

  useLayoutEffect(() => {
    if (!open) return;
    const opener = document.activeElement;
    const element = panel.current;
    // below md the panel covers the page: the page behind it waits, the panel takes the focus
    const main = wide ? null : document.getElementById('main');
    if (main) {
      main.setAttribute('inert', '');
      element?.focus();
    }
    return () => {
      main?.removeAttribute('inert');
      const focus = document.activeElement;
      const lost = !focus || focus === document.body || Boolean(element?.contains(focus));
      if (lost && opener instanceof HTMLElement && opener.isConnected) opener.focus();
    };
  }, [open, wide]);

  if (!itemId) return null;
  return (
    <aside
      ref={panel}
      tabIndex={-1}
      aria-label="Vorschau"
      className="tracing fixed inset-x-2 top-16 bottom-2 z-30 flex animate-peek-in flex-col rounded-card md:top-8 md:right-2 md:left-auto md:w-[var(--panel-w)]"
    >
      <CloseOnEscape panel={panel} />
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
