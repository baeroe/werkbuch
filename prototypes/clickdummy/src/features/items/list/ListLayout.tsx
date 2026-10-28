/*
 * The list layout (spec 4.11, moodboard "Liste und Timeline"): the groups as sections that fold away, with their
 * count; children right below their parent, indented; the display fields as chips that open their pickers.
 *
 * - Virtualized against the page's scroll (`useWindowVirtualizer`): only the rows in view are mounted, each with its
 *   pickers. Rows measure themselves, so a row whose chips wrap (phones) takes the room it needs.
 * - Keyboard (`useSelection`): j/k and ↓/↑ move the cursor, which is the row with the focus ring and the tab stop;
 *   Enter opens the page, the space bar the preview, x selects. The chips are no tab stops: the item shortcuts change
 *   the fields of the cursor row.
 * - Mouse: a click on the title opens the preview, with ⌘/Strg the page in a new tab, with ⇧ it selects the range up
 *   to the row; the checkbox selects (with ⇧ a range).
 */

import { useWindowVirtualizer } from '@tanstack/react-virtual';
import { ChevronDown } from 'lucide-react';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react';
import { ItemRowBase } from '@/components/items/ItemRowBase';
import { Checkbox } from '@/components/ui/Checkbox';
import { cx } from '@/components/ui/cx';
import { useUiStore } from '@/store/ui';
import type { Group, WorkItem } from '@/types';
import { GroupIcon } from '../display/GroupIcon';
import { nestRows } from '../display/grouping';
import type { LayoutProps } from '../display/layouts';
import { revealBelowToolbar, useSelection } from '../selection/useSelection';

type ListRow = { kind: 'group'; key: string; group: Group; first: boolean } | { kind: 'item'; key: string; item: WorkItem; depth: number };

const count = new Intl.NumberFormat('de-DE');

/** The rows of the list: per group its heading, then (unless it is folded) its items with their children. */
function listRows(groups: readonly Group[], grouped: boolean, collapsed: ReadonlySet<string>): ListRow[] {
  const shown = groups.filter((group) => group.items.length > 0);
  return shown.flatMap((group, index): ListRow[] => {
    const heading: ListRow[] = grouped ? [{ kind: 'group', key: `group:${group.key}`, group, first: index === 0 }] : [];
    if (grouped && collapsed.has(group.key)) return heading;
    return [...heading, ...nestRows(group.items).map((row): ListRow => ({ kind: 'item', key: `${group.key}:${row.item.id}`, item: row.item, depth: row.depth }))];
  });
}

export function ListLayout({ items, groups, display, selection, onSelect, onOpen, onPeek, cursorId, onCursor }: LayoutProps) {
  const container = useRef<HTMLUListElement>(null);
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set());
  const peekItemId = useUiStore((state) => state.peekItemId);
  const flashIds = useUiStore((state) => state.flashIds);
  const grouped = display.group_by !== 'none';

  const rows = useMemo(() => listRows(groups, grouped, collapsed), [groups, grouped, collapsed]);
  // an item with two labels has two rows; the cursor takes the first
  const order = useMemo(() => [...new Set(rows.flatMap((row) => (row.kind === 'item' ? [row.item.id] : [])))], [rows]);
  const all = useMemo(() => items.map((item) => item.id), [items]);

  // the list starts below the bars of the screen; their height changes with the filter chips
  const [scrollMargin, setScrollMargin] = useState(0);
  const measure = useCallback(() => {
    const top = (container.current?.getBoundingClientRect().top ?? 0) + window.scrollY;
    setScrollMargin((previous) => (Math.abs(previous - top) < 1 ? previous : top));
  }, []);
  useLayoutEffect(measure);
  useEffect(() => {
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [measure]);

  const virtualizer = useWindowVirtualizer({
    count: rows.length,
    estimateSize: (index) => (rows[index]?.kind === 'group' ? 48 : 44),
    // generous: an ordinary list renders whole (and stays whole in a full-page screenshot); long ones still virtualize
    overscan: 24,
    scrollMargin,
    getItemKey: (index) => rows[index]?.key ?? index,
    useFlushSync: false,
  });
  const virtualRows = virtualizer.getVirtualItems();

  /** The item whose row gets the focus once it is rendered (it may first have to scroll into the window). */
  const pending = useRef<string | null>(null);
  const focusRow = useCallback(
    (id: string) => {
      const index = rows.findIndex((row) => row.kind === 'item' && row.item.id === id);
      if (index < 0) return;
      pending.current = id;
      const find = () => container.current?.querySelector<HTMLElement>(`[data-row-id="${CSS.escape(id)}"]`);
      if (!find()) virtualizer.scrollToIndex(index, { align: 'center' });
      let attempts = 0;
      const tryFocus = () => {
        if (pending.current !== id) return;
        const element = find();
        if (element) {
          pending.current = null;
          element.focus({ preventScroll: true });
          revealBelowToolbar(element);
        } else if (attempts++ < 10) requestAnimationFrame(tryFocus);
      };
      requestAnimationFrame(tryFocus);
    },
    [rows, virtualizer],
  );

  const { clickSelect } = useSelection({ order, all, cursorId, onCursor, selection, onSelect, onOpen, onPeek, focus: focusRow, container });

  // the tab stop: the cursor row, else the first row; one that is rendered, so Tab always reaches the list
  const renderedItems = virtualRows.flatMap((virtual) => {
    const row = rows[virtual.index];
    return row?.kind === 'item' ? [row] : [];
  });
  const wanted = cursorId !== null && order.includes(cursorId) ? cursorId : order[0];
  const stopKey = (renderedItems.find((row) => row.item.id === wanted) ?? renderedItems[0])?.key;

  /** ⇧ at the click of a checkbox, read before the checkbox reports its change. */
  const shiftClick = useRef(false);

  function toggleGroup(key: string) {
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  return (
    <ul ref={container} aria-label="Items" className="relative" style={{ height: virtualizer.getTotalSize() }}>
      {virtualRows.map((virtual) => {
        const row = rows[virtual.index];
        if (!row) return null;
        const style = { transform: `translateY(${virtual.start - virtualizer.options.scrollMargin}px)` };
        const position = { 'aria-posinset': virtual.index + 1, 'aria-setsize': rows.length };

        if (row.kind === 'group') {
          const folded = collapsed.has(row.group.key);
          return (
            <li key={virtual.key} ref={virtualizer.measureElement} data-index={virtual.index} {...position} className={cx('absolute inset-x-0 top-0', !row.first && 'pt-3')} style={style}>
              <h2>
                <button
                  type="button"
                  aria-expanded={!folded}
                  onClick={() => toggleGroup(row.group.key)}
                  className="flex h-11 w-full min-w-0 cursor-pointer items-center gap-2 rounded-ctl px-2 text-left text-ui transition-colors duration-120 hover:bg-hover sm:h-9"
                >
                  <ChevronDown className={cx('size-3.5 shrink-0 text-muted transition-transform duration-160', folded && '-rotate-90')} aria-hidden="true" />
                  <GroupIcon groupBy={display.group_by} groupKey={row.group.key} />
                  <span className="min-w-0 truncate font-semibold text-ink">{row.group.label}</span>
                  <span className="shrink-0 text-muted tabular-nums">
                    <span className="sr-only">, </span>
                    {count.format(row.group.items.length)}
                    <span className="sr-only">{row.group.items.length === 1 ? ' Item' : ' Items'}</span>
                  </span>
                </button>
              </h2>
            </li>
          );
        }

        const { item } = row;
        const selected = selection.includes(item.id);
        return (
          <li key={virtual.key} ref={virtualizer.measureElement} data-index={virtual.index} {...position} className="absolute inset-x-0 top-0 py-px" style={style}>
            <ItemRowBase
              item={item}
              depth={row.depth}
              fields={display.fields}
              onOpen={onPeek}
              selected={selected}
              tabIndex={row.key === stopKey ? 0 : -1}
              data-row-id={item.id}
              data-nav-target=""
              lead={
                <Checkbox
                  aria-label={`${item.key} auswählen`}
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
                // Enter on the row opens the page; a click on the title opens the preview
                if (event.key === 'Enter' && event.target === event.currentTarget && !event.nativeEvent.isComposing) {
                  event.preventDefault();
                  onOpen(item.id);
                }
              }}
              onClickCapture={(event: MouseEvent<HTMLDivElement>) => {
                // ⇧ and a click on the title selects the range instead of opening a window
                if (!event.shiftKey || !(event.target instanceof Element) || !event.target.closest('[data-item-link]')) return;
                event.preventDefault();
                event.stopPropagation();
                clickSelect(item.id, true);
              }}
              className={cx(peekItemId === item.id && !selected && 'bg-pressed', flashIds.includes(item.id) && 'bg-wash')}
            />
          </li>
        );
      })}
    </ul>
  );
}
