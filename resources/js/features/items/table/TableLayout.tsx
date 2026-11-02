/*
 * The table layout (spec 4.11), ported from the clickdummy: one row per item, one column per display field (the display
 * menu chooses them), properties included; the header and the first column (key and title) stay in place while the
 * rest scrolls (`position: sticky`). Groups are rows that fold away, with the count of the server.
 *
 * - An ARIA grid. Its keys (`useGridKeys`, P26): the arrows choose a cell (↑/↓ and j/k through the items, K19), Enter
 *   edits it (the picker or editor of the field opens), Escape closes the editor and the focus comes back to the cell,
 *   Tab leaves the grid (one cell is the tab stop). Enter on the first column opens the item's page, the space bar its
 *   preview. Without the right to change an item, Enter on a field says why; so do the read-only cells (project,
 *   created, changed) and the cells of a property the item's type does not have.
 * - The group headings are no tab stops (13c): ← on the first column goes to the heading of the row's group; on a
 *   heading ← folds the group, → opens it or goes to its first row, ↓/↑ go to the next or previous heading, as in the
 *   list. Only while no item row is there to take it, the first heading is the tab stop.
 * - Virtualized inside the table's own scroll box, which fills the window below the toolbar; the cursor row stays
 *   rendered while it scrolls away (13c). A group loads its first page once a row of it is rendered and it is open, its
 *   next once its last loaded row is rendered, as in the list; a page that fails adds a row with a retry.
 * - Below sm the rows, the group toggles and the pickers in the cells are 44 px tall (touch targets, 13c).
 */

import { defaultRangeExtractor, useVirtualizer, type Range } from '@tanstack/react-virtual';
import { ArrowDownWideNarrow, ArrowUpNarrowWide } from 'lucide-react';
import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type FocusEvent, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react';
import { archivedReason } from '@/components/fields/itemData';
import { TypeGlyph } from '@/components/fields/TypeGlyph';
import { ItemKey } from '@/components/items/ItemKey';
import { ItemLink } from '@/components/items/ItemLink';
import { Button } from '@/components/ui/Button';
import { Checkbox } from '@/components/ui/Checkbox';
import { cx } from '@/components/ui/cx';
import { Skeleton, SkeletonGroup } from '@/components/ui/Skeleton';
import { toast } from '@/components/ui/toast';
import { useProperties } from '@/hooks/properties';
import { useWorkItemTypes } from '@/hooks/workItemTypes';
import { t, type TranslationKey } from '@/lib/i18n';
import { useIsWide } from '@/lib/media';
import { usePermissions } from '@/lib/permissions';
import { useUiStore } from '@/store/ui';
import type { ListedItem } from '@/types';
import type { LayoutProps } from '../layouts';
import { GroupHeader } from '../list/GroupHeader';
import { listRows, rowKey, type ListRow } from '../list/rows';
import { useSelection } from '../selection/useSelection';
import { Cell } from './cells/Cell';
import { tableColumns, typeHasProperty, type Column } from './columns';
import { useGridKeys } from './useGridKeys';

/** How tall a row is before it has measured itself: 40 px and its line, 44 px on phones (touch targets). */
const ROW_HEIGHT = { wide: 41, narrow: 45 };

/** The sort field a column shows in its heading (`aria-sort`); the first column is the key. */
const SORTED_BY: Record<string, string> = { state: 'state_category' };
const sortFieldOf = (field: string) => SORTED_BY[field] ?? field;

/** Why a read-only column does not open. */
const READ_ONLY_REASONS: Record<string, TranslationKey> = {
  project: 'items.table.read_only.project',
  created_at: 'items.table.read_only.created_at',
  updated_at: 'items.table.read_only.updated_at',
};

/** Plain arrow keys only. */
const plain = (event: KeyboardEvent) => !event.shiftKey && !event.altKey && !event.metaKey && !event.ctrlKey;

/**
 * The backgrounds of a row's cells, laid over the paper the sticky column needs: a selected row has the highlighter's
 * wash, a fresh item a short ink-blue tint, the previewed row the pressed tone, the others the hover tone.
 */
const wash = '[background-image:linear-gradient(var(--select-wash),var(--select-wash))]';
const tint = '[background-image:linear-gradient(var(--accent-soft),var(--accent-soft))]';
const pressed = '[background-image:linear-gradient(var(--pressed),var(--pressed))]';
const hoverWash = 'group-hover:[background-image:linear-gradient(var(--hover),var(--hover))]';

type ItemRow = Extract<ListRow, { kind: 'item' }>;
/** What places a rendered row: the virtualizer measures it, the grid counts it. */
type RowPlace = { ref: (element: Element | null) => void; 'data-index': number; role: string; 'aria-rowindex': number };

/** The height of the rows that are not rendered, in the flow of the table. */
function Spacer({ span, height }: { span: number; height: number }) {
  return (
    <tr aria-hidden="true" data-spacer="">
      <td colSpan={span} style={{ height }} className="p-0" />
    </tr>
  );
}

/** A row that is not an item: the sticky content of a cell over the whole width. */
function WideCell({ span, children }: { span: number; children: ReactNode }) {
  return (
    <td role="gridcell" colSpan={span} className="border-b border-line p-0">
      <div className="sticky left-0 w-fit max-w-[calc(100vw-3rem)] px-1">{children}</div>
    </td>
  );
}

export function TableLayout({ groups, groupBy, display, selection, onSelect, onSelectAll, onOpen, onPeek, cursorId, onCursor }: LayoutProps) {
  const properties = useProperties().data?.items;
  const types = useWorkItemTypes().data?.items;
  const { reason } = usePermissions();
  const columns = useMemo(() => tableColumns(display.fields, properties ?? []), [display.fields, properties]);
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set());
  const [column, setColumn] = useState(0);
  /** The open editor: the row (`rowKey`, an item has a row in each of its label groups) and the field. */
  const [editing, setEditing] = useState<{ row: string; field: string } | null>(null);
  const peekItemId = useUiStore((state) => state.peekItemId);
  const flashIds = useUiStore((state) => state.flashIds);
  const scroller = useRef<HTMLDivElement>(null);
  const grouped = groupBy !== 'none';
  const showKey = display.fields.includes('key');
  const activeColumn = Math.min(column, columns.length);

  const rows = useMemo(() => listRows(groups, grouped, collapsed), [groups, grouped, collapsed]);
  // an item with two labels has two rows: the cells are addressed by the row (`rowKey`), the cursor by the item
  const itemRows = useMemo(() => rows.filter((row): row is ItemRow => row.kind === 'item'), [rows]);
  const rowKeys = useMemo(() => itemRows.map(rowKey), [itemRows]);
  const rowsByKey = useMemo(() => new Map(itemRows.map((row) => [rowKey(row), row])), [itemRows]);
  const order = useMemo(() => [...new Set(itemRows.map((row) => row.item.id))], [itemRows]);
  const all = useMemo(() => [...new Set(groups.flatMap((group) => group.items.map((item) => item.id)))], [groups]);

  // the box fills the window below the bars of the screen
  const [top, setTop] = useState(0);
  const measure = useCallback(() => {
    const next = Math.round((scroller.current?.getBoundingClientRect().top ?? 0) + window.scrollY);
    setTop((previous) => (previous === next ? previous : next));
  }, []);
  useLayoutEffect(measure);
  useEffect(() => {
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [measure]);

  // the row of the cursor: the one the focus was in last, else the first row of the cursor item
  const [cursorRow, setCursorRow] = useState<string | null>(null);
  const firstRowKey = (id: string | null) => {
    const first = itemRows.find((row) => row.item.id === id);
    return first ? rowKey(first) : null;
  };
  const cursorKey = cursorRow !== null && rowsByKey.get(cursorRow)?.item.id === cursorId ? cursorRow : firstRowKey(cursorId);

  // the cursor row stays rendered while it scrolls away, so it keeps the focus (13c)
  const cursorIndex = useMemo(() => rows.findIndex((row) => row.kind === 'item' && rowKey(row) === cursorKey), [rows, cursorKey]);
  const rangeExtractor = useCallback(
    (range: Range) => {
      const indexes = defaultRangeExtractor(range);
      return cursorIndex < 0 || indexes.includes(cursorIndex) ? indexes : [...indexes, cursorIndex].sort((a, b) => a - b);
    },
    [cursorIndex],
  );

  const wide = useIsWide();
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scroller.current,
    estimateSize: () => (wide ? ROW_HEIGHT.wide : ROW_HEIGHT.narrow),
    overscan: 10,
    getItemKey: (index) => rowKey(rows[index]!),
    rangeExtractor,
    // the sticky header covers the first 40 px of the box
    scrollPaddingStart: ROW_HEIGHT.wide,
    useFlushSync: false,
  });
  // across the md line the rows change their height: measure them again
  useEffect(() => virtualizer.measure(), [wide, virtualizer]);
  const virtualRows = virtualizer.getVirtualItems();
  // the rows stand in the flow of the table: what is not rendered keeps its height in spacer rows, before the first
  // rendered row, between two that do not follow each other (the cursor row kept while it scrolled away) and after the
  // last, so the box keeps its height and its scroll position
  const padBottom = virtualizer.getTotalSize() - (virtualRows.at(-1)?.end ?? 0);

  /** Brings a row into view and gives an element of it the focus once it is rendered. */
  const pending = useRef<string | null>(null);
  const focusAt = useCallback(
    (index: number, selector: string) => {
      pending.current = selector;
      const find = () => scroller.current?.querySelector<HTMLElement>(selector);
      if (!find()) virtualizer.scrollToIndex(index, { align: 'auto' });
      let attempts = 0;
      const tryFocus = () => {
        if (pending.current !== selector) return;
        const element = find();
        // focus() scrolls the cell into view; the box's scroll padding keeps it clear of the sticky header and column
        if (element) {
          pending.current = null;
          element.focus();
        } else if (attempts++ < 10) requestAnimationFrame(tryFocus);
      };
      requestAnimationFrame(tryFocus);
    },
    [virtualizer],
  );
  const focusCell = useCallback(
    (key: string, col: number) => {
      const index = rows.findIndex((row) => row.kind === 'item' && rowKey(row) === key);
      if (index >= 0) focusAt(index, `[data-cell="${CSS.escape(`${key}:${col}`)}"]`);
    },
    [rows, focusAt],
  );
  const focusHeading = (key: string) => focusAt(rows.findIndex((row) => row.kind === 'group' && row.group.key === key), `[data-group-key="${CSS.escape(key)}"]`);

  const columnRef = useRef(activeColumn);
  useLayoutEffect(() => {
    columnRef.current = activeColumn;
  });

  /** The row j/k and ↑/↓ went to: `focus` takes it, so an item in two groups is left from the row it is in. */
  const stepped = useRef<string | null>(null);
  const { clickSelect, move } = useSelection({
    order,
    all,
    onSelectAll,
    cursorId,
    onCursor: (id) => {
      setEditing(null);
      onCursor(id);
    },
    selection,
    onSelect,
    onOpen,
    onPeek,
    focus: (id) => {
      const key = stepped.current !== null && rowsByKey.get(stepped.current)?.item.id === id ? stepped.current : firstRowKey(id)!;
      stepped.current = null;
      setCursorRow(key);
      focusCell(key, columnRef.current);
    },
    // row by row from the row of the cursor (an item with two labels is in two rows)
    step: (_current, step) => {
      if (rowKeys.length === 0) return null;
      const index = cursorKey === null ? -1 : rowKeys.indexOf(cursorKey);
      const next = index < 0 ? (step === 1 ? rowKeys[0]! : rowKeys.at(-1)!) : rowKeys[Math.min(rowKeys.length - 1, Math.max(0, index + step))]!;
      stepped.current = next;
      return rowsByKey.get(next)!.item.id;
    },
    container: scroller,
    arrows: false,
  });

  /** The cursor goes to a cell. */
  function go(key: string, col: number) {
    const { item } = rowsByKey.get(key)!;
    setColumn(col);
    setCursorRow(key);
    if (item.id !== cursorId) onCursor(item.id);
    focusCell(key, col);
  }

  function refuse(description: string) {
    toast({ title: t('items.table.read_only.title'), description, tone: 'error' });
  }

  function startEditing(item: ListedItem, target: Column, key: string) {
    const readOnly = READ_ONLY_REASONS[target.field];
    if (readOnly) return refuse(t(readOnly));
    if (target.property && !typeHasProperty(types, item, target.property)) {
      const type = types?.find((entry) => entry.id === item.type_id)?.name ?? '';
      return refuse(t('items.table.not_applicable_detail', { property: target.property.label, type }));
    }
    const denied = item.archived_at !== null ? archivedReason(item.key) : reason('item.edit', item.project_id);
    if (denied) return refuse(denied);
    setEditing({ row: key, field: target.field });
  }

  const gridKeys = useGridKeys({
    rows: rowKeys,
    lastColumn: columns.length,
    go,
    move,
    enter: (key, col) => {
      const { item } = rowsByKey.get(key)!;
      if (col === 0) onOpen(item.id);
      else startEditing(item, columns[col - 1]!, key);
    },
    leftEdge: (key) => {
      if (!grouped) return false;
      focusHeading(rowsByKey.get(key)!.group.key);
      return true;
    },
  });

  // a group loads once a row of it is rendered and it is open; its next page once its last loaded row is rendered
  const enabling = useRef(new Set<string>());
  useEffect(() => {
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

  /** A pointer is pressing in a cell: the focus may stay on the control it hit. */
  const pointer = useRef(false);

  // the tab stop: the cell of the cursor, else the first cell; one that is rendered, so Tab always reaches the table
  const renderedItems = virtualRows.flatMap((virtual) => {
    const row = rows[virtual.index];
    return row?.kind === 'item' ? [row] : [];
  });
  const stop = renderedItems.find((row) => rowKey(row) === cursorKey) ?? renderedItems[0];
  const stopKey = stop ? rowKey(stop) : null;
  const headingStop = stop ? null : virtualRows.map((virtual) => rows[virtual.index]).find((row) => row?.kind === 'group')?.group.key;
  /** ⇧ at the click of a checkbox, read before the checkbox reports its change. */
  const shiftClick = useRef(false);

  const allSelected = all.length > 0 && all.every((id) => selection.includes(id));
  const someSelected = !allSelected && selection.length > 0;
  const sorted = (field: string) =>
    display.sort.field === sortFieldOf(field) ? (display.sort.direction === 'asc' ? ('ascending' as const) : ('descending' as const)) : undefined;
  const SortArrow = display.sort.direction === 'asc' ? ArrowUpNarrowWide : ArrowDownWideNarrow;
  const span = columns.length + 1;

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
      else if (first?.kind === 'item') go(rowKey(first), 0);
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      const headings = rows.flatMap((entry) => (entry.kind === 'group' ? [entry.group.key] : []));
      const target = headings[headings.indexOf(key) + (event.key === 'ArrowDown' ? 1 : -1)];
      if (target !== undefined) focusHeading(target);
    } else return;
    event.preventDefault();
  }

  function renderRow(row: ListRow, index: number) {
    const { group } = row;
    if (row.kind === 'group') {
      return (
        <WideCell span={span}>
          <GroupHeader
            group={group}
            groupBy={groupBy}
            expanded={!collapsed.has(group.key)}
            onToggle={() => toggleGroup(group.key)}
            tabStop={headingStop === group.key}
            onKeyDown={(event) => headingKeys(event, row, index)}
          />
        </WideCell>
      );
    }
    if (row.kind === 'error') {
      return (
        <WideCell span={span}>
          <div role="alert" className="flex min-h-11 flex-wrap items-center gap-x-3 gap-y-1 px-2 text-ui text-muted sm:min-h-10">
            {t('items.list.not_loaded')}
            <Button variant="secondary" size="sm" onClick={() => group.retry()}>
              {t('common.retry')}
            </Button>
          </div>
        </WideCell>
      );
    }
    return (
      <WideCell span={span}>
        <SkeletonGroup className="flex h-11 items-center gap-2 px-2 sm:h-10">
          <Skeleton className="size-4" />
          <Skeleton className="h-3 w-48" />
        </SkeletonGroup>
      </WideCell>
    );
  }

  function renderItem(row: ItemRow, place: RowPlace) {
    const { item } = row;
    const key = rowKey(row);
    const selected = selection.includes(item.id);
    const type = types?.find((entry) => entry.id === item.type_id);
    const look = selected ? wash : flashIds.includes(item.id) ? tint : peekItemId === item.id ? pressed : hoverWash;
    const isStop = key === stopKey;
    const cellFocus = (col: number) => ({
      'data-cell': `${key}:${col}`,
      'data-item-id': item.id,
      'data-column': col,
      'data-nav-target': '',
      tabIndex: isStop && col === activeColumn ? 0 : -1,
      onPointerDown: () => {
        pointer.current = true;
        setTimeout(() => {
          pointer.current = false;
        }, 0);
      },
      onFocus: (event: FocusEvent<HTMLTableCellElement>) => {
        // only what happens in the cell itself: an editor's popup or a question (the resolution) is portalled
        if (!event.currentTarget.contains(event.target)) return;
        // the picker gave the focus back to its trigger: the cell takes it, so the arrows go on from here
        if (event.target !== event.currentTarget && !pointer.current && editing === null) event.currentTarget.focus();
        if (cursorId !== item.id) onCursor(item.id);
        setCursorRow(key);
        if (activeColumn !== col) setColumn(col);
      },
    });

    return (
      <tr {...place} aria-selected={selected} className="group">
        <td
          role="gridcell"
          {...cellFocus(0)}
          onClickCapture={(event: MouseEvent<HTMLTableCellElement>) => {
            // ⇧ and a click on the title selects the range instead of opening a window
            if (!event.shiftKey || !(event.target instanceof Element) || !event.target.closest('[data-item-link]')) return;
            event.preventDefault();
            event.stopPropagation();
            clickSelect(item.id, true);
          }}
          className={cx('sticky left-0 z-10 h-11 border-r border-b border-line bg-surface px-2 [--focus-offset:-2px] sm:h-10', look)}
        >
          <div className="flex min-w-0 items-center gap-2" style={{ paddingLeft: row.depth > 0 ? `${row.depth * 1.25}rem` : undefined }}>
            <span className="relative z-10 inline-flex shrink-0">
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
            </span>
            {type && <TypeGlyph type={type} />}
            <ItemLink item={item} onOpen={onPeek} tabIndex={-1} className="flex min-w-0 flex-1 items-center gap-2 text-ink">
              {showKey ? <ItemKey value={item.key} className="shrink-0 text-sm text-muted" /> : <span className="sr-only">{item.key} </span>}
              <span className={cx('min-w-0 truncate', type?.is_epic && 'font-medium', item.archived_at && 'text-muted')}>{item.title}</span>
            </ItemLink>
          </div>
        </td>
        {columns.map((entry, index) => {
          const col = index + 1;
          const cellEditing = editing !== null && editing.row === key && editing.field === entry.field;
          return (
            <td
              key={entry.field}
              role="gridcell"
              {...cellFocus(col)}
              className={cx('h-11 border-b border-line px-2 [--focus-offset:-2px] sm:h-10', entry.numeric && 'text-right', look === pressed ? hoverWash : look)}
            >
              {/* the pickers in the cells are 44 px tall on phones (touch targets, 13c) */}
              <div className={cx('flex min-w-0 items-center max-sm:[&_button]:min-h-11', entry.numeric && 'justify-end')}>
                <Cell
                  item={item}
                  column={entry}
                  editing={cellEditing}
                  onEditingChange={(open) => {
                    if (open) startEditing(item, entry, key);
                    else if (cellEditing) setEditing(null);
                  }}
                />
              </div>
            </td>
          );
        })}
      </tr>
    );
  }

  return (
    <div
      ref={scroller}
      data-table-scroller=""
      // focus moving between cells scrolls them clear of the sticky header and first column
      className="relative overflow-auto overscroll-contain rounded-card border border-line bg-surface shadow-elev-1 scroll-pt-11 scroll-pl-56 md:scroll-pl-88"
      style={{ maxHeight: `calc(100dvh - ${top}px - 1rem)` }}
    >
      <table
        role="grid"
        aria-label={t('items.table.label')}
        aria-rowcount={rows.length + 1}
        aria-colcount={span}
        aria-multiselectable="true"
        onKeyDown={gridKeys}
        // a fixed table needs its width: the first column (14 rem, 22 rem from md on) and the fields
        style={{ width: `calc(var(--title-w) + ${columns.reduce((sum, entry) => sum + entry.width, 0)}rem)` }}
        className="min-w-full table-fixed border-separate border-spacing-0 text-ui [--title-w:14rem] md:[--title-w:22rem]"
      >
        <colgroup>
          <col className="w-(--title-w)" />
          {columns.map((entry) => (
            <col key={entry.field} style={{ width: `${entry.width}rem` }} />
          ))}
        </colgroup>
        <thead>
          <tr role="row" aria-rowindex={1}>
            <th
              role="columnheader"
              scope="col"
              aria-sort={sorted('key')}
              className="sticky top-0 left-0 z-30 h-10 border-r border-b border-line bg-surface px-2 text-left text-sm font-medium text-muted"
            >
              <span className="flex items-center gap-2">
                <Checkbox
                  aria-label={t('items.table.select_all')}
                  checked={allSelected}
                  indeterminate={someSelected}
                  tabIndex={-1}
                  // all of the list, also the pages not loaded yet, as ⌘A does
                  onCheckedChange={() => (allSelected ? onSelect([]) : onSelectAll ? onSelectAll() : onSelect(all))}
                />
                {t('items.table.item')}
                {sorted('key') && <SortArrow className="size-3.5" aria-hidden="true" />}
              </span>
            </th>
            {columns.map((entry) => {
              const sort = sorted(entry.field);
              return (
                <th
                  key={entry.field}
                  role="columnheader"
                  scope="col"
                  aria-sort={sort}
                  className={cx('sticky top-0 z-20 h-10 border-b border-line bg-surface px-3 text-sm font-medium whitespace-nowrap text-muted', entry.numeric ? 'text-right' : 'text-left')}
                >
                  <span className={cx('inline-flex max-w-full items-center gap-1', sort && 'text-ink')}>
                    <span className="truncate">{entry.label}</span>
                    {sort && <SortArrow className="size-3.5 shrink-0" aria-hidden="true" />}
                  </span>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {virtualRows.map((virtual, position) => {
            const row = rows[virtual.index]!;
            const gap = virtual.start - (virtualRows[position - 1]?.end ?? 0);
            const place = { ref: virtualizer.measureElement, 'data-index': virtual.index, role: 'row', 'aria-rowindex': virtual.index + 2 };
            return (
              <Fragment key={virtual.key}>
                {gap > 0 && <Spacer span={span} height={gap} />}
                {row.kind === 'item' ? (
                  renderItem(row, place)
                ) : (
                  <tr {...place} className={row.kind === 'group' ? 'bg-sunken' : undefined}>
                    {renderRow(row, virtual.index)}
                  </tr>
                )}
              </Fragment>
            );
          })}
          {padBottom > 0 && <Spacer span={span} height={padBottom} />}
        </tbody>
      </table>
    </div>
  );


}
