/*
 * The preview (spec 5.2, WEBU-67): an item in a modal over the page, on tracing paper, while `useUiStore.peekItemId` is
 * set. The host places the dialog and decides when it closes; `ItemPeek` fills it.
 *
 * - Escape: the first Escape in a field (`isTyping`) only moves the focus out of the field to the panel, so a draft
 *   survives; the next Escape closes the preview (R14). A field that handles Escape itself calls `preventDefault()` in
 *   its own onKeyDown; the registry then leaves the key alone.
 * - A visit to another page closes the preview (`closePeekOnNavigation`: Inertia's `navigate`, which comes when the new
 *   page is on screen, and `success`, the only event of a visit that replaces the page; a visit that stays on the same
 *   path, such as a reload, keeps it). To show an item on another
 *   page, open the preview once that page is there.
 * - It is modal at every width (WEBU-67): the page, the sidebar and the mobile bar turn inert (not the toasts, whose
 *   "Rückgängig" stays in reach), the dialog takes the focus, a click on the backdrop closes it.
 * - j/k (and ↓/↑ of a list) go on working in the modal (ruling of WEBU-67): they move the cursor of the list behind, and
 *   the preview follows it to the next or previous item; the focus stays in the dialog.
 * - When it closes while the focus was inside (or lost), the focus goes back to where it came from.
 * - The item commands (s, a, i, p, l, t, d, shift+d, shift+p, mod+backspace) are mounted here for the preview: with the
 *   focus inside the panel they act on the previewed item (`PreviewItemCommands`). `ItemPeek` mounts none.
 * - `ItemPeek` gets the panel as well: its e ("Titel bearbeiten") acts while the focus is inside or nowhere.
 */

import { router } from '@inertiajs/react';
import { lazy, Suspense, useEffect, useLayoutEffect, useRef, type RefObject } from 'react';
import { Skeleton, SkeletonGroup } from '@/components/ui/Skeleton';
import { t } from '@/lib/i18n';
import { isTyping } from '@/lib/shortcuts/registry';
import { useShortcut } from '@/lib/shortcuts/useShortcut';
import { useUiStore } from '@/store/ui';

const ItemPeek = lazy(() => import('@/features/item-detail/ItemPeek').then((module) => ({ default: module.ItemPeek })));
// loaded with the preview: the commands bring the field editors with them, which the shell's own bundle does not need
const PreviewItemCommands = lazy(() => import('@/components/fields/commands').then((module) => ({ default: module.PreviewItemCommands })));

/**
 * Closes the preview when a visit arrives at another path (not when only the query changes). A visit that replaces
 * the page (`replace`, a reload) ends with `success` only, never `navigate`: both are heard, as everything that has to
 * follow each new page does. Answers the function that stops listening.
 */
export function closePeekOnNavigation(): () => void {
  let shown = window.location.pathname;
  const arrived = (url: string) => {
    const path = new URL(url, window.location.origin).pathname;
    if (path === shown) return;
    shown = path;
    useUiStore.getState().openPeek(null);
  };
  const stops = [router.on('navigate', (event) => arrived(event.detail.page.url)), router.on('success', (event) => arrived(event.detail.page.url))];
  return () => stops.forEach((stop) => stop());
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
  const panel = useRef<HTMLDivElement>(null);
  const open = itemId !== null;

  useEffect(() => closePeekOnNavigation(), []);

  useLayoutEffect(() => {
    if (!open) return;
    const opener = document.activeElement;
    const element = panel.current;
    // the page behind the modal waits; only what was not inert already is given back
    const behind = [...document.querySelectorAll<HTMLElement>('#main, [data-shell-chrome]')].filter((node) => !node.hasAttribute('inert'));
    behind.forEach((node) => node.setAttribute('inert', ''));
    element?.focus();
    return () => {
      behind.forEach((node) => node.removeAttribute('inert'));
      const focus = document.activeElement;
      const lost = !focus || focus === document.body || Boolean(element?.contains(focus));
      if (lost && opener instanceof HTMLElement && opener.isConnected) opener.focus();
    };
  }, [open]);

  // another item (j/k behind the modal): a focus that went with the old item's content comes back to the dialog
  useLayoutEffect(() => {
    const focus = document.activeElement;
    if (itemId && (!focus || focus === document.body)) panel.current?.focus();
  }, [itemId]);

  if (!itemId) return null;
  return (
    <>
      <div className="fixed inset-0 z-30 bg-ink/20" aria-hidden="true" data-peek-backdrop="" onClick={() => useUiStore.getState().openPeek(null)} />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        tabIndex={-1}
        data-peek-panel=""
        aria-label={t('items.peek.label')}
        className="tracing fixed inset-x-2 top-16 bottom-2 z-30 flex animate-peek-in flex-col rounded-card md:inset-x-auto md:top-8 md:bottom-8 md:left-1/2 md:w-[min(56rem,calc(100vw-4rem))] md:-translate-x-1/2"
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
      </div>
    </>
  );
}
