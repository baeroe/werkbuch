/*
 * The keyboard cursor and selection of the item layouts: the pure rules (port of the clickdummy's
 * `useSelection.test.ts`, same names) and the keys of `useSelection` against a layout whose cursor and selection live
 * in React state, as the items screen keeps them.
 */

import { act, renderHook } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isMac } from '@/lib/platform';
import { listShortcuts } from '@/lib/shortcuts/registry';
import { useUiStore } from '@/store/ui';
import { nextInOrder, rangeBetween, selectRange, toggleId } from './selection';
import { revealBelowToolbar, useSelection, type SelectionOptions } from './useSelection';

const order = ['a', 'b', 'c', 'd', 'e'];

describe('selection', () => {
  it('x toggles one item in and out of the selection', () => {
    expect(toggleId([], 'b')).toEqual(['b']);
    expect(toggleId(['a', 'b'], 'b')).toEqual(['a']);
  });

  it('a shift range selects everything between the anchor and the item, in either direction', () => {
    expect(rangeBetween(order, 'b', 'd')).toEqual(['b', 'c', 'd']);
    expect(rangeBetween(order, 'd', 'b')).toEqual(['b', 'c', 'd']);
    // added to what is selected, each id once, in the order of the list
    expect(selectRange(['e', 'b'], order, 'b', 'd')).toEqual(['b', 'c', 'd', 'e']);
    // an item of the selection the layout does not show (a collapsed group) stays, after the shown ones
    expect(selectRange(['z', 'a'], order, 'a', 'b')).toEqual(['a', 'b', 'z']);
    // an item that is not in the list is no range
    expect(rangeBetween(order, 'a', 'gone')).toEqual([]);
  });

  it('a range from an anchor that is gone starts at the item itself', () => {
    expect(rangeBetween(order, 'gone', 'c')).toEqual(['c']);
    expect(rangeBetween(order, null, 'c')).toEqual(['c']);
  });

  it('moves the cursor through the order, starting at the first item and stopping at the ends', () => {
    expect(nextInOrder(order, null, 1)).toBe('a');
    expect(nextInOrder(order, null, -1)).toBe('e');
    expect(nextInOrder(order, 'b', 1)).toBe('c');
    expect(nextInOrder(order, 'e', 1)).toBe('e');
    expect(nextInOrder(order, 'a', -1)).toBe('a');
    expect(nextInOrder([], null, 1)).toBeNull();
  });
});

/* ------------------------------------------------------------------------- harness */

const press = (key: string, init: KeyboardEventInit = {}) =>
  act(() => {
    (document.activeElement ?? document.body).dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }));
  });
const mod = () => (isMac() ? { metaKey: true } : { ctrlKey: true });

let container: HTMLDivElement;

beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
});

afterEach(() => {
  document.body.replaceChildren();
  useUiStore.getState().openPeek(null);
});

/** A layout that keeps its cursor and selection in state, as the items screen does, with spies for the rest. */
function mountLayout({ cursorId = null, selection = [], ...rest }: Partial<Omit<SelectionOptions, 'order'>> = {}, ids: string[] = order) {
  const spies = { focus: vi.fn(), onOpen: vi.fn(), onPeek: vi.fn() };
  const hook = renderHook(
    ({ order: shown }: { order: string[] }) => {
      const [cursor, setCursor] = useState(cursorId);
      const [chosen, setChosen] = useState(selection);
      const { clickSelect } = useSelection({
        order: shown,
        cursorId: cursor,
        onCursor: setCursor,
        selection: chosen,
        onSelect: setChosen,
        container: { current: container },
        ...spies,
        ...rest,
      });
      return { clickSelect, cursor, chosen, setChosen };
    },
    { initialProps: { order: ids } },
  );
  return { ...spies, hook, now: () => hook.result.current };
}

/* ---------------------------------------------------------------------------- tests */

describe('a layout that mounts', () => {
  const options = (focus: (id: string) => void): SelectionOptions => ({
    order,
    cursorId: 'c',
    onCursor: vi.fn(),
    selection: [],
    onSelect: vi.fn(),
    onOpen: vi.fn(),
    onPeek: vi.fn(),
    focus,
    container: { current: null },
  });

  it('takes the focus for the cursor when it is on nothing, as after 1–4 switched the layout', () => {
    const focus = vi.fn();
    renderHook(() => useSelection(options(focus)));
    expect(focus).toHaveBeenCalledWith('c');
  });

  it('leaves the focus where it is when it is somewhere, e.g. on the layout switcher', () => {
    const button = document.createElement('button');
    document.body.append(button);
    button.focus();
    const focus = vi.fn();
    renderHook(() => useSelection(options(focus)));
    expect(focus).not.toHaveBeenCalled();
  });

  it('registers its keys in the scope of the list, the arrows only where the layout leaves them to it', () => {
    const list = mountLayout();
    const ids = listShortcuts().map((entry) => entry.id);
    expect(ids).toEqual([
      'list.next',
      'list.prev',
      'list.next_arrow',
      'list.prev_arrow',
      'list.extend_next',
      'list.extend_prev',
      'list.extend_next_arrow',
      'list.extend_prev_arrow',
      'list.open',
      'list.peek',
      'list.select',
      'list.select_range',
      'list.select_all',
      'list.clear',
    ]);
    expect(new Set(listShortcuts().map((entry) => `${entry.scope} ${entry.group}`))).toEqual(new Set(['list shortcuts.group.list']));
    list.hook.unmount();

    // the table: ↑/↓ belong to its grid of cells (K19)
    const table = mountLayout({ arrows: false, cursorId: 'b' });
    expect(listShortcuts().map((entry) => entry.id)).not.toContain('list.next_arrow');
    expect(listShortcuts().filter((entry) => entry.id.endsWith('_arrow'))).toEqual([]);
    press('ArrowDown');
    expect(table.now().cursor).toBe('b');
    press('j');
    expect(table.now().cursor).toBe('c');
  });
});

describe('the keys of a layout', () => {
  it('moves the cursor with j and k from the first item on, and gives it the focus', () => {
    const layout = mountLayout();

    press('j');
    expect(layout.now().cursor).toBe('a');
    expect(layout.focus).toHaveBeenLastCalledWith('a');
    press('j', { repeat: true });
    press('j', { repeat: true });
    expect(layout.now().cursor).toBe('c');
    press('k');
    expect(layout.now().cursor).toBe('b');
    // nothing selected along the way
    expect(layout.now().chosen).toEqual([]);
  });

  it('starts at the last item going up, and does nothing in an empty layout', () => {
    const layout = mountLayout();
    press('k');
    expect(layout.now().cursor).toBe('e');
    layout.hook.unmount();

    const empty = mountLayout({}, []);
    press('j');
    expect(empty.now().cursor).toBeNull();
    expect(empty.focus).not.toHaveBeenCalled();
  });

  it('moves with the arrows only while the focus is in the layout or nowhere, so menus keep theirs', () => {
    const layout = mountLayout({ cursorId: 'b' });
    press('ArrowDown');
    expect(layout.now().cursor).toBe('c');

    const menu = document.createElement('button');
    document.body.append(menu);
    menu.focus();
    press('ArrowDown');
    press('ArrowUp', { shiftKey: true });
    expect(layout.now().cursor).toBe('c');

    const row = document.createElement('div');
    row.tabIndex = 0;
    container.append(row);
    row.focus();
    press('ArrowUp');
    expect(layout.now().cursor).toBe('b');
  });

  it('extends the selection with shift from where it started, in both directions and with the arrows too', () => {
    const layout = mountLayout({ cursorId: 'b' });

    press('J', { shiftKey: true });
    expect(layout.now().chosen).toEqual(['b', 'c']);
    press('ArrowDown', { shiftKey: true });
    expect(layout.now().chosen).toEqual(['b', 'c', 'd']);
    expect(layout.now().cursor).toBe('d');
    // going back keeps what was chosen; above the anchor the range grows upwards
    press('K', { shiftKey: true });
    press('K', { shiftKey: true });
    press('ArrowUp', { shiftKey: true });
    expect(layout.now().cursor).toBe('a');
    expect(layout.now().chosen).toEqual(['a', 'b', 'c', 'd']);
  });

  it('starts a range at the next item when there is no cursor yet', () => {
    const layout = mountLayout();
    press('J', { shiftKey: true });
    expect(layout.now().chosen).toEqual(['a']);
  });

  it('x selects the item under the cursor, shift+x the range from the one chosen last', () => {
    const layout = mountLayout({ cursorId: 'b' });

    press('x');
    expect(layout.now().chosen).toEqual(['b']);
    press('j');
    press('j');
    press('X', { shiftKey: true });
    expect(layout.now().chosen).toEqual(['b', 'c', 'd']);
    // x again takes the item out
    press('x');
    expect(layout.now().chosen).toEqual(['b', 'c']);
  });

  it('shift+x without an earlier choice selects just the cursor item, and neither does anything without a cursor', () => {
    const layout = mountLayout({ cursorId: 'c' });
    press('X', { shiftKey: true });
    expect(layout.now().chosen).toEqual(['c']);
    layout.hook.unmount();

    const without = mountLayout();
    press('x');
    press('X', { shiftKey: true });
    expect(without.now().chosen).toEqual([]);
  });

  it('selects every item with mod+a, those of collapsed groups too, or lets the screen select what is not loaded', () => {
    const layout = mountLayout({ all: [...order, 'f'] });
    press('a', mod());
    expect(layout.now().chosen).toEqual([...order, 'f']);
    layout.hook.unmount();

    const shown = mountLayout();
    press('a', mod());
    expect(shown.now().chosen).toEqual(order);
    shown.hook.unmount();

    const onSelectAll = vi.fn();
    const paged = mountLayout({ onSelectAll });
    press('a', mod());
    expect(onSelectAll).toHaveBeenCalledTimes(1);
    expect(paged.now().chosen).toEqual([]);
    paged.hook.unmount();

    // an empty layout leaves mod+a to the page (select the text)
    const empty = mountLayout({ onSelectAll }, []);
    const event = new KeyboardEvent('keydown', { key: 'a', bubbles: true, cancelable: true, ...mod() });
    act(() => {
      document.body.dispatchEvent(event);
    });
    expect(event.defaultPrevented).toBe(false);
    expect(empty.now().chosen).toEqual([]);
  });

  it('clears the selection with Escape, but leaves Escape to a field and to an empty selection', () => {
    const layout = mountLayout({ cursorId: 'a', selection: ['a', 'b'] });

    const input = document.createElement('input');
    document.body.append(input);
    input.focus();
    press('Escape');
    expect(layout.now().chosen).toEqual(['a', 'b']);

    input.blur();
    press('Escape');
    expect(layout.now().chosen).toEqual([]);

    // the next range starts anew, at the cursor
    press('J', { shiftKey: true });
    expect(layout.now().chosen).toEqual(['a', 'b']);
  });

  it('opens the page with Enter only with the focus nowhere, so buttons keep their Enter', () => {
    const layout = mountLayout({ cursorId: 'c' });
    press('Enter');
    expect(layout.onOpen).toHaveBeenCalledWith('c');

    const button = document.createElement('button');
    container.append(button);
    button.focus();
    press('Enter');
    expect(layout.onOpen).toHaveBeenCalledTimes(1);
    layout.hook.unmount();

    // without a cursor Enter is nobody's
    const without = mountLayout();
    button.blur();
    press('Enter');
    expect(without.onOpen).not.toHaveBeenCalled();
  });

  it('shows the preview with space on the element of the cursor, and closes it when it shows that item', () => {
    const layout = mountLayout({ cursorId: 'c' });
    const row = document.createElement('div');
    row.tabIndex = 0;
    row.setAttribute('data-nav-target', '');
    container.append(row);
    row.focus();

    press(' ');
    expect(layout.onPeek).toHaveBeenCalledWith('c');

    act(() => useUiStore.getState().openPeek('c'));
    press(' ');
    expect(useUiStore.getState().peekItemId).toBeNull();
    expect(layout.onPeek).toHaveBeenCalledTimes(1);

    // a button inside the row keeps its space bar
    const button = document.createElement('button');
    row.append(button);
    button.focus();
    press(' ');
    expect(layout.onPeek).toHaveBeenCalledTimes(1);
  });
});

describe('clicks and changes of the layout', () => {
  it('toggles an item with a click and selects the range from the last one with a shift click', () => {
    const layout = mountLayout();

    // a shift click without an anchor chooses just the item
    act(() => layout.now().clickSelect('b', true));
    expect(layout.now().chosen).toEqual(['b']);
    expect(layout.now().cursor).toBe('b');
    act(() => layout.now().clickSelect('d', true));
    expect(layout.now().chosen).toEqual(['b', 'c', 'd']);
    act(() => layout.now().clickSelect('c', false));
    expect(layout.now().chosen).toEqual(['b', 'd']);
    expect(layout.now().cursor).toBe('c');
  });

  it('starts a new range after the selection was emptied elsewhere, e.g. by a bulk change', () => {
    const layout = mountLayout();
    act(() => layout.now().clickSelect('b', false));
    act(() => layout.now().setChosen([]));
    act(() => layout.now().clickSelect('d', true));
    expect(layout.now().chosen).toEqual(['d']);
  });

  it('moves the cursor to the item at its place when its item goes away, and the focus with it', () => {
    const layout = mountLayout({ cursorId: 'c' });
    layout.focus.mockClear();

    // archived or filtered out: the item that took its place
    layout.hook.rerender({ order: ['a', 'b', 'd', 'e'] });
    expect(layout.now().cursor).toBe('d');
    expect(layout.focus).toHaveBeenLastCalledWith('d');

    // with the focus somewhere else, only the cursor moves
    const button = document.createElement('button');
    document.body.append(button);
    button.focus();
    layout.focus.mockClear();
    layout.hook.rerender({ order: ['a', 'b'] });
    expect(layout.now().cursor).toBe('b');
    expect(layout.focus).not.toHaveBeenCalled();

    // nothing left: no cursor
    layout.hook.rerender({ order: [] });
    expect(layout.now().cursor).toBeNull();
  });
});

describe('revealBelowToolbar', () => {
  const rect = (top: number, bottom: number) => ({ top, bottom }) as DOMRect;

  it('scrolls an element out from under the sticky toolbar and up from the bottom edge, and leaves a visible one', () => {
    const scrollBy = vi.spyOn(window, 'scrollBy').mockImplementation(() => {});
    const element = document.createElement('div');
    const toolbar = document.createElement('div');
    toolbar.setAttribute('data-items-toolbar', '');
    vi.spyOn(toolbar, 'getBoundingClientRect').mockReturnValue(rect(0, 100));
    document.body.append(toolbar, element);
    const place = vi.spyOn(element, 'getBoundingClientRect');

    place.mockReturnValue(rect(90, 126));
    revealBelowToolbar(element);
    expect(scrollBy).toHaveBeenLastCalledWith({ top: -18 });

    place.mockReturnValue(rect(window.innerHeight - 20, window.innerHeight + 16));
    revealBelowToolbar(element);
    expect(scrollBy).toHaveBeenLastCalledWith({ top: 24 });

    scrollBy.mockClear();
    place.mockReturnValue(rect(200, 236));
    revealBelowToolbar(element);
    expect(scrollBy).not.toHaveBeenCalled();

    // without a toolbar the top of the window counts
    toolbar.remove();
    place.mockReturnValue(rect(4, 40));
    revealBelowToolbar(element);
    expect(scrollBy).toHaveBeenLastCalledWith({ top: -4 });
    scrollBy.mockRestore();
  });
});
