/*
 * Dragging the cards of the board with the pointer (dnd-kit, the mouse and a long press on touch), ported from the
 * clickdummy's BoardLayout. The board renders a `DndContext` with `context` and a `DragOverlay`; its columns are drop
 * targets and their cards sortable (`BoardColumn`, `BoardCard`).
 *
 * - Picked up, the card lifts, tilts −2° and travels in the overlay; the columns it may not enter are dimmed, and over
 *   one of them the card names the reason (`refusalOf`, `refusedHere`). Over a column it may enter it stands where the
 *   sort puts it; in its own column of a board sorted by rank the cards make room under the pointer.
 * - Dropped on another column: `checkMove`, then the board's `move` (`applyMove`: a status as a transition, after the
 *   resolution where it closes, else the priority or the assignee). Dropped in its own column sorted by rank: the
 *   board's `reorder` (`rankForSlot` between the cards above and below, `PATCH rank`); a rank that would grow too long
 *   moves nothing (P23). A column sorted by something else keeps its order and says so once. A refused drop springs
 *   back and a toast says why.
 * - A dropped card keeps its new place (`placements`) until the move has landed: the optimistic change of the
 *   mutation stands in for it then, and a refusal of the server puts it back with the counts (`useItemMutation`).
 * - Escape cancels a drag and nothing else: dnd-kit's sensors cancel on the document's keydown, before the shortcuts
 *   (on the window) hear it; the board marks that Escape as handled, so the selection stays and no preview closes. The
 *   click that ends a drag never reaches the card: the sensor stops it.
 * - Grouped by label nothing moves (`boardLockReason`): no card is sortable and no column takes a drop. Grouped by type,
 *   project or parent a card only changes its place in its column.
 * - dnd-kit's keyboard sensor is left out on purpose: it would take Enter (open) and the space bar (preview) from the
 *   cards; the board's own keys move them (`useBoardKeys`).
 */

import {
  closestCenter,
  defaultDropAnimationSideEffects,
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
  type DndContextProps,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
  type DropAnimation,
  type UniqueIdentifier,
} from '@dnd-kit/core';
import { arrayMove } from '@dnd-kit/sortable';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { boardLockReason, checkMove, type BoardReason, type BoardRules, type MoveCheck } from '@/domain/boardRules';
import { sortItems } from '@/domain/sort';
import { t } from '@/lib/i18n';
import { reducedMotion, SPRING_MS, springEasing } from '@/lib/motion';
import type { ListedItem, SortSpec, StateCategory } from '@/types';
import { reasonText } from './moves';
import type { BoardColumnData } from './useBoardColumns';

/** The droppable id of a column; cards use their item id. */
export const columnDropId = (key: string) => `column:${key}`;

const MEASURING = { droppable: { strategy: MeasuringStrategy.Always } };
/**
 * The board scrolls while a card nears its edge, but only close to it: dnd-kit's default (a fifth of the width) scrolls
 * a wide board away under a card that is meant for the last visible column.
 */
const AUTO_SCROLL = { threshold: { x: 0.08, y: 0.12 } };

/** A drag in progress: where the card came from, and the columns as they would be after the drop. */
export interface DragState {
  id: string;
  origin: { column: string; index: number };
  columns: BoardColumnData[];
  /** The column under the pointer. */
  over: string | null;
}

/** The columns with the card `item` moved to `index` of the column `key`; the counts follow. */
function place(columns: BoardColumnData[], item: ListedItem, key: string, index: number): BoardColumnData[] {
  return columns.map((column) => {
    const had = column.ids.includes(item.id);
    if (!had && column.key !== key) return column;
    const items = column.items.filter((entry) => entry.id !== item.id);
    if (column.key === key) items.splice(Math.max(0, Math.min(index, items.length)), 0, item);
    return { ...column, items, ids: items.map((entry) => entry.id), count: column.count + (column.key === key ? 1 : 0) - (had ? 1 : 0) };
  });
}

/** The column a droppable id stands for: a column itself, or the column a card lies in. */
function columnKeyOf(columns: readonly BoardColumnData[], id: string): string | null {
  if (id.startsWith('column:')) return id.slice('column:'.length);
  return columns.find((column) => column.ids.includes(id))?.key ?? null;
}

export interface BoardDragOptions {
  /** The columns are sorted by rank: a drop within a column changes the card's place. */
  manual: boolean;
  sort: SortSpec;
  stateCategory(stateId: string): StateCategory;
  itemById: ReadonlyMap<string, ListedItem>;
  /** A card was picked up in a column: the cursor goes to it. */
  onPickUp(id: string, column: string): void;
  /** A drag ended without a move: the focus goes back to the card in its column. */
  onPutBack(id: string, column: string): void;
  /** Sends a move the rules allowed to another column; settles once the move has landed or was refused. */
  move(item: ListedItem, check: Extract<MoveCheck, { ok: true }>, origin: BoardColumnData, target: BoardColumnData): Promise<unknown>;
  /** Sends a new place in a column sorted by rank, or refuses it (no room) and returns null. */
  reorder(item: ListedItem, column: BoardColumnData, ids: string[], index: number): Promise<unknown> | null;
  refuse(item: ListedItem, reason: BoardReason): void;
  /** The hint that a sorted column keeps its order, once. */
  sortedHint(): void;
}

export function useBoardDrag(served: BoardColumnData[], rules: BoardRules, options: BoardDragOptions) {
  const { manual, sort, itemById } = options;
  const sortable = boardLockReason(rules.groupBy) === null;

  /* ------------------------------------------------------------------- columns */

  /**
   * Cards dropped by pointer keep their place until the move has landed (or the resolution is chosen). Each drop holds
   * its own token: the end of an older move of the same card leaves the place of a newer one alone.
   */
  const [placements, setPlacements] = useState<ReadonlyMap<string, { column: string; index: number; token: symbol }>>(() => new Map());
  const placed = useMemo(() => {
    let next = served;
    for (const [id, spot] of placements) {
      const item = itemById.get(id);
      if (item) next = place(next, item, spot.column, spot.index);
    }
    return next;
  }, [served, placements, itemById]);
  const [drag, setDrag] = useState<DragState | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const columns = drag?.columns ?? placed;
  const columnsRef = useRef(columns);
  useLayoutEffect(() => {
    columnsRef.current = columns;
  });

  /** Keeps the card in its place until the call settles. */
  function hold(id: string, column: string, index: number, call: Promise<unknown>) {
    const token = Symbol(id);
    setPlacements((current) => new Map(current).set(id, { column, index, token }));
    void call.finally(() =>
      setPlacements((current) => {
        if (current.get(id)?.token !== token) return current;
        const next = new Map(current);
        next.delete(id);
        return next;
      }),
    );
  }

  /* ------------------------------------------------------------------- sensors */

  const sensors = useSensors(useSensor(MouseSensor, { activationConstraint: { distance: 5 } }), useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 6 } }));
  const [lifted, setLifted] = useState(false);
  const lastOver = useRef<UniqueIdentifier | null>(null);
  const movedColumn = useRef(false);
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      movedColumn.current = false;
    });
    return () => cancelAnimationFrame(frame);
  }, [columns]);

  // Escape during a drag is the drag's: the list keys leave the selection alone. This listener is older than the one
  // of the sensor (added as the drag starts), so it hears the key while the drag still runs.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && dragRef.current !== null) event.preventDefault();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

  /** Over a column with cards: the card nearest to the pointer; else the column. While a card changes column, the last hit. */
  const collisionDetection = useCallback<CollisionDetection>((args) => {
    const pointer = pointerWithin(args);
    const hits = pointer.length > 0 ? pointer : rectIntersection(args);
    let overId = getFirstCollision(hits, 'id');
    if (overId !== null) {
      const id = String(overId);
      const ids = id.startsWith('column:') ? (columnsRef.current.find((column) => columnDropId(column.key) === id)?.ids ?? []) : [];
      if (ids.length > 0) {
        overId = closestCenter({ ...args, droppableContainers: args.droppableContainers.filter((container) => ids.includes(String(container.id))) })[0]?.id ?? overId;
      }
      lastOver.current = overId;
      return [{ id: overId }];
    }
    if (movedColumn.current && dragRef.current) lastOver.current = dragRef.current.id;
    return lastOver.current === null ? [] : [{ id: lastOver.current }];
  }, []);

  /* --------------------------------------------------------------------- events */

  function onDragStart({ active }: DragStartEvent) {
    const id = String(active.id);
    const key = columnKeyOf(columns, id);
    if (!key) return;
    const column = columns.find((entry) => entry.key === key)!;
    const state: DragState = { id, origin: { column: key, index: column.ids.indexOf(id) }, columns, over: key };
    dragRef.current = state;
    setDrag(state);
    lastOver.current = null;
    options.onPickUp(id, key);
    // the overlay starts as the card in its place and lifts on the next frame (spring, DESIGN.md)
    setLifted(false);
    requestAnimationFrame(() => setLifted(true));
  }

  /** Where a card goes in a column it enters: where the sort puts it (with the field the move changes). */
  function insertIndex(item: ListedItem, check: Extract<MoveCheck, { ok: true }>, target: BoardColumnData): number {
    const patched = { ...item, ...check.patch };
    const others = target.items.filter((entry) => entry.id !== item.id);
    return sortItems([...others, patched], sort, { stateCategory: options.stateCategory }).findIndex((entry) => entry.id === item.id);
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
    if (!check.ok || overKey === state.origin.column) {
      // over a column the card may not enter (or back over its own) it waits at home, so a drop there springs back
      if (currentKey !== state.origin.column) next = place(state.columns, item, state.origin.column, state.origin.index);
    } else if (overKey !== currentKey) {
      next = place(state.columns, item, overKey, insertIndex(item, check, state.columns.find((column) => column.key === overKey)!));
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
    return state;
  }

  function onDragEnd({ over }: DragEndEvent) {
    const state = endDrag();
    const item = state ? itemById.get(state.id) : undefined;
    if (!state || !item) return;
    const { origin } = state;
    const back = () => options.onPutBack(item.id, origin.column);
    // without a place under it (the card it was last over scrolled out of its column) the card goes home
    const overKey = over ? columnKeyOf(state.columns, String(over.id)) : null;
    if (!overKey) return back();
    const check = checkMove(item, origin.column, overKey, rules);
    if (!check.ok) {
      back();
      options.refuse(item, check.reason);
      return;
    }
    const target = state.columns.find((column) => column.key === overKey)!;
    if (overKey !== origin.column) {
      const home = served.find((column) => column.key === origin.column)!;
      hold(item.id, overKey, target.ids.indexOf(item.id), options.move(item, check, home, target));
      return;
    }
    let ids = target.ids;
    if (manual && over) {
      const from = ids.indexOf(item.id);
      const to = ids.indexOf(String(over.id));
      if (from >= 0 && to >= 0 && from !== to) ids = arrayMove(ids, from, to);
    }
    const index = ids.indexOf(item.id);
    if (index === origin.index) {
      back();
      // a column sorted by something else keeps its order: say why the card did not change its place
      if (!manual && over && String(over.id) !== item.id) options.sortedHint();
      return;
    }
    const call = options.reorder(item, target, ids, index);
    if (call === null) back();
    else hold(item.id, overKey, index, call);
  }

  function onDragCancel() {
    const state = endDrag();
    if (state) options.onPutBack(state.id, state.origin.column);
  }

  /* -------------------------------------------------------------- what it says */

  const keyOf = (id: UniqueIdentifier) => itemById.get(String(id))?.key ?? t('items.board.drag.card');
  const announcements: Announcements = {
    onDragStart: ({ active }) => t('items.board.drag.picked', { key: keyOf(active.id) }),
    onDragOver: ({ active, over }) => {
      const state = dragRef.current;
      const item = itemById.get(String(active.id));
      const key = over && state ? columnKeyOf(state.columns, String(over.id)) : null;
      if (!item || !state || !key) return t('items.board.drag.nowhere', { key: keyOf(active.id) });
      const check = checkMove(item, state.origin.column, key, rules);
      const where = t('items.board.drag.over', { key: item.key, column: rules.columnLabel(key) });
      return check.ok ? where : `${where} ${reasonText(check.reason)}`;
    },
    onDragEnd: () => undefined,
    onDragCancel: ({ active }) => t('items.board.drag.cancelled', { key: keyOf(active.id) }),
  };

  const dropAnimation = useMemo<DropAnimation>(
    () => ({
      duration: reducedMotion() ? 1 : SPRING_MS,
      easing: springEasing(),
      sideEffects: defaultDropAnimationSideEffects({ className: { dragOverlay: 'board-dropping' }, styles: { active: { opacity: '0' } } }),
    }),
    [],
  );

  /** Why the dragged card may not enter a column, or null (also while nothing is dragged). */
  const refusalOf = (key: string): BoardReason | null => {
    const item = drag ? itemById.get(drag.id) : undefined;
    if (!drag || !item) return null;
    const check = checkMove(item, drag.origin.column, key, rules);
    return check.ok ? null : check.reason;
  };

  const context: Omit<DndContextProps, 'children'> = {
    sensors,
    collisionDetection,
    measuring: MEASURING,
    autoScroll: AUTO_SCROLL,
    // the live region stands at the end of the body, outside the board: a dialog that opens on the drop (the resolution
    // of a closing move) keeps the live regions of the page readable and would hide one inside the board with it
    accessibility: { announcements, container: document.body },
    onDragStart,
    onDragOver,
    onDragEnd,
    onDragCancel,
  };

  return {
    /** The columns as they stand: with the dragged card where it would go, and dropped cards in their new places. */
    columns,
    /** Cards move on this board (not grouped by label). */
    sortable,
    drag,
    /** The card being dragged. */
    dragItem: drag ? itemById.get(drag.id) : undefined,
    /** Why the dragged card may not enter the column under the pointer, or null. */
    refusedHere: drag?.over ? refusalOf(drag.over) : null,
    refusalOf,
    lifted,
    context,
    dropAnimation,
  };
}
