/*
 * The bulk bar and its rules against a fake REST API (`mockApi`): the bar on its own (what it offers, what it sends, the
 * toast of the refused items, also after it went), and on the items screen (select all pages, archive with undo, the
 * keys of the toolbar). Inertia is a fake whose address the tests set; jsdom lays nothing out, so every row reports a
 * height (as in screen.test.tsx).
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { MouseEvent, ReactNode } from 'react';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ItemDialogsHost } from '@/components/fields/ItemDialogs';
// the question loads lazily; loaded with the file, so it does not wait for the editor's modules
import '@/components/fields/ResolutionPrompt';
import { currentToasts, dismissToast, resetToasts, runToastAction } from '@/components/ui/toast';
import { TooltipProvider } from '@/components/ui/Tooltip';
import { useUiStore } from '@/store/ui';
import { mockApi, type MockApi, type MockRoute } from '@/test/api';
import { agency, ida, labels, lene, list, makeWorkItem, mara, organization, project, properties, resolutions, standard, types } from '@/test/fixtures';
import type { BulkResult, Condition, ListedItem, Project, WorkItem } from '@/types';
import { ItemsScreen } from '../ItemsScreen';
import { BulkBar, type BulkBarProps } from './BulkBar';
import { bulkToast, commonStates, subjectOf } from './bulk';

/* --------------------------------------------------------------------- fake Inertia */

vi.mock('@inertiajs/react', () => ({
  usePage: () => ({ props: { auth: { user: lene, permissions: [] }, organization }, url: '/projects/WEB' }),
  router: { get: vi.fn(), visit: vi.fn(), replace: vi.fn(), on: () => () => {} },
  Link: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest} onClick={(event: MouseEvent) => event.preventDefault()}>
      {children}
    </a>
  ),
}));

/* ------------------------------------------------------------------- layout in jsdom */

const offsetHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight')!;
const boundingRect = Element.prototype.getBoundingClientRect;

beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
    configurable: true,
    get(this: HTMLElement) {
      if (!this.hasAttribute('data-index')) return 0;
      return this.querySelector('h2') ? 48 : 36;
    },
  });
  Element.prototype.getBoundingClientRect = function (this: Element) {
    return this.tagName === 'UL' ? new DOMRect(0, 0, 1024, 0) : boundingRect.call(this);
  };
  Object.defineProperty(document.documentElement, 'scrollHeight', { configurable: true, get: () => 1_000_000 });
  window.scrollTo = (() => {}) as typeof window.scrollTo;
  window.scrollBy = (() => {}) as typeof window.scrollBy;
});

afterAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', offsetHeight);
  Element.prototype.getBoundingClientRect = boundingRect;
  Reflect.deleteProperty(document.documentElement, 'scrollHeight');
});

/* --------------------------------------------------------------------- fake server */

const item = (number: number, state_id: string, changes: Partial<WorkItem> = {}) =>
  makeWorkItem({ id: `wi_web_${number}`, number, key: `WEB-${number}`, title: `Aufgabe ${number}`, state_id, rank: `a${number}`, ...changes });

const app3 = makeWorkItem({ id: 'wi_app_3', project_id: 'p_app', number: 3, key: 'APP-3', title: 'Login-Maske', state_id: 'app_todo' });

let items: WorkItem[];
let projects: Project[];
/** How many items a page of the fake holds. */
let pageSize: number;
/** Who is a member of APP: Lene by default. */
let appMembers: { project_id: string; user_id: string; role: 'member' }[];
/** What the bulk edit answers; by default every item changes. */
let answer: (ids: string[]) => ReturnType<MockRoute>;
let api: MockApi | undefined;

interface Body {
  filter?: { conditions: Condition[] };
  group?: string;
  cursor?: string;
}

const hits = (body: Body) => items.filter((entry) => (body.filter?.conditions ?? []).every((condition) => condition.field !== 'project' || entry.project_id === condition.value));

beforeEach(() => {
  items = [item(1, 'std_todo'), item(2, 'std_todo'), item(3, 'std_todo'), item(4, 'std_done'), item(5, 'std_progress')];
  projects = [project('WEB', 'admin', { name: 'Website-Relaunch' }), project('APP', 'member', { workflow_id: 'wf_agency' })];
  pageSize = 100;
  appMembers = [{ project_id: 'p_app', user_id: 'u_lene', role: 'member' }];
  answer = (ids) => ({ body: { updated: ids, rejected: [] } satisfies BulkResult });
  useUiStore.setState(useUiStore.getInitialState());
  api = mockApi({
    'GET /api/v1/organization': () => ({ body: { data: organization } }),
    'GET /api/v1/projects': () => ({ body: list(projects) }),
    'GET /api/v1/projects/WEB': () => ({ body: { data: projects[0] } }),
    'GET /api/v1/projects/p_web/members': () => ({ body: list([{ project_id: 'p_web', user_id: 'u_ida', role: 'admin' }, { project_id: 'p_web', user_id: 'u_lene', role: 'member' }]) }),
    'GET /api/v1/projects/p_app/members': () => ({ body: list(appMembers) }),
    'GET /api/v1/workflows': () => ({ body: list([standard, agency]) }),
    'GET /api/v1/resolutions': () => ({ body: list(resolutions) }),
    'GET /api/v1/users': () => ({ body: list([mara, ida, lene]) }),
    'GET /api/v1/labels': () => ({ body: list(labels) }),
    'GET /api/v1/work-item-types': () => ({ body: list(types) }),
    'GET /api/v1/properties': () => ({ body: list(properties) }),
    'GET /api/v1/favorites': () => ({ body: list([]) }),
    'POST /api/v1/work-items/groups': (body) => {
      const found = hits(body as Body);
      return { body: { data: { group_by: 'state', total: found.length, groups: standard.states.map((state) => ({ key: state.id, count: found.filter((entry) => entry.state_id === state.id).length })) } } };
    },
    'POST /api/v1/work-items/query': (body) => {
      const query = body as Body;
      const found = hits(query).filter((entry) => query.group === undefined || entry.state_id === query.group);
      const from = Number(query.cursor ?? 0);
      const next = from + pageSize < found.length ? String(from + pageSize) : null;
      return { body: { ...list(found.slice(from, from + pageSize), found.length), meta: { next_cursor: next, total: found.length } } };
    },
    'POST /api/v1/work-items/bulk': (body) => answer((body as { ids: string[] }).ids),
  });
});

afterEach(() => {
  api?.restore();
  api = undefined;
  act(() => resetToasts());
});

const bulkCalls = () => (api?.calls ?? []).filter((call) => call.url === '/api/v1/work-items/bulk').map((call) => call.body);
const lastToast = () => currentToasts().at(-1);

function wrap(node: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return (
    <QueryClientProvider client={client}>
      <TooltipProvider>
        {node}
        <ItemDialogsHost />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

function renderBar(props: Partial<BulkBarProps> & { items: ListedItem[] }) {
  const handlers = { onSelectAll: vi.fn(), onClear: vi.fn(), onArchive: vi.fn() };
  const view = render(wrap(<BulkBar total={props.items.length} {...handlers} {...props} />));
  return { ...view, ...handlers };
}

/** Waits until the rights have loaded: the action is a menu then (until then a button that says why it waits). */
const menuReady = (name: string) => waitFor(() => expect(screen.getByRole('button', { name }).getAttribute('aria-disabled')).toBeNull());

/* -------------------------------------------------------------------------- rules */

describe('the rules of a bulk change', () => {
  it('names one item by its key and several by their number', () => {
    expect(subjectOf([item(47, 'std_todo')])).toBe('WEB-47');
    expect(subjectOf([item(1, 'std_todo'), item(2, 'std_todo'), item(3, 'std_todo')])).toBe('3 Items');
  });

  it('says what changed, and which item was refused for which reason', () => {
    const three = [item(1, 'std_todo'), item(2, 'std_todo'), item(3, 'std_todo')];
    bulkToast(three, { updated: ['wi_web_1', 'wi_web_2', 'wi_web_3'], rejected: [] }, 'Priorität High');
    expect(lastToast()).toMatchObject({ title: '3 Items: Priorität High', tone: 'success' });
    bulkToast(three, { updated: ['wi_web_1'], rejected: [{ id: 'wi_web_2', reason: 'not_closed' }, { id: 'wi_web_3', reason: 'brand_new' }] }, 'archiviert', 'archived');
    expect(lastToast()).toMatchObject({
      title: '1 von 3 Items archiviert',
      description: 'WEB-2: Nur geschlossene Items lassen sich archivieren. WEB-3: Abgelehnt (brand_new).',
      tone: 'neutral',
    });
    bulkToast([three[0]!], { updated: [], rejected: [{ id: 'wi_web_1', reason: 'archived' }] }, 'Status Todo');
    expect(lastToast()).toMatchObject({ title: 'WEB-1 nicht geändert', tone: 'error' });
  });

  it('offers the states every workflow of the targets has (A128)', () => {
    const workflowOf = (entry: ListedItem) => (entry.project_id === 'p_app' ? agency : entry.project_id === 'p_web' ? standard : undefined);
    expect(commonStates([item(1, 'std_todo'), item(2, 'std_done')], workflowOf).map((state) => state.id)).toEqual(standard.states.map((state) => state.id));
    expect(commonStates([item(1, 'std_todo'), app3], workflowOf)).toEqual([]);
    expect(commonStates([makeWorkItem({ project_id: 'p_gone' })], workflowOf)).toEqual([]);
    expect(commonStates([], workflowOf)).toEqual([]);
  });
});

/* ------------------------------------------------------------------------ the bar */

describe('the bulk bar', () => {
  it('names the refused items even when the bar is gone before the answer (Esc during the request)', async () => {
    answer = () => ({ body: { updated: ['wi_app_3'], rejected: [{ id: 'wi_web_1', reason: 'forbidden' }] } });
    const view = renderBar({ items: [item(1, 'std_todo'), app3] });
    const user = userEvent.setup();
    await menuReady('Priorität');

    await user.click(screen.getByRole('button', { name: 'Priorität' }));
    const urgent = await screen.findByRole('menuitem', { name: 'Urgent' });
    // choose, and in the same moment the selection goes (Esc): the bar is gone before the server answers
    fireEvent.click(urgent);
    view.unmount();

    await waitFor(() => expect(lastToast()).toMatchObject({ title: '1 von 2 Items geändert', description: 'WEB-1: Dafür fehlt die Berechtigung.' }));
    expect(bulkCalls()).toEqual([{ ids: ['wi_web_1', 'wi_app_3'], patch: { priority: 'urgent' } }]);
  });

  it('changes the state, asking for the resolution of a closed one', async () => {
    renderBar({ items: [item(1, 'std_todo'), item(2, 'std_progress')] });
    const user = userEvent.setup();
    await menuReady('Status');

    await user.click(screen.getByRole('button', { name: 'Status' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Pending' }));
    await waitFor(() => expect(lastToast()?.title).toBe('2 Items: Status Pending'));

    await user.click(screen.getByRole('button', { name: 'Status' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Done' }));
    const dialog = await screen.findByRole('dialog', { name: '2 Items auf Done setzen' });
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));
    await user.keyboard('{Enter}');
    await waitFor(() =>
      expect(bulkCalls()).toEqual([
        { ids: ['wi_web_1', 'wi_web_2'], patch: { state_id: 'std_pending' } },
        { ids: ['wi_web_1', 'wi_web_2'], patch: { state_id: 'std_done', resolution_id: 'res_done' } },
      ]),
    );
  });

  it('asks one item for its resolution from its own state', async () => {
    renderBar({ items: [item(4, 'std_done', { resolution_id: 'res_done' })] });
    const user = userEvent.setup();
    await menuReady('Status');
    await user.click(screen.getByRole('button', { name: 'Status' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Cancelled' }));
    const dialog = await screen.findByRole('dialog', { name: 'WEB-4 auf Cancelled setzen' });
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(bulkCalls()).toEqual([]);
  });

  it('assigns me, nobody or a person every project of the selection has', async () => {
    renderBar({ items: [item(1, 'std_todo'), app3] });
    const user = userEvent.setup();
    await menuReady('Assignee');

    await user.click(screen.getByRole('button', { name: 'Assignee' }));
    // Ida is only in WEB, Mara (org admin) and Lene in both
    await waitFor(() =>
      expect(screen.getAllByRole('menuitem').map((entry) => entry.textContent)).toEqual(['Mir zuweisen', 'Nicht zugewiesen', expect.stringContaining('Lene Vogt'), expect.stringContaining('Mara Lindqvist')]),
    );
    await user.click(screen.getByRole('menuitem', { name: 'Mir zuweisen' }));
    await user.click(screen.getByRole('button', { name: 'Assignee' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Nicht zugewiesen' }));
    await user.click(screen.getByRole('button', { name: 'Assignee' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Mara Lindqvist' }));

    await waitFor(() => expect(bulkCalls().map((call) => (call as { patch: unknown }).patch)).toEqual([{ assignee_id: 'u_lene' }, { assignee_id: null }, { assignee_id: 'u_mara' }]));
    await waitFor(() => expect(lastToast()?.title).toBe('2 Items: zugewiesen an Mara Lindqvist'));
  });

  it('offers "Mir zuweisen" only when I can take every item', async () => {
    appMembers = [];
    renderBar({ items: [app3] });
    const user = userEvent.setup();
    await menuReady('Assignee');
    await user.click(screen.getByRole('button', { name: 'Assignee' }));
    await waitFor(() => expect(screen.getAllByRole('menuitem').map((entry) => entry.textContent)).toEqual(['Nicht zugewiesen', expect.stringContaining('Mara Lindqvist')]));
  });

  it('puts a label on all of them, and takes off one that all have', async () => {
    renderBar({ items: [item(1, 'std_todo', { label_ids: ['lb_ux'] }), item(2, 'std_todo', { label_ids: ['lb_ux', 'lb_forms'] })] });
    const user = userEvent.setup();
    await menuReady('Labels');

    await user.click(screen.getByRole('button', { name: 'Labels' }));
    expect((await screen.findAllByRole('menuitem')).map((entry) => entry.textContent)).toEqual(['Formulare', 'Performance', 'Produktion', 'UXbei allen, entfernen']);
    await user.click(screen.getByRole('menuitem', { name: /UX/ }));
    await user.click(screen.getByRole('button', { name: 'Labels' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Formulare' }));
    await waitFor(() =>
      expect(bulkCalls().map((call) => (call as { patch: unknown }).patch)).toEqual([{ remove_label_ids: ['lb_ux'] }, { add_label_ids: ['lb_forms'] }]),
    );
    await waitFor(() => expect(lastToast()?.title).toBe('2 Items: Label Formulare gesetzt'));
  });

  it('says why it changes nothing: archived items, open items to archive, two workflows', async () => {
    const archived = item(4, 'std_done', { archived_at: '2026-10-30T10:00:00.000Z' });
    const first = renderBar({ items: [archived] });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Priorität' }).getAttribute('aria-disabled')).toBe('true'));
    expect(screen.getByRole('button', { name: 'Archivieren' }).getAttribute('aria-disabled')).toBe('true');
    first.unmount();

    const user = userEvent.setup();
    const second = renderBar({ items: [item(1, 'std_todo'), app3], total: 9 });
    await menuReady('Priorität');
    // two workflows share no state; nothing closed to archive
    expect(screen.getByRole('button', { name: 'Status' }).getAttribute('aria-disabled')).toBe('true');
    expect(screen.getByRole('button', { name: 'Archivieren' }).getAttribute('aria-disabled')).toBe('true');
    expect(screen.getByText('von 9 ausgewählt')).toBeTruthy();
    // not all of them selected: the box selects all, the X clears
    await user.click(screen.getByRole('checkbox', { name: 'Alle 9 auswählen' }));
    expect(second.onSelectAll).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole('button', { name: 'Auswahl aufheben' }));
    expect(second.onClear).toHaveBeenCalledTimes(1);
    second.unmount();

    const third = renderBar({ items: [item(1, 'std_todo'), item(4, 'std_done')] });
    await menuReady('Priorität');
    // all of them selected: the box clears; some closed: archive hands them all over
    await user.click(screen.getByRole('checkbox', { name: 'Alle 2 auswählen' }));
    expect(third.onClear).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole('button', { name: 'Archivieren' }));
    expect(third.onArchive).toHaveBeenCalledWith([expect.objectContaining({ id: 'wi_web_1' }), expect.objectContaining({ id: 'wi_web_4' })]);
  });
});

/* ------------------------------------------------------------------- on the screen */

function renderScreen() {
  return render(
    wrap(
      <main id="main">
        <ItemsScreen preset="project" projectIdentifier="WEB" />
      </main>,
    ),
  );
}

const bar = () => screen.queryByRole('group', { name: 'Auswahl' });

describe('the bulk bar on the items screen', () => {
  it('selects every item of every page with "Alle auswählen"', async () => {
    pageSize = 1;
    items = [item(1, 'std_todo'), item(2, 'std_todo'), item(3, 'std_todo')];
    renderScreen();
    await screen.findByText('Aufgabe 1');
    act(() => useUiStore.getState().setSelection(['wi_web_1']));
    expect(await screen.findByText('von 3 ausgewählt')).toBeTruthy();

    fireEvent.click(screen.getByRole('checkbox', { name: 'Alle 3 auswählen' }));
    await waitFor(() => expect(useUiStore.getState().selection).toEqual(['wi_web_1', 'wi_web_2', 'wi_web_3']));
    // page by page, one item each
    expect((api?.calls ?? []).filter((call) => call.url === '/api/v1/work-items/query' && (call.body as Body).cursor === '2')).not.toEqual([]);

    // all of them: the box clears, and the bar goes
    fireEvent.click(screen.getByRole('checkbox', { name: 'Alle 3 auswählen' }));
    await waitFor(() => expect(bar()).toBeNull());
  });

  it('keeps / and f working while items are selected', async () => {
    // the filter bar binds them in the list scope: `/` searches the titles, `f` adds a condition
    renderScreen();
    await screen.findByText('Aufgabe 1');
    act(() => useUiStore.getState().setSelection(['wi_web_1', 'wi_web_2']));
    await menuReady('Priorität');
    // the bar stands below the toolbar, which stays (with "Neues Item")
    const toolbar = document.querySelector('[data-items-toolbar]')!;
    expect(toolbar.contains(bar())).toBe(true);
    expect(toolbar.textContent).toContain('Neues Item');

    const button = screen.getByRole('button', { name: 'Priorität' });
    act(() => button.focus());
    act(() => void button.dispatchEvent(new KeyboardEvent('keydown', { key: '/', bubbles: true, cancelable: true })));
    expect(document.activeElement).toBe(screen.getByRole('searchbox', { name: 'Titel durchsuchen' }));
    act(() => button.focus());
    act(() => void button.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', bubbles: true, cancelable: true })));
    expect(await screen.findByRole('dialog', { name: 'Feld der Bedingung' })).toBeTruthy();
    expect(useUiStore.getState().selection).toEqual(['wi_web_1', 'wi_web_2']);
  });

  it('archives the closed items of the selection with undo, and the server names the open ones', async () => {
    answer = () => ({ body: { updated: ['wi_web_4'], rejected: [{ id: 'wi_web_1', reason: 'not_closed' }] } });
    renderScreen();
    await screen.findByText('Aufgabe 4');
    act(() => useUiStore.getState().setSelection(['wi_web_1', 'wi_web_4']));
    await menuReady('Priorität');

    fireEvent.click(screen.getByRole('button', { name: 'Archivieren' }));
    expect(lastToast()).toMatchObject({ title: 'WEB-4 archiviert', action: { label: 'Rückgängig' } });
    // the closed one leaves the list and the selection at once, the open one stays
    await waitFor(() => expect(screen.queryByText('Aufgabe 4')).toBeNull());
    expect(useUiStore.getState().selection).toEqual(['wi_web_1']);

    act(() => runToastAction(lastToast()!.id));
    expect(await screen.findByText('Aufgabe 4')).toBeTruthy();
    expect(bulkCalls()).toEqual([]);

    act(() => useUiStore.getState().setSelection(['wi_web_1', 'wi_web_4']));
    fireEvent.click(await screen.findByRole('button', { name: 'Archivieren' }));
    act(() => dismissToast(lastToast()!.id));
    await waitFor(() => expect(bulkCalls()).toEqual([{ ids: ['wi_web_1', 'wi_web_4'], patch: { archived: true } }]));
    await waitFor(() => expect(lastToast()).toMatchObject({ title: '1 von 2 Items archiviert', description: 'WEB-1: Nur geschlossene Items lassen sich archivieren.' }));
  });

  it('leaves an archived item of the selection alone when it archives the others', async () => {
    // "Archivierte zeigen": WEB-3 is closed and archived already
    items = [item(2, 'std_done'), item(3, 'std_done', { archived_at: '2026-10-30T10:00:00.000Z' }), item(4, 'std_done')];
    renderScreen();
    await screen.findByText('Aufgabe 3');
    act(() => useUiStore.getState().setSelection(['wi_web_2', 'wi_web_3', 'wi_web_4']));
    await menuReady('Priorität');

    fireEvent.click(screen.getByRole('button', { name: 'Archivieren' }));
    expect(lastToast()).toMatchObject({ title: '2 Items archiviert' });
    // the archived one stays where it is, the others leave the list
    await waitFor(() => expect(screen.queryByText('Aufgabe 4')).toBeNull());
    expect(screen.getByText('Aufgabe 3')).toBeTruthy();
    act(() => dismissToast(lastToast()!.id));
    await waitFor(() => expect(bulkCalls()).toEqual([{ ids: ['wi_web_2', 'wi_web_4'], patch: { archived: true } }]));
  });
});
