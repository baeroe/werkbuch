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
import { bulkToast, commonStates, removalVerdict, selectionVerdict, subjectOf, type SelectionRules } from './bulk';

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

describe('what an action does to a selection (A198)', () => {
  const open = item(1, 'std_todo');
  const done = item(4, 'std_done');
  const cancelled = item(6, 'std_cancelled');
  const archived = item(5, 'std_done', { archived_at: '2026-10-30T10:00:00.000Z' });
  // APP: read-only, and deleting is for its admins
  const foreignOpen = makeWorkItem({ id: 'wi_app_3', project_id: 'p_app', key: 'APP-3', state_id: 'app_todo' });
  const foreignDone = makeWorkItem({ id: 'wi_app_4', project_id: 'p_app', key: 'APP-4', state_id: 'app_done' });
  const rules: SelectionRules = {
    reason: (permission, projectId) => (projectId !== 'p_app' ? null : permission === 'item.edit' ? 'Nur lesen.' : 'Nur Admins.'),
    isClosed: (entry) => entry.state_id.endsWith('_done') || entry.state_id.endsWith('_cancelled'),
  };
  const isArchived = 'WEB-5 ist archiviert und schreibgeschützt. Stelle es zuerst wieder her.';
  const onlyClosed = 'Nur geschlossene Items lassen sich archivieren. Setze sie zuerst auf einen Status wie Done.';

  it('allows a change only when it is allowed for every item', () => {
    expect(selectionVerdict([], 'edit', rules)).toBeNull();
    expect(selectionVerdict([open, done], 'edit', rules)).toBeNull();
    expect(selectionVerdict([open], 'edit', rules)).toBeNull();
    // none of them: the reason, as for one item
    expect(selectionVerdict([archived], 'edit', rules)).toEqual({ reason: isArchived, mixed: false });
    expect(selectionVerdict([foreignOpen, foreignDone], 'edit', rules)).toEqual({ reason: 'Nur lesen.', mixed: false });
    expect(selectionVerdict([archived, foreignOpen], 'edit', rules)).toEqual({ reason: isArchived, mixed: false });
    // some of them: mixed, with the number and the first reason
    expect(selectionVerdict([open, archived], 'edit', rules)).toEqual({ reason: `Nicht möglich für 1 der 2 ausgewählten Items: ${isArchived}`, mixed: true });
    expect(selectionVerdict([open, foreignOpen, archived], 'edit', rules)).toEqual({ reason: 'Nicht möglich für 2 der 3 ausgewählten Items: Nur lesen.', mixed: true });
  });

  it('archives only when every item is closed, not archived and may be changed', () => {
    expect(selectionVerdict([done, cancelled], 'archive', rules)).toBeNull();
    expect(selectionVerdict([done], 'archive', rules)).toBeNull();
    expect(selectionVerdict([open], 'archive', rules)).toEqual({ reason: onlyClosed, mixed: false });
    expect(selectionVerdict([archived], 'archive', rules)).toEqual({ reason: isArchived, mixed: false });
    expect(selectionVerdict([foreignDone], 'archive', rules)).toEqual({ reason: 'Nur lesen.', mixed: false });
    expect(selectionVerdict([done, open], 'archive', rules)).toEqual({ reason: `Nicht möglich für 1 der 2 ausgewählten Items: ${onlyClosed}`, mixed: true });
    expect(selectionVerdict([done, archived], 'archive', rules)).toEqual({ reason: `Nicht möglich für 1 der 2 ausgewählten Items: ${isArchived}`, mixed: true });
    expect(selectionVerdict([done, foreignDone], 'archive', rules)).toEqual({ reason: 'Nicht möglich für 1 der 2 ausgewählten Items: Nur lesen.', mixed: true });
  });

  it('deletes only when every item may be deleted, archived ones too', () => {
    expect(selectionVerdict([open, done, archived], 'delete', rules)).toBeNull();
    expect(selectionVerdict([foreignOpen], 'delete', rules)).toEqual({ reason: 'Nur Admins.', mixed: false });
    expect(selectionVerdict([open, foreignOpen], 'delete', rules)).toEqual({ reason: 'Nicht möglich für 1 der 2 ausgewählten Items: Nur Admins.', mixed: true });
  });

  it('removes with mod+backspace only what it removes the same way: archive the closed, delete the open or the archived', () => {
    // one item: as ever, a closed one archives, any other deletes (an archived one too)
    expect(removalVerdict([done], rules)).toEqual({ effect: 'archive' });
    expect(removalVerdict([open], rules)).toEqual({ effect: 'delete' });
    expect(removalVerdict([archived], rules)).toEqual({ effect: 'delete' });
    expect(removalVerdict([foreignDone], rules)).toEqual({ reason: 'Nur lesen.' });
    expect(removalVerdict([foreignOpen], rules)).toEqual({ reason: 'Nur Admins.' });
    // several of one kind: the same for all
    expect(removalVerdict([done, cancelled], rules)).toEqual({ effect: 'archive' });
    expect(removalVerdict([open, item(2, 'std_todo')], rules)).toEqual({ effect: 'delete' });
    expect(removalVerdict([archived, item(7, 'std_todo', { archived_at: '2026-10-30T10:00:00.000Z' })], rules)).toEqual({ effect: 'delete' });
    // open and archived ones: both deleted, the same for all
    expect(removalVerdict([open, archived], rules)).toEqual({ effect: 'delete' });
    // archive some and delete others: neither (T15-M3: an archived item among closed ones deleted them all)
    const mixed = (kinds: string) =>
      `Archivieren und Löschen gemischt: ${kinds}. Geschlossene würden archiviert, offene und archivierte gelöscht. Wähle nur geschlossene oder nur andere Items aus.`;
    expect(removalVerdict([done, archived], rules)).toEqual({ reason: mixed('1 geschlossenes Item und 1 archiviertes Item') });
    expect(removalVerdict([done, open, cancelled], rules)).toEqual({ reason: mixed('1 offenes Item und 2 geschlossene Items') });
    expect(removalVerdict([open, item(2, 'std_todo'), done, archived], rules)).toEqual({ reason: mixed('2 offene Items, 1 geschlossenes Item und 1 archiviertes Item') });
    // one kind, not allowed for all
    expect(removalVerdict([done, foreignDone], rules)).toEqual({ reason: 'Nicht möglich für 1 der 2 ausgewählten Items: Nur lesen.' });
    expect(removalVerdict([open, foreignOpen], rules)).toEqual({ reason: 'Nicht möglich für 1 der 2 ausgewählten Items: Nur Admins.' });
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

    const third = renderBar({ items: [item(4, 'std_done'), item(6, 'std_cancelled')] });
    await menuReady('Priorität');
    // all of them selected: the box clears; all closed: archive hands them over
    await user.click(screen.getByRole('checkbox', { name: 'Alle 2 auswählen' }));
    expect(third.onClear).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole('button', { name: 'Archivieren' }));
    expect(third.onArchive).toHaveBeenCalledWith([expect.objectContaining({ id: 'wi_web_4' }), expect.objectContaining({ id: 'wi_web_6' })]);
  });

  it('leaves out what it would do to some of them and not to others (A198)', async () => {
    const archived = item(4, 'std_done', { archived_at: '2026-10-30T10:00:00.000Z' });
    const actions = ['Status', 'Assignee', 'Priorität', 'Labels', 'Archivieren'];
    const shown = () => actions.filter((name) => screen.queryByRole('button', { name }) !== null);

    // open and closed: every change, but no archive (the open one would stay)
    const first = renderBar({ items: [item(1, 'std_todo'), item(2, 'std_done')] });
    await menuReady('Priorität');
    expect(shown()).toEqual(['Status', 'Assignee', 'Priorität', 'Labels']);
    expect(screen.queryByText('Keine gemeinsame Aktion für diese Auswahl')).toBeNull();
    first.unmount();

    // an archived one among them: nothing that changes or archives
    const second = renderBar({ items: [item(1, 'std_done'), archived] });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Auswahl aufheben' })).toBeTruthy());
    await waitFor(() => expect(shown()).toEqual([]));
    // the bar says so instead of standing empty
    expect(screen.getByRole('group', { name: 'Auswahl' }).textContent).toContain('Keine gemeinsame Aktion für diese Auswahl');
    second.unmount();

    // a project the person only reads: the same
    projects = [project('WEB', 'admin'), project('APP', 'viewer', { workflow_id: 'wf_agency' })];
    const third = renderBar({ items: [item(1, 'std_todo'), app3] });
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Priorität' })).toBeNull());
    // archiving is for neither (one open, one read-only): it stays and says why
    expect(shown()).toEqual(['Archivieren']);
    expect(screen.getByRole('button', { name: 'Archivieren' }).getAttribute('aria-disabled')).toBe('true');
    third.unmount();

    // all of them read-only: the actions stay and say why
    renderBar({ items: [app3] });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Priorität' }).getAttribute('aria-disabled')).toBe('true'));
    expect(shown()).toEqual(actions);
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

  it('archives a closed selection with undo, and names what the server still refuses', async () => {
    items = [...items, item(6, 'std_cancelled')];
    answer = () => ({ body: { updated: ['wi_web_4'], rejected: [{ id: 'wi_web_6', reason: 'not_closed' }] } });
    renderScreen();
    await screen.findByText('Aufgabe 6');
    act(() => useUiStore.getState().setSelection(['wi_web_4', 'wi_web_6']));
    await menuReady('Priorität');

    fireEvent.click(screen.getByRole('button', { name: 'Archivieren' }));
    expect(lastToast()).toMatchObject({ title: '2 Items archiviert', action: { label: 'Rückgängig' } });
    // they leave the list and the selection at once
    await waitFor(() => expect(screen.queryByText('Aufgabe 4')).toBeNull());
    expect(screen.queryByText('Aufgabe 6')).toBeNull();
    expect(useUiStore.getState().selection).toEqual([]);

    act(() => runToastAction(lastToast()!.id));
    expect(await screen.findByText('Aufgabe 4')).toBeTruthy();
    expect(bulkCalls()).toEqual([]);

    act(() => useUiStore.getState().setSelection(['wi_web_4', 'wi_web_6']));
    fireEvent.click(await screen.findByRole('button', { name: 'Archivieren' }));
    act(() => dismissToast(lastToast()!.id));
    await waitFor(() => expect(bulkCalls()).toEqual([{ ids: ['wi_web_4', 'wi_web_6'], patch: { archived: true } }]));
    // reopened meanwhile: the server refuses it, and it comes back
    await waitFor(() => expect(lastToast()).toMatchObject({ title: '1 von 2 Items archiviert', description: 'WEB-6: Nur geschlossene Items lassen sich archivieren.' }));
    expect(await screen.findByText('Aufgabe 6')).toBeTruthy();
  });

  it('offers no archive while an archived item is selected with others, and mod+backspace removes nothing', async () => {
    // "Archivierte zeigen": WEB-3 is closed and archived already
    items = [item(2, 'std_done'), item(3, 'std_done', { archived_at: '2026-10-30T10:00:00.000Z' }), item(4, 'std_done')];
    renderScreen();
    await screen.findByText('Aufgabe 3');
    act(() => useUiStore.getState().setSelection(['wi_web_2', 'wi_web_3', 'wi_web_4']));
    await screen.findByRole('button', { name: 'Auswahl aufheben' });
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Priorität' })).toBeNull());
    expect(screen.queryByRole('button', { name: 'Archivieren' })).toBeNull();

    // pressed again until the commands have their catalogs ("Einen Moment" before)
    await waitFor(() => {
      act(() => void document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', ctrlKey: true, bubbles: true, cancelable: true })));
      expect(lastToast()).toMatchObject({
        title: 'Nicht möglich',
        description:
          'Archivieren und Löschen gemischt: 2 geschlossene Items und 1 archiviertes Item. Geschlossene würden archiviert, offene und archivierte gelöscht. Wähle nur geschlossene oder nur andere Items aus.',
      });
    });
    // nothing left the list or the selection, nothing goes to the server
    expect(currentToasts().some((toast) => toast.action?.label === 'Rückgängig')).toBe(false);
    expect(['Aufgabe 2', 'Aufgabe 3', 'Aufgabe 4'].map((title) => screen.queryByText(title) !== null)).toEqual([true, true, true]);
    expect(useUiStore.getState().selection).toEqual(['wi_web_2', 'wi_web_3', 'wi_web_4']);
  });
});
