/*
 * The keyboard cursor and the selection of an item layout (spec 5.3), ported from the clickdummy: j/k and ↓/↑ move the
 * cursor, ⇧ with them extends the selection, x selects the cursor item, ⇧X the range from the last one chosen, ⌘A all,
 * Esc clears the selection; Enter opens the item's page, the space bar shows or hides its preview. The keys stand in
 * the catalog (`list.*`, scope `list`); the pure rules in `selection.ts`.
 *
 * A layout mounts `useSelection` once (list, table, board) with the item ids in the order it shows them. The cursor and
 * the selection themselves belong to the items screen (`LayoutProps`), so the item commands of the list act on them,
 * whatever the layout. The table passes `arrows: false`: ↑/↓ belong to its grid of cells (K19), which moves with `move`.
 * The inbox mounts it without `selection` and `onSelect`: it has a cursor and nothing to choose, so the keys that
 * choose (⇧J/⇧K, x, ⇧X, ⌘A, Esc) stay unbound there.
 *
 * When the keys act: j/k, x and the like whenever the list's shortcuts run (not while typing, not under a dialog).
 * The arrows only while the focus is in the layout or nowhere in particular, so they keep working in menus and
 * segmented controls; Enter and the space bar only on the element that stands for the cursor (`data-nav-target`) or
 * with the focus nowhere, so buttons keep their own Enter and space.
 */

import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react';
import { isTyping } from '@/lib/shortcuts/registry';
import { useShortcut } from '@/lib/shortcuts/useShortcut';
import { useUiStore } from '@/store/ui';
import { nextInOrder, selectRange, toggleId } from './selection';

/* ------------------------------------------------------------------------------- focus */

/** No element in particular has the focus: the page itself or the main area. */
export function focusIsNeutral(): boolean {
  const element = document.activeElement;
  return !element || element === document.body || element.id === 'main';
}

/** The focus is on the element that stands for the cursor (a row, a cell, a card), not on a control inside it. */
const focusOnTarget = () => focusIsNeutral() || document.activeElement?.hasAttribute('data-nav-target') === true;

/**
 * Scrolls the page just enough that an element stands below the sticky toolbar of the list screen
 * (`data-items-toolbar`) and above the bottom edge.
 */
export function revealBelowToolbar(element: HTMLElement): void {
  const toolbar = document.querySelector('[data-items-toolbar]');
  const top = toolbar ? toolbar.getBoundingClientRect().bottom : 0;
  const rect = element.getBoundingClientRect();
  const margin = 8;
  if (rect.top < top + margin) window.scrollBy({ top: rect.top - top - margin });
  else if (rect.bottom > window.innerHeight - margin) window.scrollBy({ top: rect.bottom - window.innerHeight + margin });
}

/* -------------------------------------------------------------------------------- hook */

const NONE: string[] = [];
const ignore = () => {};

export interface SelectionOptions {
  /** The item ids in the order the layout shows them, without the ones in collapsed groups. */
  order: string[];
  /** All ids of the layout (⌘A), collapsed groups included; `order` when left out. */
  all?: string[];
  /** ⌘A when the list has more than the layout shows (pages not loaded yet): the screen selects them all. */
  onSelectAll?: () => void;
  cursorId: string | null;
  onCursor: (id: string | null) => void;
  /** The chosen items; a list without a selection (the inbox) leaves both out and binds no keys for it. */
  selection?: string[];
  onSelect?: (ids: string[]) => void;
  /** Enter: the item's page. */
  onOpen: (id: string) => void;
  /** Space: the preview of the item. */
  onPeek: (id: string) => void;
  /** Moves the focus to the row, cell or card of an item; it brings it into view first. */
  focus: (id: string) => void;
  /** The layout's element: the arrows act while the focus is inside. */
  container: RefObject<HTMLElement | null>;
  /** ↓/↑ (with and without ⇧) move the cursor; false where they belong to the layout itself (the table's grid, K19). */
  arrows?: boolean;
  /**
   * The item j/k and ↓/↑ go to from `current`, where the layout steps in its own way (the board stays within the
   * column); without it the next in `order`. `null` stays where it is.
   */
  step?: (current: string | null, step: 1 | -1) => string | null;
}

/**
 * Registers the cursor and selection keys of a layout; answers what a click with or without ⇧ does (`clickSelect`), and
 * moves the cursor as j/k and ⇧J/⇧K do (`move`), for a layout whose own keys step through the items (the table's ↑/↓).
 */
export function useSelection(options: SelectionOptions): { clickSelect: (id: string, range: boolean) => void; move: (step: 1 | -1, extend: boolean) => void } {
  const { order, cursorId, selection = NONE, arrows = true } = options;
  const selectable = options.onSelect !== undefined;
  const latest = useRef(options);
  useLayoutEffect(() => {
    latest.current = options;
  });
  /** Where the next ⇧ range starts: the item chosen last. */
  const anchor = useRef<string | null>(null);
  const lastIndex = useRef(0);

  const inLayout = () => focusIsNeutral() || Boolean(latest.current.container.current?.contains(document.activeElement));

  function move(step: 1 | -1, extend: boolean) {
    const { order: ids, cursorId: current, onCursor, focus, onSelect = ignore, selection: chosen = NONE, step: stepOf } = latest.current;
    const next = stepOf ? stepOf(current, step) : nextInOrder(ids, current, step);
    if (!next) return;
    if (extend) {
      // the range grows from where it started (the cursor when nothing was chosen yet)
      if (anchor.current === null || !ids.includes(anchor.current)) anchor.current = current ?? next;
      onSelect(selectRange(chosen, ids, anchor.current, next));
    }
    onCursor(next);
    focus(next);
  }

  function clickSelect(id: string, range: boolean) {
    const { order: ids, selection: chosen = NONE, onSelect = ignore, onCursor } = latest.current;
    if (range && anchor.current !== null) onSelect(selectRange(chosen, ids, anchor.current, id));
    else {
      onSelect(toggleId(chosen, id));
      anchor.current = id;
    }
    onCursor(id);
  }

  const hasCursor = () => latest.current.cursorId !== null && latest.current.order.includes(latest.current.cursorId);
  const arrowKeys = { when: inLayout, enabled: arrows };
  const selectKeys = { enabled: selectable };
  const extendArrowKeys = { when: inLayout, enabled: arrows && selectable };
  /** What a key that chooses reads: the latest selection and its setter (only bound while there is one). */
  const chosen = () => ({ selection: latest.current.selection ?? NONE, onSelect: latest.current.onSelect ?? ignore });

  useShortcut('list.next', () => move(1, false));
  useShortcut('list.prev', () => move(-1, false));
  useShortcut('list.next_arrow', () => move(1, false), arrowKeys);
  useShortcut('list.prev_arrow', () => move(-1, false), arrowKeys);
  useShortcut('list.extend_next', () => move(1, true), selectKeys);
  useShortcut('list.extend_prev', () => move(-1, true), selectKeys);
  useShortcut('list.extend_next_arrow', () => move(1, true), extendArrowKeys);
  useShortcut('list.extend_prev_arrow', () => move(-1, true), extendArrowKeys);

  useShortcut('list.open', () => latest.current.onOpen(latest.current.cursorId!), { when: () => hasCursor() && focusIsNeutral() });
  useShortcut(
    'list.peek',
    () => {
      const id = latest.current.cursorId!;
      const ui = useUiStore.getState();
      if (ui.peekItemId === id) ui.openPeek(null);
      else latest.current.onPeek(id);
    },
    { when: () => hasCursor() && focusOnTarget() },
  );

  useShortcut(
    'list.select',
    () => {
      const id = latest.current.cursorId!;
      const { selection: current, onSelect } = chosen();
      onSelect(toggleId(current, id));
      anchor.current = id;
    },
    { when: hasCursor, enabled: selectable },
  );
  useShortcut(
    'list.select_range',
    () => {
      const { order: ids, cursorId: current } = latest.current;
      const { selection: picked, onSelect } = chosen();
      onSelect(selectRange(picked, ids, anchor.current ?? current, current!));
      anchor.current = current;
    },
    { when: hasCursor, enabled: selectable },
  );
  useShortcut(
    'list.select_all',
    () => {
      const { onSelectAll, all, order: ids } = latest.current;
      if (onSelectAll) onSelectAll();
      else chosen().onSelect([...(all ?? ids)]);
    },
    { when: () => (latest.current.all ?? latest.current.order).length > 0, enabled: selectable },
  );
  useShortcut(
    'list.clear',
    () => {
      chosen().onSelect([]);
      anchor.current = null;
    },
    // Escape in a field belongs to the field (the filter search clears itself)
    { when: () => chosen().selection.length > 0 && !isTyping(document.activeElement), enabled: selectable },
  );

  // the cursor item went away (archived, filtered out, its group collapsed): the cursor takes the item at its place
  useEffect(() => {
    if (cursorId === null) return;
    const index = order.indexOf(cursorId);
    if (index >= 0) {
      lastIndex.current = index;
      return;
    }
    const next = order.length > 0 ? order[Math.min(lastIndex.current, order.length - 1)]! : null;
    latest.current.onCursor(next);
    // the row had the focus and is gone: the focus moves on with the cursor instead of falling back to the page
    if (next && (document.activeElement === null || document.activeElement === document.body)) latest.current.focus(next);
  }, [order, cursorId]);

  // a layout that mounts while the focus is on nothing (1–4 switched the layout, and the old one took the focused row
  // with it) gives the cursor its focus, so it stays visible; a focus elsewhere (the layout switcher) stays where it is
  useEffect(() => {
    const { cursorId: current, order: ids } = latest.current;
    if (current !== null && ids.includes(current) && focusIsNeutral()) latest.current.focus(current);
  }, []);

  // a selection that was cleared elsewhere (Esc, a bulk change) starts the next range anew
  useEffect(() => {
    if (selection.length === 0) anchor.current = null;
  }, [selection.length]);

  return { clickSelect, move };
}
