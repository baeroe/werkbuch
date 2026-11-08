/*
 * The board (spec 4.11, moodboard "Board"), ported from the clickdummy: the groups of the list as columns of index
 * cards on the paper, empty ones included. The contract with the items screen is in layouts.ts, the rules of what a card
 * may do in `domain/boardRules.ts`, what a move sends in moves.ts.
 *
 * - Columns (`useBoardColumns`, `BoardColumn`): each loads its first page at once and virtualizes its cards; the count
 *   is the server's plus what the optimistic changes moved (`placeItems`).
 * - Moving a card changes the grouped field: the status (only where the workflow allows the transition; on a category
 *   column the first status of that category the item's workflow allows), the priority or the assignee. A move into
 *   Completed or Canceled asks for the resolution first. A board grouped by label moves nothing; by type, project or
 *   parent a card only changes its place in its column. The card stands in its new column at once; a refusal of the
 *   server puts it back.
 * - Keyboard: ↑/↓ and j/k move the cursor within a column (they stop at its end), ←/→ to the neighbouring column;
 *   ⇧←/⇧→ move the cursor's card to the nearest allowed column, ⌥↑/⌥↓ change its place in a column sorted by rank
 *   (`useBoardKeys`; the four moves are palette commands as well). The rest of the list keys (x, ⇧X, ⌘A, Esc, Enter,
 *   space) come from `useSelection`, the item commands (s, a, p …) from the screen. A refused move says why in a toast
 *   and moves nothing; a move gets no success toast, a polite status line says it. The moved card keeps the focus.
 * - Pointer (`useBoardDrag`): a card dragged to another column moves like ⇧←/⇧→ (the same rules and the same
 *   `applyMove`), dropped within its column sorted by rank it gets the rank between its neighbours like ⌥↑/⌥↓. A
 *   refused drop springs back and a toast says why; Escape cancels the drag and keeps the selection.
 * - Where a new place has no room left between its neighbours (the rank would grow past 128 characters), the server
 *   gives the items of the card's project short ranks first (A448, `sendPlace`) and the board tries the place once more
 *   with the fresh neighbours.
 * - Quick add (`QuickAdd`): the "+" of a column makes an item with the column's value (`quickAddFields`) in the project
 *   of the list, else in one of the projects on the board (the most cards first). The new card lights up and comes into
 *   view; one the filter leaves out says so in a toast.
 * - Exactly one card is the tab stop: the cursor's, else the first card of the first column with cards.
 */

import { DndContext, DragOverlay } from '@dnd-kit/core';
import { useQueryClient } from '@tanstack/react-query';
import { Ban } from 'lucide-react';
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import { archivedReason } from '@/components/fields/itemData';
import { ItemCard } from '@/components/items/ItemCard';
import { priorityName } from '@/components/ui/PriorityIcon';
import { currentToasts, dismissToast, toast, type ToastOptions } from '@/components/ui/toast';
import { assignBlocker, boardLockReason, checkMove, nearestAllowed, quickAddFields, rankForSlot, type BoardReason, type BoardRules, type MoveCheck } from '@/domain/boardRules';
import { NONE_KEY } from '@/domain/grouping';
import { qk } from '@/hooks/keys';
import { useMembersOf, useProjects } from '@/hooks/projects';
import { useAllUsers } from '@/hooks/users';
import { useWorkflows } from '@/hooks/workflows';
import { useRedistributeRanks, useTransitionWorkItem, useUpdateWorkItem } from '@/hooks/workItems';
import { useWorkItemTypes } from '@/hooks/workItemTypes';
import { notifyError } from '@/lib/errors';
import { t } from '@/lib/i18n';
import { usePermissions } from '@/lib/permissions';
import { useUiStore } from '@/store/ui';
import type { ListedItem, Project, WorkItem } from '@/types';
import type { LayoutProps } from '../layouts';
import { focusIsNeutral, revealBelowToolbar, useSelection } from '../selection/useSelection';
import { BoardCard } from './BoardCard';
import { BoardColumn } from './BoardColumn';
import { applyMove, reasonText } from './moves';
import { QuickAdd, type QuickAddOption } from './QuickAdd';
import { useBoardColumns, type BoardColumnData } from './useBoardColumns';
import { useBoardDrag } from './useBoardDrag';
import { useBoardKeys } from './useBoardKeys';

/** How long a moved card keeps getting the focus back while the move lands (optimistic change, rollback, dialog). */
const FOLLOW_MS = 1500;

/** A live change gets a short ink-blue tint, the previewed card the pressed tone; both lie over the card's white. */
const TINT = '[background-image:linear-gradient(var(--accent-soft),var(--accent-soft))]';
const PRESSED = '[background-image:linear-gradient(var(--pressed),var(--pressed))]';
/** While the overlay flies to its place the card straightens up again (DESIGN.md: "beim Ablegen federt sie zurück"). */
const SETTLE = 'in-[.board-dropping]:translate-y-0 in-[.board-dropping]:scale-100 in-[.board-dropping]:rotate-0 in-[.board-dropping]:after:opacity-0';
/** How long the board waits for its lists to load again (a new card of the quick add, fresh ranks) before it goes on. */
const LISTS_WAIT_MS = 5000;
/** How many frames the list must load nothing before the board looks for a new card. */
const QUIET_FRAMES = 3;

/** A hint once: a toast with the same text replaces the one shown, so key after key does not take one more place. */
function toastOnce(options: ToastOptions): void {
  currentToasts()
    .filter((entry) => entry.title === options.title && entry.description === options.description)
    .forEach((entry) => dismissToast(entry.id));
  toast(options);
}

/** The ids with the one at `from` moved to `to`. */
function moved(ids: readonly string[], from: number, to: number): string[] {
  const next = [...ids];
  next.splice(to, 0, ...next.splice(from, 1));
  return next;
}

export function BoardLayout({ groups, groupBy, display, project, createDefaults, selection, onSelect, onSelectAll, onOpen, onPeek, cursorId, onCursor }: LayoutProps) {
  const served = useBoardColumns({ groups });
  const projects = useProjects({ include_archived: true }).data?.items;
  const workflows = useWorkflows().data?.items;
  const types = useWorkItemTypes().data?.items;
  const users = useAllUsers().data?.items;
  const queryClient = useQueryClient();
  const { reason } = usePermissions();
  const transition = useTransitionWorkItem();
  const update = useUpdateWorkItem();
  const redistribute = useRedistributeRanks();
  const peekItemId = useUiStore((state) => state.peekItemId);
  const flashIds = useUiStore((state) => state.flashIds);
  const hintId = useId();

  // a child card names its epic before its key, except where the columns are the epics
  const showParent = groupBy !== 'parent';
  const manual = display.sort.field === 'rank';
  const locked = boardLockReason(groupBy);

  const itemById = useMemo(() => new Map(served.flatMap((column) => column.items.map((item) => [item.id, item] as const))), [served]);
  /**
   * The items and columns as the last render had them (the columns as the server serves them, without the cards held
   * in a new place): what a move reads when its turn comes (fresh ranks, A448).
   */
  const latestItems = useRef(itemById);
  const latestServed = useRef(served);
  useLayoutEffect(() => {
    latestItems.current = itemById;
    latestServed.current = served;
  });
  const columnLabel = useCallback((key: string) => served.find((column) => column.key === key)?.label ?? key, [served]);

  /* --------------------------------------------------------------------------- rules */

  // who may take an item of a column of people: the members of the projects on the board
  const boardProjects = useMemo(() => (groupBy === 'assignee' ? [...new Set([...itemById.values()].map((item) => item.project_id))] : []), [groupBy, itemById]);
  const memberLists = useMembersOf(boardProjects);
  const members = memberLists.every((entry) => entry.data) ? memberLists.flatMap((entry) => entry.data!.items) : undefined;

  const workflowOf = useCallback(
    (item: Pick<ListedItem, 'project_id'>) => {
      const project = projects?.find((entry) => entry.id === item.project_id);
      return workflows?.find((workflow) => workflow.id === project?.workflow_id);
    },
    [projects, workflows],
  );
  const rules: BoardRules = {
    groupBy,
    workflowOf,
    columnLabel,
    editReason: (item) => (item.archived_at !== null ? archivedReason(item.key) : reason('item.edit', item.project_id)),
    assignReason: (userId, item) => {
      const user = users?.find((entry) => entry.id === userId);
      const project = projects?.find((entry) => entry.id === item.project_id);
      return user && project && members ? assignBlocker(user, project, members) : null;
    },
  };

  /* ------------------------------------------------------------------- dragging */

  const categories = useMemo(() => new Map(workflows?.flatMap((workflow) => workflow.states.map((state) => [state.id, state.category] as const))), [workflows]);
  // the callbacks run in the handlers of a drag, once everything below is defined
  const dragging = useBoardDrag(served, rules, {
    manual,
    sort: display.sort,
    stateCategory: (stateId) => categories.get(stateId) ?? 'backlog',
    itemById,
    onPickUp: (id, column) => {
      setCursorColumn(column);
      if (id !== cursorId) onCursor(id);
    },
    onPutBack: (id, column) => {
      setCursorColumn(column);
      follow(id, column, true);
    },
    move: (item, check, origin, target) => sendMove(item, check, origin, target, true),
    reorder: (item, column, ids, index) => sendPlace(item, column, ids, index, true),
    refuse: (item, why) => refuse(item, why),
    sortedHint: () => sortedHint(),
  });
  /** The columns as they stand: during a drag with the card where it would go, after a drop with it in its new place. */
  const columns = dragging.columns;
  const latestColumns = useRef(columns);
  useLayoutEffect(() => {
    latestColumns.current = columns;
  });

  /* ------------------------------------------------------------------ cursor and focus */

  const board = useRef<HTMLDivElement>(null);
  /** On a board grouped by label an item has a card in several columns: the cursor stands on one of them. */
  const [cursorColumn, setCursorColumn] = useState<string | null>(null);
  const order = useMemo(() => [...new Set(columns.flatMap((column) => column.ids))], [columns]);

  /** Where an item's card stands: in the cursor's column when it has one there. */
  const locate = (id: string | null): { column: number; index: number } | null => {
    if (id === null) return null;
    const preferred = cursorColumn === null ? -1 : columns.findIndex((column) => column.key === cursorColumn && column.ids.includes(id));
    const column = preferred >= 0 ? preferred : columns.findIndex((column) => column.ids.includes(id));
    return column < 0 ? null : { column, index: columns[column]!.ids.indexOf(id) };
  };

  /** The element of an item's card in a column, once it is rendered. */
  const findCard = useCallback(
    (id: string, column: string): HTMLElement | null =>
      board.current?.querySelector<HTMLElement>(`[data-column-key="${CSS.escape(column)}"] [data-card-id="${CSS.escape(id)}"]`) ?? null,
    [],
  );

  /**
   * Brings a card into view: its column scrolls to it, the board to the column (the card of the cursor is always
   * rendered, `keepIndex`, so this is how a card far down its column comes into view), the page below the toolbar.
   */
  const reveal = useCallback((element: HTMLElement) => {
    element.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
    revealBelowToolbar(element.closest('li') ?? element);
  }, []);

  const pendingFocus = useRef<string | null>(null);
  /** Focuses a card now, or as soon as it is rendered (the cursor moved to it a moment ago). */
  const focusCard = useCallback(
    (id: string, column: string) => {
      pendingFocus.current = id;
      let attempts = 0;
      const attempt = () => {
        if (pendingFocus.current !== id) return;
        const element = findCard(id, column);
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
   * A moved card keeps the focus while it changes its place: its new column mounts it anew and the old element goes,
   * the question of the resolution gives the focus back as it closes, a refusal puts the card back. For a moment the
   * card takes the focus back whenever it fell to the page (or stayed on the card's old element); a focus the person
   * put elsewhere stays there.
   */
  const following = useRef<object | null>(null);
  /** `pointer`: a drag moved the card, it gets the focus as the pointer left it (without the keyboard's ring). */
  const follow = useCallback(
    (id: string, column: string, pointer = false) => {
      const token = {};
      following.current = token;
      const started = performance.now();
      const tick = () => {
        if (following.current !== token) return;
        const element = findCard(id, column);
        const active = document.activeElement;
        if (element && element !== active && (focusIsNeutral() || active?.getAttribute('data-card-id') === id)) {
          element.focus({ preventScroll: true, focusVisible: !pointer });
          reveal(element);
        }
        if (performance.now() - started < FOLLOW_MS) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    },
    [findCard, reveal],
  );
  /** The board is on the page: what waits for a frame stops once it is gone. */
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      following.current = null;
      pendingFocus.current = null;
    };
  }, []);

  /**
   * Settles once the lists of the board have loaded again: a column rebuilds its pages one after another (K15), so the
   * lists count as loaded once nothing of them has been on its way for a few frames, and the board has rendered what
   * they brought. Resolves `false` when that takes longer than `LISTS_WAIT_MS` or the board is gone.
   */
  const listsLoaded = useCallback(
    () =>
      new Promise<boolean>((resolve) => {
        const started = performance.now();
        let quiet = 0;
        const look = () => {
          quiet = queryClient.isFetching({ queryKey: qk.workItems.all }) > 0 ? 0 : quiet + 1;
          if (!alive.current || quiet >= QUIET_FRAMES) resolve(alive.current);
          else if (performance.now() - started >= LISTS_WAIT_MS) resolve(false);
          else requestAnimationFrame(look);
        };
        requestAnimationFrame(look);
      }),
    [queryClient],
  );

  /** The step of j/k and ↓/↑: within the column, stopping at its ends; from no cursor the first card. */
  const step = (current: string | null, direction: 1 | -1): string | null => {
    const at = locate(current);
    if (!at) return columns.find((column) => column.ids.length > 0)?.ids[0] ?? null;
    return columns[at.column]!.ids[at.index + direction] ?? null;
  };
  const focusItem = (id: string) => {
    // an id of `order`, so it has a card
    const key = columns[locate(id)!.column]!.key;
    setCursorColumn(key);
    focusCard(id, key);
  };
  const { clickSelect } = useSelection({ order, onSelectAll, cursorId, onCursor, selection, onSelect, onOpen, onPeek, focus: focusItem, container: board, step });

  /** Puts the cursor on a card and the focus with it. */
  function go(column: number, index: number) {
    const entry = columns[column]!;
    const id = entry.ids[index]!;
    setCursorColumn(entry.key);
    if (id !== cursorId) onCursor(id);
    focusCard(id, entry.key);
  }

  function horizontal(direction: 1 | -1) {
    const at = locate(cursorId);
    if (!at) {
      const first = columns.findIndex((column) => column.ids.length > 0);
      if (first >= 0) go(first, 0);
      return;
    }
    for (let column = at.column + direction; column >= 0 && column < columns.length; column += direction) {
      const { ids, key } = columns[column]!;
      if (ids.length === 0) continue;
      // the card at the same height, as far as the page has a layout; else the one at the same position
      const from = findCard(cursorId!, columns[at.column]!.key)?.getBoundingClientRect();
      let index = Math.min(at.index, ids.length - 1);
      if (from && from.height > 0) {
        const middle = from.top + from.height / 2;
        let best = Number.POSITIVE_INFINITY;
        ids.forEach((id, position) => {
          // a card the column has not rendered (out of its view) is far away
          const rect = findCard(id, key)?.getBoundingClientRect();
          const distance = rect ? Math.abs(rect.top + rect.height / 2 - middle) : Number.POSITIVE_INFINITY;
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

  const refuse = (item: ListedItem, why: BoardReason) => toast({ title: t('items.board.not_moved', { key: item.key }), description: reasonText(why), tone: 'error' });
  const stateOf = (item: ListedItem, stateId = item.state_id) => workflowOf(item)?.states.find((state) => state.id === stateId);

  /** What a move did, for the status line. */
  function said(item: ListedItem, check: Extract<MoveCheck, { ok: true }>, column: BoardColumnData): string {
    const { state_id, priority, assignee_id } = check.patch;
    if (state_id !== undefined) return t('items.board.moved.state', { key: item.key, state: stateOf(item, state_id)?.name ?? column.label });
    if (priority !== undefined) return t('items.board.moved.priority', { key: item.key, priority: priorityName(priority) });
    return assignee_id ? t('items.board.moved.assigned', { key: item.key, name: column.label }) : t('items.board.moved.unassigned', { key: item.key });
  }

  /** The cursor's card and where it stands, when there is one. */
  const cursorCard = () => {
    const item = cursorId ? itemById.get(cursorId) : undefined;
    const at = locate(cursorId);
    return item && at ? { item, at, column: columns[at.column]! } : null;
  };

  /** ⇧←/⇧→: the nearest column the card may go to; a card that cannot move at all says so, also at the edge. */
  function nearest(item: ListedItem, at: { column: number }, direction: 1 | -1) {
    const own = columns[at.column]!.key;
    const movable = checkMove(item, own, own, rules);
    return movable.ok ? nearestAllowed(item, columns.map((column) => column.key), at.column, direction, rules) : movable;
  }

  const sortedHint = () => toastOnce({ title: t('items.board.sorted.title'), description: t('items.board.sorted.description') });

  /**
   * The moves of a card go out one after the other (T18-M2, T19-M4): a second ⇧→ or drop while the first is on its way
   * waits for it and goes only where the first landed (two transitions at once could arrive in the other order, and the
   * end of the first would take the spinner of the second). A move after one the server refused is dropped: the card
   * went back, the second was meant from where it no longer is.
   */
  const turns = useRef(new Map<string, Promise<boolean>>());
  function inTurn(id: string, run: () => Promise<boolean>): Promise<boolean> {
    const before = turns.current.get(id);
    const call = before ? before.then((landed) => (landed ? run() : false)) : run();
    turns.current.set(id, call);
    void call.finally(() => {
      if (turns.current.get(id) === call) turns.current.delete(id);
    });
    return call;
  }

  /**
   * Sends a move to another column (a key or a drop): the card follows with the focus, the status line says what
   * happened. Resolves whether the server took it.
   */
  function sendMove(item: ListedItem, check: Extract<MoveCheck, { ok: true }>, origin: BoardColumnData, target: BoardColumnData, pointer = false): Promise<boolean> {
    return inTurn(item.id, () => moveNow(item, check, origin, target, pointer));
  }

  function moveNow(item: ListedItem, check: Extract<MoveCheck, { ok: true }>, origin: BoardColumnData, target: BoardColumnData, pointer: boolean): Promise<boolean> {
    let sent = false;
    return applyMove(item, check, {
      transition,
      update,
      from: stateOf(item),
      onSend: () => {
        sent = true;
        mark(item.id, true);
        setCursorColumn(target.key);
        follow(item.id, target.key, pointer);
      },
    }).then((landed) => {
      if (sent) mark(item.id, false);
      if (landed) setAnnouncement(said(item, check, target));
      else {
        // the mutation put the card back and said why, or the question of the resolution was cancelled (a dropped card
        // goes back from the column it waited in): the focus goes back with it
        if (!sent) setAnnouncement(t('items.board.cancelled', { key: item.key, column: origin.label }));
        setCursorColumn(origin.key);
        follow(item.id, origin.key, pointer);
      }
      return landed;
    });
  }

  /**
   * The redistributions of ranks on their way, by project: they settle once the lists have loaded again (`loaded`) or
   * the board gave up waiting for them (`stale`), and fail with the server's refusal.
   */
  const reranking = useRef(new Map<string, Promise<'loaded' | 'stale'>>());
  /**
   * Has the server give the items of a project short ranks (A448). Moves of the project wait for a call on its way
   * (`placeNow`); two moves that start in the same tick may both call, and the second only finds the order the first
   * left (nothing changes).
   */
  function makeRoom(projectId: string): Promise<'loaded' | 'stale'> {
    const call = redistribute.mutateAsync(projectId).then(async () => ((await listsLoaded()) ? 'loaded' : 'stale'));
    reranking.current.set(projectId, call);
    const done = () => {
      if (reranking.current.get(projectId) === call) reranking.current.delete(projectId);
    };
    void call.then(done, done);
    return call;
  }

  /**
   * Sends a new place of a card in its column sorted by rank (`ids`: the column with the card at `index`). Returns null,
   * and moves nothing, at the last loaded place of a column that has more to load. Otherwise the card goes in turn
   * (`inTurn`), and its rank between the neighbours `ids` names is worked out when the turn comes, from the ranks the
   * board has then (I1): a move queued behind another of the card, or behind a redistribution of its project, never
   * sends a rank of the old scale.
   *
   * Where the rank would grow past what the server takes (P23), the server first gives the items of the card's project
   * short ranks (A448, one call per project at a time; moves of other cards of the project wait for it): the status
   * line says so and the card waits in its new place. Once the lists have loaded again, the rank is worked out between
   * the fresh neighbours. After a redistribution the card only goes where the two neighbours still stand next to each
   * other in the fresh column: in a list of several projects the cards of the own project may now stand between them,
   * and a place that is gone is no room (`no_room`), as are neighbours of another project that still leave none. Lists
   * that take longer than `LISTS_WAIT_MS` say so (`not_reloaded`); a failed redistribution says it, with "Try again"
   * where repeating helps, and the card goes back.
   */
  function sendPlace(item: ListedItem, column: BoardColumnData, ids: readonly string[], index: number, pointer = false): Promise<boolean> | null {
    // below the last loaded card come cards not loaded yet: a rank after the last loaded one would put the card after
    // all of them (T18-M1)
    if (column.hasMore && index === ids.length - 1) {
      refuse(item, { code: 'load_more', params: { column: column.label } });
      return null;
    }
    // the new place moves the card's element within its column, and a focused element that moves loses the focus in
    // the browser. React gives it back within the commit that moved it (seen in Chromium); the card is followed all the
    // same, as a move to another column is, so the focus stays with it whatever renders next (the rollback of a
    // refusal included)
    follow(item.id, column.key, pointer);
    return inTurn(item.id, () => placeNow(item, column, ids, index, pointer));
  }

  async function placeNow(item: ListedItem, column: BoardColumnData, ids: readonly string[], index: number, pointer: boolean): Promise<boolean> {
    const [above, below] = [ids[index - 1], ids[index + 1]];
    const slot = () => {
      const rankOf = (id: string | undefined) => (id === undefined ? null : (latestItems.current.get(id)?.rank ?? null));
      return rankForSlot(rankOf(above), rankOf(below), display.sort.direction);
    };
    const stop = (why: BoardReason) => {
      setAnnouncement('');
      refuse(item, why);
      return false;
    };
    mark(item.id, true);
    try {
      // a redistribution of the project on its way: its new ranks first (one that failed changed nothing)
      let outcome = await reranking.current.get(item.project_id)?.catch(() => undefined);
      let rank = slot();
      if (rank === null && outcome === undefined) {
        setAnnouncement(t('items.board.reranking'));
        try {
          outcome = await makeRoom(item.project_id);
        } catch (error) {
          setAnnouncement('');
          notifyError(t('items.board.not_moved', { key: item.key }), error, () => latestRetry.current(item.id, column.key, ids, index, pointer));
          return false;
        }
        rank = slot();
      }
      if (outcome === 'stale') return stop({ code: 'not_reloaded', params: {} });
      let place = index + 1;
      let count = ids.length;
      if (outcome === 'loaded') {
        // the place is where the two neighbours still stand next to each other
        const others = (latestServed.current.find((entry) => entry.key === column.key)?.ids ?? []).filter((id) => id !== item.id);
        const at = above === undefined ? 0 : others.indexOf(above) + 1;
        if ((above !== undefined && at === 0) || others[at] !== below) rank = null;
        place = at + 1;
        count = others.length + 1;
      }
      if (rank === null) return stop({ code: 'no_room', params: {} });
      follow(item.id, column.key, pointer);
      return await update.mutateAsync({ id: item.id, patch: { rank } }).then(
        () => {
          setAnnouncement(t('items.board.moved.place', { key: item.key, place, count, column: column.label }));
          return true;
        },
        // the mutation put the card back and said why
        () => false,
      );
    } finally {
      mark(item.id, false);
    }
  }

  /** Sends a new place and keeps the card there until it has landed (a key, "Try again"; a drop holds it itself). */
  function placeCard(item: ListedItem, column: BoardColumnData, ids: readonly string[], index: number, pointer = false) {
    const call = sendPlace(item, column, ids, index, pointer);
    if (call) dragging.hold(item.id, column.key, index, call);
  }

  /**
   * "Try again" after a failed redistribution, from the board as it is then: the card must still be on the board and
   * still allowed to move (M1); it waits in its new place again.
   */
  const latestRetry = useRef((_id: string, _column: string, _ids: readonly string[], _index: number, _pointer: boolean) => {});
  useLayoutEffect(() => {
    latestRetry.current = (id, key, ids, index, pointer) => {
      const item = latestItems.current.get(id);
      const column = latestServed.current.find((entry) => entry.key === key);
      if (!item || !column) return;
      const check = checkMove(item, key, key, rules);
      if (!check.ok) return refuse(item, check.reason);
      placeCard(item, column, ids, index, pointer);
    };
  });

  function moveByKey(direction: 1 | -1) {
    const card = cursorCard();
    if (!card) return;
    const { item, at, column: origin } = card;
    const result = nearest(item, at, direction);
    if (!result.ok) return refuse(item, result.reason);
    void sendMove(item, result.check, origin, columns[result.index]!);
  }

  function reorderByKey(direction: 1 | -1) {
    const card = cursorCard();
    if (!card) return;
    const { item, at, column } = card;
    const check = checkMove(item, column.key, column.key, rules);
    if (!check.ok) return refuse(item, check.reason);
    if (!manual) return sortedHint();
    const index = at.index + direction;
    if (index < 0 || index >= column.ids.length) {
      setAnnouncement(t(direction < 0 ? 'items.board.at_top' : 'items.board.at_bottom', { key: item.key, column: column.label }));
      return;
    }
    placeCard(item, column, moved(column.ids, at.index, index), index);
  }

  const inBoard = () => focusIsNeutral() || Boolean(board.current?.contains(document.activeElement));
  useBoardKeys({
    inBoard,
    column: horizontal,
    move: moveByKey,
    reorder: reorderByKey,
    canMove: (direction) => {
      const card = cursorCard();
      return card !== null && nearest(card.item, card.at, direction).ok;
    },
    canReorder: (direction) => {
      const card = cursorCard();
      if (!card || !manual) return false;
      const index = card.at.index + direction;
      return index >= 0 && index < card.column.ids.length && checkMove(card.item, card.column.key, card.column.key, rules).ok;
    },
  });

  /* ------------------------------------------------------------------------ quick add */

  const [adding, setAdding] = useState<string | null>(null);
  /** A new card to bring into view in its column. */
  const [revealing, setRevealing] = useState<{ column: string; id: string } | null>(null);
  /** The projects a quick add makes items in: the project of the list, else the board's projects, the most cards first. */
  const quickProjects = useMemo((): Project[] => {
    if (!projects) return [];
    if (project) return projects.filter((entry) => entry.id === project.id);
    const counts = new Map<string, number>();
    for (const item of itemById.values()) counts.set(item.project_id, (counts.get(item.project_id) ?? 0) + 1);
    return projects.filter((entry) => counts.has(entry.id)).sort((a, b) => counts.get(b.id)! - counts.get(a.id)!);
  }, [projects, project, itemById]);

  /** What a quick add in a column offers: the projects it can make the item in with its fields, or why there is none. */
  function quickAddFor(column: BoardColumnData): { options: QuickAddOption[]; reason: string | null } {
    if (!projects || !workflows || !types) return { options: [], reason: t('items.board.quick_add.loading') };
    let candidates = quickProjects;
    if (groupBy === 'project') candidates = projects.filter((entry) => entry.id === column.key);
    if (groupBy === 'parent' && column.key !== NONE_KEY) {
      // the parent's project, from its key (an empty column of an epic has no card to ask)
      const key = column.item?.key ?? '';
      candidates = projects.filter((entry) => entry.identifier === key.slice(0, key.lastIndexOf('-')));
    }
    const options: QuickAddOption[] = [];
    let refusal: string | null = null;
    for (const candidate of candidates) {
      const denied = reason('item.create', candidate.id);
      const workflow = workflows.find((entry) => entry.id === candidate.workflow_id);
      if (denied || !workflow) {
        refusal ??= denied ?? reasonText({ code: 'workflow_loading', params: {} });
        continue;
      }
      const result = quickAddFields(column.key, { ...rules, project: candidate, workflow, types });
      if (result.ok) options.push({ project: candidate, fields: result.fields });
      else refusal ??= reasonText(result.reason);
    }
    return { options, reason: options.length > 0 ? null : (refusal ?? t('items.board.quick_add.unavailable')) };
  }

  /**
   * A quick add made an item: the status line says it. Once the list has loaded again the new card lights up and comes
   * into view; where the list leaves it out (its filter) a toast says so and opens it, and so it does where a column
   * with more pages to load has it further down (T19-M3: the status line alone tells no one who sees).
   */
  function created(item: WorkItem, column: BoardColumnData) {
    setAnnouncement(t('items.board.created', { key: item.key, column: column.label }));
    void listsLoaded().then(() => {
      if (!alive.current) return;
      const shown = latestColumns.current.find((entry) => entry.key === column.key);
      if (shown?.ids.includes(item.id)) {
        useUiStore.getState().flash(item.id);
        setRevealing({ column: column.key, id: item.id });
      } else {
        // a column with more pages to load has it further down; otherwise the filter leaves it out
        toast({
          title: t('items.create.created', { key: item.key }),
          description: shown?.hasMore ? t('items.board.created_further', { key: item.key, column: column.label }) : t('items.board.created_elsewhere'),
          action: { label: t('items.create.open'), onClick: () => useUiStore.getState().openPeek(item.id) },
        });
      }
    });
  }

  /* --------------------------------------------------------------------------- layout */

  // the board fills the window below the bars of the screen; its columns scroll on their own
  const [top, setTop] = useState(0);
  const measure = useCallback(() => {
    const next = Math.round((board.current?.getBoundingClientRect().top ?? 0) + window.scrollY);
    setTop((previous) => (previous === next ? previous : next));
  }, []);
  useLayoutEffect(measure);
  useEffect(() => {
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [measure]);

  /* ---------------------------------------------------------------------------- view */

  const at = locate(cursorId);
  const firstColumn = columns.find((column) => column.ids.length > 0);
  const stop = at ? { id: columns[at.column]!.ids[at.index]!, column: columns[at.column]!.key } : firstColumn ? { id: firstColumn.ids[0]!, column: firstColumn.key } : null;
  const hint = locked ? reasonText(locked) : t(manual ? 'items.board.hint_manual' : 'items.board.hint');

  return (
    <div className="relative -mx-4" style={{ height: `max(22rem, calc(100dvh - ${top}px - 1rem))` }}>
      <div
        ref={board}
        role="group"
        aria-label={t('items.board.label')}
        aria-describedby={hintId}
        // relative: what is positioned inside (sr-only texts) stays inside the scroll box instead of widening the page
        className="relative h-full overflow-x-auto overscroll-x-contain px-4 max-sm:snap-x max-sm:snap-proximity max-sm:scroll-px-4"
      >
        <p id={hintId} hidden>
          {hint}
        </p>
        <div role="status" aria-label={t('items.board.announcements')} className="sr-only">
          {announcement}
        </div>
        <DndContext {...dragging.context} accessibility={{ ...dragging.context.accessibility, screenReaderInstructions: { draggable: hint } }}>
          <div className="flex h-full w-max gap-3">
            {columns.map((column) => {
              const quick = quickAddFor(column);
              const refused = dragging.refusalOf(column.key);
              return (
                <BoardColumn
                  key={column.key}
                  column={column}
                  groupBy={groupBy}
                  keepIndex={stop?.column === column.key ? column.ids.indexOf(stop.id) : -1}
                  sortable={dragging.sortable}
                  drag={{
                    active: dragging.drag !== null,
                    refused: refused && reasonText(refused),
                    over: dragging.drag?.over === column.key,
                    sorts: manual && dragging.drag?.origin.column === column.key,
                  }}
                  revealId={revealing?.column === column.key ? revealing.id : null}
                  addReason={quick.reason}
                  adding={adding === column.key}
                  onAddChange={(open) => setAdding(open ? column.key : null)}
                  renderQuickAdd={(close) => (
                    <QuickAdd
                      columnLabel={column.label}
                      options={quick.options}
                      // where the columns are the people, the column says who takes the item (none in "Nicht zugewiesen"),
                      // not the list (Meine Items: me)
                      defaults={groupBy !== 'assignee' && createDefaults?.assignee_id ? { assignee_id: createDefaults.assignee_id } : undefined}
                      onCreated={(item) => created(item, column)}
                      onClose={close}
                    />
                  )}
                  renderCard={(item) => {
                    const selected = selection.includes(item.id);
                    return (
                      <BoardCard
                        item={item}
                        fields={display.fields}
                        showParent={showParent}
                        selected={selected}
                        cursor={stop?.id === item.id && stop.column === column.key}
                        busy={busy.has(item.id)}
                        sortable={dragging.sortable}
                        draggable={dragging.sortable && rules.editReason?.(item) === null}
                        onOpen={onOpen}
                        onPeek={onPeek}
                        data-card-id={item.id}
                        onFocus={() => {
                          if (cursorId !== item.id) onCursor(item.id);
                          if (cursorColumn !== column.key) setCursorColumn(column.key);
                        }}
                        onClickCapture={(event: MouseEvent<HTMLElement>) => {
                          // ⇧ and a click on the title selects the range instead of opening a window
                          if (!event.shiftKey || !(event.target instanceof Element) || !event.target.closest('[data-item-link]')) return;
                          event.preventDefault();
                          event.stopPropagation();
                          clickSelect(item.id, true);
                        }}
                        // a live change gets its own short ink-blue tint (the highlighter is for selection, focus and hits only)
                        className={selected ? undefined : flashIds.includes(item.id) ? TINT : peekItemId === item.id ? PRESSED : undefined}
                      />
                    );
                  }}
                />
              );
            })}
          </div>
          <DragOverlay dropAnimation={dragging.dropAnimation} zIndex={40} className="cursor-grabbing">
            {dragging.dragItem ? (
              // flow-root keeps the card's margin (the room of its tab) inside, so the overlay measures like the card's place;
              // a picture of the card only: assistive tech hears the drag from dnd-kit's live region, and neither its
              // link nor a second article of the same name take part (T19-M8)
              <div className="relative flow-root" aria-hidden="true" inert>
                <ItemCard
                  item={dragging.dragItem}
                  fields={display.fields}
                  onOpen={() => {}}
                  lifted={dragging.lifted}
                  selected={selection.includes(dragging.dragItem.id)}
                  showParent={showParent}
                  className={SETTLE}
                />
                {/* over a column it may not enter, the card says why; out of the layout, so the overlay keeps its size */}
                {dragging.refusedHere && (
                  <p className="absolute inset-x-1 top-full mt-2.5 flex items-start gap-1.5 rounded-ctl bg-danger-soft px-2.5 py-2 text-sm font-medium text-pretty text-danger shadow-elev-2 in-[.board-dropping]:hidden">
                    <Ban className="mt-px size-3.5 shrink-0" aria-hidden="true" />
                    {reasonText(dragging.refusedHere)}
                  </p>
                )}
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>
      </div>
    </div>
  );
}
