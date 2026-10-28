/*
 * Placeholder until Task 8 replaces this file.
 *
 * Contract with `PeekHost` (src/app/PeekHost.tsx): the named export `ItemPeek({ itemId })` fills the preview panel
 * while `useUiStore.peekItemId` is set. The host draws the panel (tracing paper, `--panel-w`, room above for the
 * item's tab, focusable itself); this component draws everything inside, its own close button (`openPeek(null)`)
 * included. What the host already does, so this component need not:
 * - Escape (scope detail): in a field (title, description, comment, any `isTyping` target) the first Escape only moves
 *   the focus to the panel, so the draft stays; the next Escape closes the preview. A field that wants Escape for
 *   itself (e.g. to cancel an edit) calls `event.preventDefault()` in its own onKeyDown: the shortcut registry leaves a
 *   handled key alone, so the preview stays open.
 * - A new route closes the preview at the moment of the navigation. To show an item on another screen, call
 *   `navigate(to)` and then `openPeek(id)`, or open it while the new screen mounts; both keep it open.
 * - Below md the panel covers the page and is modal (<main> inert, the panel takes the focus); from md on the list
 *   beside it stays usable and keeps the focus. Closing gives the focus back to where it was.
 */

import { Maximize2, PanelRight, X } from 'lucide-react';
import { Link } from 'react-router';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { IconButton } from '@/components/ui/IconButton';
import { Skeleton, SkeletonGroup } from '@/components/ui/Skeleton';
import { Tooltip } from '@/components/ui/Tooltip';
import { useWorkItem } from '@/hooks/workItems';
import { useUiStore } from '@/store/ui';

export function ItemPeek({ itemId }: { itemId: string }) {
  const detail = useWorkItem(itemId);
  const item = detail.data?.item;
  const close = () => useUiStore.getState().openPeek(null);

  return (
    <>
      <div className="flex h-11 shrink-0 items-center gap-1 border-b border-edge pr-2 pl-4">
        <h2 translate={item ? 'no' : undefined} className="min-w-0 flex-1 truncate text-sm font-semibold text-ink tabular-nums">
          {item ? item.key : 'Vorschau'}
        </h2>
        {item && (
          <Tooltip content="Als Seite öffnen">
            <Link
              to={`/items/${item.key}`}
              aria-label="Als Seite öffnen"
              className="inline-flex size-11 items-center justify-center rounded-chip text-muted transition-colors duration-120 hover:bg-hover hover:text-ink md:size-7"
            >
              <Maximize2 className="size-4" aria-hidden="true" />
            </Link>
          </Tooltip>
        )}
        <IconButton icon={X} label="Vorschau schließen" shortcut="escape" onClick={close} />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4">
        {detail.isError ? (
          <ErrorState description={detail.error.message} onRetry={() => void detail.refetch()} retrying={detail.isFetching} />
        ) : !item ? (
          <SkeletonGroup label="Vorschau wird geladen …">
            <Skeleton className="h-6 w-3/4" />
            <Skeleton className="mt-4 h-24 w-full rounded-card" />
          </SkeletonGroup>
        ) : (
          <EmptyState
            icon={PanelRight}
            title="Kommt in Task 8"
            description={`Die Vorschau von ${item.key} zeigt dann Titel, Felder, Relationen und die Aktivität, ohne die Liste zu verlassen.`}
          />
        )}
      </div>
    </>
  );
}
