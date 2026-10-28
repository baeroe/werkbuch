/*
 * The four layouts of an item list (spec 4.11: Liste, Board, Tabelle, Timeline) and the contract between `ItemsScreen`
 * and a layout. `ItemsScreen` loads, filters, sorts and groups; a layout only shows and lets people act.
 *
 * `layouts` maps `Display['layout']` to its component. List and table load with the screen; board and timeline load
 * on demand (`board/BoardLayout.tsx` and `timeline/TimelineLayout.tsx` export `BoardLayout` and `TimelineLayout` by
 * name; the screen wraps them in Suspense). `1`–`4` switch between them (ItemsScreen).
 *
 * What a layout gets (`LayoutProps`):
 * - `items`: the items to show, sorted (`display.sort`), already narrowed: sub-items left out when
 *   `display.show_sub_items` is false, items on their way out (archive with undo) hidden. Never empty: without items
 *   the screen shows its empty state instead of a layout.
 * - `groups`: `items` grouped by `display.group_by` (`groupItems`), in display order, empty groups included (a board
 *   needs its empty columns; the list leaves them out). An item with several labels sits in several label groups.
 *   Without grouping there is one group with the key `all`.
 * - `display`: the display as applied. `display.group_by` is the grouping that holds: `state` became `category` when
 *   the items span several workflows (spec 4.11). The screen says so in a hint above the layout; a layout need not.
 * - `ctx`: the filter context (who is signed in, today, categories of states, blocked items …).
 * - `selection` / `onSelect(ids)`: the selected ids (`useUiStore.selection`). The screen clears it when it unmounts
 *   and drops ids that leave the list; the bulk bar acts on it.
 * - `cursorId` / `onCursor(id)`: the item under the keyboard cursor. It is the `current` of the list's item commands
 *   (`useItemCommands` in ItemsScreen), so s, a, i, p, l, t, d, ⇧D, ⇧P and ⌘⌫ act on it when nothing is selected.
 *   Report every change (keys, click, focus). While the preview is open it follows the cursor.
 * - `onOpen(id)`: the item's page (/items/KEY). Enter on the cursor.
 * - `onPeek(id)`: the preview panel. A click on a row's or card's title, and the space bar.
 *
 * What a layout does:
 * - Mounts `useSelection` (selection/useSelection.ts) with the ids in its visual order and a `focus(id)` that brings
 *   the row or card into view and focuses it. That registers j/k, ↓/↑ (with ⇧ to extend), x, ⇧X, ⌘A, Esc, Enter and
 *   space for the list scope. The element that stands for the cursor carries `data-nav-target` and is the tab stop
 *   (roving tabindex); Enter there calls `onOpen`, a click on the title `onPeek`.
 * - Registers no item commands of its own (no `s`, `a` …): the screen's `useItemCommands` instance covers every layout.
 *   To open a command's list from code: `useUiStore.getState().openPalette('item.state')`.
 * - Shows the selection with the highlighter (`selected` of ItemRowBase / ItemCard) and keeps chips and pickers out of
 *   the tab order (`tabIndex={-1}`); the shortcuts change fields.
 * - When a bar of the screen disappears under the focus (bulk bar, unsaved bar) or the layout changes, the screen hands
 *   the focus to the layout's tab stop (`[data-nav-target][tabindex="0"]`); keep exactly one such element rendered.
 */

import { lazy, type ComponentType } from 'react';
import type { Display, FilterContext, Group, WorkItem } from '@/types';
import { ListLayout } from '../list/ListLayout';
import { TableLayout } from '../table/TableLayout';

export interface LayoutProps {
  items: WorkItem[];
  groups: Group[];
  display: Display;
  ctx: FilterContext;
  selection: string[];
  onSelect(ids: string[]): void;
  onOpen(id: string): void;
  onPeek(id: string): void;
  cursorId: string | null;
  onCursor(id: string | null): void;
}

const BoardLayout = lazy(() => import('../board/BoardLayout').then((module) => ({ default: module.BoardLayout })));
const TimelineLayout = lazy(() => import('../timeline/TimelineLayout').then((module) => ({ default: module.TimelineLayout })));

export const layouts: Record<Display['layout'], ComponentType<LayoutProps>> = {
  list: ListLayout,
  board: BoardLayout,
  table: TableLayout,
  timeline: TimelineLayout,
};

/** The layouts by name and key, for the switcher and the shortcuts. */
export const LAYOUT_OPTIONS: { value: Display['layout']; label: string; shortcut: string }[] = [
  { value: 'list', label: 'Liste', shortcut: '1' },
  { value: 'board', label: 'Board', shortcut: '2' },
  { value: 'table', label: 'Tabelle', shortcut: '3' },
  { value: 'timeline', label: 'Timeline', shortcut: '4' },
];
