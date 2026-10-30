import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { initI18n } from '@/lib/i18n';
import { registerShortcut } from '@/lib/shortcuts/registry';
import en from '../../../../lang/en.json';
import { SortableList, type SortableControls } from './SortableList';

type Row = { id: string; name: string };

const ITEMS: Row[] = [
  { id: 'a', name: 'Backlog' },
  { id: 'b', name: 'Todo' },
  { id: 'c', name: 'Doing' },
];

/** jsdom has no layout: every row is 40 px high and below the one before, which is all dnd-kit's keyboard needs. */
beforeEach(() => {
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    const rows = Array.from(document.querySelectorAll('li'));
    const index = rows.indexOf(this as HTMLLIElement);
    const top = Math.max(index, 0) * 40;
    return { x: 0, y: top, top, left: 0, right: 200, bottom: top + 40, width: 200, height: 40, toJSON: () => ({}) } as DOMRect;
  });
});

afterEach(() => vi.restoreAllMocks());

function renderList(props: Partial<Parameters<typeof SortableList<Row>>[0]> = {}) {
  const onReorder = vi.fn();
  const seen: SortableControls[] = [];
  const view = render(
    <SortableList
      items={ITEMS}
      onReorder={onReorder}
      label="Status"
      nameOf={(item) => item.name}
      renderItem={(item, controls) => {
        seen.push(controls);
        return (
          <div>
            {controls.handle}
            <span>{item.name}</span>
          </div>
        );
      }}
      {...props}
    />,
  );
  return { ...view, onReorder, seen };
}

const handle = (name: string) => screen.getByRole('button', { name: `${name} verschieben` });
/**
 * Everything the live region of dnd-kit says from now on, in order. It holds one sentence at a time, and React sets
 * several within one `act`, so the observer reads the old text of every change as well as the text it ends with.
 */
function listen() {
  const heard: string[] = [];
  const say = (text: string | null) => {
    if (text && heard.at(-1) !== text) heard.push(text);
  };
  const regionText = () => Array.from(document.querySelectorAll('[aria-live]')).map((region) => region.textContent).join(' ').trim();
  const observer = new MutationObserver((records) => {
    for (const record of records) if (record.type === 'characterData') say(record.oldValue);
    say(regionText());
  });
  observer.observe(document.body, { subtree: true, childList: true, characterData: true, characterDataOldValue: true });
  return { heard, stop: () => observer.disconnect() };
}

describe('SortableList handle', () => {
  it('lifts a row with the bare Space key, and leaves Ctrl+Enter to the page so the save shortcut still runs', async () => {
    const user = userEvent.setup();
    const save = vi.fn();
    const unregister = registerShortcut({ id: 'test.save', keys: 'mod+enter', scope: 'global', label: 'shortcuts.shell.help', group: 'shortcuts.group.general', run: save });
    try {
      renderList();
      await user.tab();
      const first = handle('Backlog');
      expect(document.activeElement).toBe(first);

      // Ctrl+Enter is the page's save: the handle must not take the key to lift the row
      await user.keyboard('{Control>}{Enter}{/Control}');
      expect(save).toHaveBeenCalledTimes(1);
      expect(first.getAttribute('aria-pressed')).not.toBe('true');

      // Alt and Cmd belong to the system: no lift either
      await user.keyboard('{Alt>} {/Alt}');
      expect(first.getAttribute('aria-pressed')).not.toBe('true');
      await user.keyboard('{Meta>}{Enter}{/Meta}');
      expect(first.getAttribute('aria-pressed')).not.toBe('true');

      // the bare key still lifts the row
      await user.keyboard(' ');
      await waitFor(() => expect(first.getAttribute('aria-pressed')).toBe('true'));
      await user.keyboard('{Escape}');
      await waitFor(() => expect(first.getAttribute('aria-pressed')).not.toBe('true'));
    } finally {
      unregister();
    }
  });
});

describe('SortableList', () => {
  it('names the list and gives every row a handle that says what it moves and that it can be sorted', () => {
    renderList();

    expect(screen.getByRole('list', { name: 'Status' })).toBeTruthy();
    expect(screen.getAllByRole('listitem')).toHaveLength(3);
    expect(handle('Todo').getAttribute('aria-roledescription')).toBe('sortierbar');
  });

  it('a row without a name is called "Eintrag"', () => {
    renderList({ items: [{ id: 'x', name: '' }] });

    expect(screen.getByRole('button', { name: 'Eintrag verschieben' })).toBeTruthy();
  });

  it('Space lifts a row, the arrow down and Space put it down one place lower, and onReorder gets the new order', async () => {
    const user = userEvent.setup();
    const { onReorder } = renderList();
    await user.tab();

    await user.keyboard(' ');
    await waitFor(() => expect(handle('Backlog').getAttribute('aria-pressed')).toBe('true'));
    await user.keyboard('{ArrowDown}');
    await user.keyboard(' ');

    await waitFor(() => expect(onReorder).toHaveBeenCalledTimes(1));
    expect(onReorder.mock.calls[0][0].map((item: Row) => item.id)).toEqual(['b', 'a', 'c']);
  });

  it('the arrow up moves a row up', async () => {
    const user = userEvent.setup();
    const { onReorder } = renderList();
    await user.tab();
    await user.tab();
    expect(document.activeElement).toBe(handle('Todo'));

    await user.keyboard(' ');
    await user.keyboard('{ArrowUp}');
    await user.keyboard(' ');

    await waitFor(() => expect(onReorder).toHaveBeenCalledTimes(1));
    expect(onReorder.mock.calls[0][0].map((item: Row) => item.id)).toEqual(['b', 'a', 'c']);
  });

  it('Escape takes the lift back without a call to onReorder', async () => {
    const user = userEvent.setup();
    const { onReorder } = renderList();
    await user.tab();

    await user.keyboard(' ');
    await user.keyboard('{ArrowDown}');
    await user.keyboard('{Escape}');

    await waitFor(() => expect(handle('Backlog').getAttribute('aria-pressed')).not.toBe('true'));
    expect(onReorder).not.toHaveBeenCalled();
    expect(screen.getAllByRole('listitem').map((row) => row.textContent)).toEqual(['Backlog', 'Todo', 'Doing']);
  });

  it('putting a row down where it was is no reorder', async () => {
    const user = userEvent.setup();
    const { onReorder } = renderList();
    await user.tab();

    await user.keyboard(' ');
    await user.keyboard(' ');

    await waitFor(() => expect(handle('Backlog').getAttribute('aria-pressed')).not.toBe('true'));
    expect(onReorder).not.toHaveBeenCalled();
  });

  it('the live region says lifting, position and putting down with the name of the row', async () => {
    const user = userEvent.setup();
    renderList();
    const { heard, stop } = listen();
    await user.tab();

    await user.keyboard(' ');
    await user.keyboard('{ArrowDown}');
    await user.keyboard(' ');
    await waitFor(() => expect(heard).toContain('Backlog abgelegt auf Position 2 von 3.'));
    stop();

    expect(heard).toEqual(['Backlog aufgenommen. Position 1 von 3.', 'Backlog liegt über Position 1 von 3.', 'Backlog liegt über Position 2 von 3.', 'Backlog abgelegt auf Position 2 von 3.']);
  });

  it('the live region says it when the move is taken back', async () => {
    const user = userEvent.setup();
    renderList();
    const { heard, stop } = listen();
    await user.tab();

    await user.keyboard(' ');
    await user.keyboard('{ArrowDown}');
    await user.keyboard('{Escape}');
    await waitFor(() => expect(heard.at(-1)).toBe('Verschieben abgebrochen. Backlog bleibt auf Position 1 von 3.'));
    stop();
  });

  it('tells how to use it to screen readers, and says everything in English on an English page', async () => {
    const { unmount } = renderList();
    expect(document.body.textContent).toContain('Leertaste drücken, um den Eintrag aufzunehmen.');
    unmount();

    initI18n({ locale: 'en', translations: en });
    const user = userEvent.setup();
    renderList();
    expect(document.body.textContent).toContain('Press Space to pick up the item.');
    expect(screen.getByRole('button', { name: 'Move Backlog' }).getAttribute('aria-roledescription')).toBe('sortable');
    const { heard, stop } = listen();
    await user.tab();
    await user.keyboard(' ');
    await user.keyboard('{Escape}');
    await waitFor(() => expect(heard.at(-1)).toBe('Move cancelled. Backlog stays at Position 1 of 3.'));
    stop();
    expect(heard[0]).toBe('Backlog picked up. Position 1 of 3.');
  });

  it('announces a row without a name as "Eintrag"', async () => {
    const user = userEvent.setup();
    renderList({ items: [{ id: 'x', name: '' }, { id: 'y', name: 'Todo' }] });
    const { heard, stop } = listen();
    await user.tab();

    await user.keyboard(' ');
    await user.keyboard('{ArrowDown}');
    await user.keyboard(' ');

    await waitFor(() => expect(heard.at(-1)).toBe('Eintrag abgelegt auf Position 2 von 2.'));
    stop();
    expect(heard[0]).toBe('Eintrag aufgenommen. Position 1 von 2.');
  });

  it('a disabled list has handles that cannot lift anything', async () => {
    const user = userEvent.setup();
    renderList({ disabled: true });

    expect(handle('Backlog').className).toContain('cursor-not-allowed');
    await user.tab();
    await user.keyboard(' ');
    expect(handle('Backlog').getAttribute('aria-pressed')).not.toBe('true');
  });

  it('gives renderItem the handle, the position and whether the row is dragged', async () => {
    const user = userEvent.setup();
    const { seen } = renderList();

    expect(seen.slice(0, 3).map((controls) => [controls.index, controls.dragging])).toEqual([
      [0, false],
      [1, false],
      [2, false],
    ]);
    expect(seen[0].handle).toBeTruthy();

    await user.tab();
    await user.keyboard(' ');
    await waitFor(() => expect(seen.some((controls) => controls.dragging && controls.index === 0)).toBe(true));
  });

  it('puts the classes of the list and of the rows where they belong', () => {
    renderList({ className: 'divide-y', rowClassName: 'py-1' });

    expect(screen.getByRole('list').className).toContain('divide-y');
    expect(screen.getAllByRole('listitem')[0].className).toContain('py-1');
  });
});
