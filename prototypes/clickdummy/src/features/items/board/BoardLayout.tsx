/*
 * The board (spec 4.11, moodboard "Board"): the groups of the list as columns of index cards on the paper. The
 * contract with ItemsScreen is in display/layouts.ts; the rules of what a card may do are in rules.ts.
 *
 * Moving a card changes the grouped field: the status (only where the workflow allows the transition; on a category
 * column the first status of that category the item's workflow allows), the priority or the assignee. A move into
 * Completed or Canceled asks for the resolution first (ResolutionPrompt). Within a column sorted by rank the order is
 * the rank (`rankBetween`); a board grouped by label moves nothing.
 *
 * Pointer (dnd-kit, mouse and long press on touch): the card lifts, tilts −2° and travels in an overlay; columns it
 * may not enter are dimmed, and over one of them the card names the reason. Dropped there, it springs back and a toast
 * says why (Review Focus 3). A dropped card keeps its new place until the server has answered.
 *
 * Keyboard: the arrows move the cursor between cards (↑/↓, j/k within a column, ←/→ to the neighbouring column);
 * ⇧←/⇧→ move the cursor's card to the nearest allowed column, ⌥↑/⌥↓ change its place in a column sorted by rank.
 * j/k and the arrows of `useSelection` are bound again here, so they stay within a column; the rest of the list keys
 * (x, ⇧X, ⌘A, Esc, Enter, space) come from `useSelection`, the item commands (s, a, p …) from the screen. dnd-kit's
 * keyboard sensor is left out on purpose: it would take Enter (open) and the space bar (preview) from the cards.
 *
 * No success toast for a move: the card shows the result at once, and a polite status line says it for screen
 * readers (toasts take three places at most, and a toast per move would push out the others).
 */

import {
  closestCenter,
  defaultDropAnimationSideEffects,
  DndContext,
  DragOverlay,
  getFirstCollision,
  MeasuringStrategy,
  MouseSensor,
  pointerWithin,
  rectIntersection,
  TouchSensor,
  useSensor,
  useSensors,
  type Announcements,
  type CollisionDetection,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
  type DropAnimation,
  type UniqueIdentifier,
} from '@dnd-kit/core';
import { arrayMove } from '@dnd-kit/sortable';
import { ArrowDown, ArrowUp, Ban } from 'lucide-react';
import { createElement, useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router';
import type { WorkItemPatch } from '@/api/workItems';
import { archivedReason } from '@/components/fields/itemData';
import { ResolutionPrompt } from '@/components/fields/ResolutionPrompt';
import { cardEpic, ItemCard, partOf } from '@/components/items/ItemCard';
import { cx } from '@/components/ui/cx';
import { PRIORITY_LABELS } from '@/components/ui/PriorityIcon';
import { currentToasts, dismissToast, toast, type ToastOptions } from '@/components/ui/toast';
import { sortItems } from '@/domain/filter';
import { NONE_KEY } from '@/domain/grouping';
import { useMembers, useProjects } from '@/hooks/projects';
import { useUsers } from '@/hooks/users';
import { useWorkflows } from '@/hooks/workflows';
import { useTransitionWorkItem, useUpdateWorkItem } from '@/hooks/workItems';
import { useWorkItemTypes } from '@/hooks/workItemTypes';
import { useCommand } from '@/lib/commands';
import { usePermissions } from '@/lib/permissions';
import { useShortcut } from '@/lib/shortcuts/useShortcut';
import { useUiStore } from '@/store/ui';
import type { State, WorkItem } from '@/types';
import type { LayoutProps } from '../display/layouts';
import { revealBelowToolbar, useSelection } from '../selection/useSelection';
import { BoardCard, BoardColumn, BoardSkeletonColumns, type BoardColumnData } from './BoardColumn';
import { QuickAdd, type QuickAddOption } from './QuickAdd';
import { assignBlocker, boardLockReason, checkMove, nearestAllowed, quickAddFields, rankForSlot, type BoardRules, type MoveCheck } from './rules';

/** The sort of a column by name, for the hint that its order follows the sort. */
const SORT_NAMES: Record<string, string> = {
  priority: 'Priorität',
  due_date: 'Due-Date',
  start_date: 'Start-Date',
  created_at: 'Angelegt',
  updated_at: 'Geändert',
  key: 'Key',
  state_category: 'Kategorie',
};

/** A live change gets a short ink-blue tint, the previewed card the pressed tone; both lie over the card's white. */
const TINT = '[background-image:linear-gradient(var(--accent-soft),var(--accent-soft))]';
const PRESSED = '[background-image:linear-gradient(var(--pressed),var(--pressed))]';
/** While the overlay flies to its place the card straightens up again (DESIGN.md: "beim Ablegen federt sie zurück"). */
const SETTLE = 'in-[.board-dropping]:translate-y-0 in-[.board-dropping]:scale-100 in-[.board-dropping]:rotate-0 in-[.board-dropping]:after:opacity-0';

const MEASURING = { droppable: { strategy: MeasuringStrategy.Always } };
/**
 * The board scrolls while a card nears its edge, but only close to it: dnd-kit's default (a fifth of the width) scrolls
 * a wide board away under a card that is meant for the last visible column.
 */
const AUTO_SCROLL = { threshold: { x: 0.08, y: 0.12 } };

/** A drag in progress: where the card came from, and the columns as they would be after the drop. */
interface DragState {
  id: string;
  origin: { column: string; index: number };
  columns: BoardColumnData[];
  /** The column under the pointer. */
  over: string | null;
}

/** The columns with a card moved to `index` of the column `key`. */
function place(columns: BoardColumnData[], id: string, key: string, index: number): BoardColumnData[] {
  return columns.map((column) => {
    const had = column.ids.includes(id);
    if (!had && column.key !== key) return column;
    const ids = column.ids.filter((entry) => entry !== id);
    if (column.key === key) ids.splice(Math.max(0, Math.min(index, ids.length)), 0, id);
    return { ...column, ids };
  });
}

/** The column a droppable id stands for: a column itself, or the column a card lies in. */
function columnKeyOf(columns: BoardColumnData[], id: string): string | null {
  if (id.startsWith('column:')) return id.slice('column:'.length);
  return columns.find((column) => column.ids.includes(id))?.key ?? null;
}

const reducedMotion = () => typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** The spring of DESIGN.md for the drop animation (Web Animations need the curve itself, not the variable). */
function springEasing(): string {
  const fallback = 'cubic-bezier(0.34, 1.3, 0.64, 1)';
  const value = getComputedStyle(document.documentElement).getPropertyValue('--ease-spring').trim();
  if (!value || typeof KeyframeEffect === 'undefined') return fallback;
  try {
    new KeyframeEffect(null, null, { easing: value });
    return value;
  } catch {
    return fallback;
  }
}

/**
 * The sorting hint once: a neutral toast with the same text replaces the one shown, so drop after drop does not take
 * one more of the three places each time. Refusals are errors and go straight to `toast()`, which refreshes the same
 * error itself.
 */
function toastOnce(options: ToastOptions): void {
  currentToasts()
    .filter((entry) => entry.title === options.title && entry.description === options.description)
    .forEach((entry) => dismissToast(entry.id));
  toast(options);
}

/** Scrolls a box just enough that an element stands inside it. */
function scrollWithin(box: HTMLElement, element: HTMLElement, axis: 'x' | 'y', margin = 12): void {
  const outer = box.getBoundingClientRect();
  const inner = element.getBoundingClientRect();
  if (axis === 'y') {
    if (inner.top < outer.top + margin) box.scrollTop -= outer.top + margin - inner.top;
    else if (inner.bottom > outer.bottom - margin) box.scrollTop += inner.bottom - outer.bottom + margin;
  } else if (inner.left < outer.left + margin) box.scrollLeft -= outer.left + margin - inner.left;
  else if (inner.right > outer.right - margin) box.scrollLeft += inner.right - outer.right + margin;
}

/** No element in particular has the focus: the page itself or the main area. */
function focusIsNeutral(): boolean {
  const element = document.activeElement;
  return !element || element === document.body || element.id === 'main';
}

const cardKey = (column: string, id: string) => `${column}\n${id}`;

export function BoardLayout({ items, groups, display, ctx, selection, onSelect, onSelectAll, onOpen, onPeek, cursorId, onCursor }: LayoutProps) {
  const navigate = useNavigate();
  const { identifier } = useParams();
  const { pathname } = useLocation();
  const workflows = useWorkflows().data?.items;
  const projects = useProjects({ include_archived: true }).data?.items;
  // a quick add in a parent's column gives the child a type that may have a parent
  const types = useWorkItemTypes().data?.items;
  const users = useUsers().data?.items;
  const members = useMembers().data?.items;
  const { reason } = usePermissions();
  const update = useUpdateWorkItem();
  const transition = useTransitionWorkItem();
  const peekItemId = useUiStore((state) => state.peekItemId);
  const flashIds = useUiStore((state) => state.flashIds);
  const hintId = useId();

  const groupBy = display.group_by;
  // a child card names its epic before its key, except where the columns are the epics
  const showParent = groupBy !== 'parent';
  const manual = display.sort.field === 'rank';
  const locked = boardLockReason(groupBy);
  const sortable = locked === null;

  const itemById = useMemo(() => new Map(items.map((item) => [item.id, item])), [items]);
  const itemsRef = useRef(items);
  useLayoutEffect(() => {
    itemsRef.current = items;
  });

  /* ------------------------------------------------------------------------- columns */

  // sorted again here: an optimistic change (a new rank, another priority) shows in its place before the list reloads
  const base = useMemo<BoardColumnData[]>(
    () => groups.map((group) => ({ key: group.key, label: group.label, ids: sortItems(group.items, display.sort, ctx).map((item) => item.id) })),
    [groups, display.sort, ctx],
  );
  /** Cards dropped by pointer keep their place until the server has answered (or the resolution is chosen). */
  const [placements, setPlacements] = useState<ReadonlyMap<string, { column: string; index: number }>>(() => new Map());
  const placed = useMemo(() => {
    let next = base;
    for (const [id, spot] of placements) if (itemById.has(id)) next = place(next, id, spot.column, spot.index);
    return next;
  }, [base, placements, itemById]);
  const [drag, setDrag] = useState<DragState | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const columns = drag?.columns ?? placed;
  const columnsRef = useRef(columns);
  useLayoutEffect(() => {
    columnsRef.current = columns;
  });
  const columnLabel = useCallback((key: string) => groups.find((group) => group.key === key)?.label ?? key, [groups]);

  /* --------------------------------------------------------------------------- rules */

  const workflowOf = useCallback(
    (item: Pick<WorkItem, 'project_id'>) => {
      const project = projects?.find((entry) => entry.id === item.project_id);
      return workflows?.find((workflow) => workflow.id === project?.workflow_id);
    },
    [projects, workflows],
  );
  const rules = useMemo<BoardRules>(
    () => ({
      groupBy,
      workflowOf,
      columnLabel,
      editReason: (item) => (item.archived_at !== null ? archivedReason(item.key) : reason('item.edit', item.project_id)),
      assignReason: (userId, item) => {
        const user = users?.find((entry) => entry.id === userId);
        const project = projects?.find((entry) => entry.id === item.project_id);
        return user && project && members ? assignBlocker(user, project, members) : null;
      },
    }),
    [groupBy, workflowOf, columnLabel, reason, users, projects, members],
  );

  /* ------------------------------------------------------------------ cursor and focus */

  const board = useRef<HTMLDivElement>(null);
  const cards = useRef(new Map<string, HTMLElement>());
  /** On a board grouped by label an item has a card in several columns: the cursor stands on one of them. */
  const [cursorColumn, setCursorColumn] = useState<string | null>(null);
  const order = useMemo(() => [...new Set(columns.flatMap((column) => column.ids))], [columns]);
  const all = useMemo(() => items.map((item) => item.id), [items]);

  const locate = (id: string | null, within: BoardColumnData[] = columns): { column: number; index: number } | null => {
    if (id === null) return null;
    const preferred = cursorColumn === null ? -1 : within.findIndex((column) => column.key === cursorColumn && column.ids.includes(id));
    const column = preferred >= 0 ? preferred : within.findIndex((column) => column.ids.includes(id));
    return column < 0 ? null : { column, index: within[column].ids.indexOf(id) };
  };

  /** The element of an item's card; in `column` when given (and only there when `strict`). */
  const findCard = useCallback((id: string, column?: string | null, strict = false): HTMLElement | undefined => {
    if (column) {
      const element = cards.current.get(cardKey(column, id));
      if (element?.isConnected) return element;
      if (strict) return undefined;
    }
    for (const entry of columnsRef.current) {
      const element = entry.ids.includes(id) ? cards.current.get(cardKey(entry.key, id)) : undefined;
      if (element?.isConnected) return element;
    }
    return undefined;
  }, []);

  /** Brings a card into view: its column scrolls to it, the board to the column, the page below the toolbar. */
  const reveal = useCallback((element: HTMLElement) => {
    // the li holds the room of the card's tab
    const frame = element.parentElement ?? element;
    const list = element.closest<HTMLElement>('[data-board-list]');
    if (list) scrollWithin(list, frame, 'y');
    const section = element.closest<HTMLElement>('section');
    if (board.current && section) scrollWithin(board.current, section, 'x');
    revealBelowToolbar(frame);
  }, []);

  const pendingFocus = useRef<string | null>(null);
  /** Focuses a card now, or as soon as it is rendered (in `column` when `strict`: a card that is about to move there). */
  const focusCard = useCallback(
    (id: string, column?: string | null, strict = false) => {
      pendingFocus.current = id;
      let attempts = 0;
      const attempt = () => {
        if (pendingFocus.current !== id) return;
        const element = findCard(id, column, strict);
        if (element) {
          pendingFocus.current = null;
          element.focus({ preventScroll: true });
          reveal(element);
        } else if (attempts++ < 12) requestAnimationFrame(attempt);
      };
      attempt();
    },
    [findCard, reveal],
  );

  /**
   * A card the keyboard or the pointer moved keeps the focus while it changes its place: moving to another column
   * mounts it anew, and the old element takes the focus with it.
   */
  const following = useRef<{ id: string; column: string; pointer: boolean; index?: number } | null>(null);
  /** The card `id` is moving to `column` (at `index`, when the move chooses the place); `pointer`: a drag moved it. */
  const follow = useCallback((id: string, column: string, { pointer = false, index }: { pointer?: boolean; index?: number } = {}) => {
    const target = { id, column, pointer, index };
    following.current = target;
    // long enough for the optimistic change (or its rollback) to land
    setTimeout(() => {
      if (following.current === target) following.current = null;
    }, 1500);
  }, []);
  useLayoutEffect(() => {
    const target = following.current;
    if (!target) return;
    // only the card in its new place counts: until the move has landed the old element still holds the focus (a new
    // place in the same column too: the new order moves the element and may take the focus with it)
    const element = findCard(target.id, target.column, true);
    const place = columns.find((column) => column.key === target.column)?.ids.indexOf(target.id);
    if (!element || (target.index !== undefined && place !== target.index)) return;
    if (element !== document.activeElement) {
      // a focus elsewhere (a click on the paper, a field) wins over the follow
      if (!focusIsNeutral()) return;
      // after a drag the card is focused as the pointer left it: without the keyboard ring
      element.focus({ preventScroll: true, focusVisible: !target.pointer });
      reveal(element);
    }
    // done: later renders leave the focus where the person puts it
    following.current = null;
  });

  const { clickSelect } = useSelection({ order, all, onSelectAll, cursorId, onCursor, selection, onSelect, onOpen, onPeek, focus: (id) => focusCard(id), container: board });

  /** Puts the cursor on a card and the focus with it. */
  function go(column: number, index: number) {
    const entry = columns[column];
    const id = entry?.ids[index];
    if (!id) return;
    setCursorColumn(entry.key);
    if (id !== cursorId) onCursor(id);
    focusCard(id, entry.key);
  }

  function first() {
    const column = columns.findIndex((entry) => entry.ids.length > 0);
    if (column >= 0) go(column, 0);
  }

  function vertical(step: 1 | -1) {
    const at = locate(cursorId);
    if (!at) return first();
    const ids = columns[at.column].ids;
    go(at.column, Math.min(ids.length - 1, Math.max(0, at.index + step)));
  }

  function horizontal(step: 1 | -1) {
    const at = locate(cursorId);
    if (!at) return first();
    for (let column = at.column + step; column >= 0 && column < columns.length; column += step) {
      const ids = columns[column].ids;
      if (ids.length === 0) continue;
      // the card at the same height, as far as the page has a layout; else the one at the same position
      const from = cursorId ? findCard(cursorId, columns[at.column].key)?.getBoundingClientRect() : undefined;
      let index = Math.min(at.index, ids.length - 1);
      if (from && from.height > 0) {
        const middle = from.top + from.height / 2;
        let best = Number.POSITIVE_INFINITY;
        ids.forEach((id, position) => {
          const rect = findCard(id, columns[column].key, true)?.getBoundingClientRect();
          if (!rect) return;
          const distance = Math.abs(rect.top + rect.height / 2 - middle);
          if (distance < best) {
            best = distance;
            index = position;
          }
        });
      }
      go(column, index);
      return;
    }
  }

  /* ---------------------------------------------------------------------------- moves */

  const [busy, setBusy] = useState<ReadonlySet<string>>(() => new Set());
  const [announcement, setAnnouncement] = useState('');
  const mark = (id: string, on: boolean) =>
    setBusy((current) => {
      const next = new Set(current);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  const unplace = (id: string) =>
    setPlacements((current) => {
      if (!current.has(id)) return current;
      const next = new Map(current);
      next.delete(id);
      return next;
    });

  const refuse = (item: WorkItem, why: string) => toast({ title: `${item.key} nicht verschoben`, description: why, tone: 'error' });

  const stateName = (item: WorkItem, stateId: string) => workflowOf(item)?.states.find((state) => state.id === stateId)?.name ?? columnLabel(stateId);
  /** What a move did, for the status line. */
  function said(item: WorkItem, check: Extract<MoveCheck, { ok: true }>, column: BoardColumnData): string {
    const { state_id, priority, assignee_id } = check.patch;
    if (state_id !== undefined) return `${item.key} steht jetzt in ${stateName(item, state_id)}.`;
    if (priority !== undefined) return `${item.key} hat jetzt die Priorität ${PRIORITY_LABELS[priority]}.`;
    if (assignee_id !== undefined) return assignee_id === null ? `${item.key} ist jetzt niemandem zugewiesen.` : `${item.key} ist jetzt ${column.label} zugewiesen.`;
    return `${item.key} hat einen neuen Platz in ${column.label}.`;
  }

  /** The rank of a card at `index` of a column (its neighbours are the cards around it). */
  const rankAt = (ids: string[], index: number) =>
    rankForSlot(itemById.get(ids[index - 1] ?? '')?.rank ?? null, itemById.get(ids[index + 1] ?? '')?.rank ?? null, display.sort.direction);

  /** Sends a move: a status change alone as a transition, anything else (rank, priority, assignee) as an update. */
  async function commit(item: WorkItem, patch: WorkItemPatch, message: string, origin: string) {
    mark(item.id, true);
    try {
      const fields = Object.keys(patch);
      if (patch.state_id !== undefined && fields.every((field) => field === 'state_id' || field === 'resolution_id')) {
        await transition.mutateAsync({ id: item.id, to_state_id: patch.state_id, resolution_id: patch.resolution_id });
      } else {
        await update.mutateAsync({ id: item.id, patch });
      }
      setAnnouncement(message);
    } catch {
      // the mutation has put the item back and named the cause in a toast; the focus goes back with the card
      follow(item.id, origin);
    } finally {
      mark(item.id, false);
      unplace(item.id);
    }
  }

  /** A move into Completed or Canceled waits for the resolution. */
  const [asking, setAsking] = useState<{ item: WorkItem; target: State; patch: WorkItemPatch; message: string; origin: string; destination: string } | null>(null);
  const [askOpen, setAskOpen] = useState(false);
  const confirmed = useRef(false);
  function ask(request: NonNullable<typeof asking>) {
    confirmed.current = false;
    setAsking(request);
    setAskOpen(true);
  }

  function moveByKey(step: 1 | -1) {
    const item = cursorId ? itemById.get(cursorId) : undefined;
    const at = locate(cursorId);
    if (!item || !at) return;
    // a card that cannot move at all (no right, a board grouped by label) says so, also at the edge of the board
    const movable = checkMove(item, columns[at.column].key, columns[at.column].key, rules);
    if (!movable.ok) return refuse(item, movable.reason);
    const result = nearestAllowed(item, columns.map((column) => column.key), at.column, step, rules);
    // no allowed column, or the edge of the board: the toast says which (an identical one replaces itself)
    if (!result.ok) return refuse(item, result.reason);
    const target = columns[result.index];
    const message = said(item, result.check, target);
    if (result.check.closing) {
      ask({ item, target: result.check.closing, patch: result.check.patch, message, origin: columns[at.column].key, destination: target.key });
      return;
    }
    setCursorColumn(target.key);
    follow(item.id, target.key);
    void commit(item, result.check.patch, message, columns[at.column].key);
  }

  function reorderByKey(step: 1 | -1) {
    const item = cursorId ? itemById.get(cursorId) : undefined;
    const at = locate(cursorId);
    if (!item || !at) return;
    const column = columns[at.column];
    const check = checkMove(item, column.key, column.key, rules);
    if (!check.ok) return refuse(item, check.reason);
    if (!manual) {
      toastOnce({ title: 'Die Reihenfolge folgt der Sortierung', description: sortedHint() });
      return;
    }
    const index = at.index + step;
    if (index < 0 || index >= column.ids.length) {
      setAnnouncement(`${item.key} steht schon ${step < 0 ? 'oben' : 'unten'} in ${column.label}.`);
      return;
    }
    const ids = arrayMove(column.ids, at.index, index);
    follow(item.id, column.key, { index });
    void commit(item, { rank: rankAt(ids, index) }, `${item.key} steht jetzt an Stelle ${index + 1} von ${ids.length} in ${column.label}.`, column.key);
  }

  /** Whether the cursor card can move one place up or down in its column (a column sorted by rank). */
  function canReorder(step: 1 | -1): boolean {
    const item = cursorId ? itemById.get(cursorId) : undefined;
    const at = locate(cursorId);
    if (!item || !at || !manual) return false;
    const column = columns[at.column];
    const index = at.index + step;
    return index >= 0 && index < column.ids.length && checkMove(item, column.key, column.key, rules).ok;
  }

  // the place in a column without dragging (WCAG 2.5.7): ⌥↑/⌥↓, and the same in the palette, which a pointer reaches
  // through the search field of the sidebar; listed while the cursor card can move that way
  useCommand({
    id: 'board.card_up',
    label: 'Karte in der Spalte nach oben',
    group: 'Board',
    keys: 'alt+arrowup',
    icon: createElement(ArrowUp),
    keywords: ['Reihenfolge', 'verschieben', 'Platz'],
    when: () => canReorder(-1),
    run: () => reorderByKey(-1),
  });
  useCommand({
    id: 'board.card_down',
    label: 'Karte in der Spalte nach unten',
    group: 'Board',
    keys: 'alt+arrowdown',
    icon: createElement(ArrowDown),
    keywords: ['Reihenfolge', 'verschieben', 'Platz'],
    when: () => canReorder(1),
    run: () => reorderByKey(1),
  });

  const sortedHint = () =>
    `Die Spalten sind nach ${SORT_NAMES[display.sort.field] ?? 'einem Feld'} sortiert. Eine eigene Reihenfolge geht mit der Sortierung „Manuell“ unter „Anzeige“.`;

  /* ---------------------------------------------------------------------- keyboard */

  const inBoard = () => focusIsNeutral() || Boolean(board.current?.contains(document.activeElement));
  const GROUP = 'Board';
  useShortcut({ id: 'board.next', keys: 'j', scope: 'list', label: 'Nächstes Item', group: 'Liste', repeat: true, run: () => vertical(1) });
  useShortcut({ id: 'board.previous', keys: 'k', scope: 'list', label: 'Voriges Item', group: 'Liste', repeat: true, run: () => vertical(-1) });
  useShortcut({ id: 'board.down', keys: 'arrowdown', scope: 'list', label: 'Nächstes Item', group: 'Liste', repeat: true, when: inBoard, run: () => vertical(1) });
  useShortcut({ id: 'board.up', keys: 'arrowup', scope: 'list', label: 'Voriges Item', group: 'Liste', repeat: true, when: inBoard, run: () => vertical(-1) });
  useShortcut({ id: 'board.left', keys: 'arrowleft', scope: 'list', label: 'Spalte links', group: GROUP, repeat: true, when: inBoard, run: () => horizontal(-1) });
  useShortcut({ id: 'board.right', keys: 'arrowright', scope: 'list', label: 'Spalte rechts', group: GROUP, repeat: true, when: inBoard, run: () => horizontal(1) });
  useShortcut({ id: 'board.move_left', keys: 'shift+arrowleft', scope: 'list', label: 'Karte in die nächste erlaubte Spalte links', group: GROUP, when: inBoard, run: () => moveByKey(-1) });
  useShortcut({ id: 'board.move_right', keys: 'shift+arrowright', scope: 'list', label: 'Karte in die nächste erlaubte Spalte rechts', group: GROUP, when: inBoard, run: () => moveByKey(1) });
  useShortcut({ id: 'board.move_up', keys: 'alt+arrowup', scope: 'list', label: 'Karte in der Spalte nach oben', group: GROUP, when: inBoard, run: () => reorderByKey(-1) });
  useShortcut({ id: 'board.move_down', keys: 'alt+arrowdown', scope: 'list', label: 'Karte in der Spalte nach unten', group: GROUP, when: inBoard, run: () => reorderByKey(1) });
  // Escape during a drag cancels the drag and nothing else: the selection stays. dnd-kit's pointer sensors cancel on
  // the document's keydown and end the drag at once (onDragCancel), before this listener on the window asks: the drag
  // that just ended counts too (`justDropped`, cleared after the event). An open preview still closes with the same
  // key, through PeekHost's Escape in the detail scope, which outranks the list's.
  useShortcut({
    id: 'board.cancel_drag',
    keys: 'escape',
    scope: 'list',
    label: 'Ziehen abbrechen',
    group: GROUP,
    when: () => dragRef.current !== null || justDropped.current,
    run: () => {},
  });

  /* -------------------------------------------------------------------- drag and drop */

  const sensors = useSensors(useSensor(MouseSensor, { activationConstraint: { distance: 5 } }), useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 6 } }));
  const [lifted, setLifted] = useState(false);
  const lastOver = useRef<UniqueIdentifier | null>(null);
  const movedColumn = useRef(false);
  /** A click right after a drop is the end of the drag, not a click on the card's title. */
  const justDropped = useRef(false);
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      movedColumn.current = false;
    });
    return () => cancelAnimationFrame(frame);
  }, [columns]);

  /** Over a column with cards: the card nearest to the pointer; else the column. While a card changes column, the last hit. */
  const collision = useCallback<CollisionDetection>((args) => {
    const pointer = pointerWithin(args);
    const hits = pointer.length > 0 ? pointer : rectIntersection(args);
    let overId = getFirstCollision(hits, 'id');
    if (overId !== null) {
      const id = String(overId);
      const ids = id.startsWith('column:') ? (columnsRef.current.find((column) => `column:${column.key}` === id)?.ids ?? []) : [];
      if (ids.length > 0) {
        overId = closestCenter({ ...args, droppableContainers: args.droppableContainers.filter((container) => ids.includes(String(container.id))) })[0]?.id ?? overId;
      }
      lastOver.current = overId;
      return [{ id: overId }];
    }
    if (movedColumn.current && dragRef.current) lastOver.current = dragRef.current.id;
    return lastOver.current === null ? [] : [{ id: lastOver.current }];
  }, []);

  function onDragStart({ active }: DragStartEvent) {
    const id = String(active.id);
    const key = columnKeyOf(columns, id);
    if (!key) return;
    const column = columns.find((entry) => entry.key === key)!;
    const state: DragState = { id, origin: { column: key, index: column.ids.indexOf(id) }, columns, over: key };
    dragRef.current = state;
    setDrag(state);
    lastOver.current = null;
    setCursorColumn(key);
    if (cursorId !== id) onCursor(id);
    // the overlay starts as the card in its place and lifts on the next frame (spring, DESIGN.md)
    setLifted(false);
    requestAnimationFrame(() => setLifted(true));
  }

  /** Where a card goes in a column it enters: under the pointer in a column sorted by rank, else where the sort puts it. */
  function insertIndex(item: WorkItem, check: Extract<MoveCheck, { ok: true }>, target: BoardColumnData, event: DragOverEvent): number {
    if (!manual) {
      const patched = { ...item, ...check.patch };
      const others = target.ids.flatMap((id) => (id === item.id ? [] : (itemById.get(id) ?? [])));
      return sortItems([...others, patched], display.sort, ctx).findIndex((entry) => entry.id === item.id);
    }
    const { active, over } = event;
    const overIndex = over ? target.ids.indexOf(String(over.id)) : -1;
    if (!over || overIndex < 0) return target.ids.length;
    const dragged = active.rect.current.translated;
    const below = dragged !== null && dragged.top + dragged.height / 2 > over.rect.top + over.rect.height / 2;
    return overIndex + (below ? 1 : 0);
  }

  function onDragOver(event: DragOverEvent) {
    const state = dragRef.current;
    const item = state ? itemById.get(state.id) : undefined;
    if (!state || !item || !event.over) return;
    const overKey = columnKeyOf(state.columns, String(event.over.id));
    if (!overKey) return;
    const check = checkMove(item, state.origin.column, overKey, rules);
    const currentKey = columnKeyOf(state.columns, state.id);
    let next = state.columns;
    if (!check.ok) {
      // over a column the card may not enter it waits at home, so a drop there springs back
      if (currentKey !== state.origin.column) next = place(state.columns, state.id, state.origin.column, state.origin.index);
    } else if (overKey !== currentKey) {
      const target = state.columns.find((column) => column.key === overKey)!;
      next = place(state.columns, state.id, overKey, insertIndex(item, check, target, event));
    }
    if (next !== state.columns) movedColumn.current = true;
    if (next !== state.columns || state.over !== overKey) {
      const updated = { ...state, columns: next, over: overKey };
      dragRef.current = updated;
      setDrag(updated);
    }
  }

  function endDrag() {
    const state = dragRef.current;
    dragRef.current = null;
    lastOver.current = null;
    setDrag(null);
    justDropped.current = true;
    setTimeout(() => {
      justDropped.current = false;
    }, 0);
    return state;
  }

  function onDragEnd({ over }: DragEndEvent) {
    const state = endDrag();
    const item = state ? itemById.get(state.id) : undefined;
    if (!state || !item) return;
    follow(item.id, state.origin.column, { pointer: true });
    const overKey = over ? columnKeyOf(state.columns, String(over.id)) : null;
    if (!overKey) {
      setAnnouncement(`${item.key} liegt wieder in ${columnLabel(state.origin.column)}.`);
      return;
    }
    const check = checkMove(item, state.origin.column, overKey, rules);
    if (!check.ok) {
      refuse(item, check.reason);
      return;
    }
    const target = state.columns.find((column) => column.key === overKey)!;
    let ids = target.ids;
    if (manual && over) {
      const from = ids.indexOf(item.id);
      const to = ids.indexOf(String(over.id));
      if (from >= 0 && to >= 0 && from !== to) ids = arrayMove(ids, from, to);
    }
    const index = ids.indexOf(item.id);
    if (overKey === state.origin.column && index === state.origin.index) {
      // a column sorted by something else keeps its order: say why the card did not change its place
      if (!manual && over && String(over.id) !== item.id) toastOnce({ title: 'Die Reihenfolge folgt der Sortierung', description: sortedHint() });
      return;
    }
    const patch: WorkItemPatch = manual ? { ...check.patch, rank: rankAt(ids, index) } : { ...check.patch };
    follow(item.id, overKey, { pointer: true, index });
    setPlacements((current) => new Map(current).set(item.id, { column: overKey, index }));
    setCursorColumn(overKey);
    const message = said(item, check, target);
    if (check.closing) {
      ask({ item, target: check.closing, patch, message, origin: state.origin.column, destination: overKey });
      return;
    }
    void commit(item, patch, message, state.origin.column);
  }

  function onDragCancel() {
    const state = endDrag();
    if (state) follow(state.id, state.origin.column, { pointer: true });
  }

  const keyOf = (id: UniqueIdentifier) => itemById.get(String(id))?.key ?? 'Die Karte';
  const announcements: Announcements = {
    onDragStart: ({ active }) => `${keyOf(active.id)} aufgenommen.`,
    onDragOver: ({ active, over }) => {
      const state = dragRef.current;
      const item = itemById.get(String(active.id));
      const key = over && state ? columnKeyOf(state.columns, String(over.id)) : null;
      if (!item || !state || !key) return `${keyOf(active.id)} ist über keiner Spalte.`;
      const check = checkMove(item, state.origin.column, key, rules);
      return check.ok ? `${item.key} über ${columnLabel(key)}.` : `${item.key} über ${columnLabel(key)}. ${check.reason}`;
    },
    onDragEnd: () => undefined,
    onDragCancel: ({ active }) => `Abgebrochen. ${keyOf(active.id)} liegt wieder an seinem Platz.`,
  };

  const dropAnimation = useMemo<DropAnimation>(
    () => ({
      duration: reducedMotion() ? 1 : 420,
      easing: springEasing(),
      sideEffects: defaultDropAnimationSideEffects({ className: { dragOverlay: 'board-dropping' }, styles: { active: { opacity: '0' } } }),
    }),
    [],
  );

  /* ------------------------------------------------------------------------ quick add */

  const [adding, setAdding] = useState<string | null>(null);
  /** The projects a quick add makes items in: the project of a project list, else the board's projects, the most cards first. */
  const boardProjects = useMemo(() => {
    if (!projects) return [];
    if (identifier) return projects.filter((project) => project.identifier === identifier);
    const counts = new Map<string, number>();
    for (const item of items) counts.set(item.project_id, (counts.get(item.project_id) ?? 0) + 1);
    return projects.filter((project) => counts.has(project.id)).sort((a, b) => (counts.get(b.id) ?? 0) - (counts.get(a.id) ?? 0));
  }, [projects, identifier, items]);

  function quickAddFor(column: BoardColumnData): { options: QuickAddOption[]; reason: string | null } {
    let candidates = boardProjects;
    if (groupBy === 'project') candidates = (projects ?? []).filter((project) => project.id === column.key);
    if (groupBy === 'parent' && column.key !== NONE_KEY) candidates = candidates.filter((project) => project.id === itemById.get(column.ids[0] ?? '')?.project_id);
    const options: QuickAddOption[] = [];
    let refusal: string | null = null;
    for (const project of candidates) {
      const denied = reason('item.create', project.id);
      const workflow = workflows?.find((entry) => entry.id === project.workflow_id);
      if (denied || !workflow) {
        refusal ??= denied;
        continue;
      }
      const result = quickAddFields(column.key, { ...rules, project, workflow, types });
      if (result.ok) options.push({ project, fields: result.fields });
      else refusal ??= result.reason;
    }
    return { options, reason: options.length > 0 ? null : (refusal ?? 'Hier lässt sich kein Item anlegen.') };
  }

  function created(item: WorkItem, column: BoardColumnData) {
    setAnnouncement(`${item.key} in ${column.label} angelegt.`);
    // the list has loaded again by now: the new card lights up, unless the filter of the list leaves it out
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        if (itemsRef.current.some((entry) => entry.id === item.id)) {
          useUiStore.getState().flash(item.id);
          const element = findCard(item.id);
          if (element) reveal(element);
          return;
        }
        toast({
          title: `${item.key} angelegt`,
          description: 'Es passt nicht zum Filter dieser Liste und steht darum nicht hier.',
          action: { label: 'Öffnen', onClick: () => navigate(`/items/${item.key}`) },
        });
      }),
    );
  }

  /* --------------------------------------------------------------------------- layout */

  // the board fills the window below the bars of the screen; its columns scroll on their own
  const [top, setTop] = useState(0);
  /** Columns beyond the edges: the edge fades out, so the board says it goes on (overlay scrollbars say nothing). */
  const [edges, setEdges] = useState({ start: false, end: false });
  const measure = useCallback(() => {
    const box = board.current;
    if (!box) return;
    const next = Math.round(box.getBoundingClientRect().top + window.scrollY);
    setTop((previous) => (previous === next ? previous : next));
    const start = box.scrollLeft > 1;
    const end = box.scrollLeft + box.clientWidth < box.scrollWidth - 1;
    setEdges((previous) => (previous.start === start && previous.end === end ? previous : { start, end }));
  }, []);
  useLayoutEffect(measure);
  useEffect(() => {
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [measure]);

  /* ---------------------------------------------------------------------------- view */

  const ready = projects !== undefined && workflows !== undefined;
  const stopAt = locate(cursorId);
  const firstColumn = columns.find((column) => column.ids.length > 0);
  const stop = stopAt ? { id: columns[stopAt.column].ids[stopAt.index], column: columns[stopAt.column].key } : firstColumn ? { id: firstColumn.ids[0], column: firstColumn.key } : null;
  const dragItem = drag ? itemById.get(drag.id) : undefined;
  const overCheck = drag && dragItem && drag.over !== null ? checkMove(dragItem, drag.origin.column, drag.over, rules) : null;
  const refusedHere = overCheck && !overCheck.ok ? overCheck.reason : null;
  const hint =
    locked ??
    `Pfeiltasten wechseln die Karte. Umschalt mit Pfeil links oder rechts schiebt sie in die nächste erlaubte Spalte${manual ? ', Alt mit Pfeil hoch oder runter ändert ihren Platz in der Spalte' : ''}.`;

  function cardFor(item: WorkItem, column: string) {
    const selected = selection.includes(item.id);
    const key = cardKey(column, item.id);
    const epic = showParent ? cardEpic(item) : null;
    return {
      onOpen: onPeek,
      selected,
      showParent,
      tabIndex: stop?.id === item.id && stop.column === column ? 0 : -1,
      'data-nav-target': '',
      'aria-label': `${item.key} ${item.title}${epic ? `, ${partOf(epic)}` : ''}${selected ? ', ausgewählt' : ''}`,
      ref: (element: HTMLElement | null) => {
        if (!element) return;
        cards.current.set(key, element);
        return () => {
          if (cards.current.get(key) === element) cards.current.delete(key);
        };
      },
      onFocus: () => {
        if (cursorId !== item.id) onCursor(item.id);
        if (cursorColumn !== column) setCursorColumn(column);
      },
      onKeyDown: (event: KeyboardEvent<HTMLElement>) => {
        // Enter on the card opens the page; a click on the title opens the preview
        if (event.key === 'Enter' && event.target === event.currentTarget && !event.nativeEvent.isComposing) {
          event.preventDefault();
          onOpen(item.id);
        }
      },
      onClickCapture: (event: MouseEvent<HTMLElement>) => {
        if (justDropped.current) {
          event.preventDefault();
          event.stopPropagation();
          return;
        }
        // ⇧ and a click on the title selects the range instead of opening a window
        if (!event.shiftKey || !(event.target instanceof Element) || !event.target.closest('[data-item-link]')) return;
        event.preventDefault();
        event.stopPropagation();
        clickSelect(item.id, true);
      },
      // a live change gets its own short ink-blue tint (the highlighter is for selection, focus and hits only)
      className: cx(!selected && (flashIds.includes(item.id) ? TINT : peekItemId === item.id && PRESSED)),
    };
  }

  return (
    <div className="relative -mx-4" style={{ height: `max(22rem, calc(100dvh - ${top}px - 1rem))` }}>
      <div
        ref={board}
        role="group"
        aria-label="Board"
        aria-describedby={hintId}
        onScroll={measure}
        // relative: what is positioned inside (sr-only texts, tabs) stays inside the scroll box instead of widening the page
        className="relative h-full overflow-x-auto overscroll-x-contain px-4 max-sm:snap-x max-sm:snap-proximity max-sm:scroll-px-4"
      >
        <p id={hintId} hidden>
          {hint}
        </p>
        <div role="status" aria-label="Mitteilungen des Boards" className="sr-only">
          {announcement}
        </div>
        {!ready ? (
          <div role="status" className="flex h-full w-max gap-3">
            <span className="sr-only">Board wird geladen …</span>
            <BoardSkeletonColumns />
          </div>
        ) : (
          <DndContext
            sensors={sensors}
            collisionDetection={collision}
            measuring={MEASURING}
            autoScroll={AUTO_SCROLL}
            accessibility={{ announcements }}
            onDragStart={onDragStart}
            onDragOver={onDragOver}
            onDragEnd={onDragEnd}
            onDragCancel={onDragCancel}
          >
            <div className="flex h-full w-max gap-3">
              {columns.map((column) => {
                const quick = quickAddFor(column);
                const check = drag && dragItem ? checkMove(dragItem, drag.origin.column, column.key, rules) : null;
                return (
                  <BoardColumn
                    key={column.key}
                    column={column}
                    groupBy={groupBy}
                    sortable={sortable}
                    manual={manual}
                    drag={{ active: drag !== null, refused: check && !check.ok ? check.reason : null, over: drag?.over === column.key }}
                    addReason={quick.reason}
                    adding={adding === column.key}
                    onAddChange={(open) => setAdding(open ? column.key : null)}
                    renderQuickAdd={(close) => (
                      <QuickAdd
                        columnLabel={column.label}
                        options={quick.options}
                        defaults={pathname === '/my-items' ? { assignee_id: ctx.me } : undefined}
                        onCreated={(item) => created(item, column)}
                        onClose={close}
                      />
                    )}
                  >
                    {column.ids.map((id) => {
                      const item = itemById.get(id);
                      if (!item) return null;
                      return (
                        <BoardCard
                          key={id}
                          item={item}
                          column={column.key}
                          sortable={sortable}
                          draggable={sortable && rules.editReason?.(item) === null}
                          busy={busy.has(id)}
                          card={cardFor(item, column.key)}
                        />
                      );
                    })}
                  </BoardColumn>
                );
              })}
            </div>
            <DragOverlay dropAnimation={dropAnimation} zIndex={40} className="cursor-grabbing">
              {dragItem ? (
                // flow-root keeps the card's margin (the room of its tab) inside, so the overlay measures like the card's place
                <div className="relative flow-root">
                  <ItemCard item={dragItem} onOpen={() => {}} lifted={lifted} selected={selection.includes(dragItem.id)} showParent={showParent} className={SETTLE} />
                  {/* over a column it may not enter, the card says why; out of the layout, so the overlay keeps its size */}
                  {refusedHere && (
                    <p className="absolute inset-x-1 top-full mt-2.5 flex items-start gap-1.5 rounded-ctl bg-danger-soft px-2.5 py-2 text-sm font-medium text-pretty text-danger shadow-elev-2 in-[.board-dropping]:hidden">
                      <Ban className="mt-px size-3.5 shrink-0" aria-hidden="true" />
                      {refusedHere}
                    </p>
                  )}
                </div>
              ) : null}
            </DragOverlay>
          </DndContext>
        )}
        <ResolutionPrompt
          open={askOpen}
          onOpenChange={(open) => {
            setAskOpen(open);
            if (open || !asking) return;
            const { item, origin, destination } = asking;
            if (!confirmed.current) {
              unplace(item.id);
              setAnnouncement(`Abgebrochen. ${item.key} bleibt in ${columnLabel(origin)}.`);
            }
            const column = confirmed.current ? destination : origin;
            follow(item.id, column);
            focusCard(item.id, column, true);
          }}
          subject={asking?.item.key ?? ''}
          target={asking?.target ?? null}
          from={(() => {
            const current = asking ? workflowOf(asking.item)?.states.find((state) => state.id === asking.item.state_id) : undefined;
            return current && asking ? { category: current.category, resolutionId: asking.item.resolution_id } : undefined;
          })()}
          onConfirm={(resolutionId) => {
            if (!asking) return;
            confirmed.current = true;
            setCursorColumn(asking.destination);
            void commit(asking.item, { ...asking.patch, resolution_id: resolutionId }, asking.message, asking.origin);
          }}
        />
      </div>
      <span
        aria-hidden="true"
        className={cx('pointer-events-none absolute inset-y-0 left-0 w-6 bg-linear-to-r from-paper to-transparent transition-opacity duration-160', edges.start ? 'opacity-100' : 'opacity-0')}
      />
      <span
        aria-hidden="true"
        className={cx('pointer-events-none absolute inset-y-0 right-0 w-10 bg-linear-to-l from-paper to-transparent transition-opacity duration-160', edges.end ? 'opacity-100' : 'opacity-0')}
      />
    </div>
  );
}
