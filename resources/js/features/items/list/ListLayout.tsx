/*
 * The list layout (spec 4.11, moodboard "Liste und Timeline"), ported from the clickdummy: the groups as sections that
 * fold away, with the count of the server; children right below their parent, indented; the display fields as chips.
 *
 * - Virtualized against the page's scroll (`useWindowVirtualizer`): only the rows in view are mounted, each with its
 *   pickers. Rows measure themselves, so a row whose chips wrap (phones) takes the room it needs. The cursor row stays
 *   rendered while it scrolls away (`rangeExtractor`), so the focus is not lost (13c).
 * - Loading group by group: a group asks for its first page once its heading is rendered and open (`enable`), for the
 *   next once its last loaded row is rendered (`loadMore`). A page that fails leaves the rows loaded so far and adds a
 *   row "Nicht geladen. Erneut versuchen" (13c).
 * - Keyboard (`useSelection`): j/k and ↓/↑ move the cursor, which is the row with the tab stop; Enter opens the page,
 *   the space bar the preview, x selects. The chips are no tab stops: the item shortcuts change the fields of the cursor
 *   row. The group headings are no tab stops either (13c), the arrows reach them as in a tree: ← on a row goes to the
 *   heading of its group; on a heading ← folds the group, → opens it or goes to its first row, ↓/↑ go to the next or
 *   previous heading; Enter and the space bar fold and open. Only while no row is there to take it (every group folded
 *   or still loading) the first heading is the tab stop.
 * - Mouse: a click on the title opens the preview, with ⌘/Strg the page in a new tab, with ⇧ it selects the range up
 *   to the row; the checkbox selects (with ⇧ a range).
 */

import { defaultRangeExtractor, useWindowVirtualizer, type Range } from '@tanstack/react-virtual';
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react';
import { ItemRowBase } from '@/components/items/ItemRowBase';
import { Button } from '@/components/ui/Button';
import { Checkbox } from '@/components/ui/Checkbox';
import { cx } from '@/components/ui/cx';
import { Skeleton, SkeletonGroup } from '@/components/ui/Skeleton';
import { t } from '@/lib/i18n';
import { useIsWide } from '@/lib/media';
import { useUiStore } from '@/store/ui';
import type { LayoutProps } from '../layouts';
import { revealBelowToolbar, useSelection } from '../selection/useSelection';
import { useDocumentTop } from '../useDocumentTop';
import { GroupHeader } from './GroupHeader';
import { listRows, rowKey, type ListRow } from './rows';

/** How tall a row is before it has measured itself: 36 px, 44 px on phones (touch targets). */
const ROW_HEIGHT = { wide: 36, narrow: 44 };
const HEADING_HEIGHT = 48;

/** Plain arrow keys only: with ⇧ they extend the selection (`useSelection`). */
const plain = (event: KeyboardEvent) => !event.shiftKey && !event.altKey && !event.metaKey && !event.ctrlKey;

export function ListLayout({ groups, groupBy, display, selection, onSelect, onSelectAll, onOpen, onPeek, cursorId, onCursor }: LayoutProps) {
  const container = useRef<HTMLUListElement>(null);
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set());
  const peekItemId = useUiStore((state) => state.peekItemId);
  const flashIds = useUiStore((state) => state.flashIds);
  const wide = useIsWide();
  const grouped = groupBy !== 'none';

  const rows = useMemo(() => listRows(groups, grouped, collapsed), [groups, grouped, collapsed]);
  // an item with two labels has two rows; the cursor takes the first
  const order = useMemo(() => [...new Set(rows.flatMap((row) => (row.kind === 'item' ? [row.item.id] : [])))], [rows]);
  const all = useMemo(() => [...new Set(groups.flatMap((group) => group.items.map((item) => item.id)))], [groups]);

  // the position of an item row among all items of the open groups, loaded or not (`aria-posinset`/`aria-setsize`)
  const positions = useMemo(() => {
    const at = new Map<number, number>();
    const bases = new Map<string, number>();
    let size = 0;
    for (const group of groups) {
      if ((group.count === 0 && group.items.length === 0) || (grouped && collapsed.has(group.key))) continue;
      bases.set(group.key, size);
      size += Math.max(group.count, group.items.length);
    }
    rows.forEach((row, index) => {
      if (row.kind !== 'item') return;
      const next = bases.get(row.group.key)! + 1;
      bases.set(row.group.key, next);
      at.set(index, next);
    });
    return { at, size };
  }, [groups, rows, grouped, collapsed]);

  // the list starts below the bars of the screen; their height changes with the filter chips
  const scrollMargin = useDocumentTop(container, [rows.length, wide]);

  // the cursor row stays rendered while it scrolls away, so it keeps the focus (13c)
  const cursorIndex = useMemo(() => rows.findIndex((row) => row.kind === 'item' && row.item.id === cursorId), [rows, cursorId]);
  const rangeExtractor = useCallback(
    (range: Range) => {
      const indexes = defaultRangeExtractor(range);
      return cursorIndex < 0 || indexes.includes(cursorIndex) ? indexes : [...indexes, cursorIndex].sort((a, b) => a - b);
    },
    [cursorIndex],
  );

  const rowHeight = wide ? ROW_HEIGHT.wide : ROW_HEIGHT.narrow;
  const virtualizer = useWindowVirtualizer({
    count: rows.length,
    estimateSize: (index) => (rows[index]?.kind === 'group' ? HEADING_HEIGHT : rowHeight),
    overscan: 12,
    scrollMargin,
    getItemKey: (index) => rowKey(rows[index]!),
    rangeExtractor,
    useFlushSync: false,
  });
  const virtualRows = virtualizer.getVirtualItems();

  /** Brings a row into view and gives it the focus once it is rendered (it may first have to scroll into the window). */
  const pending = useRef<string | null>(null);
  const focusAt = useCallback(
    (index: number, selector: string) => {
      pending.current = selector;
      const find = () => container.current?.querySelector<HTMLElement>(selector);
      if (!find()) virtualizer.scrollToIndex(index, { align: 'center' });
      let attempts = 0;
      const tryFocus = () => {
        if (pending.current !== selector) return;
        const element = find();
        if (element) {
          pending.current = null;
          element.focus({ preventScroll: true });
          revealBelowToolbar(element);
        } else if (attempts++ < 10) requestAnimationFrame(tryFocus);
      };
      requestAnimationFrame(tryFocus);
    },
    [virtualizer],
  );
  const focusRow = useCallback(
    (id: string) => {
      const index = rows.findIndex((row) => row.kind === 'item' && row.item.id === id);
      if (index >= 0) focusAt(index, `[data-row-id="${CSS.escape(id)}"]`);
    },
    [rows, focusAt],
  );
  const focusHeading = (key: string) => focusAt(rows.findIndex((row) => row.kind === 'group' && row.group.key === key), `[data-group-key="${CSS.escape(key)}"]`);

  const { clickSelect } = useSelection({ order, all, onSelectAll, cursorId, onCursor, selection, onSelect, onOpen, onPeek, focus: focusRow, container });

  // a group loads once a row of it is rendered and it is open; its next page once its last loaded row is rendered
  const enabling = useRef(new Set<string>());
  useEffect(() => {
    // asked again on every render while the end shows and nothing is on its way: a page asked for that never came (a
    // rebuild dropped its cursor, K15) is asked for again instead of leaving the placeholder for good; `loadMore` is
    // idempotent (the screen appends a cursor once)
    const asked = new Set<string>();
    for (const virtual of virtualRows) {
      const row = rows[virtual.index];
      if (!row) continue;
      const { group } = row;
      if (group.status !== 'idle') enabling.current.delete(group.key);
      else if (!collapsed.has(group.key) && !enabling.current.has(group.key)) {
        enabling.current.add(group.key);
        group.enable();
      }
      const next = rows[virtual.index + 1];
      const last = row.kind === 'more' || (row.kind === 'item' && !(next?.kind === 'item' && next.group === group));
      if (last && group.hasMore && !group.loadingMore && group.moreError === null && !asked.has(group.key)) {
        asked.add(group.key);
        group.loadMore();
      }
    }
  });

  // the tab stop: the cursor row, else the first row; one that is rendered, so Tab always reaches the list
  const renderedItems = virtualRows.flatMap((virtual) => {
    const row = rows[virtual.index];
    return row?.kind === 'item' ? [row] : [];
  });
  const wanted = cursorId !== null && order.includes(cursorId) ? cursorId : order[0];
  const stop = renderedItems.find((row) => row.item.id === wanted) ?? renderedItems[0];
  const stopKey = stop ? rowKey(stop) : null;
  const headingStop = stop ? null : virtualRows.map((virtual) => rows[virtual.index]).find((row) => row?.kind === 'group')?.group.key;

  /** ⇧ at the click of a checkbox, read before the checkbox reports its change. */
  const shiftClick = useRef(false);

  function toggleGroup(key: string, open?: boolean) {
    setCollapsed((current) => {
      const shut = open === undefined ? !current.has(key) : !open;
      if (shut === current.has(key)) return current;
      const next = new Set(current);
      if (shut) next.add(key);
      else next.delete(key);
      return next;
    });
  }

  function headingKeys(event: KeyboardEvent<HTMLButtonElement>, row: Extract<ListRow, { kind: 'group' }>, index: number) {
    if (!plain(event)) return;
    const key = row.group.key;
    const open = !collapsed.has(key);
    if (event.key === 'ArrowLeft') toggleGroup(key, false);
    else if (event.key === 'ArrowRight') {
      const first = rows[index + 1];
      if (!open) toggleGroup(key, true);
      else if (first?.kind === 'item') {
        onCursor(first.item.id);
        focusRow(first.item.id);
      }
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      const headings = rows.flatMap((entry) => (entry.kind === 'group' ? [entry.group.key] : []));
      const target = headings[headings.indexOf(key) + (event.key === 'ArrowDown' ? 1 : -1)];
      if (target !== undefined) focusHeading(target);
    } else return;
    // the list's own arrows (the cursor) stay out of it
    event.preventDefault();
  }

  return (
    <ul ref={container} aria-label={t('items.list.label')} className="relative" style={{ height: virtualizer.getTotalSize() }}>
      {virtualRows.map((virtual) => {
        const row = rows[virtual.index]!;
        const style = { transform: `translateY(${virtual.start - virtualizer.options.scrollMargin}px)` };
        const place = { ref: virtualizer.measureElement, 'data-index': virtual.index, style };
        const { group } = row;

        if (row.kind === 'group') {
          const open = !collapsed.has(group.key);
          return (
            <li key={virtual.key} {...place} className={cx('absolute inset-x-0 top-0', virtual.index > 0 && 'pt-3')}>
              <GroupHeader
                group={group}
                groupBy={groupBy}
                expanded={open}
                onToggle={() => toggleGroup(group.key)}
                tabStop={headingStop === group.key}
                onKeyDown={(event) => headingKeys(event, row, virtual.index)}
              />
            </li>
          );
        }

        if (row.kind !== 'item') {
          return (
            <li key={virtual.key} {...place} className="absolute inset-x-0 top-0 py-px">
              {row.kind === 'error' ? (
                <div role="alert" className="flex min-h-11 flex-wrap items-center gap-x-3 gap-y-1 px-2 text-ui text-muted sm:min-h-9">
                  {t('items.list.not_loaded')}
                  <Button variant="secondary" size="sm" onClick={() => group.retry()}>
                    {t('common.retry')}
                  </Button>
                </div>
              ) : (
                <SkeletonGroup className="flex min-h-11 items-center gap-2 px-2 sm:min-h-9">
                  <Skeleton className="size-4" />
                  <Skeleton className="h-3 w-48" />
                </SkeletonGroup>
              )}
            </li>
          );
        }

        const { item } = row;
        const selected = selection.includes(item.id);
        return (
          <li key={virtual.key} {...place} aria-posinset={positions.at.get(virtual.index)} aria-setsize={positions.size} className="absolute inset-x-0 top-0 py-px">
            <ItemRowBase
              item={item}
              depth={row.depth}
              fields={display.fields}
              onOpen={onOpen}
              onPeek={onPeek}
              selected={selected}
              cursor={rowKey(row) === stopKey}
              data-row-id={item.id}
              lead={
                <Checkbox
                  aria-label={t('items.list.select', { key: item.key })}
                  checked={selected}
                  tabIndex={-1}
                  onClickCapture={(event: MouseEvent) => {
                    shiftClick.current = event.shiftKey;
                  }}
                  onCheckedChange={() => {
                    clickSelect(item.id, shiftClick.current);
                    shiftClick.current = false;
                  }}
                />
              }
              onFocus={() => {
                if (cursorId !== item.id) onCursor(item.id);
              }}
              onKeyDown={(event: KeyboardEvent<HTMLDivElement>) => {
                // ← goes to the heading of the row's group
                if (grouped && event.key === 'ArrowLeft' && plain(event) && event.target === event.currentTarget) {
                  event.preventDefault();
                  focusHeading(group.key);
                }
              }}
              onClickCapture={(event: MouseEvent<HTMLDivElement>) => {
                // ⇧ and a click on the title selects the range instead of opening a window
                if (!event.shiftKey || !(event.target instanceof Element) || !event.target.closest('[data-item-link]')) return;
                event.preventDefault();
                event.stopPropagation();
                clickSelect(item.id, true);
              }}
              // a fresh item (created just now) gets a short ink-blue tint; the highlighter is for selection only
              className={cx(!selected && (flashIds.includes(item.id) ? 'bg-accent-soft' : peekItemId === item.id && 'bg-pressed'))}
            />
          </li>
        );
      })}
    </ul>
  );
}
