/*
 * The preview of an item (spec 5.2), inside the panel of `PeekHost` while `useUiStore.peekItemId` is set.
 *
 * Contract with `PeekHost` (shell/PeekHost.tsx): the named export `ItemPeek({ itemId, panel })` fills the preview
 * panel. The host draws the panel (tracing paper, `--panel-w`, room above for the item's tab, focusable itself) and
 * passes it as `panel`: the preview's e acts while the focus is inside it, or nowhere (`ItemDetailProvider`). This
 * component draws everything inside, its own close button (`openPeek(null)`) included. What the host already does, so
 * this component need not:
 * - Escape: in a field the first Escape only moves the focus to the panel, so the draft stays; the next one closes the
 *   preview. A field that wants Escape for itself (to cancel an edit) calls `event.preventDefault()` in its onKeyDown.
 * - A visit to another page closes the preview (Inertia's `navigate`).
 * - Below md the panel covers the page and is modal; from md on the page beside it stays usable and keeps the focus.
 *   Closing gives the focus back to where it was.
 * - The item commands (s, a, i, p …) for the previewed item.
 *
 * Inside: from md on the item's tab stands on the panel's top edge (moodboard); the header row has the project and
 * the actions; below it the body every detail shares (`ItemBody`). Another item opened from here (a blocker) replaces
 * the preview.
 */

import { FileQuestionMark } from 'lucide-react';
import type { RefObject } from 'react';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { Skeleton, SkeletonGroup } from '@/components/ui/Skeleton';
import { TypeTab } from '@/components/ui/TypeTab';
import { useWorkItem } from '@/hooks/workItems';
import { t } from '@/lib/i18n';
import { useUiStore } from '@/store/ui';
import { ItemHeader } from './header/ItemHeader';
import { ItemBody, ItemDetailProvider } from './ItemBody';
import { isGone } from './shared';

export function ItemPeek({ itemId, panel }: { itemId: string; panel?: RefObject<HTMLElement | null> }) {
  const detail = useWorkItem(itemId);
  const data = detail.data;
  const close = () => useUiStore.getState().openPeek(null);
  const missing = isGone(detail.error);

  // a reload that fails (the server is down) keeps the item on screen: its editors hold what is not saved yet. Gone
  // (deleted, or access lost) it is not shown any more, not even as loaded before.
  if (data && !missing) {
    return (
      // a new detail for each item: drafts and edits never carry over to the next one
      <ItemDetailProvider key={data.item.id} surface="peek" panel={panel}>
        <span className="absolute bottom-full left-4 hidden md:block">
          <TypeTab tone={data.type.tone} icon={data.type.icon} label={data.item.key} />
        </span>
        <ItemHeader detail={data} surface="peek" onClose={close} />
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
          <ItemBody detail={data} surface="peek" />
        </div>
      </ItemDetailProvider>
    );
  }

  return (
    <>
      <ItemHeader detail={undefined} surface="peek" onClose={close} />
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        {missing ? (
          <EmptyState
            icon={FileQuestionMark}
            title={t('items.peek.gone.title')}
            description={t('items.peek.gone.description')}
            actions={
              <Button variant="secondary" onClick={close}>
                {t('items.peek.close')}
              </Button>
            }
            className="m-4"
          />
        ) : detail.isError ? (
          <ErrorState description={detail.error.message} onRetry={() => void detail.refetch()} retrying={detail.isFetching} className="m-4" />
        ) : (
          <SkeletonGroup label={t('items.peek.loading')} className="px-5 pt-4">
            <Skeleton className="h-6 w-3/4" />
            <div className="mt-5 grid grid-cols-[5.5rem_minmax(0,1fr)] gap-x-2 gap-y-3">
              {[0, 1, 2, 3, 4, 5].map((row) => (
                <span key={row} className="contents">
                  <Skeleton className="h-4 w-14" />
                  <Skeleton className="h-4 w-28" />
                </span>
              ))}
            </div>
            <Skeleton className="mt-6 h-24 w-full rounded-ctl" />
          </SkeletonGroup>
        )}
      </div>
    </>
  );
}
