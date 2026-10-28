/*
 * The keyboard cursor and the selection of an item layout (spec 5.3): j/k and ↓/↑ move the cursor, ⇧ with them extends
 * the selection, x selects the cursor item, ⇧X the range from the last one chosen, ⌘A all, Esc clears the selection;
 * Enter opens the item's page, the space bar shows or hides its preview.
 *
 * A layout mounts `useSelection` once (list, table, and the board of Task 7) with the item ids in the order it shows
 * them. The cursor and the selection themselves belong to `ItemsScreen` (LayoutProps), so the item commands of the
 * list (s, a, p … from `useItemCommands`) act on them, whatever the layout.
 *
 * When the keys act: j/k, x and the like whenever the list's shortcuts run (not while typing, not under a dialog).
 * The arrows only while the focus is in the layout or nowhere in particular, so they keep working in menus and
 * segmented controls; Enter and the space bar only on the element that stands for the cursor (`data-nav-target`) or
 * with the focus nowhere, so buttons keep their own Enter and space.
 */

import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react';
import { useShortcut } from '@/lib/shortcuts/useShortcut';
import { isTyping } from '@/lib/shortcuts/registry';
import { useUiStore } from '@/store/ui';

/* ------------------------------------------------------------------------- pure helpers */

/** The selection with the item added, or taken out when it was in. */
export function toggleId(selection: readonly string[], id: string): string[] {
  return selection.includes(id) ? selection.filter((entry) => entry !== id) : [...selection, id];
}

/** The ids from `from` to `to` in the order of the list, both included; just `to` when `from` is not in the list. */
export function rangeBetween(order: readonly string[], from: string | null, to: string): string[] {
  const end = order.indexOf(to);
  if (end < 0) return [];
  const start = from === null ? -1 : order.indexOf(from);
  if (start < 0) return [to];
  return order.slice(Math.min(start, end), Math.max(start, end) + 1);
}

/** The selection with the range from the anchor to `to` added; each id once, in the order of the list. */
export function selectRange(selection: readonly string[], order: readonly string[], anchor: string | null, to: string): string[] {
  const chosen = new Set([...selection, ...rangeBetween(order, anchor, to)]);
  return [...order.filter((id) => chosen.has(id)), ...selection.filter((id) => !order.includes(id))];
}

/** The next item in a direction; from no cursor the first (or, going up, the last); at the ends it stays. */
export function nextInOrder(order: readonly string[], current: string | null, step: 1 | -1): string | null {
  if (order.length === 0) return null;
  const index = current === null ? -1 : order.indexOf(current);
  if (index < 0) return step === 1 ? order[0] : order[order.length - 1];
  return order[Math.min(order.length - 1, Math.max(0, index + step))];
}

/* ------------------------------------------------------------------------------- focus */

/** No element in particular has the focus: the page itself or the main area. */
function focusIsNeutral(): boolean {
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

export interface SelectionOptions {
  /** The item ids in the order the layout shows them, without the ones in collapsed groups. */
  order: string[];
  /** All ids of the layout (⌘A), collapsed groups included; `order` when left out. */
  all?: string[];
  cursorId: string | null;
  onCursor: (id: string | null) => void;
  selection: string[];
  onSelect: (ids: string[]) => void;
  /** Enter: the item's page. */
  onOpen: (id: string) => void;
  /** Space: the preview of the item. */
  onPeek: (id: string) => void;
  /** Moves the focus to the row, cell or card of an item; it brings it into view first. */
  focus: (id: string) => void;
  /** The layout's element: the arrows act while the focus is inside. */
  container: RefObject<HTMLElement | null>;
}

const GROUP = 'Liste';

/** Registers the cursor and selection keys of a layout; answers what a click with or without ⇧ does. */
export function useSelection(options: SelectionOptions): { clickSelect: (id: string, range: boolean) => void } {
  const { order, cursorId, selection } = options;
  const latest = useRef(options);
  useLayoutEffect(() => {
    latest.current = options;
  });
  /** Where the next ⇧ range starts: the item chosen last. */
  const anchor = useRef<string | null>(null);
  const lastIndex = useRef(0);

  const inLayout = () => focusIsNeutral() || Boolean(latest.current.container.current?.contains(document.activeElement));

  function move(step: 1 | -1, extend: boolean) {
    const { order: ids, cursorId: current, onCursor, focus, onSelect, selection: chosen } = latest.current;
    const next = nextInOrder(ids, current, step);
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
    const { order: ids, selection: chosen, onSelect, onCursor } = latest.current;
    if (range && anchor.current !== null) onSelect(selectRange(chosen, ids, anchor.current, id));
    else {
      onSelect(toggleId(chosen, id));
      anchor.current = id;
    }
    onCursor(id);
  }

  const hasCursor = () => latest.current.cursorId !== null && latest.current.order.includes(latest.current.cursorId);

  useShortcut({ id: 'list.next', keys: 'j', scope: 'list', label: 'Nächstes Item', group: GROUP, repeat: true, run: () => move(1, false) });
  useShortcut({ id: 'list.previous', keys: 'k', scope: 'list', label: 'Voriges Item', group: GROUP, repeat: true, run: () => move(-1, false) });
  useShortcut({ id: 'list.down', keys: 'arrowdown', scope: 'list', label: 'Nächstes Item', group: GROUP, repeat: true, when: inLayout, run: () => move(1, false) });
  useShortcut({ id: 'list.up', keys: 'arrowup', scope: 'list', label: 'Voriges Item', group: GROUP, repeat: true, when: inLayout, run: () => move(-1, false) });
  useShortcut({ id: 'list.extend_next', keys: 'shift+j', scope: 'list', label: 'Auswahl nach unten erweitern', group: GROUP, repeat: true, run: () => move(1, true) });
  useShortcut({ id: 'list.extend_previous', keys: 'shift+k', scope: 'list', label: 'Auswahl nach oben erweitern', group: GROUP, repeat: true, run: () => move(-1, true) });
  useShortcut({
    id: 'list.extend_down',
    keys: 'shift+arrowdown',
    scope: 'list',
    label: 'Auswahl nach unten erweitern',
    group: GROUP,
    repeat: true,
    when: inLayout,
    run: () => move(1, true),
  });
  useShortcut({ id: 'list.extend_up', keys: 'shift+arrowup', scope: 'list', label: 'Auswahl nach oben erweitern', group: GROUP, repeat: true, when: inLayout, run: () => move(-1, true) });

  useShortcut({
    id: 'list.open',
    keys: 'enter',
    scope: 'list',
    label: 'Item öffnen',
    group: GROUP,
    when: () => hasCursor() && focusIsNeutral(),
    run: () => latest.current.cursorId && latest.current.onOpen(latest.current.cursorId),
  });
  useShortcut({
    id: 'list.peek',
    keys: 'space',
    scope: 'list',
    label: 'Vorschau zeigen oder schließen',
    group: GROUP,
    when: () => hasCursor() && focusOnTarget(),
    run: () => {
      const id = latest.current.cursorId;
      if (!id) return;
      if (useUiStore.getState().peekItemId === id) useUiStore.getState().openPeek(null);
      else latest.current.onPeek(id);
    },
  });

  useShortcut({
    id: 'list.select',
    keys: 'x',
    scope: 'list',
    label: 'Item auswählen',
    group: GROUP,
    when: hasCursor,
    run: () => {
      const id = latest.current.cursorId!;
      latest.current.onSelect(toggleId(latest.current.selection, id));
      anchor.current = id;
    },
  });
  useShortcut({
    id: 'list.select_range',
    keys: 'shift+x',
    scope: 'list',
    label: 'Bereich bis hier auswählen',
    group: GROUP,
    when: hasCursor,
    run: () => {
      const { order: ids, selection: chosen, cursorId: current, onSelect } = latest.current;
      onSelect(selectRange(chosen, ids, anchor.current ?? current, current!));
      anchor.current = current;
    },
  });
  useShortcut({
    id: 'list.select_all',
    keys: 'mod+a',
    scope: 'list',
    label: 'Alle auswählen',
    group: GROUP,
    when: () => (latest.current.all ?? latest.current.order).length > 0,
    run: () => latest.current.onSelect([...(latest.current.all ?? latest.current.order)]),
  });
  useShortcut({
    id: 'list.clear_selection',
    keys: 'escape',
    scope: 'list',
    label: 'Auswahl aufheben',
    group: GROUP,
    // Escape in a field belongs to the field (the filter search clears itself)
    when: () => latest.current.selection.length > 0 && !isTyping(document.activeElement),
    run: () => {
      latest.current.onSelect([]);
      anchor.current = null;
    },
  });

  // the cursor item went away (archived, filtered out, its group collapsed): the cursor takes the item at its place
  useEffect(() => {
    if (cursorId === null) return;
    const index = order.indexOf(cursorId);
    if (index >= 0) {
      lastIndex.current = index;
      return;
    }
    const next = order.length > 0 ? order[Math.min(lastIndex.current, order.length - 1)] : null;
    latest.current.onCursor(next);
    // the row had the focus and is gone: the focus moves on with the cursor instead of falling back to the page
    if (next && (document.activeElement === null || document.activeElement === document.body)) latest.current.focus(next);
  }, [order, cursorId]);

  // a selection that was cleared elsewhere (Esc, a bulk change) starts the next range anew
  useEffect(() => {
    if (selection.length === 0) anchor.current = null;
  }, [selection.length]);

  return { clickSelect };
}
