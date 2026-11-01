/*
 * The create dialog against a fake REST API (`mockApi`), from the clickdummy's `create.test.tsx`: the title takes the
 * focus, a required property the server asks for shows at its field, mod+enter creates once, "Weitere anlegen" keeps
 * project, type and fields, the status offers the start state and its moves, a closed draft comes back with undo, a
 * failed reload keeps the draft, a stale refusal disappears with a change, an item created while the dialog closed
 * parks nothing, and a viewer is told why. Also the host (`c`, lazy) and "Neues Item" of "Meine Items".
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StrictMode, type ReactNode } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { currentToasts, resetToasts, runToastAction } from '@/components/ui/toast';
import { preloadEditor } from '@/editor/RichTextEditor';
import { MyItemsEmpty } from '@/features/items/MyItemsEmpty';
import { canUndo, undoLatest } from '@/lib/undo';
import { CreateHost } from '@/shell/CreateHost';
import { useUiStore, type CreateDefaults } from '@/store/ui';
import { mockApi, type MockApi, type MockRoute } from '@/test/api';
import { agency, ida, labels, lene, list, makeWorkItem, mara, organization, project, properties, queryItems, standard, types, web30, web47, web48 } from '@/test/fixtures';
import type { Project, Property, User, WorkItem } from '@/types';
import { CreateItemDialog } from './CreateItemDialog';

const inertia = vi.hoisted(() => ({ url: '/my-items' }));
let signedIn: User = lene;

vi.mock('@inertiajs/react', () => ({
  usePage: () => ({ props: { auth: { user: signedIn, permissions: [] }, organization }, url: inertia.url }),
  router: { visit: vi.fn(), replace: vi.fn(), on: () => () => {} },
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

const web = project('WEB', 'member', { name: 'Website-Relaunch' });
/** APP runs the agency workflow and takes customer wishes. */
const app = project('APP', 'member', { name: 'Kunden-App', workflow_id: 'wf_agency', enabled_type_ids: ['t_task', 't_bug', 't_epic', 't_wish'] });
const ops = project('OPS', 'viewer', { name: 'Betrieb', visibility: 'private' });
/** Whether the customer has signed the change off: a yes/no that wishes require. */
const approved: Property = { id: 'pr_approved', key: 'approved', label: 'Abgenommen', field_type: 'boolean', help: '', default_value: null, settings: {}, options: [] };
const ticket: Property = { id: 'pr_ticket', key: 'ticket_url', label: 'Ticket', field_type: 'url', help: '', default_value: null, settings: {}, options: [] };
const notes: Property = { id: 'pr_notes', key: 'notes', label: 'Notizen', field_type: 'rich_text', help: '', default_value: null, settings: {}, options: [] };
const wishTypes = types.map((type) =>
  type.id === 't_wish'
    ? {
        ...type,
        properties: [
          { property_id: 'pr_customer', required: true, position: 0 },
          { property_id: 'pr_approved', required: true, position: 1 },
          { property_id: 'pr_ticket', required: false, position: 2 },
          { property_id: 'pr_notes', required: false, position: 3 },
        ],
      }
    : type,
);
const catalog = [...properties, approved, ticket, notes];

const problem = (status: number, reason: string, detail: string, errors?: Record<string, string[]>) => ({
  status,
  body: { type: 'about:blank', title: reason, status, reason, detail, ...(errors && { errors }) },
});
const invalid = (errors: Record<string, string[]>) => problem(422, 'validation_failed', 'Die Eingabe ist ungültig.', errors);

let projects: Project[] = [];
let failing: Set<string>;
let number = 51;
/** What `POST /work-items` answers; by default the new item, numbered on. */
let answerCreate: MockRoute;

const created = (body: unknown): { status: number; body: { data: WorkItem } } => {
  const input = body as { project_id: string; title: string; type_id: string };
  const identifier = projects.find((entry) => entry.id === input.project_id)!.identifier;
  number += 1;
  return { status: 201, body: { data: makeWorkItem({ id: `wi_new_${number}`, number, key: `${identifier}-${number}`, project_id: input.project_id, type_id: input.type_id, title: input.title }) } };
};

/* ------------------------------------------------------------------------ render */

let api: MockApi | undefined;
let client: QueryClient;

function renderWith(node: ReactNode, routes: Record<string, MockRoute> = {}) {
  const fails = (path: string, answer: (body: unknown) => { body: unknown }) => (body: unknown) =>
    failing.has(path) ? problem(503, 'service_unavailable', 'Der Server ist gerade nicht erreichbar.') : answer(body);
  api = mockApi({
    'GET /api/v1/organization': () => ({ body: { data: organization } }),
    'GET /api/v1/projects': fails('projects', () => ({ body: list(projects) })),
    'GET /api/v1/workflows': fails('workflows', () => ({ body: list([standard, agency]) })),
    'GET /api/v1/work-item-types': fails('types', () => ({ body: list(wishTypes) })),
    'GET /api/v1/properties': fails('properties', () => ({ body: list(catalog) })),
    'GET /api/v1/labels': fails('labels', () => ({ body: list(labels) })),
    'GET /api/v1/users': () => ({ body: list([mara, ida, lene]) }),
    'GET /api/v1/projects/p_web/members': () => ({ body: list([{ project_id: 'p_web', user_id: 'u_ida', role: 'admin' }, { project_id: 'p_web', user_id: 'u_lene', role: 'member' }]) }),
    'GET /api/v1/projects/p_app/members': () => ({ body: list([{ project_id: 'p_app', user_id: 'u_lene', role: 'member' }]) }),
    'POST /api/v1/work-items/query': fails('items', (body) => ({ body: list(queryItems([web30, web47, web48], body)) })),
    'GET /api/v1/work-items/wi_web_30': () => ({ body: { data: { ...web30, children: [], relations: [], type: wishTypes.find((type) => type.id === web30.type_id), workflow: standard } } }),
    'POST /api/v1/work-items': (body, url) => answerCreate(body, url),
    ...routes,
  });
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>);
}

/** The dialog as it is opened with `defaults`; `onOpenChange` records the closing. */
async function openDialog(defaults: CreateDefaults | null = { project_id: 'p_web' }, routes: Record<string, MockRoute> = {}) {
  const onOpenChange = vi.fn();
  renderWith(<CreateItemDialog open defaults={defaults} onOpenChange={onOpenChange} />, routes);
  const dialog = await screen.findByRole('dialog', { name: 'Neues Item' });
  const title = await within(dialog).findByRole<HTMLInputElement>('textbox', { name: /^Titel/ });
  return { dialog, title, onOpenChange };
}

/** The dialog as `CreateHost` mounts it: open while the store says so. */
function Host() {
  const open = useUiStore((state) => state.createOpen);
  const defaults = useUiStore((state) => state.createDefaults);
  return <CreateItemDialog open={open} defaults={defaults} onOpenChange={(next) => !next && useUiStore.getState().closeCreate()} />;
}

const posts = () => api!.calls.filter((call) => call.method === 'POST' && call.url === '/api/v1/work-items').map((call) => call.body as Record<string, unknown>);
const toastTitles = () => currentToasts().map((entry) => entry.title);
const parkedToasts = () => currentToasts().filter((entry) => entry.title === 'Entwurf verworfen');
/** mod+enter where the focus is (Ctrl in jsdom, which is no Mac). */
const modEnter = (init: KeyboardEventInit = {}) =>
  act(() => {
    (document.activeElement ?? document.body).dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true, cancelable: true, ...init }));
  });
/** Opens a picker or select in the dialog and chooses `option`. */
async function choose(user: ReturnType<typeof userEvent.setup>, trigger: HTMLElement, option: string | RegExp) {
  await user.click(trigger);
  await user.click(await screen.findByRole('option', { name: option }));
}

/**
 * Holds the answers of `POST /work-items` until `release`: the dialog is pending meanwhile. The calls reach the fake API
 * (and its `calls`) only on release; `held()` counts them before.
 */
function holdCreates() {
  const real = globalThis.fetch;
  const waiting: (() => void)[] = [];
  globalThis.fetch = (input: RequestInfo | URL, init: RequestInit = {}) =>
    init.method === 'POST' ? new Promise<Response>((resolve) => waiting.push(() => resolve(real(input, init)))) : real(input, init);
  return {
    held: () => waiting.length,
    release: () =>
      act(async () => {
        globalThis.fetch = real;
        waiting.splice(0).forEach((resume) => resume());
      }),
  };
}

beforeEach(() => {
  useUiStore.setState(useUiStore.getInitialState());
  signedIn = lene;
  inertia.url = '/my-items';
  projects = [web, app, ops];
  failing = new Set();
  answerCreate = created;
  number = 51;
});

afterEach(() => {
  act(() => resetToasts());
  api?.restore();
  vi.useRealTimers();
});

/* ------------------------------------------------------------------------- tests */

describe('CreateItemDialog', () => {
  it('keeps the dialog when the project of the draft disappears and says so', async () => {
    const user = userEvent.setup();
    const { dialog, title } = await openDialog({ project_id: 'p_app', type_id: 't_wish' });
    await user.type(title, 'Export als CSV');

    // the project is archived while the dialog is open
    projects = [web, { ...app, archived_at: '2026-10-01T00:00:00Z' }, ops];
    await act(() => client.invalidateQueries());
    const project = await within(dialog).findByRole('combobox', { name: /^Projekt/ });
    await waitFor(() => expect(project.textContent).toContain('Website-Relaunch'));
    expect(within(dialog).getByText('„Kunden-App“ steht nicht mehr zur Wahl. Prüfe Projekt und Typ.')).toBeTruthy();
    await waitFor(() => expect(document.activeElement).toBe(project));
    // the title stays, the type falls back to the default of the project
    expect((title as HTMLInputElement).value).toBe('Export als CSV');
    expect(within(dialog).getByRole('combobox', { name: /^Typ/ }).textContent).toContain('Task');
  });

  it('keeps the dialog when the type of the draft is switched off', async () => {
    const user = userEvent.setup();
    const { dialog, title } = await openDialog({ project_id: 'p_app', type_id: 't_wish' });
    await user.type(title, 'Export als CSV');

    projects = [web, { ...app, enabled_type_ids: ['t_task', 't_bug', 't_epic'] }, ops];
    await act(() => client.invalidateQueries());
    await waitFor(() => expect(within(dialog).getByRole('combobox', { name: /^Typ/ }).textContent).toContain('Task'));
    expect(within(dialog).getByText(/steht nicht mehr zur Wahl/).textContent).toContain('Kundenwunsch');
    expect(within(dialog).getByRole('combobox', { name: /^Projekt/ }).textContent).toContain('Kunden-App');
  });

  it('says so and sends nothing when no project takes items any more', async () => {
    const { dialog, title } = await openDialog({ project_id: 'p_web' });
    await waitFor(() => expect(document.activeElement).toBe(title));
    projects = [ops];
    await act(() => client.invalidateQueries());
    expect(await within(dialog).findByText('Hier kannst du kein Item anlegen')).toBeTruthy();
    await modEnter();
    expect(posts()).toEqual([]);
  });

  it('starts in the title', async () => {
    const { dialog, title } = await openDialog(null);
    await waitFor(() => expect(document.activeElement).toBe(title));
    // the first project that takes items, its default type, the start state of its workflow
    expect(within(dialog).getByRole('combobox', { name: /^Projekt/ }).textContent).toContain('Website-Relaunch');
    expect(within(dialog).getByRole('combobox', { name: /^Typ/ }).textContent).toContain('Task');
    expect(within(dialog).getByRole('combobox', { name: 'Status: Backlog' })).toBeTruthy();
    // the properties of the type, none of them required
    expect(within(dialog).getByRole('heading', { name: 'Properties von Task' })).toBeTruthy();
  });

  it('starts in the project of the screen behind it', async () => {
    inertia.url = '/items/app-3?tab=history';
    const { dialog } = await openDialog(null);
    expect(within(dialog).getByRole('combobox', { name: /^Projekt/ }).textContent).toContain('Kunden-App');
  });

  it('drops the refusal of a property the new type does not have when the type changes', async () => {
    const user = userEvent.setup();
    answerCreate = () => invalid({ 'values.approved': ['„Abgenommen“ fehlt.'] });
    const { dialog, title } = await openDialog({ project_id: 'p_app', type_id: 't_wish' });

    await user.type(title, 'Export als CSV');
    await modEnter();
    expect(await within(dialog).findByText('„Abgenommen“ fehlt.')).toBeTruthy();
    // a task has no sign-off: the refusal does not move to the banner on top
    await choose(user, within(dialog).getByRole('combobox', { name: /^Typ/ }), 'Task');
    await waitFor(() => expect(within(dialog).queryByText('„Abgenommen“ fehlt.')).toBeNull());
    expect(within(dialog).queryByRole('alert')).toBeNull();
  });

  it('marks a missing required property at its field and keeps the dialog open', async () => {
    const user = userEvent.setup();
    answerCreate = (body) =>
      (body as { values: Record<string, unknown> }).values.customer ? created(body) : invalid({ 'values.customer': ['„Kunde“ ist ein Pflichtfeld.'] });
    const { dialog, title, onOpenChange } = await openDialog({ project_id: 'p_app', type_id: 't_wish' });

    await user.type(title, 'Export als CSV');
    await modEnter();
    const customer = await within(dialog).findByRole('combobox', { name: /^Kunde/ });
    await waitFor(() => expect(customer.getAttribute('aria-invalid')).toBe('true'));
    expect(within(dialog).getByText('„Kunde“ ist ein Pflichtfeld.')).toBeTruthy();
    expect(document.activeElement).toBe(customer);
    expect(onOpenChange).not.toHaveBeenCalled();
    // a required yes/no reads "Nein" and goes out as false
    expect(posts()[0]!.values).toEqual({ approved: false });

    await choose(user, customer, 'Hafenkontor');
    await waitFor(() => expect(within(dialog).queryByText('„Kunde“ ist ein Pflichtfeld.')).toBeNull());
    await modEnter();
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(posts()[1]).toMatchObject({ project_id: 'p_app', type_id: 't_wish', title: 'Export als CSV', values: { approved: false, customer: 'opt_hafenkontor' } });
    expect(toastTitles()).toContain('APP-52 angelegt');
  });

  it('creates with mod+enter once and offers to open the item', async () => {
    const user = userEvent.setup();
    const { title, onOpenChange } = await openDialog();
    await user.type(title, 'Impressum aktualisieren');

    const hold = holdCreates();
    // pressed twice at once, then held: one item
    await modEnter();
    await modEnter({ repeat: true });
    await act(async () => {
      document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true, cancelable: true }));
      document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true, cancelable: true }));
    });
    await waitFor(() => expect(hold.held()).toBe(1));
    // pressed again while the call runs: still one
    await modEnter();
    await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
    expect(hold.held()).toBe(1);
    await hold.release();

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(posts()).toHaveLength(1);
    expect(posts()[0]).toEqual({
      project_id: 'p_web',
      type_id: 't_task',
      title: 'Impressum aktualisieren',
      description_json: null,
      assignee_id: null,
      priority: 'none',
      label_ids: [],
      start_date: null,
      due_date: null,
      parent_id: null,
      values: {},
    });
    const done = currentToasts().find((entry) => entry.title === 'WEB-52 angelegt')!;
    expect([done.description, done.tone, done.action?.label]).toEqual(['Impressum aktualisieren', 'success', 'Öffnen']);
    expect(useUiStore.getState().flashIds).toEqual(['wi_new_52']);
    act(() => runToastAction(done.id));
    expect(useUiStore.getState().peekItemId).toBe('wi_new_52');
    // nothing was left to park
    expect(parkedToasts()).toEqual([]);
  });

  it('creates nothing more once the item was created, also while the dialog closes', async () => {
    const user = userEvent.setup();
    // the parent has not closed it yet: the form is still there, with the title it sent
    const { dialog, title, onOpenChange } = await openDialog();
    await user.type(title, 'Impressum aktualisieren');
    await modEnter();
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));

    // mod+enter again, the button, and Enter in the title (the form's submit)
    await modEnter();
    await user.click(within(dialog).getByRole('button', { name: /^Anlegen/ }));
    fireEvent.submit(title.form!);
    await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
    expect(posts()).toHaveLength(1);
  });

  it('creates nothing more when mod+enter comes while the dialog animates out', async () => {
    const user = userEvent.setup();
    renderWith(<Host />);
    act(() => useUiStore.getState().openCreate({ project_id: 'p_web' }));
    const dialog = await screen.findByRole('dialog', { name: 'Neues Item' });
    await user.type(await within(dialog).findByRole('textbox', { name: /^Titel/ }), 'Impressum aktualisieren');

    // the closing animation runs until `finish`: jsdom has none, so Base UI would unmount the popup at once
    let finish!: () => void;
    const fading = { pending: false, playState: 'running', effect: { getTiming: () => ({ duration: 160, iterations: 1 }) }, finished: new Promise<void>((resolve) => (finish = resolve)) };
    Element.prototype.getAnimations = () => [fading as unknown as Animation];
    try {
      await modEnter();
      await waitFor(() => expect(toastTitles()).toContain('WEB-52 angelegt'));
      await waitFor(() => expect(useUiStore.getState().createOpen).toBe(false));
      // the form is still there, fading out, with its mod+enter registered
      expect(document.querySelector('[role="dialog"]')).not.toBeNull();
      await modEnter();
      await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
      expect(posts()).toHaveLength(1);
    } finally {
      fading.playState = 'finished';
      await act(async () => finish());
    }
    // Base UI looks once more for animations before it lets go of the popup
    await waitFor(() => expect(document.querySelector('[role="dialog"]')).toBeNull());
    delete (Element.prototype as Partial<Element>).getAnimations;
    expect(toastTitles().filter((title) => title.endsWith('angelegt'))).toEqual(['WEB-52 angelegt']);
  });

  it('keeps project, type and fields for another item', async () => {
    const user = userEvent.setup();
    const { dialog, title, onOpenChange } = await openDialog({ project_id: 'p_web', type_id: 't_bug' });
    await user.click(within(dialog).getByRole('switch', { name: 'Weitere anlegen' }));

    await choose(user, within(dialog).getByRole('combobox', { name: 'Priorität: None' }), 'High');
    await choose(user, within(dialog).getByRole('combobox', { name: 'Assignee: Nicht zugewiesen' }), 'Ida Brenner');
    await choose(user, within(dialog).getByRole('combobox', { name: 'Labels: keine' }), 'UX');
    await user.keyboard('{Escape}');
    await choose(user, within(dialog).getByRole('combobox', { name: /^Umgebung/ }), 'Produktion');
    await user.type(within(dialog).getByRole('textbox', { name: 'Aufwand (h)' }), '2,5');
    await user.type(title, 'Formular-Fehler auf Android');
    await modEnter();

    await waitFor(() => expect(toastTitles()).toContain('WEB-52 angelegt'));
    await waitFor(() => expect(title.value).toBe(''));
    expect(document.activeElement).toBe(title);
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(posts()[0]).toMatchObject({ type_id: 't_bug', priority: 'high', assignee_id: 'u_ida', label_ids: ['lb_ux'], values: { environment: 'opt_env_prod', effort: 2.5 } });
    // the fields stay, the properties start empty
    expect(within(dialog).getByRole('combobox', { name: 'Priorität: High' })).toBeTruthy();
    expect(within(dialog).getByRole('combobox', { name: 'Assignee: Ida Brenner' })).toBeTruthy();
    expect(within(dialog).getByRole<HTMLInputElement>('textbox', { name: 'Aufwand (h)' }).value).toBe('');

    await choose(user, within(dialog).getByRole('combobox', { name: /^Umgebung/ }), 'Staging');
    await user.type(title, 'Formular-Fehler auf iOS');
    await modEnter();
    await waitFor(() => expect(toastTitles()).toContain('WEB-53 angelegt'));
    expect(posts()[1]).toMatchObject({ project_id: 'p_web', type_id: 't_bug', title: 'Formular-Fehler auf iOS', priority: 'high', assignee_id: 'u_ida', label_ids: ['lb_ux'], values: { environment: 'opt_env_staging' } });
  });

  it('offers only the start state and the states it may reach', async () => {
    const user = userEvent.setup();
    const { dialog, title } = await openDialog({ project_id: 'p_app' });

    await user.click(within(dialog).getByRole('combobox', { name: 'Status: Backlog' }));
    const options = await screen.findAllByRole('option');
    expect(options.map((option) => option.textContent)).toEqual(['Backlog', 'Todo', 'Cancelled']);
    await user.click(screen.getByRole('option', { name: 'Todo' }));
    await user.type(title, 'Startseite freigeben');
    await modEnter();
    await waitFor(() => expect(posts()).toHaveLength(1));
    expect(posts()[0]!.state_id).toBe('app_todo');
  });

  it('takes the state of the defaults only when the workflow offers it from the start', async () => {
    const user = userEvent.setup();
    const { dialog, title } = await openDialog({ project_id: 'p_app', state_id: 'app_done' });
    expect(within(dialog).getByRole('combobox', { name: 'Status: Backlog' })).toBeTruthy();
    // to Todo and back: the start state goes out as none
    await choose(user, within(dialog).getByRole('combobox', { name: 'Status: Backlog' }), 'Todo');
    await choose(user, within(dialog).getByRole('combobox', { name: 'Status: Todo' }), 'Backlog');
    await user.type(title, 'Kundenfreigabe einholen');
    await modEnter();
    await waitFor(() => expect(posts()).toHaveLength(1));
    expect(posts()[0]).not.toHaveProperty('state_id');
  });

  it('brings a closed draft back with undo', async () => {
    const user = userEvent.setup();
    act(() => useUiStore.getState().openCreate({ project_id: 'p_web' }));
    renderWith(
      <StrictMode>
        <CreateHost />
      </StrictMode>,
    );
    const dialog = await screen.findByRole('dialog', { name: 'Neues Item' });
    await user.type(await within(dialog).findByRole('textbox', { name: /^Titel/ }), 'Export als CSV');
    await user.click(within(dialog).getByRole('button', { name: 'Abbrechen' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(parkedToasts().map((entry) => entry.description)).toEqual(['Export als CSV']);

    // mod+z presses "Rückgängig" on the toast: the dialog comes back with the draft, and parks nothing on the way
    act(() => void undoLatest());
    const restored = await screen.findByRole('dialog', { name: 'Neues Item' });
    expect((await within(restored).findByRole<HTMLInputElement>('textbox', { name: /^Titel/ })).value).toBe('Export als CSV');
    expect(parkedToasts()).toEqual([]);

    await modEnter();
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(posts()).toHaveLength(1);
    // created: no draft parked, mod+z cannot bring it back again
    expect(parkedToasts()).toEqual([]);
    expect(canUndo()).toBe(false);
  });

  it('parks nothing when the dialog closes empty, and a draft without a title by its words', async () => {
    const user = userEvent.setup();
    renderWith(<Host />);
    act(() => useUiStore.getState().openCreate());
    let dialog = await screen.findByRole('dialog', { name: 'Neues Item' });
    await within(dialog).findByRole('textbox', { name: /^Titel/ });
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(parkedToasts()).toEqual([]);

    act(() => useUiStore.getState().openCreate({ project_id: 'p_web', type_id: 't_task' }));
    dialog = await screen.findByRole('dialog', { name: 'Neues Item' });
    await user.type(await within(dialog).findByRole('textbox', { name: 'Aufwand (h)' }), '3');
    await user.click(within(dialog).getByRole('button', { name: 'Abbrechen' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(parkedToasts().map((entry) => entry.description)).toEqual(['Ein neues Item ohne Titel']);
  });

  it('keeps the draft when a catalog fails to reload', async () => {
    const user = userEvent.setup();
    const { dialog, title } = await openDialog();
    await user.type(title, 'Export als CSV');

    failing = new Set(['types', 'workflows']);
    await act(() => client.refetchQueries());
    expect(within(dialog).queryByRole('alert')).toBeNull();
    expect(title.value).toBe('Export als CSV');
    expect(title.isConnected).toBe(true);
  });

  it('says so when the form cannot load, and tries again', async () => {
    const user = userEvent.setup();
    failing = new Set(['properties']);
    renderWith(<CreateItemDialog open defaults={null} onOpenChange={vi.fn()} />);
    const dialog = await screen.findByRole('dialog', { name: 'Neues Item' });
    const alert = await within(dialog).findByRole('alert');
    expect(alert.textContent).toContain('Das Formular ließ sich nicht laden: Der Server ist gerade nicht erreichbar.');
    expect(within(dialog).getByRole('button', { name: /^Anlegen/ }).getAttribute('aria-disabled')).toBe('true');

    failing = new Set();
    await user.click(within(alert).getByRole('button', { name: 'Erneut versuchen' }));
    expect(await within(dialog).findByRole('textbox', { name: /^Titel/ })).toBeTruthy();
    await waitFor(() => expect(within(dialog).getByRole('button', { name: /^Anlegen/ }).hasAttribute('aria-disabled')).toBe(false));
  });

  it('clears a stale server error when the field changes', async () => {
    const user = userEvent.setup();
    answerCreate = () =>
      invalid({
        title: ['Der Titel ist schon vergeben.'],
        type_id: ['Der Typ ist im Projekt nicht aktiviert.'],
        state_id: ['Der Status gehört nicht zum Workflow.'],
        priority: ['Die Priorität gibt es nicht.'],
        assignee_id: ['Ida kann hier nichts übernehmen.'],
        label_ids: ['Ein Label gibt es nicht mehr.'],
        due_date: ['Das Due-Date liegt vor dem Start.'],
        parent_id: ['Das Eltern-Item gibt es nicht mehr.'],
        description_json: ['Die Beschreibung ist zu lang.'],
        'values.effort': ['Der Aufwand ist zu groß.'],
        'values.environment': ['Die Umgebung gibt es nicht mehr.'],
        filter: ['Ein Feld, das der Dialog nicht kennt.'],
      });
    const { dialog, title } = await openDialog({ project_id: 'p_web', type_id: 't_task' });
    await user.type(title, 'Export als CSV');
    await modEnter();

    const shown = (text: string) => within(dialog).queryByText(text) !== null;
    await waitFor(() => expect(shown('Der Titel ist schon vergeben.')).toBe(true));
    // the first field the server refused takes the focus; a refusal without a field of its own stands on top
    expect(document.activeElement).toBe(within(dialog).getByRole('combobox', { name: /^Typ/ }));
    const banner = within(dialog).getByRole('alert');
    expect(banner.textContent).toContain('Nicht angelegt');
    expect(banner.textContent).toContain('Ein Feld, das der Dialog nicht kennt.');
    // a property the type does not show says so on top too
    expect(banner.textContent).toContain('Die Umgebung gibt es nicht mehr.');
    expect(within(dialog).getByRole('combobox', { name: 'Assignee: Nicht zugewiesen' }).getAttribute('aria-describedby')).toBeTruthy();

    await user.type(title, '!');
    expect(shown('Der Titel ist schon vergeben.')).toBe(false);
    await choose(user, within(dialog).getByRole('combobox', { name: 'Status: Backlog' }), 'Todo');
    expect(shown('Der Status gehört nicht zum Workflow.')).toBe(false);
    await choose(user, within(dialog).getByRole('combobox', { name: 'Priorität: None' }), 'Low');
    expect(shown('Die Priorität gibt es nicht.')).toBe(false);
    await choose(user, within(dialog).getByRole('combobox', { name: 'Assignee: Nicht zugewiesen' }), 'Lene Vogt');
    expect(shown('Ida kann hier nichts übernehmen.')).toBe(false);
    await choose(user, within(dialog).getByRole('combobox', { name: 'Labels: keine' }), 'UX');
    await user.keyboard('{Escape}');
    expect(shown('Ein Label gibt es nicht mehr.')).toBe(false);
    await choose(user, within(dialog).getByRole('combobox', { name: 'Eltern-Item: keins' }), /^Relaunch Phase 1/);
    expect(shown('Das Eltern-Item gibt es nicht mehr.')).toBe(false);
    await user.type(within(dialog).getByRole('textbox', { name: 'Aufwand (h)' }), '4');
    expect(shown('Der Aufwand ist zu groß.')).toBe(false);
    const description = within(dialog).getByRole('textbox', { name: 'Beschreibung' });
    expect(description.getAttribute('aria-invalid')).toBe('true');
    await user.click(description);
    await user.keyboard('Nur die Spalten der Liste');
    await waitFor(() => expect(shown('Die Beschreibung ist zu lang.')).toBe(false));
    await choose(user, within(dialog).getByRole('combobox', { name: /^Typ/ }), 'Bug');
    expect(shown('Der Typ ist im Projekt nicht aktiviert.')).toBe(false);
    // the type asks for the environment now: its refusal moves from the top to the field
    expect(within(dialog).getByText('Die Umgebung gibt es nicht mehr.').closest('[role="alert"]')).toBeNull();
    // another project starts clean
    await choose(user, within(dialog).getByRole('combobox', { name: /^Projekt/ }), 'Kunden-App');
    expect(shown('Das Due-Date liegt vor dem Start.')).toBe(false);
    expect(within(dialog).queryByRole('alert')).toBeNull();
    // the type stays where the new project has it, and the values of its properties with it
    expect(within(dialog).getByRole('combobox', { name: /^Typ/ }).textContent).toContain('Bug');
    expect(within(dialog).getByRole<HTMLInputElement>('textbox', { name: 'Aufwand (h)' }).value).toBe('4');
  });

  it('refuses a start after the due date and clears the due date error with a new day', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-31T10:00:00.000Z'));
    const user = userEvent.setup();
    answerCreate = () => invalid({ due_date: ['Das Due-Date liegt vor dem Start.'] });
    const { dialog, title } = await openDialog();
    const day = (iso: string) => document.querySelector<HTMLButtonElement>(`[data-day="${iso}"]`)!;

    await user.click(within(dialog).getByRole('button', { name: 'Due-Date: nicht gesetzt' }));
    await user.click(day('2026-11-04'));
    await user.click(within(dialog).getByRole('button', { name: 'Start-Date: nicht gesetzt' }));
    await user.click(day('2026-11-06'));
    expect(await screen.findByText('Der Start läge nach dem Due-Date (04.11.2026). Verschiebe zuerst das Due-Date.')).toBeTruthy();
    await user.click(day('2026-11-02'));
    await waitFor(() => expect(within(dialog).getByRole('button', { name: /^Start-Date: 02.11.2026/ })).toBeTruthy());
    await user.click(within(dialog).getByRole('button', { name: /^Due-Date: 04.11.2026/ }));
    await user.click(day('2026-11-01'));
    expect(await screen.findByText('Das Due-Date läge vor dem Start (02.11.2026). Verschiebe zuerst den Start.')).toBeTruthy();
    await user.keyboard('{Escape}');

    await user.type(title, 'Newsletter verschicken');
    await modEnter();
    const due = within(dialog).getByRole('button', { name: /^Due-Date: 04.11.2026/ });
    await waitFor(() => expect(due.getAttribute('aria-invalid')).toBe('true'));
    expect(posts()[0]).toMatchObject({ start_date: '2026-11-02', due_date: '2026-11-04' });
    await user.click(due);
    await user.click(day('2026-11-05'));
    await waitFor(() => expect(within(dialog).queryByText('Das Due-Date liegt vor dem Start.')).toBeNull());
  });

  it('asks for a title, and for no more than the server takes', async () => {
    const user = userEvent.setup();
    const { dialog, title } = await openDialog();
    await user.type(title, '   ');
    await modEnter();
    expect(await within(dialog).findByText('Gib dem Item einen Titel.')).toBeTruthy();
    expect(document.activeElement).toBe(title);

    await user.clear(title);
    await user.click(title);
    await user.paste('x'.repeat(256));
    await modEnter();
    expect(await within(dialog).findByText('Höchstens 255 Zeichen, jetzt sind es 256.')).toBeTruthy();
    expect(posts()).toEqual([]);

    // characters count as the server counts them: 200 emoji are 400 UTF-16 units, and well inside
    await user.clear(title);
    await user.click(title);
    await user.paste('🚀'.repeat(200));
    await modEnter();
    await waitFor(() => expect(posts()).toHaveLength(1));
  });

  it('waits while a property still shows a text it cannot read', async () => {
    const user = userEvent.setup();
    const { dialog, title } = await openDialog({ project_id: 'p_app', type_id: 't_wish' });
    await user.type(title, 'Ticket verlinken');
    const url = within(dialog).getByRole('textbox', { name: 'Ticket' });
    await user.type(url, 'kein link');
    await user.click(within(dialog).getByRole('button', { name: /^Anlegen/ }));

    expect(await within(dialog).findByText('Noch nicht angelegt')).toBeTruthy();
    expect(document.activeElement).toBe(url);
    expect(url.getAttribute('aria-invalid')).toBe('true');
    expect(posts()).toEqual([]);

    // readable again: the notice goes, and the rich text of a property spans the grid
    await user.clear(url);
    await user.type(url, 'https://tickets.example.com/42');
    await waitFor(() => expect(within(dialog).queryByText('Noch nicht angelegt')).toBeNull());
    expect(within(dialog).getByRole('textbox', { name: 'Notizen' }).closest('.md\\:col-span-2')).toBeTruthy();
  });

  it('shows another refusal on top and offers a retry when the server did not answer', async () => {
    const user = userEvent.setup();
    let calls = 0;
    answerCreate = (body) => {
      calls += 1;
      if (calls === 1) return problem(409, 'project_archived', 'Das Projekt WEB ist archiviert.');
      if (calls === 2) return problem(503, 'service_unavailable', 'Der Server ist gerade nicht erreichbar.');
      return created(body);
    };
    const { dialog, title, onOpenChange } = await openDialog();
    await user.type(title, 'Export als CSV');
    await modEnter();
    const banner = await within(dialog).findByRole('alert');
    expect(banner.textContent).toContain('Das Projekt WEB ist archiviert.');

    await modEnter();
    await waitFor(() => expect(toastTitles()).toContain('Item nicht angelegt'));
    const failed = currentToasts().find((entry) => entry.title === 'Item nicht angelegt')!;
    expect(failed.action?.label).toBe('Erneut versuchen');
    act(() => runToastAction(failed.id));
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(posts()).toHaveLength(3);
  });

  it('offers the epics of the project as parents, and sends none for an epic', async () => {
    const user = userEvent.setup();
    // as "Kind-Item" on WEB-30 opens it
    const { dialog, title } = await openDialog({ project_id: 'p_web', type_id: 't_task', parent_id: 'wi_web_30' });
    const parent = await within(dialog).findByRole('combobox', { name: 'Eltern-Item: WEB-30 Relaunch Phase 1' });
    // the parent it was opened with is its detail; the items of the project load only when the list opens (A153)
    const projectLists = () => api!.calls.filter((call) => call.method === 'POST' && call.url === '/api/v1/work-items/query');
    expect(projectLists()).toEqual([]);
    await user.click(parent);
    await waitFor(() => expect(projectLists()).toHaveLength(1));
    const options = await screen.findAllByRole('option');
    expect(options.map((option) => option.textContent)).toEqual(['Kein Eltern-Item', 'Relaunch Phase 1WEB-30']);
    await user.keyboard('{Escape}');

    // an epic stands at the top: no parent field, and the parent it held is not sent
    await choose(user, within(dialog).getByRole('combobox', { name: /^Typ/ }), 'Epic');
    await waitFor(() => expect(within(dialog).queryByRole('combobox', { name: /^Eltern-Item/ })).toBeNull());
    await user.type(title, 'Relaunch Phase 2');
    await modEnter();
    await waitFor(() => expect(posts()).toHaveLength(1));
    expect(posts()[0]).toMatchObject({ type_id: 't_epic', parent_id: null });
  });

  it('tries the labels and the epics again when they failed to load', async () => {
    const user = userEvent.setup();
    failing = new Set(['labels', 'items']);
    const { dialog } = await openDialog();

    await user.click(within(dialog).getByRole('combobox', { name: 'Labels: keine' }));
    failing.delete('labels');
    await user.click(await screen.findByRole('button', { name: 'Erneut versuchen' }));
    expect(await screen.findByRole('option', { name: 'UX' })).toBeTruthy();
    await user.keyboard('{Escape}');

    // the epics load once the list opens (A153), and fail there
    await user.click(within(dialog).getByRole('combobox', { name: 'Eltern-Item: keins' }));
    const retry = await screen.findByRole('button', { name: 'Erneut versuchen' });
    failing.delete('items');
    await user.click(retry);
    expect(await screen.findByRole('option', { name: /^Relaunch Phase 1/ })).toBeTruthy();
  });

  it('does not park the draft of an item that was created while closing', async () => {
    const user = userEvent.setup();
    renderWith(<Host />);
    act(() => useUiStore.getState().openCreate({ project_id: 'p_web' }));
    const dialog = await screen.findByRole('dialog', { name: 'Neues Item' });
    await user.type(await within(dialog).findByRole('textbox', { name: /^Titel/ }), 'Export als CSV');

    const hold = holdCreates();
    await modEnter();
    await waitFor(() => expect(hold.held()).toBe(1));
    await user.click(within(dialog).getByRole('button', { name: 'Abbrechen' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(parkedToasts()).toEqual([]);

    await hold.release();
    await waitFor(() => expect(toastTitles()).toContain('WEB-52 angelegt'));
    expect(parkedToasts()).toEqual([]);
  });

  it('parks the draft of an item the server refused after closing', async () => {
    const user = userEvent.setup();
    answerCreate = () => problem(409, 'project_archived', 'Das Projekt WEB ist archiviert.');
    renderWith(<Host />);
    act(() => useUiStore.getState().openCreate({ project_id: 'p_web' }));
    const dialog = await screen.findByRole('dialog', { name: 'Neues Item' });
    await user.type(await within(dialog).findByRole('textbox', { name: /^Titel/ }), 'Export als CSV');

    const hold = holdCreates();
    await modEnter();
    await waitFor(() => expect(hold.held()).toBe(1));
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await hold.release();

    await waitFor(() => expect(parkedToasts().map((entry) => entry.description)).toEqual(['Export als CSV']));
    expect(currentToasts().find((entry) => entry.title === 'Item nicht angelegt')?.description).toBe('Das Projekt WEB ist archiviert.');
  });

  it('says why a viewer cannot create items here', async () => {
    // OPS, where Lene only reads, is passed over for the first project she may write in
    const { dialog } = await openDialog({ project_id: 'p_ops' });
    const select = within(dialog).getByRole('combobox', { name: /^Projekt/ });
    expect(select.textContent).toContain('Website-Relaunch');
    expect(within(dialog).getByText('Im Projekt OPS darfst du nur lesen. Items anlegen dürfen Member und Admins.')).toBeTruthy();
    await userEvent.setup().click(select);
    expect((await screen.findAllByRole('option')).map((option) => option.textContent)).toEqual([expect.stringContaining('Website-Relaunch'), expect.stringContaining('Kunden-App')]);
  });

  it('says so when no project takes her items', async () => {
    projects = [project('WEB', 'viewer'), project('APP', 'member', { archived_at: '2026-10-01T10:00:00.000Z' })];
    renderWith(<CreateItemDialog open defaults={null} onOpenChange={vi.fn()} />);
    const dialog = await screen.findByRole('dialog', { name: 'Neues Item' });
    expect(await within(dialog).findByText('Hier kannst du kein Item anlegen')).toBeTruthy();
    expect(within(dialog).getByText('Du kannst gerade in keinem Projekt Items anlegen.')).toBeTruthy();
    expect(within(dialog).getByRole('button', { name: /^Anlegen/ }).getAttribute('aria-disabled')).toBe('true');
  });
});

describe('CreateHost', () => {
  it('loads the dialog on the first open and keeps it while it closes', async () => {
    renderWith(<CreateHost />);
    expect(screen.queryByRole('dialog')).toBeNull();
    act(() => useUiStore.getState().openCreate({ project_id: 'p_app' }));
    const dialog = await screen.findByRole('dialog', { name: 'Neues Item' });
    expect((await within(dialog).findByRole('combobox', { name: /^Projekt/ })).textContent).toContain('Kunden-App');
    act(() => useUiStore.getState().closeCreate());
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });
});

describe('MyItemsEmpty', () => {
  it('opens the create dialog with "Neues Item"', async () => {
    const user = userEvent.setup();
    renderWith(<MyItemsEmpty />);
    const button = await screen.findByRole('button', { name: /^Neues Item/ });
    await waitFor(() => expect(button.hasAttribute('aria-disabled')).toBe(false));
    await user.click(button);
    expect(useUiStore.getState()).toMatchObject({ createOpen: true, createDefaults: null });
  });

  it('says why without a project to create in', async () => {
    projects = [project('WEB', 'viewer')];
    const user = userEvent.setup();
    renderWith(<MyItemsEmpty />);
    const button = await screen.findByRole('button', { name: /^Neues Item/ });
    await waitFor(() => expect(button.getAttribute('aria-describedby')).toBeTruthy());
    expect(document.getElementById(button.getAttribute('aria-describedby')!)?.textContent).toBe('Items anlegen darfst du in keinem Projekt.');
    await user.click(button);
    expect(useUiStore.getState().createOpen).toBe(false);
  });
});
