/*
 * The preview panel (spec 5.2): an item beside the page, on tracing paper over it, while `useUiStore.peekItemId` is
 * set. The host places the panel and decides when it closes; `ItemPeek` fills it.
 *
 * - Escape: the first Escape in a field (`isTyping`) only moves the focus out of the field to the panel, so a draft
 *   survives; the next Escape closes the preview (R14). A field that handles Escape itself calls `preventDefault()` in
 *   its own onKeyDown; the registry then leaves the key alone.
 * - A visit to another page closes the preview (`closePeekOnNavigation`: Inertia's `navigate`, which comes when the new
 *   page is on screen; a visit that stays on the same path, such as a reload, keeps it). To show an item on another
 *   page, open the preview once that page is there.
 * - From md on the page beside the panel stays usable: the panel takes no focus when it opens. Below md it covers the
 *   page and is modal: <main> turns inert and the panel takes the focus.
 * - When it closes while the focus was inside (or lost), the focus goes back to where it came from.
 * - The item commands (s, a, i, p, l, t, d, shift+d, shift+p, mod+backspace) are mounted here for the preview: with the
 *   focus inside the panel they act on the previewed item (`PreviewItemCommands`). `ItemPeek` mounts none.
 * - `ItemPeek` gets the panel as well: its e ("Titel bearbeiten") acts while the focus is inside or nowhere.
 */

import { router } from '@inertiajs/react';
import { lazy, Suspense, useEffect, useLayoutEffect, useRef, type RefObject } from 'react';
import { Skeleton, SkeletonGroup } from '@/components/ui/Skeleton';
import { t } from '@/lib/i18n';
import { useIsWide } from '@/lib/media';
import { isTyping } from '@/lib/shortcuts/registry';
import { useShortcut } from '@/lib/shortcuts/useShortcut';
import { useUiStore } from '@/store/ui';

const ItemPeek = lazy(() => import('@/features/item-detail/ItemPeek').then((module) => ({ default: module.ItemPeek })));
// loaded with the preview: the commands bring the field editors with them, which the shell's own bundle does not need
const PreviewItemCommands = lazy(() => import('@/components/fields/commands').then((module) => ({ default: module.PreviewItemCommands })));

/**
 * Closes the preview when a visit arrives at another path (not when only the query changes, nor on a visit that
 * replaces the page, which Inertia does not announce). Answers the function that stops listening.
 */
export function closePeekOnNavigation(): () => void {
  let shown = window.location.pathname;
  return router.on('navigate', (event) => {
    const path = new URL(event.detail.page.url, window.location.origin).pathname;
    if (path === shown) return;
    shown = path;
    useUiStore.getState().openPeek(null);
  });
}

/** Escape: first out of a field, then the preview closes. Registered only while it is open, so the help lists it only then. */
function CloseOnEscape({ panel }: { panel: RefObject<HTMLElement | null> }) {
  useShortcut('peek.close', (event) => {
    if (isTyping(event.target)) panel.current?.focus();
    else useUiStore.getState().openPeek(null);
  });
  return null;
}

export function PeekHost() {
  const itemId = useUiStore((state) => state.peekItemId);
  // from md on the panel stands beside the page; below it covers the page
  const wide = useIsWide();
  const panel = useRef<HTMLElement>(null);
  const open = itemId !== null;

  useEffect(() => closePeekOnNavigation(), []);

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
      aria-label={t('items.peek.label')}
      className="tracing fixed inset-x-2 top-16 bottom-2 z-30 flex animate-peek-in flex-col rounded-card md:top-8 md:right-2 md:left-auto md:w-[var(--panel-w)]"
    >
      <CloseOnEscape panel={panel} />
      <Suspense fallback={null}>
        <PreviewItemCommands panel={panel} />
      </Suspense>
      <Suspense
        fallback={
          <SkeletonGroup label={t('items.peek.loading')} className="p-4">
            <Skeleton className="h-5 w-24" />
            <Skeleton className="mt-6 h-6 w-3/4" />
          </SkeletonGroup>
        }
      >
        <ItemPeek itemId={itemId} panel={panel} />
      </Suspense>
    </aside>
  );
}
