/*
 * Dragging the pages of the wiki tree with the pointer (dnd-kit's sortable tree, ported from the clickdummy's
 * PageTree): the tree renders a `DndContext` with `context`, its rows are sortable, and a `DragOverlay` shows the
 * page that travels.
 * - Up and down chooses the neighbours, sideways the depth (`projectDrop`, from three quarters of an indent on, 13c).
 *   The subpages of the dragged page leave the list meanwhile and travel with it; its own row shows where it lands.
 * - Dropped: `dropPlacement` on the whole tree (collapsed subtrees included), then `onMove` (the wiki's move over
 *   `useMovePage`: shown at once, taken back on a refusal). Until that settles the tree keeps the page in its new place
 *   (`held`), so it never jumps back for a frame before the cache has the move.
 * - Only the pointer drags (5 px, `PointerSensor`): dnd-kit's keyboard sensor would take Enter and the space bar from
 *   the links of the rows; without a mouse "Verschieben nach …" does the same (WCAG 2.5.7).
 * - Escape cancels a drag and nothing else: the sensor cancels on the document's keydown; the tree marks that Escape as
 *   handled first (this listener is older than the sensor's), so the shortcuts on the window leave it alone.
 * - dnd-kit's live region (at the end of the body) says what happens (`wiki.tree.drag.*`); a new place is said once,
 *   not on every pixel.
 * - The overlay springs to its place (DESIGN.md: 420 ms, about 5 % overshoot; Web Animations take the curve itself,
 *   `lib/motion.ts`); with reduced motion it does not fly at all.
 */

import {
  closestCenter,
  defaultDropAnimationSideEffects,
  MeasuringStrategy,
  PointerSensor,
  useSensor,
  useSensors,
  type Announcements,
  type DndContextProps,
  type DragEndEvent,
  type DragMoveEvent,
  type DragOverEvent,
  type DragStartEvent,
  type DropAnimation,
  type UniqueIdentifier,
} from '@dnd-kit/core';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { t } from '@/lib/i18n';
import { reducedMotion, SPRING_MS, springEasing } from '@/lib/motion';
import type { PageNode } from '@/types';
import { dropPlacement, findPage, flattenPages, movedTree, projectDrop, subtreeIds, type PageRow, type Placement } from './tree';

/** Indentation per level in px; pulling three quarters of it sideways changes the depth by one. */
export const INDENT = 16;

/** The class the overlay has while it flies to its place: the lifted row straightens up. */
export const DROPPING = 'wiki-dropping';

const MEASURING = { droppable: { strategy: MeasuringStrategy.Always } };

/** A drag in progress: the page, the row it is over and how far it was pulled sideways. */
interface DragState {
  active: string;
  over: string | null;
  offset: number;
}

export interface TreeDragOptions {
  /** Dragging is offered only to people who may edit the wiki. */
  canMove: boolean;
  /** Sends the move; the tree holds the page in its new place until the answer settles. */
  onMove?: (id: string, placement: Placement) => Promise<unknown> | void;
}

export function useTreeDrag(nodes: readonly PageNode[], collapsed: ReadonlySet<string>, { canMove, onMove }: TreeDragOptions) {
  const movable = canMove && onMove !== undefined;

  /** A dropped page stands in its new place until its move settles; each drop holds its own token. */
  const [held, setHeld] = useState<{ id: string; placement: Placement; token: symbol } | null>(null);
  const shown = useMemo(() => (held ? movedTree(nodes, held.id, held.placement.parent_id, held.placement.before_id) : nodes), [nodes, held]);

  const [drag, setDrag] = useState<DragState | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const active = drag?.active ?? null;
  // the dragged page's subtree travels with it, so its rows leave the list meanwhile
  const rows = useMemo(() => {
    const all = flattenPages(shown, collapsed);
    if (active === null) return all;
    const travelling = new Set(subtreeIds(shown, active).filter((id) => id !== active));
    return all.filter((row) => !travelling.has(row.id));
  }, [shown, collapsed, active]);
  const rowsRef = useRef<PageRow[]>(rows);
  useLayoutEffect(() => {
    rowsRef.current = rows;
  });

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));
  const [lifted, setLifted] = useState(false);
  /** The place last said: where the page would land (the row it is over and the depth). */
  const said = useRef('');

  // Escape during a drag is the drag's (see above)
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && dragRef.current !== null) event.preventDefault();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

  const landingOf = (state: DragState, list: readonly PageRow[]) => (state.over ? projectDrop(list, state.active, state.over, state.offset, INDENT) : null);

  function update(change: Partial<DragState>) {
    const state = dragRef.current;
    if (!state) return;
    const next = { ...state, ...change };
    dragRef.current = next;
    setDrag(next);
  }

  function onDragStart({ active: picked }: DragStartEvent) {
    const id = String(picked.id);
    const state: DragState = { active: id, over: id, offset: 0 };
    dragRef.current = state;
    setDrag(state);
    said.current = `${id}:${rowsRef.current.find((row) => row.id === id)?.depth}`;
    // the overlay starts as the row in its place and lifts on the next frame (spring, DESIGN.md)
    setLifted(false);
    requestAnimationFrame(() => setLifted(true));
  }

  function endDrag() {
    dragRef.current = null;
    setDrag(null);
  }

  function onDragEnd({ active: dropped, over, delta }: DragEndEvent) {
    endDrag();
    if (!over || !onMove) return;
    const id = String(dropped.id);
    const placement = dropPlacement(shown, collapsed, id, String(over.id), delta.x, INDENT);
    if (!placement) return;
    const token = Symbol(id);
    setHeld({ id, placement, token });
    void Promise.resolve(onMove(id, placement)).finally(() => setHeld((current) => (current?.token === token ? null : current)));
  }

  /* -------------------------------------------------------------- what it says */

  const titleOf = (id: UniqueIdentifier | string) => findPage(shown, String(id))?.title ?? '';
  /** Where the page would land, once each time that changes. */
  function landingSaid(): string | undefined {
    const state = dragRef.current;
    const landing = state && landingOf(state, rowsRef.current);
    if (!state || !landing) return undefined;
    const place = `${state.over}:${landing.depth}`;
    if (place === said.current) return undefined;
    said.current = place;
    const title = titleOf(state.active);
    return landing.parentId ? t('wiki.tree.drag.under', { title, parent: titleOf(landing.parentId) }) : t('wiki.tree.drag.top', { title });
  }
  const announcements: Announcements = {
    onDragStart: ({ active: picked }) => t('wiki.tree.drag.picked', { title: titleOf(picked.id) }),
    onDragMove: landingSaid,
    onDragOver: landingSaid,
    onDragEnd: () => undefined,
    onDragCancel: ({ active: cancelled }) => t('wiki.tree.drag.cancelled', { title: titleOf(cancelled.id) }),
  };

  const dropAnimation = useMemo<DropAnimation | null>(
    () =>
      reducedMotion()
        ? null
        : {
            duration: SPRING_MS,
            easing: springEasing(),
            sideEffects: defaultDropAnimationSideEffects({ className: { dragOverlay: DROPPING }, styles: { active: { opacity: '0' } } }),
          },
    [],
  );

  const context: Omit<DndContextProps, 'children'> = {
    sensors,
    collisionDetection: closestCenter,
    measuring: MEASURING,
    // the live region and the instructions stand at the end of the body, outside the tree: a modal dialog keeps the live
    // regions of the page readable and would hide their siblings, the rows, along with them
    accessibility: { announcements, screenReaderInstructions: { draggable: t('wiki.tree.drag.instructions') }, container: document.body },
    onDragStart,
    onDragMove: ({ delta }: DragMoveEvent) => update({ offset: delta.x }),
    onDragOver: ({ over }: DragOverEvent) => update({ over: over ? String(over.id) : null }),
    onDragEnd,
    onDragCancel: endDrag,
  };

  const landing = drag ? landingOf(drag, rows) : null;
  return {
    /** Rows are sortable: the person may edit the wiki and the screen moves pages. */
    movable,
    /** The tree as it stands: with a dropped page in its new place until its move settles. */
    nodes: shown,
    /** The rows on screen; while a page is dragged, without its subtree. */
    rows,
    /** The page being dragged. */
    dragged: active === null ? undefined : findPage(shown, active),
    /** The depth the dragged page would land at, or null. */
    landing: landing?.depth ?? null,
    lifted,
    context,
    dropAnimation,
  };
}
