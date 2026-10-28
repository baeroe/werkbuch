import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { listProperties } from '@/api/properties';
import { getWorkItem } from '@/api/workItems';
import { currentToasts, dismissToast } from '@/components/ui/toast';
import { CommandPalette } from '@/features/palette/CommandPalette';
import { listCommands } from '@/lib/commands';
import { listShortcuts } from '@/lib/shortcuts/registry';
import { useUiStore } from '@/store/ui';
import { asUser, resetApi } from '@/test/api';
import { useItemCommands, type ItemCommandScope } from './commands';
import { ItemDialogsHost } from './ItemDialogs';
import { PropertyField } from './PropertyField';
import { StatePicker } from './StatePicker';
import { TypePicker } from './TypePicker';

beforeEach(() => {
  resetApi();
  useUiStore.setState(useUiStore.getInitialState());
});

// the toast store is shared by all tests: close whatever a test left open
afterEach(() => {
  act(() => currentToasts().forEach((item) => dismissToast(item.id)));
});

function renderWithData(node: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const wrap = (content: ReactNode) => <QueryClientProvider client={client}>{content}</QueryClientProvider>;
  const view = render(wrap(node));
  return { ...view, rerender: (next: ReactNode) => view.rerender(wrap(next)) };
}

/** The stored item, as the server has it now. */
const stored = async (key: string) => (await getWorkItem(key)).item;

/** A picker's trigger; it turns into a combobox once the rights have loaded (read-only until then). */
const picker = (name: RegExp) => screen.findByRole('combobox', { name });

describe('StatePicker', () => {
  it('StatePicker on an APP item in app_todo offers only app_progress and app_cancelled', async () => {
    const user = userEvent.setup();
    const item = await stored('APP-11');
    expect(item.state_id).toBe('app_todo');
    renderWithData(<StatePicker item={item} />);

    await user.click(await picker(/^Status/));

    const options = await screen.findAllByRole('option');
    expect(options.map((option) => option.textContent)).toEqual(['In Progress', 'Cancelled']);
  });

  it('choosing Done asks for a resolution and preselects Done', async () => {
    const user = userEvent.setup();
    const item = await stored('WEB-42');
    renderWithData(<StatePicker item={item} />);

    await user.click(await picker(/^Status/));
    await user.click(await screen.findByRole('option', { name: 'Done' }));

    const dialog = await screen.findByRole('dialog', { name: /Done/ });
    expect(within(dialog).getByRole('radio', { name: 'Done' }).getAttribute('aria-checked')).toBe('true');
    // nothing moves before the answer
    expect((await stored('WEB-42')).state_id).toBe('std_progress');

    await user.click(within(dialog).getByRole('button', { name: /setzen/ }));
    await waitFor(async () => {
      const moved = await stored('WEB-42');
      expect([moved.state_id, moved.resolution_id]).toEqual(['std_done', 'res_done']);
    });
  });

  it('a viewer gets a read-only status that says why', async () => {
    asUser('u_theo');
    renderWithData(<StatePicker item={await stored('WEB-42')} />);

    const trigger = await screen.findByRole('button', { name: /^Status/ });
    expect(trigger.getAttribute('aria-disabled')).toBe('true');
    // once the rights have loaded, the reason is the role
    await waitFor(() => expect(document.getElementById(trigger.getAttribute('aria-describedby')!)?.textContent).toContain('darfst du nur lesen'));
  });
});

describe('PropertyField', () => {
  it('PropertyField number keeps one decimal and rejects letters', async () => {
    const user = userEvent.setup();
    const item = await stored('WEB-47');
    const effort = (await listProperties()).items.find((property) => property.key === 'effort')!;
    renderWithData(<PropertyField item={item} property={effort} required={false} />);

    const input = await screen.findByRole<HTMLInputElement>('textbox', { name: 'Aufwand (h)' });
    await waitFor(() => expect(input.disabled || input.readOnly).toBe(false));
    expect(input.value).toBe('3,5');

    await user.clear(input);
    await user.type(input, '2,75{Enter}');
    await waitFor(async () => expect((await stored('WEB-47')).values.effort).toBe(2.8));
    expect(input.value).toBe('2,8');

    await user.clear(input);
    await user.type(input, 'drei{Enter}');
    expect(await screen.findByText(/Nur eine Zahl/)).toBeTruthy();
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect((await stored('WEB-47')).values.effort).toBe(2.8);
  });

  it('a rich text property is a plain text area: blocks become paragraphs and back', async () => {
    const user = userEvent.setup();
    const item = await stored('WEB-47');
    const steps = (await listProperties()).items.find((property) => property.key === 'steps')!;
    renderWithData(<PropertyField item={item} property={steps} required={false} />);

    const area = await screen.findByRole<HTMLTextAreaElement>('textbox', { name: 'Schritte zum Nachstellen' });
    await waitFor(() => expect(area.readOnly).toBe(false));
    // the ordered list of the seed keeps one line per step
    expect(area.value.split('\n')).toEqual([
      'So lässt sich der Fehler nachstellen:',
      '',
      '1. Die Formularseite in Safari (iOS 18) öffnen.',
      '2. Alle Felder ausfüllen und auf „Absenden“ tippen.',
      '3. Im Postfach des Teams liegen zwei identische Mails.',
    ]);

    await user.clear(area);
    await user.type(area, 'Erst das.{Enter}{Enter}Dann das.');
    await user.tab();
    await waitFor(async () =>
      expect((await stored('WEB-47')).values.steps).toEqual({
        type: 'doc',
        content: [
          { type: 'paragraph', content: [{ type: 'text', text: 'Erst das.' }] },
          { type: 'paragraph', content: [{ type: 'text', text: 'Dann das.' }] },
        ],
      }),
    );
  });
});

describe('TypePicker', () => {
  it('TypePicker warns which values will be lost when Bug becomes Task', async () => {
    const user = userEvent.setup();
    const item = await stored('WEB-47');
    renderWithData(<TypePicker item={item} />);

    await user.click(await picker(/^Typ/));
    await user.click(await screen.findByRole('option', { name: 'Task' }));

    const dialog = await screen.findByRole('dialog', { name: /Task/ });
    const lost = within(dialog).getByRole('list', { name: /verloren/ });
    expect(within(lost).getByText('Umgebung')).toBeTruthy();
    expect(within(lost).getByText('Browser')).toBeTruthy();
    expect(within(lost).getByText('Schritte zum Nachstellen')).toBeTruthy();
    // Task has these too: they stay
    expect(within(lost).queryByText('Kunde')).toBeNull();
    expect(within(lost).queryByText('Aufwand (h)')).toBeNull();
    // nothing changes before the answer
    expect((await stored('WEB-47')).type_id).toBe('t_bug');
  });
});

describe('item commands', () => {
  /** A screen that mounts the item commands; its cursor stands on APP-11 unless told otherwise. */
  function Screen({ scope, cursor = 'wi_app_11' }: { scope: ItemCommandScope; cursor?: string }) {
    useItemCommands({ scope, current: () => cursor });
    return null;
  }
  const pressS = () =>
    act(() => {
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 's', bubbles: true, cancelable: true }));
    });
  const ready = () => waitFor(() => expect(listCommands().find((command) => command.id === 'item.state')?.when?.()).toBe(true));
  const registered = (id: string) => listShortcuts().filter((shortcut) => shortcut.id === id);

  /** A list that stays mounted, and the preview beside it while it is open. */
  function ListWithPreview({ preview }: { preview: boolean }) {
    return (
      <>
        <Screen scope="list" />
        {preview && <Screen scope="detail" />}
      </>
    );
  }

  it('a list and the preview beside it mount the item commands without a conflict', async () => {
    const { rerender } = renderWithData(<ListWithPreview preview />);
    // settled: the item has loaded and names the group
    await waitFor(() => expect(listCommands().find((command) => command.id === 'item.state')?.group).toBe('Aktionen für APP-11'));
    // one set at a time: the preview's (detail wins over list)
    expect(registered('item.state').map((shortcut) => shortcut.scope)).toEqual(['detail']);
    expect(listCommands().filter((command) => command.id === 'item.state')).toHaveLength(1);

    // the preview closes: the list's commands take over instead of vanishing with it
    rerender(<ListWithPreview preview={false} />);
    await waitFor(() => expect(registered('item.state').map((shortcut) => shortcut.scope)).toEqual(['list']));
    expect(listCommands().filter((command) => command.id === 'item.state')).toHaveLength(1);
  });

  it('s opens the palette right in the status list of the item under the cursor', async () => {
    renderWithData(
      <MemoryRouter>
        <Screen scope="list" />
        <CommandPalette />
      </MemoryRouter>,
    );
    // the command is there once the item and the rights have loaded
    await ready();
    pressS();

    const list = await screen.findByRole('listbox', { name: 'Status ändern …' });
    expect(within(list).getAllByRole('option').map((option) => option.textContent)).toEqual(['In Progress', 'Cancelled']);
  });

  it('mod+backspace archives a closed item only once its undo toast is over', async () => {
    renderWithData(<Screen scope="detail" cursor="wi_web_40" />);
    await waitFor(() => expect(listCommands().find((command) => command.id === 'item.archive')?.when?.()).toBe(true));

    act(() => {
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', ctrlKey: true, bubbles: true, cancelable: true }));
    });
    const undo = currentToasts().find((entry) => entry.title === 'WEB-40 archiviert');
    expect(undo?.action?.label).toBe('Rückgängig');
    // nothing happens before the toast is over
    expect((await stored('WEB-40')).archived_at).toBeNull();

    act(() => dismissToast(undo!.id));
    await waitFor(async () => expect((await stored('WEB-40')).archived_at).not.toBeNull());
  });

  it('Done from the palette asks for the resolution, and Enter moves the item', async () => {
    const user = userEvent.setup();
    renderWithData(
      <MemoryRouter>
        <Screen scope="detail" cursor="wi_web_42" />
        <CommandPalette />
        <ItemDialogsHost />
      </MemoryRouter>,
    );
    await ready();
    pressS();
    const list = await screen.findByRole('listbox', { name: 'Status ändern …' });
    await user.click(within(list).getByRole('option', { name: 'Done' }));

    // the question takes the focus on the preselected default, so Enter takes it
    const dialog = await screen.findByRole('dialog', { name: 'WEB-42 auf Done setzen' });
    await waitFor(() => expect(document.activeElement).toBe(within(dialog).getByRole('radio', { name: 'Done' })));
    await user.keyboard('{Enter}');

    await waitFor(async () => {
      const moved = await stored('WEB-42');
      expect([moved.state_id, moved.resolution_id]).toEqual(['std_done', 'res_done']);
    });
  });
});
