import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import type { Property, PropertyValue } from '@/types';
import { MemoryRouter } from 'react-router';
import { PeekHost } from '@/app/PeekHost';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getDb, saveDb } from '@/api/db';
import { createProject } from '@/api/projects';
import { listProperties } from '@/api/properties';
import { createWorkItem, getWorkItem } from '@/api/workItems';
import { useWorkItems } from '@/hooks/workItems';
import { currentToasts, dismissToast, resetToasts } from '@/components/ui/toast';
import { CommandPalette } from '@/features/palette/CommandPalette';
import { listCommands } from '@/lib/commands';
import { listShortcuts } from '@/lib/shortcuts/registry';
import { useUiStore } from '@/store/ui';
import { asUser, resetApi } from '@/test/api';
import { AssigneePicker } from './AssigneePicker';
import { useItemCommands, type ItemCommandScope } from './commands';
import { ItemDialogsHost } from './ItemDialogs';
import { ParentPicker } from './ParentPicker';
import { PropertyField, PropertyValueInput } from './PropertyField';
import { StatePicker } from './StatePicker';
import { TypePicker } from './TypePicker';

beforeEach(() => {
  resetApi();
  useUiStore.setState(useUiStore.getInitialState());
});

// the toast store is shared by all tests: close whatever a test left open
afterEach(() => {
  act(() => resetToasts());
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

describe('AssigneePicker', () => {
  it('offers the org admins besides the members, and the default bot only where it is a member', async () => {
    const user = userEvent.setup();
    const db = getDb();
    // Mara is an org admin and here no member of APP; Automation, the default bot, is an org admin too
    db.project_members = db.project_members.filter((member) => !(member.project_id === 'p_app' && member.user_id === 'u_mara'));
    saveDb();
    renderWithData(<AssigneePicker item={await stored('APP-11')} />);

    await user.click(await picker(/^Assignee/));
    const options = (await screen.findAllByRole('option')).map((option) => option.textContent ?? '');
    expect(options.some((text) => text.includes('Mara Lindqvist'))).toBe(true);
    expect(options.some((text) => text.includes('Automation'))).toBe(false);
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

  it('a rich text with a list is shown read-only, to be edited in the editor', async () => {
    const user = userEvent.setup();
    const item = await stored('WEB-47');
    const steps = (await listProperties()).items.find((property) => property.key === 'steps')!;
    renderWithData(<PropertyField item={item} property={steps} required={false} />);

    // the ordered list of the seed reads one line per step, and nothing can flatten it
    const area = await screen.findByRole<HTMLTextAreaElement>('textbox', { name: 'Schritte zum Nachstellen' });
    await waitFor(() => expect(screen.getByText('Im Editor bearbeiten')).toBeTruthy());
    expect(area.readOnly).toBe(true);
    expect(area.value.split('\n')).toEqual([
      'So lässt sich der Fehler nachstellen:',
      '',
      '1. Die Formularseite in Safari (iOS 18) öffnen.',
      '2. Alle Felder ausfüllen und auf „Absenden“ tippen.',
      '3. Im Postfach des Teams liegen zwei identische Mails.',
    ]);
    await user.type(area, 'mehr');
    await user.tab();
    expect((await stored('WEB-47')).values.steps).toEqual(item.values.steps);
  });

  it('a plain rich text edits as paragraphs: a blank line starts one, a single line break stays a hard break', async () => {
    const user = userEvent.setup();
    const item = await stored('APP-10');
    const steps = (await listProperties()).items.find((property) => property.key === 'steps')!;
    renderWithData(<PropertyField item={item} property={steps} required={false} />);

    const area = await screen.findByRole<HTMLTextAreaElement>('textbox', { name: 'Schritte zum Nachstellen' });
    await waitFor(() => expect(area.readOnly || area.disabled).toBe(false));
    await user.type(area, 'Erst das.{Enter}Und das.{Enter}{Enter}Dann das.');
    await user.tab();

    await waitFor(async () =>
      expect((await stored('APP-10')).values.steps).toEqual({
        type: 'doc',
        content: [
          { type: 'paragraph', content: [{ type: 'text', text: 'Erst das.' }, { type: 'hardBreak' }, { type: 'text', text: 'Und das.' }] },
          { type: 'paragraph', content: [{ type: 'text', text: 'Dann das.' }] },
        ],
      }),
    );
    // and it reads back as it was typed
    expect(area.value).toBe('Erst das.\nUnd das.\n\nDann das.');
  });
});

describe('PropertyValueInput numbers', () => {
  const number = (decimals: number): Property => ({
    id: `pr_test_${decimals}`,
    key: `test_${decimals}`,
    label: 'Anzahl',
    field_type: 'number',
    help: '',
    default_value: null,
    settings: { decimals },
    options: [],
  });

  function renderNumber(decimals: number, value: number) {
    const commits: PropertyValue[] = [];
    renderWithData(<PropertyValueInput property={number(decimals)} value={value} onChange={() => undefined} onCommit={(next) => commits.push(next)} projectId="p_web" />);
    return { commits, input: screen.getByRole<HTMLInputElement>('textbox', { name: 'Anzahl' }) };
  }

  it('edits 1500 without a thousands point and reads "1.500" as 1500, a point only as a thousands separator', async () => {
    const user = userEvent.setup();
    const { commits, input } = renderNumber(0, 1500);
    expect(input.value).toBe('1500');

    // a digit added to the shown value
    await user.type(input, '0{Enter}');
    expect(commits).toEqual([15000]);
    expect(input.value).toBe('15000');

    await user.clear(input);
    await user.type(input, '1.500{Enter}');
    expect(commits).toEqual([15000, 1500]);
    expect(input.value).toBe('1500');

    // "1.5" is no thousands group: refused with the fix, nothing saved
    await user.clear(input);
    await user.type(input, '1.5{Enter}');
    expect(screen.getByText(/Der Punkt trennt nur Tausender/)).toBeTruthy();
    expect(commits).toEqual([15000, 1500]);
  });

  it('refuses "0.500": a thousands group never starts with 0', async () => {
    const user = userEvent.setup();
    const { commits, input } = renderNumber(0, 1500);

    await user.clear(input);
    await user.type(input, '0.500{Enter}');
    expect(screen.getByText(/Der Punkt trennt nur Tausender/)).toBeTruthy();
    expect(commits).toEqual([]);

    // a plain 0 and a group after a real leading digit stay numbers
    await user.clear(input);
    await user.type(input, '0{Enter}');
    await user.clear(input);
    await user.type(input, '10.500{Enter}');
    expect(commits).toEqual([0, 10500]);
  });

  it('reads "1.234,5" with one decimal as 1234,5 and edits it without the point', async () => {
    const user = userEvent.setup();
    const { commits, input } = renderNumber(1, 1234.5);
    expect(input.value).toBe('1234,5');

    await user.clear(input);
    await user.type(input, '1.234,5{Enter}');
    expect(commits).toEqual([1234.5]);
    expect(input.value).toBe('1234,5');
  });
});

describe('ParentPicker', () => {
  it('offers the epics of the project only, and "Kein Eltern-Item" once the item has a parent', async () => {
    const user = userEvent.setup();
    // WEB-48 is a task under WEB-30, the one epic of WEB
    renderWithData(<ParentPicker item={await stored('WEB-48')} />);

    await user.click(await picker(/^Eltern-Item/));

    const options = await screen.findAllByRole('option');
    expect(options.map((option) => option.textContent)).toEqual(['Kein Eltern-Item', 'Relaunch Phase 1WEB-30']);
  });

  it('says so when the project has no epic yet', async () => {
    const user = userEvent.setup();
    const project = await createProject({ name: 'Newsletter', identifier: 'news' });
    const item = await createWorkItem({ project_id: project.id, type_id: 't_task', title: 'Erste Ausgabe planen' });
    renderWithData(<ParentPicker item={item} />);

    await user.click(await picker(/^Eltern-Item/));

    expect(await screen.findByText('Im Projekt gibt es noch kein Epic.')).toBeTruthy();
    expect(screen.queryAllByRole('option')).toHaveLength(0);
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

  it('keeps an epic with children an epic: the dialog says why and offers only "Typ behalten"', async () => {
    const user = userEvent.setup();
    renderWithData(<TypePicker item={await stored('WEB-30')} />);

    await user.click(await picker(/^Typ/));
    await user.click(await screen.findByRole('option', { name: 'Task' }));

    const dialog = await screen.findByRole('dialog', { name: 'Typ von WEB-30 auf Task ändern' });
    expect(within(dialog).getByText('WEB-30 hat Kind-Items. Nur Epics können Kind-Items haben.')).toBeTruthy();
    expect(within(dialog).queryByRole('button', { name: /Zu Task wechseln/ })).toBeNull();
    await user.click(within(dialog).getByRole('button', { name: /^Typ behalten/ }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect((await stored('WEB-30')).type_id).toBe('t_epic');
  });

  it('makes no epic of an item with a parent: the dialog says why', async () => {
    const user = userEvent.setup();
    // WEB-48 hangs under WEB-30
    renderWithData(<TypePicker item={await stored('WEB-48')} />);

    await user.click(await picker(/^Typ/));
    await user.click(await screen.findByRole('option', { name: 'Epic' }));

    const dialog = await screen.findByRole('dialog', { name: 'Typ von WEB-48 auf Epic ändern' });
    expect(within(dialog).getByText('WEB-48 hat ein Eltern-Item. Epics haben kein Eltern-Item.')).toBeTruthy();
    expect(within(dialog).queryByRole('button', { name: /Zu Epic wechseln/ })).toBeNull();
    expect((await stored('WEB-48')).type_id).toBe('t_task');
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

  it('a delete that fails brings its row back and "Erneut versuchen" deletes it then', async () => {
    function WebKeys() {
      const items = useWorkItems({ filter: { version: 1, conditions: [{ field: 'project', op: 'is', value: 'p_web' }] } }).data?.items;
      return <ul aria-label="WEB">{items?.map((item) => <li key={item.id}>{item.key}</li>)}</ul>;
    }
    renderWithData(
      <>
        <Screen scope="list" cursor="wi_web_50" />
        <WebKeys />
      </>,
    );
    const list = await screen.findByRole('list', { name: 'WEB' });
    await waitFor(() => expect(within(list).getByText('WEB-50')).toBeTruthy());
    await waitFor(() => expect(listCommands().find((command) => command.id === 'item.delete')?.when?.()).toBe(true));

    // WEB-50 is open: mod+backspace deletes it, the row goes at once
    localStorage.setItem('api:fail', '1');
    act(() => {
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', ctrlKey: true, bubbles: true, cancelable: true }));
    });
    await waitFor(() => expect(within(list).queryByText('WEB-50')).toBeNull());

    // the undo time is up, the server fails: the row is back, the toast offers to try again
    act(() => dismissToast(currentToasts().find((entry) => entry.title === 'WEB-50 gelöscht')!.id));
    expect(await within(list).findByText('WEB-50')).toBeTruthy();
    const failed = await waitFor(() => {
      const entry = currentToasts().find((toastEntry) => toastEntry.title === 'WEB-50 nicht gelöscht');
      expect(entry?.action?.label).toBe('Erneut versuchen');
      return entry!;
    });

    localStorage.removeItem('api:fail');
    act(() => failed.action!.onClick());
    await waitFor(() => expect(within(list).queryByText('WEB-50')).toBeNull());
    await expect(getWorkItem('WEB-50')).rejects.toMatchObject({ status: 404 });
  });

  it('in the preview the keys act on the item it shows, outside it on the selection', async () => {
    renderWithData(
      <MemoryRouter>
        <Screen scope="list" cursor="wi_web_42" />
        <PeekHost />
      </MemoryRouter>,
    );
    act(() => useUiStore.setState({ selection: ['wi_web_50'], peekItemId: 'wi_web_47' }));
    const panel = await screen.findByRole('complementary', { name: 'Vorschau' });
    // the preview mounts the commands itself (detail scope)
    await waitFor(() => expect(listShortcuts().find((shortcut) => shortcut.id === 'item.assign_me')?.scope).toBe('detail'));
    await waitFor(() => expect(listCommands().find((command) => command.id === 'item.assign_me')?.when?.()).toBe(true));
    const pressI = (target: Element) =>
      act(() => {
        target.dispatchEvent(new KeyboardEvent('keydown', { key: 'i', bubbles: true, cancelable: true }));
      });

    // focus inside the preview: WEB-47, which the preview shows, not the selected WEB-50
    act(() => panel.focus());
    pressI(panel);
    await waitFor(async () => expect((await stored('WEB-47')).assignee_id).toBe('u_mara'));
    expect((await stored('WEB-50')).assignee_id).toBeNull();

    // focus outside: the selection
    act(() => panel.blur());
    pressI(document.body);
    await waitFor(async () => expect((await stored('WEB-50')).assignee_id).toBe('u_mara'));
  });

  it('t on an epic with children opens the type dialog, which says why it stays an epic', async () => {
    const user = userEvent.setup();
    renderWithData(
      <MemoryRouter>
        <Screen scope="detail" cursor="wi_web_30" />
        <CommandPalette />
        <ItemDialogsHost />
      </MemoryRouter>,
    );
    await waitFor(() => expect(listCommands().find((command) => command.id === 'item.type')?.group).toBe('Aktionen für WEB-30'));
    // the children are known once the items of the project have loaded
    await waitFor(() => expect(listCommands().find((command) => command.id === 'item.parent')?.subpage).toBeDefined());
    await ready();
    act(() => {
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 't', bubbles: true, cancelable: true }));
    });
    const list = await screen.findByRole('listbox', { name: 'Typ ändern …' });
    await user.click(within(list).getByRole('option', { name: 'Task' }));

    const dialog = await screen.findByRole('dialog', { name: 'Typ von WEB-30 auf Task ändern' });
    expect(within(dialog).getByText('WEB-30 hat Kind-Items. Nur Epics können Kind-Items haben.')).toBeTruthy();
    expect((await stored('WEB-30')).type_id).toBe('t_epic');
    // the question host lives as long as the module: it is closed, so the next test starts without it
    await user.click(within(dialog).getByRole('button', { name: /^Typ behalten/ }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
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
