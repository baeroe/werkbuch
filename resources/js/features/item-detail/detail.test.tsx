/*
 * The item page and the preview against a fake REST API (`mockApi`), from the clickdummy's `detail.test.tsx` without
 * comments and attachments: what the detail shows, the title, the status with its resolution, the read-only look of a
 * viewer and of an archived item, the header's actions (watch, link, child item, archive, delete with undo), a gone
 * item and a failed read, a renamed key, the preview host with its Escape, and the days of the organisation.
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ItemDialogsHost } from '@/components/fields/ItemDialogs';
// loaded with the file, so the first question does not wait for its module
import '@/components/fields/ResolutionPrompt';
import { currentToasts, dismissToast, resetToasts, runToastAction } from '@/components/ui/toast';
import { preloadEditor } from '@/editor/RichTextEditor';
import { CommandPalette } from '@/features/palette/CommandPalette';
import { listCommands } from '@/lib/commands';
import { useUiStore } from '@/store/ui';
import { mockApi, type MockApi, type MockRoute } from '@/test/api';
import { ida, labels, lene, list, makeWorkItem, mara, organization, project, properties, queryItems, relationTypes, resolutions, standard, types, web30, web47, web47Relations, web48 } from '@/test/fixtures';
import type { Organization, Project, ProjectMember, Property, RichText, User, WorkItem, WorkItemType } from '@/types';
import { closePeekOnNavigation, PeekHost } from '@/shell/PeekHost';
import { SAVE_PAUSE_MS } from './FieldsPanel';
import { ItemPage } from './ItemPage';
import { ItemPeek } from './ItemPeek';

type Listener = (event: { detail: { page: { url: string } } }) => void;

const inertia = vi.hoisted(() => ({ url: '/items/WEB-47', visit: vi.fn(), replace: vi.fn(), listeners: new Map<Listener, string>() }));
let signedIn: User = lene;
let org: Organization = organization;

vi.mock('@inertiajs/react', () => ({
  usePage: () => ({ props: { auth: { user: signedIn, permissions: [] }, organization: org }, url: inertia.url }),
  router: {
    visit: inertia.visit,
    replace: inertia.replace,
    on: (event: string, listener: Listener) => {
      inertia.listeners.set(listener, event);
      return () => inertia.listeners.delete(listener);
    },
  },
  Link: ({ href, children, ...rest }: { href: string; children?: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

beforeAll(async () => {
  // jsdom has no layout; the editor measures the selection
  const empty = () => ({ x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, toJSON: () => ({}) }) as DOMRect;
  Range.prototype.getBoundingClientRect = empty;
  Range.prototype.getClientRects = () => ({ length: 0, item: () => null, [Symbol.iterator]: [][Symbol.iterator] }) as unknown as DOMRectList;
  document.elementFromPoint = () => null;
  await preloadEditor();
});

/* -------------------------------------------------------------------------- data */

/** WEB-50: a done task (closed), so it can be archived. */
const web50 = makeWorkItem({
  id: 'wi_web_50',
  number: 50,
  key: 'WEB-50',
  title: 'Impressum aktualisieren',
  state_id: 'std_done',
  resolution_id: 'res_done',
  rank: 'a6',
  closed_at: '2026-10-30T10:00:00.000Z',
});
const member = (user_id: string, role: ProjectMember['role'] = 'member'): ProjectMember => ({ project_id: 'p_web', user_id, role });
const members = [member('u_ida', 'admin'), member('u_lene')];

/** The steps of a bug, as rich text: a property this detail edits in the editor. */
const steps: Property = { id: 'pr_steps', key: 'steps', label: 'Schritte', field_type: 'rich_text', help: '', default_value: null, settings: {}, options: [] };
const doc = (text: string): RichText => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] });

let items: WorkItem[] = [];
let typeList: WorkItemType[] = types;
let propertyList: Property[] = properties;

const detail = (item: WorkItem) => ({
  body: {
    data: {
      ...item,
      children: items.filter((entry) => entry.parent_id === item.id),
      relations: item.id === web47.id ? web47Relations : [],
      type: typeList.find((type) => type.id === item.type_id),
      workflow: standard,
    },
  },
});
const problem = (status: number, reason: string, detail = 'Nein.') => ({ status, body: { type: 'about:blank', title: reason, status, reason, detail } });

/* ------------------------------------------------------------------------ render */

let api: MockApi | undefined;
let client: QueryClient;

function renderWith(node: ReactNode, { routes = {}, role = 'member' }: { routes?: Record<string, MockRoute>; role?: Project['my_role'] } = {}) {
  const current = (id: string) => items.find((entry) => entry.id === id)!;
  api = mockApi({
    'GET /api/v1/projects': () => ({ body: list([project('WEB', role, { name: 'Website-Relaunch' })]) }),
    'GET /api/v1/workflows': () => ({ body: list([standard]) }),
    'GET /api/v1/resolutions': () => ({ body: list(resolutions) }),
    'GET /api/v1/users': () => ({ body: list([mara, ida, lene]) }),
    'GET /api/v1/projects/p_web/members': () => ({ body: list(members) }),
    'GET /api/v1/labels': () => ({ body: list(labels) }),
    'GET /api/v1/relation-types': () => ({ body: list(relationTypes) }),
    'GET /api/v1/work-item-types': () => ({ body: list(typeList) }),
    'GET /api/v1/properties': () => ({ body: list(propertyList) }),
    'POST /api/v1/work-items/query': (body) => ({ body: list(queryItems(items, body)) }),
    ...Object.fromEntries(items.flatMap((item) => [`GET /api/v1/work-items/${item.id}`, `GET /api/v1/work-items/${item.key}`].map((path) => [path, () => detail(current(item.id))]))),
    ...Object.fromEntries(
      items.map((item) => [
        `PATCH /api/v1/work-items/${item.id}`,
        (body: unknown) => {
          const next = { ...current(item.id), ...(body as object) } as WorkItem;
          items = items.map((entry) => (entry.id === item.id ? next : entry));
          return { body: { data: next } };
        },
      ]),
    ),
    // the activity reads an empty history: no error state with its own "Erneut versuchen" and alert in these screens
    ...Object.fromEntries(items.flatMap((item) => [item.id, item.key].map((ref) => [`GET /api/v1/work-items/${ref}/history`, () => ({ body: list([]) })]))),
    ...routes,
  });
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>);
}

const sent = (method: string, path: string) => api!.calls.filter((call) => call.method === method && call.url.split('?')[0] === path).map((call) => call.body);
const lastToast = () => currentToasts().at(-1);
const picker = (name: RegExp) => screen.findByRole('combobox', { name });
/** The title heading once the item has loaded. */
const heading = (level = 1) => screen.findByRole('heading', { level, name: 'Kontaktformular sendet doppelt' });
const press = (key: string, init: KeyboardEventInit = {}, on: Element = document.body) =>
  act(() => {
    on.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }));
  });
/** Adds text where the editor's caret is (jsdom mixes typed keys up behind existing text). */
const paste = (editor: HTMLElement, text: string) =>
  fireEvent.paste(editor, { clipboardData: { files: [], types: ['text/plain'], getData: (type: string) => (type === 'text/plain' ? text : '') } });

beforeEach(() => {
  useUiStore.setState(useUiStore.getInitialState());
  items = [web30, web47, web48, web50];
  typeList = types;
  propertyList = properties;
  inertia.url = '/items/WEB-47';
  inertia.visit.mockReset();
  inertia.replace.mockReset();
  inertia.listeners.clear();
  window.history.replaceState(null, '', '/items/WEB-47');
});

afterEach(() => {
  api?.restore();
  api = undefined;
  signedIn = lene;
  org = organization;
  vi.useRealTimers();
  act(() => resetToasts());
  Reflect.deleteProperty(window, 'matchMedia');
});

/* ------------------------------------------------------------------------ the page */

describe('ItemPage', () => {
  it('shows key, title, type tab and fields of an item', async () => {
    renderWith(<ItemPage itemKey="WEB-47" />);

    expect(screen.getByText('Item wird geladen …')).toBeTruthy();
    await heading();
    expect(document.title).toBe('WEB-47 Kontaktformular sendet doppelt – werkbuch');

    // the path: the project and the key, and the tab of the card with the key
    const path = screen.getByRole('navigation', { name: 'Pfad' });
    await within(path).findByText('Website-Relaunch');
    expect(within(path).getByRole('link', { name: /Website-Relaunch/ }).getAttribute('href')).toBe('/projects/WEB');
    expect(within(path).getByText('WEB-47').closest('li')!.getAttribute('aria-current')).toBe('page');
    expect(screen.getAllByText('WEB-47').length).toBeGreaterThan(1);

    // the fields with the field editors, in the order of the panel
    const fields = screen.getByRole('complementary', { name: 'Felder' });
    await within(fields).findByRole('combobox', { name: /^Status: In Progress/ });
    expect([...fields.querySelectorAll('dl')[0]!.querySelectorAll('dt')].map((term) => term.textContent)).toEqual([
      'Typ',
      'Status',
      'Assignee',
      'Priorität',
      'Labels',
      'Start',
      'Due',
      'Eltern',
      'Erstellt',
      'Geändert',
    ]);
    await within(fields).findByRole('combobox', { name: /^Assignee: Ida Brenner/ });
    expect(within(fields).getByRole('combobox', { name: /^Priorität: Urgent/ })).toBeTruthy();
    await within(fields).findByText('Mara Lindqvist');
    expect(within(fields).getByText('20.10.2026')).toBeTruthy();
    expect(within(fields).getByText('Geändert').nextElementSibling!.textContent).toBe('27.10.2026');

    // the properties of a bug, the required one marked
    const props = await within(fields).findByRole('region', { name: 'Properties' });
    await within(props).findByText('Umgebung');
    expect([...props.querySelectorAll('dt')].map((term) => term.textContent)).toEqual(['Kunde', 'Aufwand (h)', 'UmgebungPflicht']);

    // blocked by OPS-12: the banner under the title
    expect(await screen.findByText('Blockiert, solange OPS-12 offen ist')).toBeTruthy();
  });

  it('shows the parent on the path and no parent field for an epic', async () => {
    renderWith(<ItemPage itemKey="WEB-48" />);
    const path = await screen.findByRole('navigation', { name: 'Pfad' });
    expect((await within(path).findByRole('link', { name: /WEB-30/ })).getAttribute('href')).toBe('/items/WEB-30');
    expect(within(path).getByText('Relaunch Phase 1')).toBeTruthy();
    expect(await picker(/^Eltern-Item: WEB-30/)).toBeTruthy();
  });

  it('edits the title with e and keeps it on escape', async () => {
    const user = userEvent.setup();
    renderWith(<ItemPage itemKey="WEB-47" />);
    // editable once the rights have loaded
    const button = await within(await heading()).findByRole('button', { name: 'Kontaktformular sendet doppelt' });

    // Escape takes the edit back, and the focus goes back to the title
    press('e');
    const field = await screen.findByRole('textbox', { name: 'Titel' });
    await waitFor(() => expect(document.activeElement).toBe(field));
    await user.clear(field);
    await user.type(field, 'Etwas anderes');
    await user.keyboard('{Escape}');
    expect((await heading()).textContent).toContain('Kontaktformular sendet doppelt');
    expect(document.activeElement).toBe(within(await heading()).getByRole('button'));
    expect(sent('PATCH', '/api/v1/work-items/wi_web_47')).toEqual([]);

    // empty or too long, the field says so and keeps the edit
    await user.click(within(await heading()).getByRole('button'));
    const again = await screen.findByRole('textbox', { name: 'Titel' });
    await user.clear(again);
    await user.keyboard('{Enter}');
    expect(screen.getByText('Der Titel darf nicht leer sein.')).toBeTruthy();
    expect(again.getAttribute('aria-invalid')).toBe('true');
    fireEvent.change(again, { target: { value: 'x'.repeat(256) } });
    await user.keyboard('{Enter}');
    expect(screen.getByText('Höchstens 255 Zeichen, jetzt sind es 256.')).toBeTruthy();
    // characters as the server counts them: 256 emoji are 256, not 512
    fireEvent.change(again, { target: { value: '🚀'.repeat(256) } });
    await user.keyboard('{Enter}');
    expect(screen.getByText('Höchstens 255 Zeichen, jetzt sind es 256.')).toBeTruthy();

    // a new line stays one line; Enter saves
    fireEvent.change(again, { target: { value: 'Kontaktformular\nsendet dreifach ' } });
    await user.keyboard('{Enter}');
    await waitFor(() => expect(sent('PATCH', '/api/v1/work-items/wi_web_47')).toEqual([{ title: 'Kontaktformular sendet dreifach' }]));
    expect(await screen.findByRole('heading', { level: 1, name: 'Kontaktformular sendet dreifach' })).toBeTruthy();
    expect(button.isConnected).toBe(false);

    // the same title again sends nothing; leaving the field saves
    press('e');
    await user.keyboard('{Enter}');
    press('e');
    const last = await screen.findByRole('textbox', { name: 'Titel' });
    await user.type(last, '!');
    act(() => last.blur());
    await waitFor(() => expect(sent('PATCH', '/api/v1/work-items/wi_web_47')).toEqual([{ title: 'Kontaktformular sendet dreifach' }, { title: 'Kontaktformular sendet dreifach!' }]));
  });

  it('puts a refusal of the title back into the field', async () => {
    const user = userEvent.setup();
    renderWith(<ItemPage itemKey="WEB-47" />, {
      routes: { 'PATCH /api/v1/work-items/wi_web_47': () => ({ status: 422, body: { type: 'about:blank', title: 'x', status: 422, reason: 'validation_failed', errors: { title: ['Der Titel ist zu lang.'] } } }) },
    });
    await user.click(await within(await heading()).findByRole('button'));
    const field = await screen.findByRole('textbox', { name: 'Titel' });
    await user.type(field, ' neu{Enter}');
    expect(await screen.findByText('Der Titel ist zu lang.')).toBeTruthy();
    expect((screen.getByRole('textbox', { name: 'Titel' }) as HTMLTextAreaElement).value).toBe('Kontaktformular sendet doppelt neu');
  });

  it('changes the status and asks for the resolution', async () => {
    const user = userEvent.setup();
    renderWith(<ItemPage itemKey="WEB-47" />, {
      routes: {
        'POST /api/v1/work-items/wi_web_47/transition': () => {
          items = items.map((entry) => (entry.id === web47.id ? { ...web47, state_id: 'std_done', resolution_id: 'res_wontdo' } : entry));
          return { body: { data: items.find((entry) => entry.id === web47.id) } };
        },
      },
    });

    await user.click(await picker(/^Status: In Progress/));
    await user.click(await screen.findByRole('option', { name: 'Done' }));
    const dialog = await screen.findByRole('dialog', { name: 'WEB-47 auf Done setzen' });
    await user.click(within(dialog).getByRole('radio', { name: "Won't do" }));
    await user.click(within(dialog).getByRole('button', { name: 'Auf Done setzen' }));

    await waitFor(() => expect(sent('POST', '/api/v1/work-items/wi_web_47/transition')).toEqual([{ to_state_id: 'std_done', resolution_id: 'res_wontdo' }]));
    // a closed item names its resolution
    const fields = screen.getByRole('complementary', { name: 'Felder' });
    await within(fields).findByText('Resolution');
    expect(within(fields).getByText("Won't do")).toBeTruthy();
  });

  it('gives the focus to the title after the question of s when nothing else had it', async () => {
    const user = userEvent.setup();
    renderWith(
      <>
        <main id="main" tabIndex={-1}>
          <ItemPage itemKey="WEB-47" />
        </main>
        <CommandPalette />
        <ItemDialogsHost />
      </>,
      { routes: { 'POST /api/v1/work-items/wi_web_47/transition': () => ({ body: { data: { ...web47, state_id: 'std_done', resolution_id: 'res_done' } } }) } },
    );
    const title = await heading();
    const state = () => listCommands().find((entry) => entry.id === 'item.state');
    await waitFor(() => expect(state()?.group).toBe('Aktionen für WEB-47'));
    await waitFor(() => expect(state()?.when?.()).toBe(true));

    press('s');
    const input = await screen.findByRole('combobox', { name: 'Status ändern …' });
    await waitFor(() => expect(document.activeElement).toBe(input));
    await user.keyboard('done{Enter}');
    const dialog = await screen.findByRole('dialog', { name: 'WEB-47 auf Done setzen' });
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));
    await user.keyboard('{Enter}');

    await waitFor(() => expect(sent('POST', '/api/v1/work-items/wi_web_47/transition')).toEqual([{ to_state_id: 'std_done', resolution_id: 'res_done' }]));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    // the heading, and in it the title's button, which Base UI takes as the first control there
    await waitFor(() => expect(document.activeElement).toBe(within(title).getByRole('button')));
  });

  it('says why a viewer cannot change anything', async () => {
    renderWith(<ItemPage itemKey="WEB-47" />, { role: 'viewer' });
    const readOnly = 'Im Projekt WEB darfst du nur lesen. Items ändern dürfen Member und Admins.';
    // the fields are read-only with the reason, the title is text, and there is no menu
    const state = await screen.findByRole('button', { name: /^Status: In Progress/ });
    await waitFor(() => expect(document.getElementById(state.getAttribute('aria-describedby')!)?.textContent).toBe(readOnly));
    expect(state.getAttribute('aria-disabled')).toBe('true');
    expect(within(await heading()).queryByRole('button')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Weitere Aktionen' })).toBeNull();

    // e says why
    press('e');
    await waitFor(() => expect(lastToast()).toMatchObject({ title: 'Nicht möglich', description: readOnly, tone: 'error' }));
    expect(screen.queryByRole('textbox', { name: 'Titel' })).toBeNull();
  });

  it('marks an archived item read-only and restores it', async () => {
    const user = userEvent.setup();
    items = items.map((entry) => (entry.id === web50.id ? { ...web50, archived_at: '2026-10-31T09:00:00.000Z' } : entry));
    renderWith(<ItemPage itemKey="WEB-50" />, {
      routes: {
        'POST /api/v1/work-items/wi_web_50/restore': () => {
          items = items.map((entry) => (entry.id === web50.id ? web50 : entry));
          return { body: { data: web50 } };
        },
      },
    });

    const note = (await screen.findByText('Archiviert am 31.10.2026.')).closest<HTMLElement>('[role="status"]')!;
    const state = await screen.findByRole('button', { name: /^Status: Done/ });
    await waitFor(() => expect(document.getElementById(state.getAttribute('aria-describedby')!)?.textContent).toBe('WEB-50 ist archiviert und schreibgeschützt. Stelle es zuerst wieder her.'));
    expect(within(screen.getByRole('heading', { level: 1, name: 'Impressum aktualisieren' })).queryByRole('button')).toBeNull();

    // the menu offers the restore too; the note's button restores and the focus goes to the title
    await user.click(screen.getByRole('button', { name: 'Weitere Aktionen' }));
    expect(await screen.findByRole('menuitem', { name: 'Wiederherstellen' })).toBeTruthy();
    expect(screen.queryByRole('menuitem', { name: 'Archivieren' })).toBeNull();
    await user.keyboard('{Escape}');

    await user.click(within(note).getByRole('button', { name: 'Wiederherstellen' }));
    await waitFor(() => expect(sent('POST', '/api/v1/work-items/wi_web_50/restore')).toHaveLength(1));
    await waitFor(() => expect(lastToast()).toMatchObject({ title: 'WEB-50 wiederhergestellt', tone: 'success' }));
    await waitFor(() => expect(screen.queryByText('Archiviert am 31.10.2026.')).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('heading', { level: 1, name: 'Impressum aktualisieren' })));

    // and archives again from the menu, with undo
    await user.click(screen.getByRole('button', { name: 'Weitere Aktionen' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Archivieren' }));
    await waitFor(() => expect(lastToast()?.title).toBe('WEB-50 archiviert'));
    act(() => runToastAction(lastToast()!.id));
    expect(sent('POST', '/api/v1/work-items/wi_web_50/archive')).toEqual([]);
  });

  it('restores from the menu', async () => {
    const user = userEvent.setup();
    items = items.map((entry) => (entry.id === web50.id ? { ...web50, archived_at: '2026-10-31T09:00:00.000Z' } : entry));
    renderWith(<ItemPage itemKey="WEB-50" />, { routes: { 'POST /api/v1/work-items/wi_web_50/restore': () => ({ body: { data: web50 } }) } });
    await user.click(await screen.findByRole('button', { name: 'Weitere Aktionen' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Wiederherstellen' }));
    await waitFor(() => expect(sent('POST', '/api/v1/work-items/wi_web_50/restore')).toHaveLength(1));
  });

  it('deletes with undo and goes back', async () => {
    const user = userEvent.setup();
    inertia.visit.mockImplementation((url: string) => window.history.replaceState(null, '', url));
    renderWith(<ItemPage itemKey="WEB-47" />, { role: 'admin', routes: { 'DELETE /api/v1/work-items/wi_web_47': () => ({ status: 204 }) } });

    await user.click(await screen.findByRole('button', { name: 'Weitere Aktionen' }));
    // an open bug: delete carries the key, archive is not offered
    const remove = await screen.findByRole('menuitem', { name: /Löschen/ });
    expect(remove.getAttribute('aria-keyshortcuts')).toBe('Control+Backspace');
    expect(screen.queryByRole('menuitem', { name: 'Archivieren' })).toBeNull();
    await user.click(remove);

    // the page leaves at once, in place of itself; undo comes back and deletes nothing
    expect(inertia.visit).toHaveBeenLastCalledWith('/my-items', { replace: true });
    await waitFor(() => expect(lastToast()?.title).toBe('WEB-47 gelöscht'));
    act(() => runToastAction(lastToast()!.id));
    expect(inertia.visit).toHaveBeenLastCalledWith('/items/WEB-47', { replace: true });
    expect(sent('DELETE', '/api/v1/work-items/wi_web_47')).toEqual([]);

    // again, and the toast runs out: deleted
    await user.click(screen.getByRole('button', { name: 'Weitere Aktionen' }));
    await user.click(await screen.findByRole('menuitem', { name: /Löschen/ }));
    act(() => dismissToast(lastToast()!.id));
    await waitFor(() => expect(sent('DELETE', '/api/v1/work-items/wi_web_47')).toHaveLength(1));
    expect(inertia.visit).toHaveBeenCalledTimes(3);
  });

  it('comes back to the page when the delete fails, and stays where the person went meanwhile', async () => {
    const user = userEvent.setup();
    inertia.visit.mockImplementation((url: string) => window.history.replaceState(null, '', url));
    renderWith(<ItemPage itemKey="WEB-47" />, { role: 'admin', routes: { 'DELETE /api/v1/work-items/wi_web_47': () => problem(503, 'unavailable') } });

    await user.click(await screen.findByRole('button', { name: 'Weitere Aktionen' }));
    await user.click(await screen.findByRole('menuitem', { name: /Löschen/ }));
    act(() => dismissToast(lastToast()!.id));
    await waitFor(() => expect(lastToast()).toMatchObject({ title: 'WEB-47 nicht gelöscht', tone: 'error' }));
    expect(inertia.visit).toHaveBeenLastCalledWith('/items/WEB-47', { replace: true });

    // deleted again from the menu, the person goes elsewhere: undo puts the item back but leaves them there
    await user.click(screen.getByRole('button', { name: 'Weitere Aktionen' }));
    await user.click(await screen.findByRole('menuitem', { name: /Löschen/ }));
    window.history.replaceState(null, '', '/projects');
    act(() => runToastAction(currentToasts().find((entry) => entry.title === 'WEB-47 gelöscht')!.id));
    expect(inertia.visit).toHaveBeenCalledTimes(3);
  });

  it('offers a child item on an epic with the type a child takes', async () => {
    const user = userEvent.setup();
    renderWith(<ItemPage itemKey="WEB-30" />);
    await user.click(await screen.findByRole('button', { name: 'Weitere Aktionen' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Kind-Item anlegen …' }));
    expect(useUiStore.getState()).toMatchObject({ createOpen: true, createDefaults: { project_id: 'p_web', parent_id: 'wi_web_30', type_id: 't_task' } });
  });

  it('greys out the child item with the reason when the project enables no type that can be one', async () => {
    const user = userEvent.setup();
    renderWith(<ItemPage itemKey="WEB-30" />, {
      routes: { 'GET /api/v1/projects': () => ({ body: list([project('WEB', 'member', { enabled_type_ids: ['t_epic'], default_type_id: 't_epic' })]) }) },
    });
    await user.click(await screen.findByRole('button', { name: 'Weitere Aktionen' }));
    const entry = await screen.findByRole('menuitem', { name: /Kind-Item anlegen/ });
    expect(entry.textContent).toContain('Im Projekt ist kein Typ aktiviert, der Kind-Item sein kann.');
    expect(entry.hasAttribute('data-disabled')).toBe(true);
    await user.click(entry);
    expect(useUiStore.getState().createOpen).toBe(false);
  });

  it('copies the link', async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('denied'));
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    renderWith(<ItemPage itemKey="WEB-47" />);

    await user.click(await screen.findByRole('button', { name: 'Link kopieren' }));
    expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/items/WEB-47`);
    await waitFor(() => expect(lastToast()).toMatchObject({ title: 'Link zu WEB-47 kopiert', tone: 'success' }));

    await user.click(screen.getByRole('button', { name: 'Link kopieren' }));
    await waitFor(() =>
      expect(lastToast()).toMatchObject({ title: 'Link nicht kopiert', description: `Der Browser erlaubt das Kopieren gerade nicht. Der Link: ${window.location.origin}/items/WEB-47` }),
    );
  });

  it('watches and stops watching', async () => {
    const user = userEvent.setup();
    const watching = (on: boolean) => () => {
      items = items.map((entry) => (entry.id === web47.id ? { ...entry, subscribed: on } : entry));
      return { body: { data: items.find((entry) => entry.id === web47.id) } };
    };
    renderWith(<ItemPage itemKey="WEB-47" />, {
      routes: { 'DELETE /api/v1/work-items/wi_web_47/subscription': watching(false), 'PUT /api/v1/work-items/wi_web_47/subscription': watching(true) },
    });

    const watch = await screen.findByRole('button', { name: 'Beobachten' });
    expect(watch.getAttribute('aria-pressed')).toBe('true');
    await user.click(watch);
    await waitFor(() => expect(lastToast()).toMatchObject({ title: 'Du beobachtest WEB-47 nicht mehr' }));
    expect(sent('DELETE', '/api/v1/work-items/wi_web_47/subscription')).toHaveLength(1);
    await waitFor(() => expect(watch.getAttribute('aria-pressed')).toBe('false'));

    await user.click(watch);
    await waitFor(() => expect(lastToast()).toMatchObject({ title: 'Du beobachtest WEB-47', tone: 'success' }));
    expect(sent('PUT', '/api/v1/work-items/wi_web_47/subscription')).toHaveLength(1);
  });

  it('shows the 404 page for a gone item and an error with retry on 5xx', async () => {
    const user = userEvent.setup();
    let answer: () => { status?: number; body?: unknown } = () => problem(404, 'not_found');
    const view = renderWith(<ItemPage itemKey="WEB-99" />, { routes: { 'GET /api/v1/work-items/WEB-99': () => answer() } });
    expect(await screen.findByRole('heading', { level: 1, name: 'WEB-99 gibt es nicht' })).toBeTruthy();
    expect(screen.getByText(/Kein Item hat diesen Key/)).toBeTruthy();
    view.unmount();

    // the server failed: no 404, an error with "Erneut versuchen"
    answer = () => problem(503, 'unavailable', 'Der Server ist gerade nicht erreichbar.');
    renderWith(<ItemPage itemKey="WEB-99" />, { routes: { 'GET /api/v1/work-items/WEB-99': () => answer() } });
    await screen.findByText('Der Server ist gerade nicht erreichbar.');
    expect(screen.queryByText('WEB-99 gibt es nicht')).toBeNull();
    answer = () => detail({ ...web47, id: 'wi_web_99', number: 99, key: 'WEB-99' });
    await user.click(screen.getByRole('button', { name: 'Erneut versuchen' }));
    expect(await heading()).toBeTruthy();
  });

  it('keeps a loaded item when a reload fails, and shows the 404 page once access is lost', async () => {
    let answer: () => { status?: number; body?: unknown } = () => detail(web47);
    renderWith(<ItemPage itemKey="WEB-47" />, { routes: { 'GET /api/v1/work-items/WEB-47': () => answer() } });
    await heading();

    answer = () => problem(500, 'server_error');
    await act(() => client.refetchQueries({ queryKey: ['work-items', 'detail', 'WEB-47'] }).catch(() => undefined));
    expect(await heading()).toBeTruthy();

    answer = () => problem(403, 'forbidden');
    await act(() => client.refetchQueries({ queryKey: ['work-items', 'detail', 'WEB-47'] }).catch(() => undefined));
    expect(await screen.findByRole('heading', { level: 1, name: 'WEB-47 gibt es nicht' })).toBeTruthy();
  });

  it('replaces the address when the key changed', async () => {
    renderWith(<ItemPage itemKey="WEB-47" />, { routes: { 'GET /api/v1/work-items/WEB-47': () => detail({ ...web47, key: 'SITE-47' }) } });
    await heading();
    await waitFor(() => expect(inertia.replace).toHaveBeenCalledWith({ url: '/items/SITE-47', preserveState: true, preserveScroll: true }));
    expect(document.title).toBe('SITE-47 Kontaktformular sendet doppelt – werkbuch');
  });

  it('keeps the query when it replaces the address, and leaves a current one alone', async () => {
    inertia.url = '/items/web-47?from=mail';
    const view = renderWith(<ItemPage itemKey="WEB-47" />);
    await heading();
    await waitFor(() => expect(inertia.replace).toHaveBeenCalledWith({ url: '/items/WEB-47?from=mail', preserveState: true, preserveScroll: true }));
    view.unmount();

    inertia.replace.mockReset();
    inertia.url = '/items/WEB-47';
    renderWith(<ItemPage itemKey="WEB-47" />);
    await heading();
    expect(inertia.replace).not.toHaveBeenCalled();
  });

  it('shows the time of the organisation, not of Berlin', async () => {
    // 23:30 in UTC is already the next day in Berlin, still the same day in New York
    org = { ...organization, timezone: 'America/New_York' };
    items = items.map((entry) =>
      entry.id === web50.id ? { ...web50, created_at: '2026-10-19T03:30:00.000Z', updated_at: '2026-10-30T23:30:00.000Z', archived_at: '2026-10-30T23:30:00.000Z' } : entry,
    );
    renderWith(<ItemPage itemKey="WEB-50" />);

    expect(await screen.findByText('Archiviert am 30.10.2026.')).toBeTruthy();
    const fields = screen.getByRole('complementary', { name: 'Felder' });
    // created at 03:30 UTC on the 19th: in New York still the 18th
    expect(await within(fields).findByText('18.10.2026')).toBeTruthy();
    expect(within(fields).getByText('30.10.2026')).toBeTruthy();
  });
});

/* -------------------------------------------------------------------------- properties */

describe('properties in the detail', () => {
  /** A bug with the steps as a rich text property, required or not. */
  function withSteps(required: boolean, value: RichText | null = doc('Formular öffnen')) {
    propertyList = [...properties, steps];
    typeList = types.map((type) => (type.id === 't_bug' ? { ...type, properties: [...type.properties, { property_id: 'pr_steps', required, position: 3 }] } : type));
    items = items.map((entry) => (entry.id === web47.id ? { ...web47, values: { ...web47.values, ...(value && { steps: value }) } } : entry));
  }
  const stepsSent = () => sent('PATCH', '/api/v1/work-items/wi_web_47').map((body) => (body as { values: { steps: unknown } }).values.steps);

  it('says when the properties could not be loaded, and loads them again', async () => {
    const user = userEvent.setup();
    let fail = true;
    renderWith(<ItemPeek itemId="wi_web_47" />, { routes: { 'GET /api/v1/properties': () => (fail ? problem(503, 'unavailable', 'Weg.') : { body: list(properties) }) } });
    const props = await screen.findByRole('region', { name: 'Properties' });
    await within(props).findByText('Die Properties ließen sich nicht laden: Weg.');
    fail = false;
    await user.click(within(props).getByRole('button', { name: 'Erneut versuchen' }));
    expect(await within(await screen.findByRole('region', { name: 'Properties' })).findByText('Umgebung')).toBeTruthy();
  });

  it('shows no properties section for a type without properties', async () => {
    typeList = types.map((type) => (type.id === 't_bug' ? { ...type, properties: [] } : type));
    renderWith(<ItemPeek itemId="wi_web_47" />);
    await screen.findByRole('heading', { level: 2, name: 'Kontaktformular sendet doppelt' });
    expect(screen.queryByRole('region', { name: 'Properties' })).toBeNull();
  });

  it('saves a rich text property after a pause, on mod+enter and when the focus leaves it', async () => {
    withSteps(false);
    renderWith(<ItemPeek itemId="wi_web_47" />);
    const editor = await screen.findByRole('textbox', { name: 'Schritte' });
    await waitFor(() => expect(editor.textContent).toBe('Formular öffnen'));

    vi.useFakeTimers({ shouldAdvanceTime: true });
    act(() => editor.focus());
    paste(editor, ' und senden');
    expect(stepsSent()).toEqual([]);
    await act(() => vi.advanceTimersByTimeAsync(SAVE_PAUSE_MS));
    await waitFor(() => expect(stepsSent()).toHaveLength(1));
    vi.useRealTimers();

    paste(editor, ' zweimal');
    fireEvent.keyDown(editor, { key: 'Enter', ctrlKey: true });
    await waitFor(() => expect(stepsSent()).toHaveLength(2));

    paste(editor, '!');
    fireEvent.blur(editor.closest('dd')!, { relatedTarget: document.body });
    await waitFor(() => expect(stepsSent()).toHaveLength(3));
    expect(JSON.stringify(stepsSent()[2])).toContain('!');
  });

  it('shows the refusal of the server at a rich text property', async () => {
    withSteps(true);
    renderWith(<ItemPeek itemId="wi_web_47" />, {
      routes: {
        'PATCH /api/v1/work-items/wi_web_47': () => ({ status: 422, body: { type: 'about:blank', title: 'x', status: 422, reason: 'validation_failed', errors: { 'values.steps': ['Zu lang.'] } } }),
      },
    });
    const editor = await screen.findByRole('textbox', { name: 'Schritte' });
    await waitFor(() => expect(editor.textContent).toBe('Formular öffnen'));

    act(() => editor.focus());
    paste(editor, ' und noch viel mehr');
    fireEvent.keyDown(editor, { key: 'Enter', ctrlKey: true });
    expect(await screen.findByText('Zu lang.')).toBeTruthy();
    expect(editor.getAttribute('aria-invalid')).toBe('true');
  });

  it('refuses to empty a required rich text value', async () => {
    withSteps(true, doc('x'));
    renderWith(<ItemPeek itemId="wi_web_47" />);
    const editor = await screen.findByRole('textbox', { name: 'Schritte' });
    await waitFor(() => expect(editor.textContent).toBe('x'));
    act(() => editor.focus());
    // all of it selected and gone: an empty editor
    fireEvent.keyDown(editor, { key: 'a', ctrlKey: true });
    fireEvent.keyDown(editor, { key: 'Backspace' });
    await waitFor(() => expect(editor.textContent).toBe(''));
    fireEvent.keyDown(editor, { key: 'Enter', ctrlKey: true });
    expect(await screen.findByText('„Schritte“ ist ein Pflichtfeld und lässt sich nicht leeren.')).toBeTruthy();
    expect(stepsSent()).toEqual([]);
  });

  it('says a required rich text value is missing, and shows the value read-only to a viewer', async () => {
    withSteps(true, null);
    const view = renderWith(<ItemPeek itemId="wi_web_47" />);
    expect(await screen.findByText('Pflichtfeld, noch leer. Bitte ergänzen.')).toBeTruthy();
    view.unmount();

    withSteps(false);
    const second = renderWith(<ItemPeek itemId="wi_web_47" />, { role: 'viewer' });
    expect(await screen.findByText('Formular öffnen')).toBeTruthy();
    expect(screen.queryByRole('textbox', { name: 'Schritte' })).toBeNull();
    second.unmount();

    withSteps(false, null);
    renderWith(<ItemPeek itemId="wi_web_47" />, { role: 'viewer' });
    const props = await screen.findByRole('region', { name: 'Properties' });
    await within(props).findByText('Schritte');
    expect(within(props).getAllByText('Kein Wert').length).toBeGreaterThan(0);
  });

  it('saves what was typed while a save was on its way, and does not take back an older text that failed before', async () => {
    withSteps(false);
    let answer: 'fail' | 'ok' = 'fail';
    renderWith(<ItemPeek itemId="wi_web_47" />, {
      routes: {
        'PATCH /api/v1/work-items/wi_web_47': (body) => {
          if (answer === 'fail') return problem(503, 'unavailable');
          const values = (body as { values: WorkItem['values'] }).values;
          items = items.map((entry) => (entry.id === web47.id ? { ...entry, values: { ...entry.values, ...values } } : entry));
          return { body: { data: items.find((entry) => entry.id === web47.id) } };
        },
      },
    });
    const editor = await screen.findByRole('textbox', { name: 'Schritte' });
    await waitFor(() => expect(editor.textContent).toBe('Formular öffnen'));
    act(() => editor.focus());

    // a save fails: the text stays and is still to save
    paste(editor, ' A');
    fireEvent.keyDown(editor, { key: 'Enter', ctrlKey: true });
    await waitFor(() => expect(stepsSent()).toHaveLength(1));
    await waitFor(() => expect(currentToasts().some((entry) => entry.tone === 'error')).toBe(true));
    expect(editor.textContent).toContain(' A');

    // the server has the failed text after all (its retry landed): the newer text is saved again
    answer = 'ok';
    paste(editor, ' B');
    fireEvent.keyDown(editor, { key: 'Enter', ctrlKey: true });
    await waitFor(() => expect(stepsSent()).toHaveLength(2));
    const failed = stepsSent()[0];
    items = items.map((entry) => (entry.id === web47.id ? { ...entry, values: { ...entry.values, steps: failed as RichText } } : entry));
    await act(() => client.refetchQueries({ queryKey: ['work-items'] }));
    await waitFor(() => expect(stepsSent()).toHaveLength(3));
    expect(JSON.stringify(stepsSent()[2])).toContain(' B');

    // typed on while a save was out: that is saved once the first one is through
    vi.useFakeTimers({ shouldAdvanceTime: true });
    paste(editor, ' C');
    fireEvent.keyDown(editor, { key: 'Enter', ctrlKey: true });
    paste(editor, ' D');
    fireEvent.keyDown(editor, { key: 'Enter', ctrlKey: true });
    await waitFor(() => expect(stepsSent()).toHaveLength(4));
    await act(() => vi.advanceTimersByTimeAsync(SAVE_PAUSE_MS));
    await waitFor(() => expect(stepsSent()).toHaveLength(5));
    expect(JSON.stringify(stepsSent()[4])).toContain(' D');
  });
});

/* ------------------------------------------------------------------------------ the preview */

describe('ItemPeek', () => {
  it('shows the item with its project, the page link and a close button', async () => {
    const user = userEvent.setup();
    act(() => useUiStore.getState().openPeek('wi_web_47'));
    renderWith(<ItemPeek itemId="wi_web_47" />);
    expect(screen.getByText('Vorschau wird geladen …')).toBeTruthy();
    await screen.findByRole('heading', { level: 2, name: 'Kontaktformular sendet doppelt' });
    expect((await screen.findAllByText('Website-Relaunch')).length).toBeGreaterThan(0);
    expect(screen.getByRole('link', { name: 'Als Seite öffnen' }).getAttribute('href')).toBe('/items/WEB-47');
    await user.click(screen.getByRole('button', { name: 'Vorschau schließen' }));
    expect(useUiStore.getState().peekItemId).toBeNull();
  });

  it('shows a gone item as gone, also when it was loaded before, and an error on 5xx', async () => {
    const user = userEvent.setup();
    let answer: () => { status?: number; body?: unknown } = () => problem(500, 'server_error', 'Kaputt.');
    act(() => useUiStore.getState().openPeek('wi_web_47'));
    renderWith(<ItemPeek itemId="wi_web_47" />, { routes: { 'GET /api/v1/work-items/wi_web_47': () => answer() } });
    await screen.findByText('Kaputt.');
    expect(screen.queryByText('Dieses Item gibt es nicht mehr')).toBeNull();

    answer = () => detail(web47);
    await user.click(screen.getByRole('button', { name: 'Erneut versuchen' }));
    await screen.findByRole('heading', { level: 2, name: 'Kontaktformular sendet doppelt' });

    answer = () => problem(404, 'not_found');
    await act(() => client.refetchQueries({ queryKey: ['work-items', 'detail', 'wi_web_47'] }).catch(() => undefined));
    expect(await screen.findByText('Dieses Item gibt es nicht mehr')).toBeTruthy();
    expect(screen.queryByRole('heading', { level: 2, name: 'Kontaktformular sendet doppelt' })).toBeNull();
    const closes = screen.getAllByRole('button', { name: 'Vorschau schließen' });
    await user.click(closes.at(-1)!);
    expect(useUiStore.getState().peekItemId).toBeNull();
  });

  it('opens a blocker in the preview', async () => {
    const user = userEvent.setup();
    renderWith(<ItemPeek itemId="wi_web_47" />);
    await screen.findByText('Blockiert, solange OPS-12 offen ist');
    // the banner under the title, before the relations section names it as well
    const [blocker] = await screen.findAllByRole('link', { name: /OPS-12/ });
    expect(screen.getByRole('region', { name: 'Relationen' }).contains(blocker!)).toBe(false);
    await user.click(blocker!);
    expect(useUiStore.getState().peekItemId).toBe('wi_ops_12');
  });
});

/* -------------------------------------------------------------------------------- the host */

/** A phone (below md) or a wider screen: what `matchMedia('(min-width: 48rem)')` answers. */
function screenWidth(wide: boolean) {
  window.matchMedia = vi.fn((media: string) => ({
    matches: wide,
    media,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
}

/** The page with a filter field in its main region, and the host beside it. */
function renderHost() {
  return renderWith(
    <>
      <main id="main" tabIndex={-1}>
        <input aria-label="Filter" />
      </main>
      <PeekHost />
    </>,
  );
}

describe('PeekHost', () => {
  it('opens and closes the preview, escape leaves a field first', async () => {
    screenWidth(true);
    const user = userEvent.setup();
    renderHost();
    const filter = screen.getByRole('textbox', { name: 'Filter' });
    act(() => filter.focus());

    act(() => useUiStore.getState().openPeek('wi_web_47'));
    const panel = await screen.findByRole('complementary', { name: 'Vorschau' });
    await screen.findByRole('heading', { level: 2, name: 'Kontaktformular sendet doppelt' });
    // from md on the page beside it stays usable and keeps the focus
    expect(document.getElementById('main')!.hasAttribute('inert')).toBe(false);
    expect(document.activeElement).toBe(filter);

    // in a field the first Escape leaves the field for the panel, the second closes the preview
    fireEvent.keyDown(filter, { key: 'Escape' });
    expect(useUiStore.getState().peekItemId).toBe('wi_web_47');
    expect(document.activeElement).toBe(panel);

    // e in the panel edits the previewed item's title; its own Escape keeps the preview open
    press('e', {}, panel);
    const title = await screen.findByRole('textbox', { name: 'Titel' });
    await waitFor(() => expect(document.activeElement).toBe(title));
    await user.keyboard('{Escape}');
    expect(useUiStore.getState().peekItemId).toBe('wi_web_47');
    expect(screen.queryByRole('textbox', { name: 'Titel' })).toBeNull();

    // the title's button took the focus back and shows its tooltip: the first Escape closes the tooltip
    act(() => panel.focus());
    fireEvent.keyDown(panel, { key: 'Escape' });
    expect(useUiStore.getState().peekItemId).toBe('wi_web_47');
    fireEvent.keyDown(panel, { key: 'Escape' });
    expect(useUiStore.getState().peekItemId).toBeNull();
    await waitFor(() => expect(screen.queryByRole('complementary', { name: 'Vorschau' })).toBeNull());
  });

  it('leaves e to the page beside it while the focus is there', async () => {
    screenWidth(true);
    renderHost();
    act(() => useUiStore.getState().openPeek('wi_web_47'));
    await screen.findByRole('heading', { level: 2, name: 'Kontaktformular sendet doppelt' });
    const button = document.createElement('button');
    document.getElementById('main')!.append(button);
    act(() => button.focus());
    press('e', {}, button);
    expect(screen.queryByRole('textbox', { name: 'Titel' })).toBeNull();
    button.remove();
  });

  it('below md the preview is modal: the page behind it is inert and the panel has the focus, given back on close', async () => {
    screenWidth(false);
    renderHost();
    const main = document.getElementById('main')!;
    const filter = screen.getByRole('textbox', { name: 'Filter' });
    act(() => filter.focus());

    act(() => useUiStore.getState().openPeek('wi_web_47'));
    const panel = await screen.findByRole('complementary', { name: 'Vorschau' });
    expect(main.hasAttribute('inert')).toBe(true);
    expect(document.activeElement).toBe(panel);

    act(() => useUiStore.getState().openPeek(null));
    expect(main.hasAttribute('inert')).toBe(false);
    expect(document.activeElement).toBe(filter);
  });

  it('closes on a visit to another page, not on one that stays on the same path', async () => {
    renderHost();
    act(() => useUiStore.getState().openPeek('wi_web_47'));
    await screen.findByRole('complementary', { name: 'Vorschau' });
    const arrive = (type: string, url: string) =>
      act(() => inertia.listeners.forEach((event, listener) => event === type && listener({ detail: { page: { url } } })));

    arrive('navigate', '/items/WEB-47?tab=activity');
    expect(useUiStore.getState().peekItemId).toBe('wi_web_47');
    arrive('navigate', '/my-items');
    expect(useUiStore.getState().peekItemId).toBeNull();

    // a visit that replaces the page announces only `success` (deleting the item of the page, a rename's replace)
    act(() => useUiStore.getState().openPeek('wi_web_47'));
    arrive('success', '/my-items');
    expect(useUiStore.getState().peekItemId).toBe('wi_web_47');
    arrive('success', '/items/WEB-30');
    expect(useUiStore.getState().peekItemId).toBeNull();
  });

  it('stops listening when asked', () => {
    const stop = closePeekOnNavigation();
    expect([...inertia.listeners.values()]).toEqual(['navigate', 'success']);
    stop();
    expect(inertia.listeners.size).toBe(0);
  });
});
