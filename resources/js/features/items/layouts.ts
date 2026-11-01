/*
 * The four layouts of an item list (spec 4.11: Liste, Board, Tabelle, Timeline) and the contract between the items
 * screen and a layout, ported from the clickdummy's `display/layouts.ts`, with the groups coming from the server. The
 * screen asks the server for the groups and their counts (`/groups`) and loads the pages of each group
 * (`useGroupedWorkItems`); a layout only shows them, says when a group comes into view, and lets people act.
 *
 * What a layout gets (`LayoutProps`):
 * - `groups`: the groups in the order of the server (`GroupData`), empty ones included (a board needs its empty
 *   columns; the list leaves them out). Each has its name, its count (the server's count plus the difference the
 *   optimistic changes made, `placeItems`), the items loaded so far in their places, and how its pages stand. A group
 *   loads nothing until the layout calls `enable()` (its heading or column came into view); `loadMore()` asks for its
 *   next page, `retry()` for the page that failed. Without grouping there is one group with the key `all`.
 * - `groupBy`: the grouping that holds (`ItemGroups.group_by`: `state` became `category` when the items span several
 *   workflows, P14). `display`: the display as applied (fields, sort, sub-items). `total`: every match of the list.
 *   `project`: the project of a project list.
 * - `selection` / `onSelect(ids)`: the selected ids. `onSelectAll()` (⌘A) selects every item of the list, also those of
 *   pages not loaded yet; pass it on to `useSelection`.
 * - `cursorId` / `onCursor(id)`: the item under the keyboard cursor; the item commands of the list act on it. Report
 *   every change (keys, click, focus).
 * - `onOpen(id)`: the item's page (Enter on the cursor). `onPeek(id)`: the preview (a click on the title, space).
 *
 * What a layout does:
 * - Mounts `useSelection` (selection/useSelection.ts) with the loaded item ids in its visual order and a `focus(id)`
 *   that brings the row or card into view and focuses it.
 * - The element that stands for the cursor is a row or card with `cursor` (`ItemRowBase`, `ItemCard`): exactly one is
 *   the tab stop (`[data-nav-target][tabindex="0"]`), the screen hands the focus there when a bar disappears under it.
 * - Registers no item commands of its own; keeps chips and pickers out of the tab order.
 */

import type { ComponentType } from 'react';
import type { ApiError } from '@/api/client';
import type { TranslationKey } from '@/lib/i18n';
import type { Display, GroupBy, GroupCount, ListedItem, Project } from '@/types';
import { ListLayout } from './list/ListLayout';

/** One group of a list as the layout shows it. */
export interface GroupData {
  key: string;
  label: string;
  /** The count of the server plus the difference of the optimistic changes (`placeItems`). */
  count: number;
  /** The parent of a parent group, as the server named it. */
  item?: GroupCount['item'];
  /** The items loaded so far, in their places (`placeItems`). */
  items: ListedItem[];
  /** How the first page stands: `idle` until the group is enabled. */
  status: 'idle' | 'pending' | 'error' | 'success';
  hasMore: boolean;
  loadingMore: boolean;
  moreError: ApiError | null;
  /** The group came into view: it may load its first page. */
  enable(): void;
  /** The next page. */
  loadMore(): void;
  /** The page that failed, again. */
  retry(): void;
}

export interface LayoutProps {
  groups: GroupData[];
  groupBy: GroupBy;
  display: Display;
  total: number;
  project?: Project;
  selection: string[];
  onSelect(ids: string[]): void;
  /** ⌘A: every item of the list, also those not loaded yet (the screen loads them first). */
  onSelectAll?(): void;
  onOpen(id: string): void;
  onPeek(id: string): void;
  cursorId: string | null;
  onCursor(id: string | null): void;
}

/** The layout of each `Display['layout']`; board, table and timeline get their own with their tasks. */
export const layouts: Record<Display['layout'], ComponentType<LayoutProps>> = {
  list: ListLayout,
  board: ListLayout,
  table: ListLayout,
  timeline: ListLayout,
};

/** The layouts by name and key, for the switcher and the shortcuts (1–4). */
export const LAYOUT_OPTIONS: readonly { value: Display['layout']; label: TranslationKey; shortcut: string }[] = [
  { value: 'list', label: 'items.layout.list', shortcut: '1' },
  { value: 'board', label: 'items.layout.board', shortcut: '2' },
  { value: 'table', label: 'items.layout.table', shortcut: '3' },
  { value: 'timeline', label: 'items.layout.timeline', shortcut: '4' },
];
