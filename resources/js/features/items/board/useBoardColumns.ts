/*
 * The columns of the board: one per group of the list (`GroupData`, layouts.ts), empty ones included, in the order of
 * the server. Unlike the list, every column loads its first page at once (`enable()`): the columns stand side by side
 * and a board without its cards says nothing. The cards are the group's items in their places (`placeItems`), the
 * count the server's plus the difference of the optimistic changes.
 */

import { useEffect, useMemo, useRef } from 'react';
import type { ApiError } from '@/api/client';
import type { ListedItem } from '@/types';
import type { GroupData, LayoutProps } from '../layouts';

/** A column as the board shows it. */
export interface BoardColumnData {
  key: string;
  label: string;
  count: number;
  /** The parent of a parent column, as the server named it. */
  item?: GroupData['item'];
  items: ListedItem[];
  /** The ids of the cards in their order. */
  ids: string[];
  status: GroupData['status'];
  hasMore: boolean;
  loadingMore: boolean;
  moreError: ApiError | null;
  loadMore(): void;
  retry(): void;
}

export function useBoardColumns({ groups }: Pick<LayoutProps, 'groups'>): BoardColumnData[] {
  // each column asks once; a column the screen still shows as idle (another state of the list) asks again
  const enabling = useRef(new Set<string>());
  useEffect(() => {
    for (const group of groups) {
      if (group.status !== 'idle') enabling.current.delete(group.key);
      else if (!enabling.current.has(group.key)) {
        enabling.current.add(group.key);
        group.enable();
      }
    }
  });

  return useMemo(
    () =>
      groups.map((group) => ({
        key: group.key,
        label: group.label,
        count: group.count,
        item: group.item,
        items: group.items,
        ids: group.items.map((item) => item.id),
        status: group.status,
        hasMore: group.hasMore,
        loadingMore: group.loadingMore,
        moreError: group.moreError,
        loadMore: group.loadMore,
        retry: group.retry,
      })),
    [groups],
  );
}
