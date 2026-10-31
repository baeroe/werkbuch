/*
 * The item commands against a fake REST API (`mockApi`), from the clickdummy's `commands.test.tsx`: which item a
 * shortcut acts on (the page's, the preview's), what the palette offers, what each choice sends, why a key does nothing,
 * archiving and deleting with undo, and that the page and the preview register the keys once.
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useRef, useState, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { currentToasts, dismissToast, resetToasts, runToastAction } from '@/components/ui/toast';
import { cachedZone } from '@/domain/tz';
import { CommandPalette } from '@/features/palette/CommandPalette';
import { listCommands } from '@/lib/commands';
import { helpGroups } from '@/lib/shortcuts/HelpOverlay';
import { listShortcuts } from '@/lib/shortcuts/registry';
import { useUiStore } from '@/store/ui';
import { mockApi, type MockApi, type MockRoute } from '@/test/api';
import { ida, labels, lene, list, makeWorkItem, mara, organization, project, properties, resolutions, standard, types, web30, web47, web48 } from '@/test/fixtures';
import type { Project, ProjectMember, User, WorkItem } from '@/types';
import { addDays, formatDay, formatWeekdayDay } from '../format';
import { ItemDialogsHost } from '../ItemDialogs';
// the questions load lazily; loaded with the file, so the first question does not wait for the editor's modules
import '../ResolutionPrompt';
import '../TypePicker';
import { useProjectItems } from '../ParentPicker';
import { datePresets, PreviewItemCommands, useItemCommands } from './index';

let signedIn: User = lene;

vi.mock('@inertiajs/react', () => ({
  usePage: () => ({ props: { auth: { user: signedIn, permissions: [] }, organization }, url: '/items/WEB-47' }),
}));

/* -------------------------------------------------------------------------- data */

/** WEB-50: a done task (closed), so mod+backspace archives it. */
const web50 = makeWorkItem({ id: 'wi_web_50', number: 50, key: 'WEB-50', title: 'Impressum aktualisieren', state_id: 'std_done', resolution_id: 'res_done', rank: 'a6' });
const member = (user_id: string, role: ProjectMember['role'] = 'member'): ProjectMember => ({ project_id: 'p_web', user_id, role });
const members = [member('u_ida', 'admin'), member('u_lene')];
const items = [web30, web47, web48, web50];

const detail = (item: WorkItem) => ({
  body: { data: { ...item, children: items.filter((entry) => entry.parent_id === item.id), relations: [], type: types.find((type) => type.id === item.type_id), workflow: standard } },
});
const problem = (status: number, reason: string, detail: string) => ({ status, body: { type: 'about:blank', title: reason, status, reason, detail } });

/* ------------------------------------------------------------------------ render */

let api: MockApi | undefined;

function renderWith(
  node: ReactNode,
  { routes = {}, role = 'member', hold }: { routes?: Record<string, MockRoute>; role?: Project['my_role']; hold?: { path: string; until: Promise<void> } } = {},
) {
  api = mockApi({
    'GET /api/v1/projects': () => ({ body: list([project('WEB', role)]) }),
    'GET /api/v1/workflows': () => ({ body: list([standard]) }),
    'GET /api/v1/resolutions': () => ({ body: list(resolutions) }),
    'GET /api/v1/users': () => ({ body: list([mara, ida, lene]) }),
    'GET /api/v1/projects/p_web/members': () => ({ body: list(members) }),
    'GET /api/v1/labels': () => ({ body: list(labels) }),
    'GET /api/v1/work-item-types': () => ({ body: list(types) }),
    'GET /api/v1/properties': () => ({ body: list(properties) }),
    'GET /api/v1/work-items': () => ({ body: list(items) }),
    ...Object.fromEntries(items.map((item) => [`GET /api/v1/work-items/${item.id}`, () => detail(item)])),
    ...Object.fromEntries(items.map((item) => [`PATCH /api/v1/work-items/${item.id}`, (body: unknown) => ({ body: { data: { ...item, ...(body as object) } } })])),
    ...routes,
  });
  if (hold) {
    const answering = globalThis.fetch;
    globalThis.fetch = async (input, init) => {
      if (String(input).includes(hold.path)) await hold.until;
      return answering(input, init);
    };
  }
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      {node}
      <CommandPalette />
      <ItemDialogsHost />
    </QueryClientProvider>,
  );
}

/** The item page: its commands, and a button that has the focus before the palette opens. */
function ItemPage({ id }: { id: string }) {
  useItemCommands({ scope: 'detail', itemId: id });
  return <button type="button">Auf der Seite</button>;
}

/** The preview panel of `peekItemId`. */
function Preview() {
  const panel = useRef<HTMLElement>(null);
  return (
    <aside ref={panel} tabIndex={-1} aria-label="Vorschau">
      <PreviewItemCommands panel={panel} />
      <button type="button">In der Vorschau</button>
    </aside>
  );
}

/** The keys of the items of WEB as the list in the cache has them: archiving and deleting take them out at once. */
function WebList() {
  const keys = useProjectItems('p_web').data?.items.map((item) => item.key);
  return <p aria-label="WEB">{keys?.join(' ')}</p>;
}

const press = (key: string, init: KeyboardEventInit = {}, on: Element = document.body) =>
  act(() => {
    on.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }));
  });
const command = (id: string) => listCommands().find((entry) => entry.id === id);
/** Waits until the item commands are there for `key` and the command can act. */
async function ready(key: string, id = 'item.state') {
  await waitFor(() => expect(command(id)?.group).toBe(`Aktionen für ${key}`));
  await waitFor(() => expect(command(id)?.when?.()).toBe(true));
}
const lastToast = () => currentToasts().at(-1);
const sent = (method: string, path: string) => api!.calls.filter((call) => call.method === method && call.url === path).map((call) => call.body);
/** The options of a sub-list, by label. */
const optionsOf = (id: string) => command(id)!.subpage!().options;
const choose = (id: string, label: string) => act(() => optionsOf(id).find((option) => option.label === label)!.run());

beforeEach(() => {
  useUiStore.setState(useUiStore.getInitialState());
});

afterEach(() => {
  api?.restore();
  api = undefined;
  signedIn = lene;
  vi.useRealTimers();
  act(() => resetToasts());
});

/* ----------------------------------------------------------------------- targets */

describe('item commands', () => {
  it('acts on the item of the page', async () => {
    const user = userEvent.setup();
    renderWith(<ItemPage id="wi_web_47" />);
    await ready('WEB-47', 'item.priority');

    press('p');
    const input = await screen.findByRole('combobox', { name: 'Priorität ändern …' });
    expect(input.getAttribute('placeholder')).toBe('Priorität wählen …');
    expect(screen.getAllByRole('option').map((option) => option.querySelector('.flex-1')!.textContent)).toEqual(['Urgent', 'High', 'Medium', 'Low', 'None']);
    await waitFor(() => expect(document.activeElement).toBe(input));
    await user.keyboard('high{Enter}');

    await waitFor(() => expect(sent('PATCH', '/api/v1/work-items/wi_web_47')).toEqual([{ priority: 'high' }]));
    await waitFor(() => expect(lastToast()).toMatchObject({ title: 'WEB-47: Priorität High', tone: 'success' }));
  });

  it('acts on the previewed item while the focus is in the preview', async () => {
    renderWith(
      <>
        <ItemPage id="wi_web_47" />
        <Preview />
      </>,
    );
    act(() => useUiStore.getState().openPeek('wi_web_48'));
    // the focus is outside the preview: the page's item
    await ready('WEB-47', 'item.labels');

    const panel = screen.getByRole('complementary', { name: 'Vorschau' });
    act(() => panel.focus());
    await ready('WEB-48', 'item.labels');
    press('l', {}, panel);

    await screen.findByRole('combobox', { name: 'Labels ändern …' });
    // the palette holds the focus now, and still acts on the previewed item
    expect(command('item.labels')?.group).toBe('Aktionen für WEB-48');
    expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual(['Formulare', 'Performance', 'Produktion', 'UX']);
    fireEvent.click(screen.getByRole('option', { name: 'UX' }));
    await waitFor(() => expect(sent('PATCH', '/api/v1/work-items/wi_web_48')).toEqual([{ label_ids: ['lb_ux'] }]));
    await waitFor(() => expect(lastToast()?.title).toBe('WEB-48: Label UX gesetzt'));

    // the focus left the preview: the page's item again
    act(() => screen.getByRole('button', { name: 'Auf der Seite' }).focus());
    await ready('WEB-47', 'item.labels');
  });

  it('acts on the previewed item when no item page is mounted, and on nothing without one', async () => {
    renderWith(<Preview />);
    await waitFor(() => expect(command('item.state')?.group).toBe('Aktionen für das Item'));
    expect(command('item.state')?.when?.()).toBe(false);
    // no target: the keys stay out of the way
    press('s');
    expect(useUiStore.getState().paletteOpen).toBe(false);

    act(() => useUiStore.getState().openPeek('wi_web_48'));
    await ready('WEB-48');
  });

  it('says why a key does nothing without the right', async () => {
    renderWith(<ItemPage id="wi_web_47" />, { role: 'viewer' });
    await waitFor(() => expect(command('item.state')?.group).toBe('Aktionen für WEB-47'));
    await waitFor(() => expect(command('item.state')?.when?.()).toBe(false));

    press('s');
    await waitFor(() => expect(lastToast()).toMatchObject({ title: 'Nicht möglich', description: 'Im Projekt WEB darfst du nur lesen. Items ändern dürfen Member und Admins.', tone: 'error' }));
    expect(useUiStore.getState().paletteOpen).toBe(false);
    // the palette leaves out what the person may not do
    for (const id of ['item.state', 'item.assignee', 'item.assign_me', 'item.archive', 'item.delete']) expect(command(id)?.when?.()).toBe(false);
  });

  it('says that an archived item is read-only, and that only project admins delete', async () => {
    const archived = { ...web50, archived_at: '2026-10-30T10:00:00.000Z' };
    renderWith(<ItemPage id="wi_web_50" />, { routes: { 'GET /api/v1/work-items/wi_web_50': () => detail(archived) } });
    await waitFor(() => expect(command('item.state')?.group).toBe('Aktionen für WEB-50'));
    await waitFor(() => expect(command('item.delete')).toBeDefined());

    press('p');
    await waitFor(() => expect(lastToast()?.description).toBe('WEB-50 ist archiviert und schreibgeschützt. Stelle es zuerst wieder her.'));
    // an archived item deletes rather than archives: a member may not
    press('Backspace', { ctrlKey: true });
    expect(lastToast()?.description).toBe('Items löschen dürfen nur Admins des Projekts WEB.');
  });

  it('waits for the catalogs instead of acting', async () => {
    let answer!: () => void;
    const held = new Promise<void>((resolve) => (answer = resolve));
    renderWith(<ItemPage id="wi_web_47" />, { hold: { path: '/labels', until: held } });
    await waitFor(() => expect(command('item.state')?.group).toBe('Aktionen für WEB-47'));

    press('s');
    expect(lastToast()).toMatchObject({ title: 'Einen Moment', description: 'Die Daten dafür werden noch geladen. Versuch es gleich noch einmal.' });
    press('Backspace', { ctrlKey: true });
    expect(currentToasts().filter((toast) => toast.title === 'Einen Moment')).toHaveLength(2);
    expect(useUiStore.getState().paletteOpen).toBe(false);

    act(() => answer());
    await ready('WEB-47');
  });

  it('offers a retry when they failed', async () => {
    let failing = true;
    renderWith(<ItemPage id="wi_web_47" />, {
      routes: { 'GET /api/v1/labels': () => (failing ? problem(503, 'service_unavailable', 'Wartung.') : { body: list(labels) }) },
    });
    await waitFor(() => expect(command('item.state')?.group).toBe('Aktionen für WEB-47'));

    await waitFor(() => {
      press('s');
      expect(lastToast()).toMatchObject({ title: 'Daten nicht geladen', description: 'Die Daten dafür ließen sich nicht laden.', tone: 'error' });
    });
    press('Backspace', { ctrlKey: true });
    expect(lastToast()?.title).toBe('Daten nicht geladen');
    expect(lastToast()?.action?.label).toBe('Erneut versuchen');

    failing = false;
    act(() => runToastAction(lastToast()!.id));
    await ready('WEB-47');
  });

  it('waits for the people and the items of the project where a command needs them, and loads them again', async () => {
    let failing = true;
    renderWith(<ItemPage id="wi_web_47" />, {
      routes: {
        'GET /api/v1/projects/p_web/members': () => (failing ? problem(503, 'service_unavailable', 'Wartung.') : { body: list(members) }),
        'GET /api/v1/work-items': () => (failing ? problem(503, 'service_unavailable', 'Wartung.') : { body: list(items) }),
      },
    });
    await ready('WEB-47');
    // status needs neither: it is there; the assignee and the parent wait for what failed
    await waitFor(() => {
      press('a');
      expect(lastToast()).toMatchObject({ title: 'Daten nicht geladen' });
    });
    press('P', { shiftKey: true });
    expect(lastToast()?.title).toBe('Daten nicht geladen');
    expect(command('item.assignee')?.when?.()).toBe(false);
    expect(command('item.parent')?.when?.()).toBe(false);

    failing = false;
    act(() => runToastAction(lastToast()!.id));
    await waitFor(() => expect(command('item.assignee')?.when?.()).toBe(true));
    await waitFor(() => expect(command('item.parent')?.when?.()).toBe(true));
  });

  it('assigns me with i at once, and says so when I am no member of the project', async () => {
    renderWith(<ItemPage id="wi_web_47" />);
    await ready('WEB-47', 'item.assign_me');

    press('i');
    await waitFor(() => expect(sent('PATCH', '/api/v1/work-items/wi_web_47')).toEqual([{ assignee_id: 'u_lene' }]));
    await waitFor(() => expect(lastToast()?.title).toBe('WEB-47: zugewiesen an Lene Vogt'));
  });

  it('says that I am no member of the project instead of assigning me', async () => {
    signedIn = { ...lene, id: 'u_guest', name: 'Gast' };
    renderWith(<ItemPage id="wi_web_47" />);
    await ready('WEB-47', 'item.assignee');

    press('i');
    expect(lastToast()).toMatchObject({ title: 'Nicht möglich', description: 'Du bist nicht Mitglied des Projekts.' });
    expect(command('item.assign_me')?.when?.()).toBe(false);
    // the list offers the people without me
    expect(optionsOf('item.assignee').map((option) => option.label)).toEqual(['Nicht zugewiesen', 'Ida Brenner', 'Lene Vogt', 'Mara Lindqvist']);
  });

  it('archives a closed item and deletes an open one with undo', async () => {
    renderWith(
      <>
        <ItemPage id="wi_web_50" />
        <WebList />
      </>,
      {
        role: 'admin',
        routes: {
          'POST /api/v1/work-items/wi_web_50/archive': () => ({ body: { data: { ...web50, archived_at: '2026-10-31T10:00:00.000Z' } } }),
          'DELETE /api/v1/work-items/wi_web_50': () => ({ status: 204 }),
        },
      },
    );
    const list = screen.getByLabelText('WEB');
    await waitFor(() => expect(list.textContent).toBe('WEB-30 WEB-47 WEB-48 WEB-50'));
    await ready('WEB-50', 'item.archive');
    // the palette shows the key on what it does: archive
    expect(command('item.archive')?.keys).toBe('mod+backspace');
    expect(command('item.delete')?.keys).toBeUndefined();

    // undo brings it back and calls nothing
    press('Backspace', { ctrlKey: true });
    expect(lastToast()).toMatchObject({ title: 'WEB-50 archiviert', action: { label: 'Rückgängig' } });
    await waitFor(() => expect(list.textContent).toBe('WEB-30 WEB-47 WEB-48'));
    act(() => runToastAction(lastToast()!.id));
    await waitFor(() => expect(list.textContent).toBe('WEB-30 WEB-47 WEB-48 WEB-50'));
    expect(sent('POST', '/api/v1/work-items/wi_web_50/archive')).toEqual([]);

    // from the palette as well; after 5 s it archives
    vi.useFakeTimers({ shouldAdvanceTime: true });
    act(() => command('item.archive')!.run());
    await act(() => vi.advanceTimersByTimeAsync(4900));
    expect(sent('POST', '/api/v1/work-items/wi_web_50/archive')).toEqual([]);
    await act(() => vi.advanceTimersByTimeAsync(100));
    expect(sent('POST', '/api/v1/work-items/wi_web_50/archive')).toHaveLength(1);
    vi.useRealTimers();

    // the palette deletes it (any item, as a project admin): after 5 s
    act(() => resetToasts());
    vi.useFakeTimers({ shouldAdvanceTime: true });
    act(() => command('item.delete')!.run());
    expect(lastToast()?.title).toBe('WEB-50 gelöscht');
    await act(() => vi.advanceTimersByTimeAsync(5000));
    expect(sent('DELETE', '/api/v1/work-items/wi_web_50')).toHaveLength(1);
  });

  it('deletes an open item with mod+backspace, puts it back in its place when that fails, and tries again', async () => {
    let failing = true;
    renderWith(
      <>
        <ItemPage id="wi_web_47" />
        <WebList />
      </>,
      { role: 'admin', routes: { 'DELETE /api/v1/work-items/wi_web_47': () => (failing ? problem(503, 'service_unavailable', 'Wartung.') : { status: 204 }) } },
    );
    act(() => useUiStore.getState().openPeek('wi_web_47'));
    const list = screen.getByLabelText('WEB');
    await waitFor(() => expect(list.textContent).toBe('WEB-30 WEB-47 WEB-48 WEB-50'));
    await ready('WEB-47', 'item.delete');
    expect(command('item.delete')?.keys).toBe('mod+backspace');
    expect(command('item.archive')?.when?.()).toBe(false);

    press('Backspace', { ctrlKey: true });
    // out of the list and out of the preview at once
    await waitFor(() => expect(list.textContent).toBe('WEB-30 WEB-48 WEB-50'));
    expect(useUiStore.getState().peekItemId).toBeNull();

    // the toast ran out (closing it does that at once); the server failed: back in its place, with a retry
    act(() => dismissToast(currentToasts().find((toast) => toast.title === 'WEB-47 gelöscht')!.id));
    await waitFor(() => expect(sent('DELETE', '/api/v1/work-items/wi_web_47')).toHaveLength(1));
    await waitFor(() => expect(list.textContent).toBe('WEB-30 WEB-47 WEB-48 WEB-50'));
    await waitFor(() => expect(lastToast()).toMatchObject({ title: 'WEB-47 nicht gelöscht', description: 'Wartung.', action: { label: 'Erneut versuchen' } }));

    failing = false;
    act(() => runToastAction(lastToast()!.id));
    await waitFor(() => expect(sent('DELETE', '/api/v1/work-items/wi_web_47')).toHaveLength(2));
  });

  it('registers once when the item page and the preview are mounted', async () => {
    function Both() {
      const [preview, setPreview] = useState(true);
      return (
        <>
          <ItemPage id="wi_web_47" />
          {preview && <Preview />}
          <button type="button" onClick={() => setPreview(false)}>
            Vorschau schließen
          </button>
        </>
      );
    }
    renderWith(<Both />);
    await ready('WEB-47');

    const itemKeys = () => helpGroups(listShortcuts()).find((group) => group.group === 'shortcuts.group.item')!.entries.map((entry) => entry.keys);
    // one entry per key in the help
    expect(itemKeys()).toEqual(['s', 'a', 'i', 'p', 'l', 't', 'd', 'shift+d', 'shift+p', 'mod+backspace']);
    expect(listCommands().filter((entry) => entry.id === 'item.state')).toHaveLength(1);

    // the preview goes: the page takes over
    fireEvent.click(screen.getByRole('button', { name: 'Vorschau schließen' }));
    await ready('WEB-47');
    expect(itemKeys()).toHaveLength(10);
  });
});

/* -------------------------------------------------------------------------- sub-lists */

describe('the sub-lists of the item commands', () => {
  const today = cachedZone(organization.timezone).date(new Date());
  const transition = (id: string) => ({ [`POST /api/v1/work-items/${id}/transition`]: (body: unknown) => ({ body: { data: { ...web47, ...(body as object) } } }) });

  it('moves into an open state at once and asks for the resolution of a closed one, then gives the focus back', async () => {
    const user = userEvent.setup();
    renderWith(<ItemPage id="wi_web_47" />, { routes: transition('wi_web_47') });
    await ready('WEB-47');
    expect(optionsOf('item.state').map((option) => option.label)).toEqual(['Backlog', 'Todo', 'Pending', 'Done', 'Cancelled']);

    choose('item.state', 'Todo');
    await waitFor(() => expect(sent('POST', '/api/v1/work-items/wi_web_47/transition')).toEqual([{ to_state_id: 'std_todo', resolution_id: null }]));
    await waitFor(() => expect(lastToast()?.title).toBe('WEB-47: Status Todo'));

    // through the palette, from a button on the page: the question comes after the palette closed, and the focus goes back
    const trigger = screen.getByRole('button', { name: 'Auf der Seite' });
    act(() => trigger.focus());
    press('s', {}, trigger);
    const input = await screen.findByRole('combobox', { name: 'Status ändern …' });
    await waitFor(() => expect(document.activeElement).toBe(input));
    await user.keyboard('done{Enter}');
    const dialog = await screen.findByRole('dialog', { name: 'WEB-47 auf Done setzen' });
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));
    await user.keyboard('{Enter}');

    await waitFor(() => expect(sent('POST', '/api/v1/work-items/wi_web_47/transition')).toHaveLength(2));
    expect(sent('POST', '/api/v1/work-items/wi_web_47/transition')[1]).toEqual({ to_state_id: 'std_done', resolution_id: 'res_done' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });

  it('gives the focus to the main area after a question when nothing on the page had it', async () => {
    const user = userEvent.setup();
    renderWith(
      <main id="main" tabIndex={-1}>
        <ItemPage id="wi_web_47" />
      </main>,
    );
    await ready('WEB-47', 'item.type');

    // Bug → Task: the environment goes, so the type dialog asks
    press('t');
    const input = await screen.findByRole('combobox', { name: 'Typ ändern …' });
    expect(optionsOf('item.type').map((option) => option.label)).toEqual(['Task', 'Epic']);
    await waitFor(() => expect(document.activeElement).toBe(input));
    await user.keyboard('task{Enter}');
    const dialog = await screen.findByRole('dialog', { name: 'Typ von WEB-47 auf Task ändern' });
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));
    await user.keyboard('{Escape}');

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    // Base UI hands it on to the first element there that takes the focus
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Auf der Seite' })));
  });

  it('says when the workflow leads nowhere from the state', async () => {
    renderWith(<ItemPage id="wi_web_47" />, { routes: { 'GET /api/v1/workflows': () => ({ body: list([{ ...standard, is_free: false, transitions: [] }]) }) } });
    await ready('WEB-47');

    expect(optionsOf('item.state')).toEqual([]);
    expect(command('item.state')!.subpage!().emptyText).toBe('Von „In Progress“ führt im Workflow „Standard“ kein Übergang weiter.');
  });

  it('assigns a person of the project, me or nobody', async () => {
    renderWith(<ItemPage id="wi_web_47" />);
    await ready('WEB-47', 'item.assignee');

    expect(optionsOf('item.assignee').map((option) => option.label)).toEqual(['Mir zuweisen', 'Nicht zugewiesen', 'Ida Brenner', 'Lene Vogt', 'Mara Lindqvist']);
    choose('item.assignee', 'Ida Brenner');
    await waitFor(() => expect(lastToast()?.title).toBe('WEB-47: zugewiesen an Ida Brenner'));
    choose('item.assignee', 'Nicht zugewiesen');
    await waitFor(() => expect(lastToast()?.title).toBe('WEB-47: nicht mehr zugewiesen'));
    choose('item.assignee', 'Mir zuweisen');
    act(() => command('item.assign_me')!.run());
    await waitFor(() =>
      expect(sent('PATCH', '/api/v1/work-items/wi_web_47')).toEqual([{ assignee_id: 'u_ida' }, { assignee_id: null }, { assignee_id: 'u_lene' }, { assignee_id: 'u_lene' }]),
    );
  });

  it('takes a label off that the item has', async () => {
    renderWith(<ItemPage id="wi_web_47" />);
    await ready('WEB-47', 'item.labels');

    expect(optionsOf('item.labels').map((option) => [option.label, option.hint])).toEqual([
      ['Formulare', 'gesetzt'],
      ['Performance', undefined],
      ['Produktion', 'gesetzt'],
      ['UX', undefined],
    ]);
    choose('item.labels', 'Formulare');
    await waitFor(() => expect(sent('PATCH', '/api/v1/work-items/wi_web_47')).toEqual([{ label_ids: ['lb_production'] }]));
    await waitFor(() => expect(lastToast()?.title).toBe('WEB-47: Label Formulare entfernt'));
  });

  it('changes a type at once when nothing is lost, and says so when that fails', async () => {
    let failing = false;
    renderWith(<ItemPage id="wi_web_50" />, {
      routes: {
        'PUT /api/v1/work-items/wi_web_50/type': () => (failing ? problem(422, 'invalid', 'Der Typ passt nicht.') : { body: { data: { ...web50, type_id: 't_epic' } } }),
      },
    });
    await ready('WEB-50', 'item.type');

    choose('item.type', 'Epic');
    await waitFor(() => expect(sent('PUT', '/api/v1/work-items/wi_web_50/type')).toEqual([{ type_id: 't_epic', values: {} }]));
    await waitFor(() => expect(lastToast()?.title).toBe('WEB-50 hat jetzt den Typ Epic'));

    failing = true;
    choose('item.type', 'Epic');
    await waitFor(() => expect(lastToast()).toMatchObject({ title: 'Typ nicht geändert', description: 'Der Typ passt nicht.' }));
    expect(command('item.type')!.subpage!().emptyText).toBe('Das Projekt hat keinen anderen Typ.');
  });

  it('refuses a type that breaks the two levels in the dialog', async () => {
    renderWith(<ItemPage id="wi_web_30" />);
    await ready('WEB-30', 'item.type');

    // the epic has a child: as a task it would break the two levels
    choose('item.type', 'Task');
    expect(await screen.findByText('WEB-30 hat Kind-Items. Nur Epics können Kind-Items haben.')).toBeTruthy();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Typ behalten' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('offers the days from today, sets and removes a date, and refuses a start after the due date', async () => {
    const dated = { ...web50, start_date: addDays(today, 3), due_date: addDays(today, 10) };
    renderWith(<ItemPage id="wi_web_50" />, { routes: { 'GET /api/v1/work-items/wi_web_50': () => detail(dated) } });
    await ready('WEB-50', 'item.due');

    expect(optionsOf('item.due').map((option) => option.label)).toEqual([
      'Heute',
      'Morgen',
      'Ende der Woche',
      'Nächster Montag',
      'In einer Woche',
      'In zwei Wochen',
      'Ende des Monats',
      'Due-Date entfernen',
    ]);
    expect(optionsOf('item.due')[1]).toMatchObject({ hint: formatWeekdayDay(addDays(today, 1)), keywords: [formatDay(addDays(today, 1))] });

    // a due date before the start, a start after the due date: refused with the fix
    choose('item.due', 'Heute');
    expect(lastToast()).toMatchObject({ title: 'Due-Date nicht gesetzt', description: `Das Due-Date läge vor dem Start (${formatDay(dated.start_date)}). Verschiebe zuerst den Start.` });
    choose('item.start', 'In zwei Wochen');
    expect(lastToast()).toMatchObject({ title: 'Start-Date nicht gesetzt', description: `Der Start läge nach dem Due-Date (${formatDay(dated.due_date)}). Verschiebe zuerst das Due-Date.` });
    expect(sent('PATCH', '/api/v1/work-items/wi_web_50')).toEqual([]);

    choose('item.due', 'In einer Woche');
    await waitFor(() => expect(lastToast()?.title).toBe(`WEB-50: Due-Date ${formatDay(addDays(today, 7))}`));
    choose('item.start', 'Start-Date entfernen');
    await waitFor(() => expect(lastToast()?.title).toBe('WEB-50: Start-Date entfernt'));
    expect(sent('PATCH', '/api/v1/work-items/wi_web_50')).toEqual([{ due_date: addDays(today, 7) }, { start_date: null }]);
  });

  it('counts the days of the presets from today', () => {
    // a Saturday at the end of the month
    expect(datePresets('2026-10-31').map((preset) => preset.date)).toEqual(['2026-10-31', '2026-11-01', '2026-11-06', '2026-11-02', '2026-11-07', '2026-11-14', '2026-10-31']);
    // a Monday: the next Monday is a week on, the end of the week this Friday
    expect(datePresets('2026-11-02').map((preset) => preset.date)).toEqual(['2026-11-02', '2026-11-03', '2026-11-06', '2026-11-09', '2026-11-09', '2026-11-16', '2026-11-30']);
  });

  it('offers the epics of the project as parent, or none, and says that an epic has no parent', async () => {
    renderWith(<ItemPage id="wi_web_48" />);
    await ready('WEB-48', 'item.parent');

    expect(optionsOf('item.parent').map((option) => [option.label, option.hint])).toEqual([
      ['Kein Eltern-Item', undefined],
      ['Relaunch Phase 1', 'WEB-30'],
    ]);
    expect(command('item.parent')!.subpage!()).toMatchObject({ placeholder: 'Key oder Titel suchen …', emptyText: 'Kein Epic im Projekt passt.' });
    choose('item.parent', 'Kein Eltern-Item');
    await waitFor(() => expect(lastToast()?.title).toBe('WEB-48: kein Eltern-Item mehr'));
    choose('item.parent', 'Relaunch Phase 1');
    await waitFor(() => expect(sent('PATCH', '/api/v1/work-items/wi_web_48')).toEqual([{ parent_id: null }, { parent_id: 'wi_web_30' }]));
    await waitFor(() => expect(lastToast()?.title).toBe('WEB-48: Eltern-Item WEB-30'));
  });

  it('says that an epic has no parent', async () => {
    renderWith(<ItemPage id="wi_web_30" />);
    await ready('WEB-30');
    await waitFor(() => expect(command('item.type')?.when?.()).toBe(true));

    press('P', { shiftKey: true });
    expect(lastToast()).toMatchObject({ title: 'Nicht möglich', description: 'Epics haben kein Eltern-Item.' });
    expect(command('item.parent')?.when?.()).toBe(false);
  });
});

