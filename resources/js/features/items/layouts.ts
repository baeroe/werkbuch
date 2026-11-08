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
 *   `project`: the project of a project list. `createDefaults`: what a new item of the list gets (`openCreate`; Meine
 *   Items: assigned to me), for the quick add of a board.
 * - `filtered` / `onResetFilter()`: the list is empty because of its filter, and the way back to all of it (as
 *   `ListEmpty`); only the timeline uses them, the screen shows `ListEmpty` for the other layouts.
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

import { createElement, lazy, type ComponentType } from 'react';
import type { ApiError } from '@/api/client';
import { t, type TranslationKey } from '@/lib/i18n';
import type { ShortcutId } from '@/lib/shortcuts/catalog';
import type { CreateDefaults } from '@/store/ui';
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
  /**
   * The next page. Idempotent: the layout asks again on every render while the end of the group shows and no page is on
   * its way (a page asked for that never came is asked for again), so a second call for the same page loads nothing.
   */
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
  createDefaults?: CreateDefaults;
  /** The filter of the list hides items (it differs from its base, or a view has conditions of its own). */
  filtered?: boolean;
  /** Back to the filter of the base (or none). */
  onResetFilter?(): void;
  selection: string[];
  onSelect(ids: string[]): void;
  /** ⌘A: every item of the list, also those not loaded yet (the screen loads them first). */
  onSelectAll?(): void;
  onOpen(id: string): void;
  onPeek(id: string): void;
  cursorId: string | null;
  onCursor(id: string | null): void;
}

/** A chunk of a layout that did not load: the one error `LayoutBoundary` takes on (T18-M5). */
export class LayoutChunkError extends Error {
  /** Lets the next render of the layout ask for its chunk again. */
  readonly retry: () => void;

  constructor(cause: unknown, retry: () => void) {
    super(t('items.screen.layout_failed'), { cause });
    this.name = 'LayoutChunkError';
    this.retry = retry;
  }
}

/**
 * A layout that comes as a chunk of its own, with its first use (in a `Suspense`). A lazy component keeps a failed
 * import for good: "Erneut versuchen" of `LayoutBoundary` gives the layout a new one (`retry` of the error), so its next
 * render asks for the chunk again. Not before: React renders once more after an error by itself, and that render must
 * fail again rather than ask the network a second time unasked.
 */
export function lateLayout(load: () => Promise<ComponentType<LayoutProps>>): ComponentType<LayoutProps> {
  const make = () =>
    lazy(() =>
      load().then(
        (component) => ({ default: component }),
        (reason: unknown) => {
          throw new LayoutChunkError(reason, () => (current = make()));
        },
      ),
    );
  let current = make();
  return function LateLayout(props: LayoutProps) {
    return createElement(current, props);
  };
}

/** The board, the table and the timeline come as chunks of their own. */
const BoardLayout = lateLayout(() => import('./board/BoardLayout').then((module) => module.BoardLayout));
const TableLayout = lateLayout(() => import('./table/TableLayout').then((module) => module.TableLayout));
const TimelineLayout = lateLayout(() => import('./timeline/TimelineLayout').then((module) => module.TimelineLayout));

/** The layout of each `Display['layout']`. */
export const layouts: Record<Display['layout'], ComponentType<LayoutProps>> = {
  list: ListLayout,
  board: BoardLayout,
  table: TableLayout,
  timeline: TimelineLayout,
};

/** The layouts by name, with the shortcut of the catalog (1–4) for the switcher in the header of the list. */
export const LAYOUT_OPTIONS: readonly { value: Display['layout']; label: TranslationKey; shortcut: ShortcutId }[] = [
  { value: 'list', label: 'items.layout.list', shortcut: 'list.layout.list' },
  { value: 'board', label: 'items.layout.board', shortcut: 'list.layout.board' },
  { value: 'table', label: 'items.layout.table', shortcut: 'list.layout.table' },
  { value: 'timeline', label: 'items.layout.timeline', shortcut: 'list.layout.timeline' },
];
