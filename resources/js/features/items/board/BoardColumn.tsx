/*
 * One column of the board (moodboard "Board"), ported from the clickdummy: the mark and name of its group with the
 * count of the server (plus what the optimistic changes moved), then its cards on the paper in a box that scrolls on
 * its own.
 *
 * - Virtualized (TanStack Virtual, R34): only the cards in view of the column's box are mounted; a card measures itself
 *   (96 px until it has). The card the board names (`keepIndex`: the cursor card, else the tab stop) stays rendered
 *   while it scrolls away, so it keeps the focus.
 * - Loading: the first page shows skeleton cards, a failed one says so with "Erneut versuchen". Below the last loaded
 *   card the next page loads by itself once that place is rendered (a skeleton card stands there meanwhile); a page
 *   that failed leaves the cards and offers to try again.
 */

import { defaultRangeExtractor, useVirtualizer, type Range } from '@tanstack/react-virtual';
import { useCallback, useEffect, useId, useRef, type ReactNode } from 'react';
import { Button } from '@/components/ui/Button';
import { Skeleton, SkeletonGroup } from '@/components/ui/Skeleton';
import { intlLocale, t, tn } from '@/lib/i18n';
import type { GroupBy, ListedItem } from '@/types';
import { GroupIcon } from '../display/GroupIcon';
import type { BoardColumnData } from './useBoardColumns';

/** How tall a card is before it has measured itself (R34). */
export const CARD_HEIGHT = 96;

interface BoardColumnProps {
  column: BoardColumnData;
  groupBy: GroupBy;
  /** The index of the card that stays rendered whatever the scroll (the cursor or the tab stop), or -1. */
  keepIndex: number;
  /** The card of an item, inside its place in the column. */
  renderCard(item: ListedItem): ReactNode;
}

export function BoardColumn({ column, groupBy, keepIndex, renderCard }: BoardColumnProps) {
  const headingId = useId();
  const box = useRef<HTMLDivElement>(null);
  const { items } = column;
  // a place below the cards while there is more to load (or a page failed)
  const tail = column.status === 'success' && (column.hasMore || column.loadingMore || column.moreError !== null);
  const count = items.length + (tail ? 1 : 0);

  const rangeExtractor = useCallback(
    (range: Range) => {
      const indexes = defaultRangeExtractor(range);
      return keepIndex < 0 || keepIndex >= items.length || indexes.includes(keepIndex) ? indexes : [...indexes, keepIndex].sort((a, b) => a - b);
    },
    [keepIndex, items.length],
  );
  const virtualizer = useVirtualizer({
    count,
    getScrollElement: () => box.current,
    estimateSize: () => CARD_HEIGHT,
    overscan: 4,
    getItemKey: (index) => items[index]?.id ?? 'tail',
    rangeExtractor,
    useFlushSync: false,
  });
  const virtual = virtualizer.getVirtualItems();

  // the next page once the place below the last card is rendered; asked again on every render while it shows and
  // nothing is on its way (`loadMore` is idempotent)
  const tailShown = tail && virtual.some((entry) => entry.index === items.length);
  useEffect(() => {
    if (tailShown && column.hasMore && !column.loadingMore && column.moreError === null) column.loadMore();
  });

  return (
    <section aria-labelledby={headingId} data-column-key={column.key} className="flex h-full w-[min(85vw,18rem)] shrink-0 snap-start flex-col sm:w-64">
      <header className="flex h-11 shrink-0 items-center gap-1.5 px-1.5 md:h-9">
        <GroupIcon groupBy={groupBy} groupKey={column.key} />
        <h2 id={headingId} className="min-w-0 truncate text-ui font-semibold text-ink">
          {column.label}
        </h2>
        <span className="shrink-0 text-sm text-muted tabular-nums">
          <span aria-hidden="true">{new Intl.NumberFormat(intlLocale()).format(column.count)}</span>
          <span className="sr-only">, {tn('items.group.count', column.count)}</span>
        </span>
      </header>

      <div ref={box} data-board-list="" className="min-h-0 flex-1 overflow-y-auto overscroll-contain rounded-card px-1.5 pb-4">
        {column.status === 'pending' || column.status === 'idle' ? (
          <SkeletonGroup label={t('items.board.column_loading', { column: column.label })} className="flex flex-col gap-2.5">
            {[0, 1].map((card) => (
              <span key={card} className="relative mt-5 block rounded-card border border-line bg-surface p-3 shadow-elev-1">
                <Skeleton className="h-3.5 w-4/5" />
                <Skeleton className="mt-2 h-3.5 w-1/2" />
              </span>
            ))}
          </SkeletonGroup>
        ) : column.status === 'error' ? (
          <div role="alert" className="mt-5 flex flex-col items-start gap-2 px-1 text-sm text-muted">
            {t('items.list.not_loaded')}
            <Button variant="secondary" size="sm" onClick={() => column.retry()}>
              {t('common.retry')}
            </Button>
          </div>
        ) : items.length === 0 && !tail ? (
          <p className="mt-5 rounded-card border border-dashed border-line-strong px-3 py-5 text-center text-sm text-muted">{t('items.board.empty')}</p>
        ) : (
          <ul aria-labelledby={headingId} className="relative" style={{ height: virtualizer.getTotalSize() }}>
            {virtual.map((entry) => {
              const item = items[entry.index];
              const place = { ref: virtualizer.measureElement, 'data-index': entry.index, style: { transform: `translateY(${entry.start}px)` } };
              if (!item) {
                return (
                  <li key={entry.key} {...place} className="absolute inset-x-0 top-0 pt-3">
                    {column.moreError ? (
                      <div role="alert" className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted">
                        {t('items.list.not_loaded')}
                        <Button variant="secondary" size="sm" onClick={() => column.retry()}>
                          {t('common.retry')}
                        </Button>
                      </div>
                    ) : (
                      <SkeletonGroup label={t('items.board.loading_more')}>
                        <Skeleton className="h-20 w-full rounded-card" />
                      </SkeletonGroup>
                    )}
                  </li>
                );
              }
              return (
                <li key={entry.key} {...place} className="absolute inset-x-0 top-0 pb-2.5">
                  {renderCard(item)}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}
