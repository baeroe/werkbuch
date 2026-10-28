/*
 * Placeholder until Task 8 replaces this file.
 *
 * Contract with `PeekHost` (src/app/PeekHost.tsx): the named export `ItemPeek({ itemId })` fills the preview panel
 * while `useUiStore.peekItemId` is set. The host draws the panel (tracing paper, `--panel-w`, room above for the
 * item's tab) and closes it with Escape (scope detail) or on a new route; this component draws everything inside,
 * its own close button (`openPeek(null)`) included.
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
