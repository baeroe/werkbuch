/*
 * The table layout (spec 4.11): one row per item, one column per display field, properties included; the header and
 * the first column (key and title) stay in place while the rest scrolls. Groups become rows that fold away.
 *
 * Keyboard, as in a spreadsheet: the arrows (and j/k) choose a cell, Enter edits it (the picker or editor of the
 * field opens), Escape cancels, and the focus comes back to the cell. Enter on the first column opens the item's page,
 * the space bar its preview. Without the right to change an item, Enter on a field says why.
 * The rows are virtualized inside the table's own scroll box, which fills the window below the toolbar.
 */

import { useVirtualizer } from '@tanstack/react-virtual';
import { ArrowDownWideNarrow, ArrowUpNarrowWide, ChevronDown } from 'lucide-react';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type FocusEvent, type KeyboardEvent, type MouseEvent } from 'react';
import { archivedReason } from '@/components/fields/itemData';
import { TypeGlyph } from '@/components/fields/TypePicker';
import { ItemKey } from '@/components/items/ItemKey';
import { ItemLink } from '@/components/items/ItemLink';
import { Checkbox } from '@/components/ui/Checkbox';
import { cx } from '@/components/ui/cx';
import { toast } from '@/components/ui/toast';
import { useProperties } from '@/hooks/properties';
import { useWorkItemTypes } from '@/hooks/workItemTypes';
import { usePermissions } from '@/lib/permissions';
import { useShortcut } from '@/lib/shortcuts/useShortcut';
import { useUiStore } from '@/store/ui';
import type { Group, WorkItem } from '@/types';
import { GroupIcon } from '../display/GroupIcon';
import { nestRows } from '../display/grouping';
import type { LayoutProps } from '../display/layouts';
import { useSelection } from '../selection/useSelection';
import { Cell, tableColumns, typeHasProperty, type Column } from './cells';

type TableRow = { kind: 'group'; key: string; group: Group } | { kind: 'item'; key: string; item: WorkItem; depth: number };

const count = new Intl.NumberFormat('de-DE');

/** Sort fields that are a column: the arrow in its header shows the order. */
const SORTED_BY: Record<string, string> = { priority: 'priority', due_date: 'due_date', start_date: 'start_date', created_at: 'created_at', updated_at: 'updated_at' };

function tableRows(groups: readonly Group[], grouped: boolean, collapsed: ReadonlySet<string>): TableRow[] {
  return groups
    .filter((group) => group.items.length > 0)
    .flatMap((group): TableRow[] => {
      const heading: TableRow[] = grouped ? [{ kind: 'group', key: `group:${group.key}`, group }] : [];
      if (grouped && collapsed.has(group.key)) return heading;
      return [...heading, ...nestRows(group.items).map((row): TableRow => ({ kind: 'item', key: `${group.key}:${row.item.id}`, item: row.item, depth: row.depth }))];
    });
}

/**
 * Backgrounds of a row's cells, laid over the paper the sticky column needs: a selected row has the highlighter's wash,
 * a live change a short ink-blue tint (the highlighter is for selection, focus and hits only), the previewed row the
 * pressed tone, others the hover tone.
 */
const wash = '[background-image:linear-gradient(var(--select-wash),var(--select-wash))]';
const tint = '[background-image:linear-gradient(var(--accent-soft),var(--accent-soft))]';
const pressed = '[background-image:linear-gradient(var(--pressed),var(--pressed))]';
const hoverWash = 'group-hover:[background-image:linear-gradient(var(--hover),var(--hover))]';

export function TableLayout({ items, groups, display, selection, onSelect, onSelectAll, onOpen, onPeek, cursorId, onCursor }: LayoutProps) {
  const properties = useProperties().data?.items;
  const types = useWorkItemTypes().data?.items;
  const { reason } = usePermissions();
  const columns = useMemo(() => tableColumns(display.fields, properties ?? []), [display.fields, properties]);
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set());
  const [column, setColumn] = useState(0);
  const [editing, setEditing] = useState<{ id: string; field: string } | null>(null);
  const peekItemId = useUiStore((state) => state.peekItemId);
  const flashIds = useUiStore((state) => state.flashIds);
  const scroller = useRef<HTMLDivElement>(null);
  const grouped = display.group_by !== 'none';
  const showKey = display.fields.includes('key');

  const rows = useMemo(() => tableRows(groups, grouped, collapsed), [groups, grouped, collapsed]);
  const order = useMemo(() => [...new Set(rows.flatMap((row) => (row.kind === 'item' ? [row.item.id] : [])))], [rows]);
  const all = useMemo(() => items.map((item) => item.id), [items]);
  const activeColumn = Math.min(column, columns.length);

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

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scroller.current,
    estimateSize: () => 41,
    overscan: 10,
    getItemKey: (index) => rows[index]?.key ?? index,
    // the sticky header covers the first 40 px of the box
    scrollPaddingStart: 41,
    useFlushSync: false,
  });
  const virtualRows = virtualizer.getVirtualItems();
  const padTop = virtualRows[0]?.start ?? 0;
  const padBottom = virtualizer.getTotalSize() - (virtualRows.at(-1)?.end ?? 0);

  const focusCell = useCallback(
    (id: string, col: number) => {
      const index = rows.findIndex((row) => row.kind === 'item' && row.item.id === id);
      if (index < 0) return;
      const find = () => scroller.current?.querySelector<HTMLElement>(`[data-cell="${CSS.escape(`${id}:${col}`)}"]`);
      if (!find()) virtualizer.scrollToIndex(index, { align: 'auto' });
      let attempts = 0;
      const tryFocus = () => {
        const element = find();
        // focus() scrolls the cell into view; the box's scroll padding keeps it clear of the sticky header and column
        if (element) element.focus();
        else if (attempts++ < 10) requestAnimationFrame(tryFocus);
      };
      requestAnimationFrame(tryFocus);
    },
    [rows, virtualizer],
  );
  const columnRef = useRef(activeColumn);
  useLayoutEffect(() => {
    columnRef.current = activeColumn;
  });

  const { clickSelect } = useSelection({
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
    focus: (id) => focusCell(id, columnRef.current),
    container: scroller,
  });

  const inGrid = () => Boolean(scroller.current?.contains(document.activeElement));
  function moveColumn(step: 1 | -1) {
    const next = Math.min(columns.length, Math.max(0, activeColumn + step));
    setColumn(next);
    const id = cursorId ?? order[0];
    if (id) {
      if (id !== cursorId) onCursor(id);
      focusCell(id, next);
    }
  }
  /** Home, End and with ⌘ the first or last row: the keys of the grid pattern (WAI-ARIA APG). */
  function jump(target: { column: number } | { row: 'first' | 'last' }) {
    const id = 'row' in target ? (target.row === 'first' ? order[0] : order.at(-1)) : (cursorId ?? order[0]);
    if (!id) return;
    const col = 'column' in target ? target.column : activeColumn;
    setColumn(col);
    if (id !== cursorId) onCursor(id);
    focusCell(id, col);
  }
  useShortcut({ id: 'table.left', keys: 'arrowleft', scope: 'list', label: 'Vorige Spalte', group: 'Tabelle', repeat: true, when: inGrid, run: () => moveColumn(-1) });
  useShortcut({ id: 'table.right', keys: 'arrowright', scope: 'list', label: 'Nächste Spalte', group: 'Tabelle', repeat: true, when: inGrid, run: () => moveColumn(1) });
  useShortcut({ id: 'table.home', keys: 'home', scope: 'list', label: 'Erste Spalte', group: 'Tabelle', when: inGrid, run: () => jump({ column: 0 }) });
  useShortcut({ id: 'table.end', keys: 'end', scope: 'list', label: 'Letzte Spalte', group: 'Tabelle', when: inGrid, run: () => jump({ column: columns.length }) });
  useShortcut({ id: 'table.first', keys: 'mod+home', scope: 'list', label: 'Erste Zeile', group: 'Tabelle', when: inGrid, run: () => jump({ row: 'first' }) });
  useShortcut({ id: 'table.last', keys: 'mod+end', scope: 'list', label: 'Letzte Zeile', group: 'Tabelle', when: inGrid, run: () => jump({ row: 'last' }) });

  function startEditing(item: WorkItem, target: Column) {
    if (!target.editable || (target.property && !typeHasProperty(types, item, target.property))) return;
    const denied = item.archived_at !== null ? archivedReason(item.key) : reason('item.edit', item.project_id);
    if (denied) {
      toast({ title: 'Nicht änderbar', description: denied, tone: 'error' });
      return;
    }
    setEditing({ id: item.id, field: target.field });
  }

  /** A pointer is pressing in a cell: the focus may stay on the control it hit. */
  const pointer = useRef(false);

  // the tab stop: the cell of the cursor, else the first cell; one that is rendered, so Tab always reaches the table
  const renderedItems = virtualRows.flatMap((virtual) => {
    const row = rows[virtual.index];
    return row?.kind === 'item' ? [row] : [];
  });
  const wanted = cursorId !== null && order.includes(cursorId) ? cursorId : order[0];
  const stopRow = (renderedItems.find((row) => row.item.id === wanted) ?? renderedItems[0])?.key;
  const shiftClick = useRef(false);

  const allSelected = all.length > 0 && all.every((id) => selection.includes(id));
  const someSelected = !allSelected && selection.length > 0;
  const sortedColumn = (field: string) => (display.sort.field === (SORTED_BY[field] ?? `${field}`) ? (display.sort.direction === 'asc' ? 'ascending' : 'descending') : undefined);
  const SortArrow = display.sort.direction === 'asc' ? ArrowUpNarrowWide : ArrowDownWideNarrow;

  function toggleGroup(key: string) {
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  return (
    <div
      ref={scroller}
      // focus moving between cells scrolls them clear of the sticky header and first column
      className="relative overflow-auto overscroll-contain rounded-card border border-line bg-surface shadow-elev-1 scroll-pt-11 scroll-pl-56 md:scroll-pl-88"
      style={{ maxHeight: `calc(100dvh - ${top}px - 1rem)` }}
    >
      <table
        role="grid"
        aria-label="Items"
        aria-rowcount={rows.length + 1}
        aria-colcount={columns.length + 1}
        aria-multiselectable="true"
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
              aria-sort={sortedColumn('key')}
              className="sticky top-0 left-0 z-30 h-10 border-r border-b border-line bg-surface px-2 text-left text-sm font-medium text-muted"
            >
              <span className="flex items-center gap-2">
                <Checkbox
                  aria-label="Alle Items auswählen"
                  checked={allSelected}
                  indeterminate={someSelected}
                  tabIndex={-1}
                  // all of the list, also the pages not loaded yet, as ⌘A and the bulk bar do
                  onCheckedChange={() => (allSelected ? onSelect([]) : onSelectAll ? onSelectAll() : onSelect(all))}
                />
                Item
                {sortedColumn('key') && <SortArrow className="size-3.5" aria-hidden="true" />}
              </span>
            </th>
            {columns.map((entry) => {
              const sorted = sortedColumn(entry.field);
              return (
                <th
                  key={entry.field}
                  role="columnheader"
                  scope="col"
                  aria-sort={sorted}
                  className={cx('sticky top-0 z-20 h-10 border-b border-line bg-surface px-3 text-sm font-medium whitespace-nowrap text-muted', entry.numeric ? 'text-right' : 'text-left')}
                >
                  <span className={cx('inline-flex max-w-full items-center gap-1', sorted && 'text-ink')}>
                    <span className="truncate">{entry.label}</span>
                    {sorted && <SortArrow className="size-3.5 shrink-0" aria-hidden="true" />}
                  </span>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {padTop > 0 && (
            <tr aria-hidden="true">
              <td colSpan={columns.length + 1} style={{ height: padTop }} className="p-0" />
            </tr>
          )}
          {virtualRows.map((virtual) => {
            const row = rows[virtual.index];
            if (!row) return null;
            const rowIndex = virtual.index + 2;

            if (row.kind === 'group') {
              const folded = collapsed.has(row.group.key);
              return (
                <tr key={virtual.key} ref={virtualizer.measureElement} data-index={virtual.index} role="row" aria-rowindex={rowIndex}>
                  <td role="gridcell" colSpan={columns.length + 1} className="h-10 border-b border-line bg-sunken p-0">
                    <div className="sticky left-0 inline-flex max-w-[calc(100vw-3rem)] px-1">
                      <button
                        type="button"
                        aria-expanded={!folded}
                        onClick={() => toggleGroup(row.group.key)}
                        className="flex h-9 min-w-0 cursor-pointer items-center gap-2 rounded-ctl px-2 text-left transition-colors duration-120 hover:bg-hover"
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
                    </div>
                  </td>
                </tr>
              );
            }

            const { item } = row;
            const selected = selection.includes(item.id);
            const type = types?.find((entry) => entry.id === item.type_id);
            const look = selected ? wash : flashIds.includes(item.id) ? tint : peekItemId === item.id ? pressed : hoverWash;
            const cellFocus = (col: number) => ({
              'data-cell': `${item.id}:${col}`,
              'data-nav-target': '',
              tabIndex: row.key === stopRow && col === activeColumn ? 0 : -1,
              onPointerDown: () => {
                pointer.current = true;
                setTimeout(() => {
                  pointer.current = false;
                }, 0);
              },
              onFocus: (event: FocusEvent<HTMLTableCellElement>) => {
                // the picker gave the focus back to its trigger: the cell takes it, so the arrows go on from here
                if (event.target !== event.currentTarget && !pointer.current && editing === null) event.currentTarget.focus();
                if (cursorId !== item.id) onCursor(item.id);
                if (activeColumn !== col) setColumn(col);
              },
              onKeyDown: (event: KeyboardEvent<HTMLTableCellElement>) => {
                if (event.key !== 'Enter' || event.target !== event.currentTarget || event.nativeEvent.isComposing) return;
                event.preventDefault();
                if (col === 0) onOpen(item.id);
                else startEditing(item, columns[col - 1]);
              },
            });

            return (
              <tr key={virtual.key} ref={virtualizer.measureElement} data-index={virtual.index} role="row" aria-rowindex={rowIndex} aria-selected={selected} className="group">
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
                  className={cx(
                    'sticky left-0 z-10 h-10 border-r border-b border-line bg-surface px-2 [--focus-offset:-2px]',
                    look,
                  )}
                >
                  <div className="flex min-w-0 items-center gap-2" style={{ paddingLeft: row.depth > 0 ? `${row.depth * 1.25}rem` : undefined }}>
                    <span className="relative z-10 inline-flex shrink-0">
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
                  const cellEditing = editing !== null && editing.id === item.id && editing.field === entry.field;
                  return (
                    <td
                      key={entry.field}
                      role="gridcell"
                      {...cellFocus(col)}
                      className={cx('h-10 border-b border-line px-2 [--focus-offset:-2px]', entry.numeric && 'text-right', look === pressed ? hoverWash : look)}
                    >
                      <div className={cx('flex min-w-0 items-center', entry.numeric && 'justify-end')}>
                        <Cell
                          item={item}
                          column={entry}
                          editing={cellEditing}
                          onEditingChange={(open) => {
                            if (open) startEditing(item, entry);
                            else if (cellEditing) setEditing(null);
                          }}
                        />
                      </div>
                    </td>
                  );
                })}
              </tr>
            );
          })}
          {padBottom > 0 && (
            <tr aria-hidden="true">
              <td colSpan={columns.length + 1} style={{ height: padBottom }} className="p-0" />
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
