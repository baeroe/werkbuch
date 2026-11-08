/*
 * The item commands against a fake REST API (`mockApi`), from the clickdummy's `commands.test.tsx`: which item a
 * shortcut acts on (the page's, the preview's), what the palette offers, what each choice sends, why a key does nothing,
 * archiving and deleting with undo, and that the page and the preview register the keys once.
 */

import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useRef, useState, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest';
import type { Page } from '@/api/client';
import { currentToasts, dismissToast, resetToasts, runToastAction } from '@/components/ui/toast';
import { cachedZone } from '@/domain/tz';
import { CommandPalette } from '@/features/palette/CommandPalette';
import { listCommands } from '@/lib/commands';
import { helpGroups } from '@/lib/shortcuts/HelpOverlay';
import { listShortcuts } from '@/lib/shortcuts/registry';
import { qk } from '@/hooks/keys';
import { useWorkItems } from '@/hooks/workItems';
import { useUiStore } from '@/store/ui';
import { mockApi, type MockApi, type MockRoute } from '@/test/api';
import { agency, ida, labels, lene, list, makeWorkItem, mara, organization, project, properties, queryItems, resolutions, standard, types, web30, web47, web48 } from '@/test/fixtures';
import type { Project, ProjectMember, User, WorkItem } from '@/types';
import { addDays, formatDay, formatWeekdayDay } from '../format';
import { ItemDialogsHost } from '../ItemDialogs';
// the questions load lazily; loaded with the file, so the first question does not wait for the editor's modules
import '../ResolutionPrompt';
import '../TypePicker';
import { outrankPreview, previewKeysAct } from './context';
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
  body: { data: { ...item, children: items.filter((entry) => entry.parent_id === item.id), relations: [], type: types.find((type) => type.id === item.type_id), workflow: standard, attachments: [] } },
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
    'POST /api/v1/work-items/query': (body) => ({ body: list(queryItems(items, body)) }),
    ...Object.fromEntries(items.map((item) => [`GET /api/v1/work-items/${item.id}`, () => detail(item)])),
    ...Object.fromEntries(items.map((item) => [`PATCH /api/v1/work-items/${item.id}`, (body: unknown) => ({ body: { data: { ...item, ...(body as object) } } })])),
    // the activity reads an empty history: no error state with its own "Erneut versuchen" and alert in these screens
    ...Object.fromEntries(items.flatMap((item) => [item.id, item.key].map((ref) => [`GET /api/v1/work-items/${ref}/history`, () => ({ body: list([]) })]))),
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
  const keys = useWorkItems({ project_id: 'p_web' }).data?.items.map((item) => item.key);
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

  it('waits for the children of the item the command acts on, not of another detail', async () => {
    renderWith(
      <>
        <ItemPage id="wi_web_30" />
        <Preview />
      </>,
    );
    act(() => useUiStore.getState().openPeek('wi_web_48'));
    await ready('WEB-30', 'item.type');
    const panel = screen.getByRole('complementary', { name: 'Vorschau' });
    // both details are in the cache now
    act(() => panel.focus());
    await ready('WEB-48', 'item.type');
    act(() => screen.getByRole('button', { name: 'Auf der Seite' }).focus());
    await ready('WEB-30', 'item.type');

    // the focus moved, the commands have not rendered again: WEB-30 has children, WEB-48 is not known to have any
    panel.focus();
    expect(command('item.type')?.when?.()).toBe(false);
    await ready('WEB-48', 'item.type');
  });

  it('lets the preview keep its own keys by the same rules as the commands', async () => {
    const panel = { current: document.createElement('aside') };
    const inside = document.createElement('button');
    panel.current.append(inside);
    document.body.append(panel.current);
    onTestFinished(() => panel.current.remove());

    // nowhere in particular and nothing outranks the previewed item (rule 5)
    expect(previewKeysAct(panel)).toBe(true);
    // a selection outranks it (rule 3), but not the focus inside the panel (rule 1)
    act(() => useUiStore.getState().setSelection(['wi_web_48']));
    expect(previewKeysAct(panel)).toBe(false);
    inside.focus();
    expect(previewKeysAct(panel)).toBe(true);
    inside.blur();
    act(() => useUiStore.getState().setSelection([]));

    // a screen with a cursor of its own (the inbox) outranks it while it has one (T17-M2)
    let cursor = true;
    const stop = outrankPreview(() => cursor);
    expect(previewKeysAct(panel)).toBe(false);
    cursor = false;
    expect(previewKeysAct(panel)).toBe(true);
    stop();

    // an item page outranks it (rule 2)
    renderWith(<ItemPage id="wi_web_47" />);
    await ready('WEB-47');
    expect(previewKeysAct(panel)).toBe(false);
    inside.focus();
    expect(previewKeysAct(panel)).toBe(true);
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

  it('waits for the people where a command needs them, and loads the items of the project only with the palette', async () => {
    let failing = true;
    renderWith(<ItemPage id="wi_web_47" />, {
      routes: {
        'GET /api/v1/projects/p_web/members': () => (failing ? problem(503, 'service_unavailable', 'Wartung.') : { body: list(members) }),
        'POST /api/v1/work-items/query': (body) => (failing ? problem(503, 'service_unavailable', 'Wartung.') : { body: list(queryItems(items, body)) }),
      },
    });
    const projectLists = () => api!.calls.filter((call) => call.method === 'POST' && call.url === '/api/v1/work-items/query');
    await ready('WEB-47');
    // status needs neither: it is there; the assignee waits for what failed
    await waitFor(() => {
      press('a');
      expect(lastToast()).toMatchObject({ title: 'Daten nicht geladen' });
    });
    expect(command('item.assignee')?.when?.()).toBe(false);
    // the item page reads no list of the whole project (A153): ⇧P opens its sub-list, which loads it
    expect(projectLists()).toEqual([]);
    expect(command('item.parent')?.when?.()).toBe(true);
    press('P', { shiftKey: true });
    expect(useUiStore.getState()).toMatchObject({ paletteOpen: true, paletteCommandId: 'item.parent' });
    expect(command('item.parent')!.subpage!().emptyText).toBe('Die Epics des Projekts werden geladen …');
    await waitFor(() => expect(projectLists()).not.toEqual([]));
    await waitFor(() => expect(command('item.parent')!.subpage!().emptyText).toBe('Die Daten dafür ließen sich nicht laden.'));
    expect(command('item.parent')?.when?.()).toBe(false);

    // the toast of `a` tries what failed since as well
    failing = false;
    act(() => runToastAction(lastToast()!.id));
    await waitFor(() => expect(command('item.assignee')?.when?.()).toBe(true));
    await waitFor(() => expect(command('item.parent')?.when?.()).toBe(true));
    await waitFor(() => expect(optionsOf('item.parent').length).toBeGreaterThan(0));
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

  it('counts an archived child for the two levels: the detail names it, the list without archived ones does not', async () => {
    const archived = { ...web48, id: 'wi_web_49', key: 'WEB-49', parent_id: 'wi_web_30', archived_at: '2026-10-01T10:00:00Z' };
    const epic = { ...web30, id: 'wi_web_60', key: 'WEB-60' };
    renderWith(<ItemPage id="wi_web_60" />, {
      routes: {
        'GET /api/v1/work-items/wi_web_60': () => ({ body: { data: { ...epic, children: [{ ...archived, parent_id: epic.id }], relations: [], type: types.find((type) => type.id === epic.type_id), workflow: standard, attachments: [] } } }),
      },
    });
    await ready('WEB-60', 'item.type');

    choose('item.type', 'Task');
    expect(await screen.findByText('WEB-60 hat Kind-Items. Nur Epics können Kind-Items haben.')).toBeTruthy();
    expect(sent('PUT', '/api/v1/work-items/wi_web_60/type')).toEqual([]);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Typ behalten' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('offers the days from today, sets and removes a date, and refuses a start after the due date', async () => {
    // a fixed day: a run across midnight in the zone of the organisation would count from two days otherwise
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-04T10:00:00Z'));
    onTestFinished(() => {
      vi.useRealTimers();
    });
    const today = cachedZone(organization.timezone).date(new Date());
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
    // the epics come once the palette is open
    act(() => useUiStore.getState().openPalette('item.parent'));
    await waitFor(() => expect(optionsOf('item.parent')).toHaveLength(2));

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


/* ----------------------------------------------------------------------------- lists */

/** APP: a project with the agency workflow, and two of its items (APP-5 its epic). */
const appProject = project('APP', 'member', { workflow_id: 'wf_agency' });
const app5 = makeWorkItem({ id: 'wi_app_5', project_id: 'p_app', number: 5, key: 'APP-5', type_id: 't_epic', title: 'Kundenportal', state_id: 'app_progress', rank: 'b1' });
const app11 = makeWorkItem({ id: 'wi_app_11', project_id: 'p_app', number: 11, key: 'APP-11', title: 'Login-Maske', state_id: 'app_todo', rank: 'b2' });
const withApp = (role: Project['my_role'] = 'member'): Record<string, MockRoute> => ({
  'GET /api/v1/projects': () => ({ body: list([project('WEB', role), appProject]) }),
  'GET /api/v1/workflows': () => ({ body: list([standard, agency]) }),
  'GET /api/v1/projects/p_app/members': () => ({ body: list([{ ...member('u_lene'), project_id: 'p_app' }, { ...member('u_mara', 'admin'), project_id: 'p_app' }]) }),
  'POST /api/v1/work-items/query': (body) => ({ body: list(queryItems([...items, app5, app11], body)) }),
});

/** The cursor of the list, moved from the test as the list moves it (React state, nothing else renders). */
let moveCursor: (id: string | null) => void = () => {};

/** A list: its commands with the cursor as state, and a button inside it. */
function ListScreen({ cursor = null }: { cursor?: string | null }) {
  const [current, setCurrent] = useState<string | null>(cursor);
  moveCursor = setCurrent;
  useItemCommands({ scope: 'list', current: () => current });
  return <button type="button">In der Liste</button>;
}

/** The items of APP in the cache, as a list on screen has them. */
function AppList() {
  const keys = useWorkItems({ project_id: 'p_app' }).data?.items.map((item) => item.key);
  return <p aria-label="APP">{keys?.join(' ')}</p>;
}

const bulkCalls = () => sent('POST', '/api/v1/work-items/bulk');
const select = (...ids: string[]) => act(() => useUiStore.getState().setSelection(ids));

describe('the item commands of a list', () => {
  it('acts on the selection before the cursor', async () => {
    renderWith(
      <>
        <ListScreen cursor="wi_web_47" />
        <WebList />
      </>,
      { routes: { 'POST /api/v1/work-items/bulk': () => ({ body: { updated: ['wi_web_48', 'wi_web_50'], rejected: [] } }) } },
    );
    await waitFor(() => expect(screen.getByLabelText('WEB').textContent).toBe('WEB-30 WEB-47 WEB-48 WEB-50'));
    await ready('WEB-47', 'item.priority');

    select('wi_web_48', 'wi_web_50');
    await ready('2 Items', 'item.priority');
    press('p');
    expect(useUiStore.getState()).toMatchObject({ paletteOpen: true, paletteCommandId: 'item.priority' });
    choose('item.priority', 'High');

    await waitFor(() => expect(bulkCalls()).toEqual([{ ids: ['wi_web_48', 'wi_web_50'], patch: { priority: 'high' } }]));
    await waitFor(() => expect(lastToast()).toMatchObject({ title: '2 Items: Priorität High', tone: 'success' }));
    expect(sent('PATCH', '/api/v1/work-items/wi_web_47')).toEqual([]);
  });

  it('acts on the cursor without a selection, from the list without loading its detail', async () => {
    renderWith(
      <>
        <ListScreen cursor="wi_web_47" />
        <WebList />
      </>,
    );
    await ready('WEB-47', 'item.labels');

    press('l');
    choose('item.labels', 'UX');
    await waitFor(() => expect(sent('PATCH', '/api/v1/work-items/wi_web_47')).toEqual([{ label_ids: ['lb_forms', 'lb_production', 'lb_ux'] }]));
    await waitFor(() => expect(lastToast()?.title).toBe('WEB-47: Label UX gesetzt'));
    expect(api!.calls.filter((call) => call.method === 'GET' && call.url === '/api/v1/work-items/wi_web_47')).toEqual([]);

    // the cursor leaves the list: nothing to act on
    act(() => useUiStore.getState().setPaletteOpen(false));
    act(() => moveCursor(null));
    await waitFor(() => expect(command('item.state')?.group).toBe('Aktionen für das Item'));
    expect(command('item.state')?.when?.()).toBe(false);
  });

  it('acts on no selection without a list on screen', async () => {
    renderWith(
      <>
        <Preview />
        <WebList />
      </>,
    );
    act(() => useUiStore.getState().openPeek('wi_web_48'));
    await ready('WEB-48');
    // a selection left behind is no list's: the previewed item stays the target
    select('wi_web_47', 'wi_web_50');
    await ready('WEB-48');
  });

  it('ranks the item page above the list', async () => {
    function Both() {
      const [page, setPage] = useState(true);
      return (
        <>
          {page && <ItemPage id="wi_web_50" />}
          <ListScreen cursor="wi_web_47" />
          <button type="button" onClick={() => setPage(false)}>
            Seite verlassen
          </button>
        </>
      );
    }
    renderWith(
      <>
        <Both />
        <WebList />
      </>,
    );
    // the list mounted last, the page still registers: detail before list
    await ready('WEB-50');
    expect(listShortcuts().find((shortcut) => shortcut.id === 'item.state')?.scope).toBe('detail');
    select('wi_web_47', 'wi_web_48');
    await ready('WEB-50');
    expect(listCommands().filter((entry) => entry.id === 'item.state')).toHaveLength(1);

    // the page goes: the list takes over with its selection, in its own scope
    fireEvent.click(screen.getByRole('button', { name: 'Seite verlassen' }));
    await ready('2 Items');
    expect(listShortcuts().find((shortcut) => shortcut.id === 'item.state')?.scope).toBe('list');
  });

  it('changes the state of many items in one call and names the refused ones', async () => {
    renderWith(
      <>
        <ListScreen />
        <WebList />
      </>,
      {
        routes: {
          'POST /api/v1/work-items/bulk': () => ({ body: { updated: ['wi_web_47', 'wi_web_48'], rejected: [{ id: 'wi_web_50', reason: 'transition_not_allowed' }] } }),
        },
      },
    );
    await waitFor(() => expect(screen.getByLabelText('WEB').textContent).toContain('WEB-50'));
    select('wi_web_47', 'wi_web_48', 'wi_web_50');
    await ready('3 Items');

    choose('item.state', 'Todo');
    await waitFor(() => expect(bulkCalls()).toEqual([{ ids: ['wi_web_47', 'wi_web_48', 'wi_web_50'], patch: { state_id: 'std_todo' } }]));
    await waitFor(() =>
      expect(lastToast()).toMatchObject({ title: '2 von 3 Items geändert', description: 'WEB-50: Der Übergang ist im Workflow nicht erlaubt.', tone: 'neutral' }),
    );

    // a closed state asks for the resolution of all of them first
    const user = userEvent.setup();
    act(() => command('item.state')!.subpage!().options.find((option) => option.label === 'Done')!.run());
    const dialog = await screen.findByRole('dialog', { name: '3 Items auf Done setzen' });
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));
    await user.keyboard('{Enter}');
    await waitFor(() => expect(bulkCalls()[1]).toEqual({ ids: ['wi_web_47', 'wi_web_48', 'wi_web_50'], patch: { state_id: 'std_done', resolution_id: 'res_done' } }));
  });

  it('says when the server refuses every item, and when nothing was saved', async () => {
    let failing = false;
    renderWith(
      <>
        <ListScreen />
        <WebList />
      </>,
      {
        routes: {
          'POST /api/v1/work-items/bulk': () =>
            failing
              ? problem(503, 'service_unavailable', 'Wartung.')
              : { body: { updated: [], rejected: [{ id: 'wi_web_47', reason: 'forbidden' }, { id: 'wi_web_99', reason: 'not_found' }] } },
        },
      },
    );
    await waitFor(() => expect(screen.getByLabelText('WEB').textContent).toContain('WEB-50'));
    select('wi_web_47', 'wi_web_48');
    await ready('2 Items', 'item.due');

    choose('item.due', 'Morgen');
    await waitFor(() =>
      expect(lastToast()).toMatchObject({
        title: 'Keines der 2 Items geändert',
        description: 'WEB-47: Dafür fehlt die Berechtigung. wi_web_99: Das Item gibt es nicht oder du darfst es nicht sehen.',
        tone: 'error',
      }),
    );
    expect(bulkCalls()[0]).toMatchObject({ patch: { due_date: expect.any(String) } });

    failing = true;
    await ready('2 Items', 'item.assignee');
    choose('item.assignee', 'Nicht zugewiesen');
    await waitFor(() => expect(lastToast()).toMatchObject({ title: 'Mehrfachbearbeitung nicht gespeichert', description: 'Wartung.' }));
    expect(bulkCalls()[1]).toEqual({ ids: ['wi_web_47', 'wi_web_48'], patch: { assignee_id: null } });
  });

  it('sends more than 100 items in blocks of 100 and names the refused ones of all blocks in one toast', async () => {
    const many = Array.from({ length: 150 }, (_, index) => makeWorkItem({ id: `wi_web_${100 + index}`, number: 100 + index, key: `WEB-${100 + index}`, rank: `c${index}` }));
    renderWith(
      <>
        <ListScreen />
        <WebList />
      </>,
      {
        routes: {
          'POST /api/v1/work-items/query': (body) => ({ body: list(queryItems([...items, ...many], body)) }),
          'POST /api/v1/work-items/bulk': (body) => {
            const { ids } = body as { ids: string[] };
            return { body: { updated: ids.filter((id) => id !== 'wi_web_249'), rejected: ids.includes('wi_web_249') ? [{ id: 'wi_web_249', reason: 'archived' }] : [] } };
          },
        },
      },
    );
    await waitFor(() => expect(screen.getByLabelText('WEB').textContent).toContain('WEB-249'));
    select(...many.map((item) => item.id));
    await ready('150 Items', 'item.priority');

    choose('item.priority', 'Low');
    await waitFor(() => expect(lastToast()).toMatchObject({ title: '149 von 150 Items geändert', description: 'WEB-249: Das Item ist archiviert und schreibgeschützt.' }));
    expect(bulkCalls().map((call) => (call as { ids: string[] }).ids.length)).toEqual([100, 50]);
  });

  it('offers only the states every workflow of the targets has', async () => {
    renderWith(
      <>
        <ListScreen />
        <WebList />
        <AppList />
      </>,
      { routes: withApp() },
    );
    await waitFor(() => expect(screen.getByLabelText('APP').textContent).toBe('APP-5 APP-11'));
    // the same workflow: all its states, whatever each item's own transitions allow
    select('wi_app_5', 'wi_app_11');
    await ready('2 Items');
    expect(optionsOf('item.state').map((option) => option.label)).toEqual(['Backlog', 'Todo', 'In Progress', 'Review', 'Kundenfreigabe', 'Done', 'Cancelled']);

    // two workflows share no state (A128): the sub-list says why
    select('wi_web_47', 'wi_app_11');
    await waitFor(() => expect(command('item.state')?.when?.()).toBe(true));
    expect(optionsOf('item.state')).toEqual([]);
    expect(command('item.state')!.subpage!().emptyText).toBe('Die gewählten Items haben verschiedene Workflows.');
    // the people every project of them has: Lene is in both, Mara as org admin anyway, Ida only in WEB
    await waitFor(() => expect(command('item.assignee')?.when?.()).toBe(true));
    expect(optionsOf('item.assignee').map((option) => option.label)).toEqual(['Mir zuweisen', 'Nicht zugewiesen', 'Lene Vogt', 'Mara Lindqvist']);
  });

  it('takes a label off that every item has, and puts one on that some lack', async () => {
    renderWith(
      <>
        <ListScreen />
        <WebList />
      </>,
      {
        routes: {
          'POST /api/v1/work-items/query': (body) => ({ body: list(queryItems([web30, web47, { ...web48, label_ids: ['lb_forms'] }, web50], body)) }),
          'POST /api/v1/work-items/bulk': (body) => ({ body: { updated: (body as { ids: string[] }).ids, rejected: [] } }),
        },
      },
    );
    await waitFor(() => expect(screen.getByLabelText('WEB').textContent).toContain('WEB-48'));
    select('wi_web_47', 'wi_web_48');
    await ready('2 Items', 'item.assign_me');

    expect(optionsOf('item.labels').map((option) => [option.label, option.hint])).toEqual([
      ['Formulare', 'gesetzt'],
      ['Performance', undefined],
      ['Produktion', undefined],
      ['UX', undefined],
    ]);
    choose('item.labels', 'Formulare');
    await waitFor(() => expect(lastToast()?.title).toBe('2 Items: Label Formulare entfernt'));
    choose('item.labels', 'Produktion');
    await waitFor(() =>
      expect(bulkCalls()).toEqual([
        { ids: ['wi_web_47', 'wi_web_48'], patch: { remove_label_ids: ['lb_forms'] } },
        { ids: ['wi_web_47', 'wi_web_48'], patch: { add_label_ids: ['lb_production'] } },
      ]),
    );
    // a start after a due date is each item's own rule here: the server decides
    choose('item.start', 'Start-Date entfernen');
    await waitFor(() => expect(bulkCalls()[2]).toEqual({ ids: ['wi_web_47', 'wi_web_48'], patch: { start_date: null } }));
    act(() => command('item.assign_me')!.run());
    await waitFor(() => expect(bulkCalls()[3]).toEqual({ ids: ['wi_web_47', 'wi_web_48'], patch: { assignee_id: 'u_lene' } }));
  });

  it('archives many closed items with undo and names what the server refuses', async () => {
    const web51 = makeWorkItem({ id: 'wi_web_51', number: 51, key: 'WEB-51', state_id: 'std_cancelled', rank: 'a7' });
    renderWith(
      <>
        <ListScreen />
        <WebList />
      </>,
      {
        role: 'admin',
        routes: {
          'POST /api/v1/work-items/query': (body) => ({ body: list(queryItems([...items, web51], body)) }),
          // reopened meanwhile: the server refuses it
          'POST /api/v1/work-items/bulk': () => ({ body: { updated: ['wi_web_50'], rejected: [{ id: 'wi_web_51', reason: 'not_closed' }] } }),
        },
      },
    );
    const webList = screen.getByLabelText('WEB');
    await waitFor(() => expect(webList.textContent).toBe('WEB-30 WEB-47 WEB-48 WEB-50 WEB-51'));
    select('wi_web_50', 'wi_web_51');
    await ready('2 Items', 'item.archive');
    // all are closed: the key archives
    expect(command('item.archive')?.keys).toBe('mod+backspace');
    expect(command('item.delete')?.keys).toBeUndefined();

    press('Backspace', { ctrlKey: true });
    expect(lastToast()).toMatchObject({ title: '2 Items archiviert', action: { label: 'Rückgängig' } });
    await waitFor(() => expect(webList.textContent).toBe('WEB-30 WEB-47 WEB-48'));
    // they leave the selection as well
    expect(useUiStore.getState().selection).toEqual([]);

    // undo puts them back and calls nothing
    act(() => runToastAction(lastToast()!.id));
    await waitFor(() => expect(webList.textContent).toBe('WEB-30 WEB-47 WEB-48 WEB-50 WEB-51'));
    expect(bulkCalls()).toEqual([]);

    // from the palette: when the toast runs out, one bulk edit; the server names what it refused
    select('wi_web_50', 'wi_web_51');
    await ready('2 Items', 'item.archive');
    act(() => command('item.archive')!.run());
    act(() => dismissToast(currentToasts().find((toast) => toast.title === '2 Items archiviert')!.id));
    await waitFor(() => expect(bulkCalls()).toEqual([{ ids: ['wi_web_50', 'wi_web_51'], patch: { archived: true } }]));
    await waitFor(() =>
      expect(lastToast()).toMatchObject({ title: '1 von 2 Items archiviert', description: 'WEB-51: Nur geschlossene Items lassen sich archivieren.' }),
    );
  });

  it('keeps archived items off the screen when a reload of the list was on its way (T7)', async () => {
    const web51 = makeWorkItem({ id: 'wi_web_51', number: 51, key: 'WEB-51', state_id: 'std_cancelled', rank: 'a7' });
    let client!: QueryClient;
    function Client() {
      client = useQueryClient();
      return null;
    }
    renderWith(
      <>
        <Client />
        <ListScreen />
        <WebList />
      </>,
      { role: 'admin', routes: { 'POST /api/v1/work-items/query': (body) => ({ body: list(queryItems([...items, web51], body)) }) } },
    );
    const webList = screen.getByLabelText('WEB');
    await waitFor(() => expect(webList.textContent).toBe('WEB-30 WEB-47 WEB-48 WEB-50 WEB-51'));

    // a reload (a live update) is on its way and answers the items as they were, after they left the screen
    let answer!: () => void;
    const held = new Promise<void>((resolve) => (answer = resolve));
    let asked = 0;
    const answering = globalThis.fetch;
    globalThis.fetch = async (input, init) => {
      if (String(input).includes('/work-items/query')) {
        asked += 1;
        await held;
      }
      return answering(input, init);
    };
    onTestFinished(() => {
      globalThis.fetch = answering;
    });
    act(() => void client.invalidateQueries({ queryKey: qk.workItems.all }));
    await waitFor(() => expect(asked).toBe(1));

    select('wi_web_50', 'wi_web_51');
    await ready('2 Items', 'item.archive');
    press('Backspace', { ctrlKey: true });
    expect(lastToast()).toMatchObject({ title: '2 Items archiviert' });
    await waitFor(() => expect(webList.textContent).toBe('WEB-30 WEB-47 WEB-48'));

    await act(async () => answer());
    await waitFor(() => expect(client.isFetching({ queryKey: qk.workItems.all })).toBe(0));
    expect(webList.textContent).toBe('WEB-30 WEB-47 WEB-48');
  });

  it('brings the archived items back when the bulk edit fails', async () => {
    const web51 = makeWorkItem({ id: 'wi_web_51', number: 51, key: 'WEB-51', state_id: 'std_cancelled', rank: 'a7' });
    renderWith(
      <>
        <ListScreen />
        <WebList />
      </>,
      {
        role: 'admin',
        routes: {
          'POST /api/v1/work-items/query': (body) => ({ body: list(queryItems([...items, web51], body)) }),
          'POST /api/v1/work-items/bulk': () => problem(503, 'service_unavailable', 'Wartung.'),
        },
      },
    );
    const webList = screen.getByLabelText('WEB');
    await waitFor(() => expect(webList.textContent).toBe('WEB-30 WEB-47 WEB-48 WEB-50 WEB-51'));
    select('wi_web_50', 'wi_web_51');
    await ready('2 Items', 'item.archive');

    press('Backspace', { ctrlKey: true });
    await waitFor(() => expect(webList.textContent).toBe('WEB-30 WEB-47 WEB-48'));
    act(() => dismissToast(currentToasts().find((toast) => toast.title === '2 Items archiviert')!.id));
    await waitFor(() => expect(webList.textContent).toBe('WEB-30 WEB-47 WEB-48 WEB-50 WEB-51'));
    await waitFor(() => expect(lastToast()).toMatchObject({ title: 'Archivieren nicht gespeichert', description: 'Wartung.', action: { label: 'Erneut versuchen' } }));
  });

  it('changes a mixed selection with no key and offers it in no palette (A198)', async () => {
    const archived50 = { ...web50, archived_at: '2026-10-30T10:00:00.000Z' };
    renderWith(
      <>
        <ListScreen />
        <WebList />
        <AppList />
      </>,
      {
        routes: {
          ...withApp('viewer'),
          'POST /api/v1/work-items/query': (body) => ({ body: list(queryItems([web30, web47, web48, archived50, app5, app11], body)) }),
        },
      },
    );
    await waitFor(() => expect(screen.getByLabelText('APP').textContent).toBe('APP-5 APP-11'));
    const changes = ['item.state', 'item.assignee', 'item.assign_me', 'item.priority', 'item.labels', 'item.due', 'item.start', 'item.archive'];

    // APP-11 can change, WEB-47 only be read (WEB: viewer): neither the keys nor the palette change some of them
    select('wi_app_11', 'wi_web_47');
    await waitFor(() => expect(command('item.state')?.group).toBe('Aktionen für 2 Items'));
    await waitFor(() => expect(command('item.delete')).toBeDefined());
    const refusal = 'Nicht möglich für 1 der 2 ausgewählten Items: Im Projekt WEB darfst du nur lesen. Items ändern dürfen Member und Admins.';
    await waitFor(() => {
      press('p');
      expect(lastToast()).toMatchObject({ title: 'Nicht möglich', description: refusal, tone: 'error' });
    });
    press('i');
    expect(lastToast()?.description).toBe(refusal);
    press('s');
    expect(lastToast()?.description).toBe(refusal);
    expect(useUiStore.getState().paletteOpen).toBe(false);
    for (const id of changes) expect(command(id)?.when?.()).toBe(false);

    // an archived item among open ones: the same
    select('wi_app_11', 'wi_web_50');
    await waitFor(() => {
      press('l');
      expect(lastToast()?.description).toBe('Nicht möglich für 1 der 2 ausgewählten Items: WEB-50 ist archiviert und schreibgeschützt. Stelle es zuerst wieder her.');
    });
    for (const id of changes) expect(command(id)?.when?.()).toBe(false);

    // the same items alone: as ever
    select('wi_app_11');
    await ready('APP-11', 'item.priority');
    expect(bulkCalls()).toEqual([]);
    expect(api!.calls.filter((call) => call.method === 'PATCH')).toEqual([]);
  });

  it('neither archives nor deletes with mod+backspace what it would archive in part (T15-M3)', async () => {
    const archived51 = makeWorkItem({ id: 'wi_web_51', number: 51, key: 'WEB-51', state_id: 'std_done', rank: 'a7', archived_at: '2026-10-30T10:00:00.000Z' });
    renderWith(
      <>
        <ListScreen />
        <WebList />
      </>,
      { role: 'admin', routes: { 'POST /api/v1/work-items/query': (body) => ({ body: list(queryItems([...items, archived51], body)) }) } },
    );
    const webList = screen.getByLabelText('WEB');
    await waitFor(() => expect(webList.textContent).toBe('WEB-30 WEB-47 WEB-48 WEB-50 WEB-51'));
    const nothing = (kinds: string) =>
      `Archivieren und Löschen gemischt: ${kinds}. Geschlossene würden archiviert, offene und archivierte gelöscht. Wähle nur geschlossene oder nur andere Items aus.`;

    // a closed item and one archived already: it once deleted both
    select('wi_web_50', 'wi_web_51');
    await ready('2 Items', 'item.delete');
    press('Backspace', { ctrlKey: true });
    expect(lastToast()).toMatchObject({ title: 'Nicht möglich', description: nothing('1 geschlossenes Item und 1 archiviertes Item'), tone: 'error' });
    // no command shows the key, and archiving is not offered (deleting all of them still is, by its name)
    expect(command('item.archive')?.when?.()).toBe(false);
    expect([command('item.archive')?.keys, command('item.delete')?.keys]).toEqual([undefined, undefined]);

    // open items and a closed one
    select('wi_web_47', 'wi_web_48', 'wi_web_50');
    await ready('3 Items', 'item.delete');
    press('Backspace', { ctrlKey: true });
    expect(lastToast()?.description).toBe(nothing('2 offene Items und 1 geschlossenes Item'));

    // nothing left the list or the selection, nothing went out
    expect(currentToasts().some((toast) => toast.action?.label === 'Rückgängig')).toBe(false);
    expect(webList.textContent).toBe('WEB-30 WEB-47 WEB-48 WEB-50 WEB-51');
    expect(useUiStore.getState().selection).toEqual(['wi_web_47', 'wi_web_48', 'wi_web_50']);
    expect(api!.calls.filter((call) => call.method === 'DELETE' || call.url.endsWith('/archive') || call.url === '/api/v1/work-items/bulk')).toEqual([]);

    // an open item and an archived one: deleting is what it does to both
    select('wi_web_47', 'wi_web_51');
    await ready('2 Items', 'item.delete');
    expect(command('item.delete')?.keys).toBe('mod+backspace');
    press('Backspace', { ctrlKey: true });
    expect(lastToast()).toMatchObject({ title: '2 Items gelöscht', action: { label: 'Rückgängig' } });
    act(() => runToastAction(lastToast()!.id));
  });

  it('tells in one toast what the blocks before a failed one changed and refused, and tries all the rest again', async () => {
    const many = Array.from({ length: 250 }, (_, index) => makeWorkItem({ id: `wi_web_${100 + index}`, number: 100 + index, key: `WEB-${100 + index}`, rank: `c${index}` }));
    let failing = true;
    renderWith(
      <>
        <ListScreen />
        <WebList />
      </>,
      {
        routes: {
          'POST /api/v1/work-items/query': (body) => ({ body: list(queryItems(many, body)) }),
          'POST /api/v1/work-items/bulk': (body) => {
            const { ids } = body as { ids: string[] };
            // the second block fails while the server is away; the first refuses one item
            if (failing && ids[0] === 'wi_web_200') return problem(503, 'service_unavailable', 'Wartung.');
            return { body: { updated: ids.filter((id) => id !== 'wi_web_101'), rejected: ids.includes('wi_web_101') ? [{ id: 'wi_web_101', reason: 'archived' }] : [] } };
          },
        },
      },
    );
    await waitFor(() => expect(screen.getByLabelText('WEB').textContent).toContain('WEB-349'));
    const lists = () => api!.calls.filter((call) => call.url === '/api/v1/work-items/query').length;
    select(...many.map((item) => item.id));
    await ready('250 Items', 'item.priority');
    const before = lists();

    choose('item.priority', 'Low');
    await waitFor(() =>
      expect(lastToast()).toMatchObject({
        title: '99 von 250 Items geändert, 150 nicht gespeichert',
        description: 'WEB-101: Das Item ist archiviert und schreibgeschützt. Wartung.',
        tone: 'error',
        action: { label: 'Erneut versuchen' },
      }),
    );
    // the block after the failed one was never sent; the lists loaded once, after the last block
    expect(bulkCalls().map((call) => (call as { ids: string[] }).ids.length)).toEqual([100, 100]);
    await waitFor(() => expect(lists()).toBe(before + 1));

    // all that was not saved, in blocks of 100 again
    failing = false;
    act(() => runToastAction(lastToast()!.id));
    await waitFor(() => expect(lastToast()?.title).toBe('150 Items: Priorität Low'));
    expect(bulkCalls().slice(2)).toEqual([
      { ids: many.slice(100, 200).map((item) => item.id), patch: { priority: 'low' } },
      { ids: many.slice(200).map((item) => item.id), patch: { priority: 'low' } },
    ]);
  });

  it('keeps what a block archived off the screen and brings back only what was not saved', async () => {
    const many = Array.from({ length: 150 }, (_, index) =>
      makeWorkItem({ id: `wi_web_${100 + index}`, number: 100 + index, key: `WEB-${100 + index}`, state_id: 'std_done', rank: `c${index}` }),
    );
    let failing = true;
    // the server lists what it has not archived
    const archived = new Set<string>();
    renderWith(
      <>
        <ListScreen />
        <WebList />
      </>,
      {
        role: 'admin',
        routes: {
          'POST /api/v1/work-items/query': (body) => ({ body: list(queryItems(many, body).filter((item) => !archived.has(item.id))) }),
          'POST /api/v1/work-items/bulk': (body) => {
            const { ids } = body as { ids: string[] };
            if (failing && ids[0] === 'wi_web_200') return problem(503, 'service_unavailable', 'Wartung.');
            ids.forEach((id) => archived.add(id));
            return { body: { updated: ids, rejected: [] } };
          },
        },
      },
    );
    const webList = screen.getByLabelText('WEB');
    await waitFor(() => expect(webList.textContent).toContain('WEB-249'));
    select(...many.map((item) => item.id));
    await ready('150 Items', 'item.archive');

    // the list as the server has it after the first block
    const shown = () => webList.textContent!.split(' ').filter(Boolean);
    press('Backspace', { ctrlKey: true });
    await waitFor(() => expect(shown()).toEqual([]));
    act(() => dismissToast(currentToasts().find((toast) => toast.title === '150 Items archiviert')!.id));
    await waitFor(() => expect(lastToast()).toMatchObject({ title: '100 von 150 Items archiviert, 50 nicht gespeichert', action: { label: 'Erneut versuchen' } }));
    // only the 50 of the failed block come back; the archived 100 stay away
    await waitFor(() => expect(shown()).toEqual(many.slice(100).map((item) => item.key)));

    failing = false;
    act(() => runToastAction(lastToast()!.id));
    await waitFor(() => expect(bulkCalls().at(-1)).toEqual({ ids: many.slice(100).map((item) => item.id), patch: { archived: true } }));
    await waitFor(() => expect(shown()).toEqual([]));
  });

  it('deletes many items one by one after the undo time and brings back what failed with a retry for it', async () => {
    let failing = true;
    renderWith(
      <>
        <ListScreen />
        <WebList />
      </>,
      {
        role: 'admin',
        routes: {
          'DELETE /api/v1/work-items/wi_web_47': () => ({ status: 204 }),
          'DELETE /api/v1/work-items/wi_web_48': () => (failing ? problem(503, 'service_unavailable', 'Wartung.') : { status: 204 }),
        },
      },
    );
    const webList = screen.getByLabelText('WEB');
    await waitFor(() => expect(webList.textContent).toBe('WEB-30 WEB-47 WEB-48 WEB-50'));
    select('wi_web_47', 'wi_web_48');
    await ready('2 Items', 'item.delete');
    // none of them is closed: the key deletes
    expect(command('item.delete')?.keys).toBe('mod+backspace');

    press('Backspace', { ctrlKey: true });
    expect(lastToast()).toMatchObject({ title: '2 Items gelöscht', action: { label: 'Rückgängig' } });
    await waitFor(() => expect(webList.textContent).toBe('WEB-30 WEB-50'));
    expect(sent('DELETE', '/api/v1/work-items/wi_web_47')).toEqual([]);

    act(() => dismissToast(lastToast()!.id));
    await waitFor(() => expect(sent('DELETE', '/api/v1/work-items/wi_web_48')).toHaveLength(1));
    expect(sent('DELETE', '/api/v1/work-items/wi_web_47')).toHaveLength(1);
    // what failed comes back, with a retry for it alone
    await waitFor(() => expect(webList.textContent).toContain('WEB-48'));
    await waitFor(() => expect(lastToast()).toMatchObject({ title: 'WEB-48 nicht gelöscht', description: 'Wartung.', action: { label: 'Erneut versuchen' } }));

    failing = false;
    act(() => runToastAction(lastToast()!.id));
    await waitFor(() => expect(sent('DELETE', '/api/v1/work-items/wi_web_48')).toHaveLength(2));
    expect(sent('DELETE', '/api/v1/work-items/wi_web_47')).toHaveLength(1);

    // the palette deletes a selection too (undo takes it back)
    select('wi_web_30', 'wi_web_50');
    await ready('2 Items', 'item.delete');
    act(() => command('item.delete')!.run());
    expect(lastToast()?.title).toBe('2 Items gelöscht');
    act(() => runToastAction(lastToast()!.id));
  });

  it('deletes a few items at once and loads the lists once, after the last delete', async () => {
    const many = Array.from({ length: 9 }, (_, index) => makeWorkItem({ id: `wi_web_${100 + index}`, number: 100 + index, key: `WEB-${100 + index}`, rank: `c${index}` }));
    const gone = new Set<string>();
    renderWith(
      <>
        <ListScreen />
        <WebList />
      </>,
      {
        role: 'admin',
        routes: {
          'POST /api/v1/work-items/query': (body) => ({ body: list(queryItems(many, body).filter((item) => !gone.has(item.id))) }),
          ...Object.fromEntries(
            many.map((item) => [
              `DELETE /api/v1/work-items/${item.id}`,
              () => {
                gone.add(item.id);
                return { status: 204 };
              },
            ]),
          ),
        },
      },
    );
    const webList = screen.getByLabelText('WEB');
    await waitFor(() => expect(webList.textContent).toContain('WEB-108'));
    // every DELETE waits a moment; count how many are open at once, and what the list asks for meanwhile
    let open = 0;
    let most = 0;
    const events: string[] = [];
    const answering = globalThis.fetch;
    globalThis.fetch = async (input, init) => {
      const url = String(input);
      if (init?.method !== 'DELETE') {
        if (url.includes('/work-items/query')) events.push('reload');
        return answering(input, init);
      }
      open += 1;
      most = Math.max(most, open);
      events.push('delete');
      await new Promise((resolve) => setTimeout(resolve, 5));
      try {
        return await answering(input, init);
      } finally {
        open -= 1;
      }
    };
    onTestFinished(() => {
      globalThis.fetch = answering;
    });
    select(...many.map((item) => item.id));
    await ready('9 Items', 'item.delete');

    act(() => command('item.delete')!.run());
    act(() => dismissToast(lastToast()!.id));
    await waitFor(() => expect(gone.size).toBe(9));
    await waitFor(() => expect(events).toContain('reload'));
    expect(most).toBe(4);
    // no reload between the deletes (it would bring back what still waits), one after the last
    expect(events.filter((event) => event === 'reload')).toHaveLength(1);
    expect(events.indexOf('reload')).toBe(9);
    expect(webList.textContent).toBe('');
  });

  it('refuses t and shift+p for more than one item with the reason', async () => {
    renderWith(
      <>
        <ListScreen cursor="wi_web_48" />
        <WebList />
      </>,
    );
    await waitFor(() => expect(screen.getByLabelText('WEB').textContent).toContain('WEB-50'));
    select('wi_web_47', 'wi_web_48');
    await ready('2 Items');

    press('t');
    expect(lastToast()).toMatchObject({ title: 'Nicht möglich', description: 'Typ und Eltern-Item ändern sich nur für ein Item allein.' });
    press('P', { shiftKey: true });
    expect(currentToasts().filter((toast) => toast.title === 'Nicht möglich')).toHaveLength(1);
    expect(useUiStore.getState().paletteOpen).toBe(false);
    expect(command('item.type')?.when?.()).toBe(false);
    expect(command('item.parent')?.when?.()).toBe(false);

    // one item of a list: the type knows its children from the list (WEB-48 has none), without its detail
    select();
    await ready('WEB-48', 'item.type');
  });

  it('acts on the card under the cursor at once with shift+p after the cursor moved to another project', async () => {
    renderWith(
      <>
        <ListScreen cursor="wi_web_47" />
        <Preview />
        <WebList />
        <AppList />
      </>,
      { routes: withApp() },
    );
    await waitFor(() => expect(screen.getByLabelText('APP').textContent).toBe('APP-5 APP-11'));
    // the preview registers (detail before list) and acts on the list's cursor
    await ready('WEB-47', 'item.parent');

    // the cursor moves to a card of APP; only the list renders, nothing else moves (no focus, no preview)
    act(() => moveCursor('wi_app_11'));
    await waitFor(() => expect(command('item.parent')?.group).toBe('Aktionen für APP-11'));
    press('P', { shiftKey: true });
    expect(useUiStore.getState()).toMatchObject({ paletteOpen: true, paletteCommandId: 'item.parent' });
    // the epics of APP, not of WEB
    await waitFor(() => expect(optionsOf('item.parent').map((option) => option.hint)).toEqual(['APP-5']));
  });

  it('lets the preview keep its keys only with the focus in the panel while a list has a cursor', async () => {
    const panel = { current: document.createElement('aside') };
    const inside = document.createElement('button');
    panel.current.append(inside);
    document.body.append(panel.current);
    onTestFinished(() => panel.current.remove());

    renderWith(<ListScreen />);
    await waitFor(() => expect(command('item.state')).toBeDefined());
    // no cursor: nothing outranks the previewed item
    expect(previewKeysAct(panel)).toBe(true);
    // a cursor in the list outranks it (rule 4), but not the focus inside the panel (rule 1)
    act(() => moveCursor('wi_web_47'));
    expect(previewKeysAct(panel)).toBe(false);
    inside.focus();
    expect(previewKeysAct(panel)).toBe(true);
  });

  it('reads the cache once for a selection of 1 000 items, not once per item (T15-M2)', async () => {
    let client: QueryClient | undefined;
    function Client() {
      client = useQueryClient();
      return null;
    }
    renderWith(
      <>
        <ListScreen />
        <Client />
      </>,
    );
    await waitFor(() => expect(command('item.priority')).toBeDefined());

    // ten pages of 100 items of WEB in the cache, as a long list loaded them; each page counts how often its items are read
    const ids = Array.from({ length: 1000 }, (_, n) => `wi_many_${n}`);
    const reads = Array.from({ length: 10 }, () => 0);
    act(() => {
      for (let p = 0; p < 10; p++) {
        const items = ids.slice(p * 100, p * 100 + 100).map((id, n) => makeWorkItem({ id, number: 1000 + p * 100 + n, key: `WEB-${1000 + p * 100 + n}` }));
        const page = { next_cursor: null, total: 1000 } as Page<WorkItem>;
        Object.defineProperty(page, 'items', { enumerable: true, get: () => ((reads[p]! += 1), items) });
        client!.setQueryData(qk.workItems.list({ project_id: 'p_web', q: 'viele', cursor: `c${p}` }), page);
      }
    });
    const lookups = vi.spyOn(client!, 'getQueriesData');
    /** What one look at the targets reads: calls into the cache, and the reads of each page. */
    const cost = () => {
      lookups.mockClear();
      reads.fill(0);
      expect(command('item.priority')!.when!()).toBe(true);
      return { lookups: lookups.mock.calls.length, reads: [...reads] };
    };

    select(ids[0]!);
    await waitFor(() => expect(command('item.priority')?.group).toBe('Aktionen für WEB-1000'));
    const one = cost();
    select(...ids);
    await waitFor(() => expect(command('item.priority')?.group).toBe('Aktionen für 1.000 Items'));
    const many = cost();

    // the selection's size does not change how often the cache and its pages are read
    expect(many).toEqual(one);
    expect(one.lookups).toBeGreaterThan(0);
    expect(one.reads.every((count) => count > 0)).toBe(true);
  });
});
