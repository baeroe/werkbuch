/*
 * Workflows against a fake REST API (`mockApi`): the list with its reasons not to delete, the editor with its live
 * findings, the answers of the server (422 `invalid_workflow`, a refused name, a refused status, everything else as a
 * notice), creating, copying, the leave guard, members and load failures. The flows with the keyboard run in
 * e2e/tests/workflows.spec.ts.
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode, Ref } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkflowInput } from '@/api/workflows';
import { currentToasts, dismissToast, resetToasts } from '@/components/ui/toast';
import { mockApi, type MockApi, type MockRoute } from '@/test/api';
import { agency, list, project, standard } from '@/test/fixtures';
import type { Transition, Workflow } from '@/types';
import Workflows from './Workflows';

type Visit = { url: URL; method: string; prefetch: boolean; preserveUrl: boolean };
const inertia = vi.hoisted(() => ({ visit: vi.fn(), url: '/settings/workflows', listeners: new Map<string, Set<(event: never) => unknown>>() }));

vi.mock('@inertiajs/react', () => ({
  usePage: () => ({ props: {}, url: inertia.url }),
  Link: ({ href, children, ref, ...rest }: { href: string; children: ReactNode; ref?: Ref<HTMLAnchorElement> }) => (
    <a href={href} ref={ref} {...rest}>
      {children}
    </a>
  ),
  router: {
    visit: inertia.visit,
    on: (event: string, listener: (event: never) => unknown) => {
      const set = inertia.listeners.get(event) ?? new Set();
      set.add(listener);
      inertia.listeners.set(event, set);
      return () => set.delete(listener);
    },
  },
}));

/** What Inertia does when a visit starts: asks every `before` listener; false from one of them stops it. */
function startVisit(path: string): boolean {
  const visit: Visit = { url: new URL(path, window.location.origin), method: 'get', prefetch: false, preserveUrl: false };
  return [...(inertia.listeners.get('before') ?? [])].every((listener) => (listener as (event: { detail: { visit: Visit } }) => unknown)({ detail: { visit } }) !== false);
}

/* -------------------------------------------------------------------------- data */

const MEMBER = 'Workflows, Typen, Properties, Labels, Relationstypen und Resolutions verwalten nur Org-Admins.';

/** A third workflow that no project uses: free, with the agency's statuses under other ids. */
const spare: Workflow = {
  ...agency,
  id: 'wf_spare',
  name: 'Wartung',
  description: '',
  is_free: true,
  initial_state_id: 'sp_backlog',
  states: agency.states.map((state) => ({ ...state, id: state.id.replace('app_', 'sp_') })),
  transitions: [],
};

const projects = [
  project('WEB', 'admin', { workflow_id: 'wf_standard' }),
  project('APP', 'admin', { name: 'App', workflow_id: 'wf_agency' }),
  project('OPS', 'admin', { name: 'Betrieb', workflow_id: 'wf_agency' }),
];

const problem = (status: number, reason: string, extra: Record<string, unknown> = {}) => ({ status, body: { type: 'about:blank', title: reason, status, reason, ...extra } });
const invalid = (errors: Record<string, string[]>) => problem(422, 'validation_failed', { detail: 'Die Eingaben sind nicht gültig.', errors });
const unavailable = () => problem(503, 'service_unavailable', { detail: 'Der Server ist gerade nicht erreichbar.' });

/** The server's answer to a save: the input with the id of the workflow, and its own ids for the new statuses (`st_…`). */
function saved(input: WorkflowInput, id: string): Workflow {
  const ids = new Map(input.states.map((state) => [state.id!, state.id!.startsWith('st_') ? `srv_${state.id}` : state.id!]));
  const mapped = (key: string) => ids.get(key) ?? key;
  return {
    ...input,
    id,
    initial_state_id: mapped(input.initial_state_id),
    states: input.states.map((state) => ({ ...state, id: mapped(state.id!) })),
    transitions: input.transitions.map(([from, to]): Transition => [mapped(from), mapped(to)]),
  };
}

/* ------------------------------------------------------------------------ render */

let api: MockApi | undefined;
let stored: Workflow[] = [];

function store(workflow: Workflow) {
  stored = [...stored.filter((entry) => entry.id !== workflow.id), workflow];
  return workflow;
}

const routes = (overrides: Record<string, MockRoute> = {}): Record<string, MockRoute> => ({
  'GET /api/v1/workflows': () => ({ body: list(stored) }),
  'GET /api/v1/projects': () => ({ body: list(projects) }),
  'POST /api/v1/workflows': (body) => ({ status: 201, body: { data: store(saved(body as WorkflowInput, 'wf_new')) } }),
  'PUT /api/v1/workflows/wf_standard': (body) => ({ body: { data: store(saved(body as WorkflowInput, 'wf_standard')) } }),
  'PUT /api/v1/workflows/wf_agency': (body) => ({ body: { data: store(saved(body as WorkflowInput, 'wf_agency')) } }),
  ...overrides,
});

function renderAt(url: string, { reason = null, overrides = {} }: { reason?: string | null; overrides?: Record<string, MockRoute> } = {}) {
  inertia.url = url;
  api = mockApi(routes(overrides));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const tree = () => (
    <QueryClientProvider client={client}>
      <Workflows readOnlyReason={reason} />
    </QueryClientProvider>
  );
  const view = render(tree());
  /** A visit to another address of the section, as Inertia makes it with `preserveState`. */
  const navigate = (next: string) => {
    inertia.url = next;
    view.rerender(tree());
  };
  return { ...view, navigate };
}

const toastNamed = (title: string) => currentToasts().find((entry) => entry.title === title);
const callsTo = (method: string, path: string) => api!.calls.filter((call) => call.method === method && call.url === path);
const card = async (name: string) => screen.findByRole('article', { name });
const save = () => screen.getByRole('button', { name: /^Speichern/ });
const issues = () => document.getElementById('workflow-issues')!;
const nameOf = (number: number) => screen.getByRole<HTMLInputElement>('textbox', { name: `Name von Status ${number}` });
const describedBy = (element: HTMLElement) => document.getElementById(element.getAttribute('aria-describedby')!)?.textContent;

/** Lets every answer take a moment, as a real one does. */
function answerSlowly() {
  const answer = globalThis.fetch;
  globalThis.fetch = (...args: Parameters<typeof fetch>) => new Promise((done) => setTimeout(done, 10)).then(() => answer(...args));
}

beforeEach(() => {
  stored = [standard, agency, spare];
  // jsdom has no layout: every row is 40 px high and below the one before, which is all dnd-kit's keyboard needs
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    const rows = Array.from(document.querySelectorAll('li'));
    const top = Math.max(rows.indexOf(this as HTMLLIElement), 0) * 40;
    return { x: 0, y: top, top, left: 0, right: 200, bottom: top + 40, width: 200, height: 40, toJSON: () => ({}) } as DOMRect;
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  api?.restore();
  api = undefined;
  inertia.visit.mockReset();
  inertia.listeners.clear();
  act(() => resetToasts());
});

/* -------------------------------------------------------------------------- list */

describe('the list of workflows', () => {
  it('shows each workflow with its badges, statuses, start, transitions and the projects that use it', async () => {
    renderAt('/settings/workflows');

    const standardCard = await card('Standard');
    expect(within(standardCard).getByText('Standard', { selector: 'span:not(.sr-only)' })).toBeTruthy();
    expect(within(standardCard).getByText('Frei')).toBeTruthy();
    expect(within(standardCard).getByText('Jeder Status darf in jeden wechseln.')).toBeTruthy();
    expect(within(standardCard).getByRole('link', { name: /WEB/ }).getAttribute('href')).toBe('/projects/WEB/settings');

    const agencyCard = await card('Agentur-Freigabe');
    expect(within(agencyCard).getByText('Mit Übergangsmatrix')).toBeTruthy();
    expect(within(agencyCard).getByText('Mit interner Prüfung und Kundenfreigabe vor dem Abschluss.')).toBeTruthy();
    expect(within(within(agencyCard).getByRole('list', { name: 'Status von Agentur-Freigabe' })).getAllByRole('listitem').map((item) => item.textContent)).toEqual(
      agency.states.map((state) => state.name),
    );
    expect(within(agencyCard).getByText('14 erlaubte Übergänge.')).toBeTruthy();
    expect(within(agencyCard).getByText('Backlog', { selector: 'dd' })).toBeTruthy();
    expect(within(agencyCard).getAllByRole('link').map((link) => link.getAttribute('href'))).toEqual([
      '/settings/workflows?workflow=wf_agency',
      '/settings/workflows?workflow=new&from=wf_agency',
      '/projects/APP/settings',
      '/projects/OPS/settings',
    ]);
    expect(within(agencyCard).getByRole('link', { name: 'Bearbeiten Agentur-Freigabe' })).toBeTruthy();

    const spareCard = await card('Wartung');
    expect(within(spareCard).getByText('Keinem Projekt')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Workflow anlegen' }).getAttribute('href')).toBe('/settings/workflows?workflow=new');
  });

  it('counts one transition and names a start that is gone', async () => {
    stored = [{ ...agency, initial_state_id: 'gone', transitions: [['app_backlog', 'app_todo']] }];
    renderAt('/settings/workflows');

    const agencyCard = await card('Agentur-Freigabe');
    expect(within(agencyCard).getByText('1 erlaubter Übergang.')).toBeTruthy();
    expect(within(agencyCard).getByText('Keiner')).toBeTruthy();
  });

  it('keeps the default workflow and one that projects use from being deleted, and says why', async () => {
    renderAt('/settings/workflows');

    const standardDelete = within(await card('Standard')).getByRole('button', { name: /^Löschen/ });
    expect(standardDelete.getAttribute('aria-disabled')).toBe('true');
    expect(describedBy(standardDelete)).toBe('Der Standard-Workflow lässt sich nie löschen. Mache zuerst einen anderen zum Standard.');
    const agencyDelete = within(await card('Agentur-Freigabe')).getByRole('button', { name: /^Löschen/ });
    expect(describedBy(agencyDelete)).toBe('APP, OPS benutzen ihn noch. Wechsle dort zuerst den Workflow.');
    expect(within(await card('Wartung')).getByRole('button', { name: /^Löschen/ }).getAttribute('aria-disabled')).toBeNull();
  });

  it('says one project uses a workflow', async () => {
    renderAt('/settings/workflows', { overrides: { 'GET /api/v1/projects': () => ({ body: list(projects.slice(0, 2)) }) } });

    const agencyDelete = within(await card('Agentur-Freigabe')).getByRole('button', { name: /^Löschen/ });
    await waitFor(() => expect(describedBy(agencyDelete)).toBe('APP benutzt ihn noch. Wechsle dort zuerst den Workflow.'));
  });

  it('deletes a workflow after the undo time, the focus going on, and brings one back that the server keeps', async () => {
    const user = userEvent.setup();
    renderAt('/settings/workflows', {
      overrides: {
        'DELETE /api/v1/workflows/wf_spare': () => problem(409, 'in_use', { detail: 'Der Workflow wird noch von WEB benutzt.', projects: ['WEB'] }),
      },
    });

    await user.click(within(await card('Wartung')).getByRole('button', { name: /^Löschen/ }));
    expect(screen.queryByRole('article', { name: 'Wartung' })).toBeNull();
    // the focus moves on to the card before (the last one went) instead of falling to the top
    await waitFor(() => expect(document.activeElement).toBe(within(screen.getByRole('article', { name: 'Agentur-Freigabe' })).getByRole('link', { name: /^Bearbeiten/ })));
    act(() => dismissToast(toastNamed('Workflow „Wartung“ gelöscht')!.id));
    await waitFor(() => expect(toastNamed('Workflow „Wartung“ nicht gelöscht')?.description).toBe('Der Workflow wird noch von WEB benutzt.'));
    expect(await card('Wartung')).toBeTruthy();
  });

  it('deletes a workflow for good', async () => {
    const user = userEvent.setup();
    renderAt('/settings/workflows', {
      overrides: {
        'DELETE /api/v1/workflows/wf_spare': () => {
          stored = [standard, agency];
          return { status: 204 };
        },
      },
    });

    await user.click(within(await card('Wartung')).getByRole('button', { name: /^Löschen/ }));
    act(() => dismissToast(toastNamed('Workflow „Wartung“ gelöscht')!.id));
    await waitFor(() => expect(callsTo('DELETE', '/api/v1/workflows/wf_spare')).toHaveLength(1));
    await waitFor(() => expect(screen.getAllByRole('article').map((article) => article.getAttribute('aria-labelledby'))).toEqual(['workflow-wf_standard', 'workflow-wf_agency']));
  });

  it('offers the first workflow in the empty state, and a member only the list to read', async () => {
    stored = [];
    const { unmount } = renderAt('/settings/workflows');

    expect(await screen.findByText('Noch kein Workflow')).toBeTruthy();
    expect(screen.getAllByRole('link', { name: 'Workflow anlegen' })).toHaveLength(2);
    unmount();

    renderAt('/settings/workflows', { reason: MEMBER });
    expect(await screen.findByText('Noch kein Workflow')).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Workflow anlegen' })).toBeNull();
  });

  it('lets a member look at the workflows without any way to change them', async () => {
    stored = [standard, agency];
    renderAt('/settings/workflows', { reason: MEMBER });

    const agencyCard = await card('Agentur-Freigabe');
    expect(screen.getByText(MEMBER)).toBeTruthy();
    expect(within(agencyCard).getByRole('link', { name: 'Ansehen Agentur-Freigabe' }).getAttribute('href')).toBe('/settings/workflows?workflow=wf_agency');
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.queryByRole('link', { name: /Duplizieren/ })).toBeNull();
  });

  it('says when the workflows could not be loaded, and loads them again', async () => {
    const user = userEvent.setup();
    let fail = true;
    renderAt('/settings/workflows', { overrides: { 'GET /api/v1/workflows': () => (fail ? unavailable() : { body: list(stored) }) } });

    expect(await screen.findByText('Die Workflows konnten nicht geladen werden')).toBeTruthy();
    expect(screen.getByText('Der Server ist gerade nicht erreichbar.')).toBeTruthy();
    fail = false;
    await user.click(screen.getByRole('button', { name: 'Erneut versuchen' }));
    expect(await card('Agentur-Freigabe')).toBeTruthy();
  });
});

/* ------------------------------------------------------------------------ editor */

describe('the workflow editor', () => {
  it('lists the findings as they happen and, after ⌘↵ with findings, takes the focus there without sending (flow 7)', async () => {
    const user = userEvent.setup();
    renderAt('/settings/workflows?workflow=wf_agency');

    const grid = await screen.findByRole('grid', { name: 'Erlaubte Übergänge' });
    // the saved workflow is sound: a status region says so
    expect(issues().getAttribute('role')).toBe('status');
    expect(within(issues()).getByText('Der Workflow ist vollständig')).toBeTruthy();
    // the projects that use it are named
    expect(screen.getByText('Wird von APP, OPS benutzt')).toBeTruthy();

    // In Progress → Review is the only way into Review
    const toReview = within(grid).getByRole('checkbox', { name: 'Von In Progress nach Review' });
    expect(toReview.getAttribute('aria-checked')).toBe('true');
    act(() => toReview.focus());
    await user.keyboard(' ');

    expect(within(issues()).getByText('3 Probleme verhindern das Speichern')).toBeTruthy();
    expect(within(issues()).getByText('Review ist vom Startstatus aus nicht erreichbar')).toBeTruthy();
    expect(within(issues()).getAllByText('Erlaube in der Matrix einen Übergang von einem erreichbaren Status in diesen.')).toHaveLength(3);
    // what only Review leads to cannot be reached any more either
    expect(within(issues()).getByText('Kundenfreigabe ist vom Startstatus aus nicht erreichbar')).toBeTruthy();
    expect(within(issues()).getByText('Done ist vom Startstatus aus nicht erreichbar')).toBeTruthy();
    // the rows say so as well, in the list and in the matrix
    expect(within(nameOf(4).closest('li')!).getByText('Nicht erreichbar')).toBeTruthy();
    expect(within(grid).getByRole('rowheader', { name: /^Review/ }).textContent).toContain('Vom Startstatus aus nicht erreichbar');

    // the button stays available; ⌘↵ in the grid sends nothing and takes the focus to the list, now an alert
    expect(save().getAttribute('aria-disabled')).toBeNull();
    await user.keyboard('{Control>}{Enter}{/Control}');
    expect(document.activeElement).toBe(issues());
    expect(issues().getAttribute('role')).toBe('alert');
    expect(callsTo('PUT', '/api/v1/workflows/wf_agency')).toHaveLength(0);

    // putting the transition back clears the list
    act(() => toReview.focus());
    await user.keyboard(' ');
    expect(within(issues()).getByText('Der Workflow ist vollständig')).toBeTruthy();
  });

  it('names the missing start and the missing Completed status', async () => {
    const user = userEvent.setup();
    stored = [{ ...spare, initial_state_id: 'gone' }];
    renderAt('/settings/workflows?workflow=wf_spare');

    expect(await screen.findByText('Der Workflow hat keinen Startstatus')).toBeTruthy();
    expect(screen.getByText('Wähle den Status, in dem neue Items beginnen.')).toBeTruthy();
    await user.click(screen.getByRole('combobox', { name: /^Startstatus/ }));
    await user.click(await screen.findByRole('option', { name: 'Todo' }));
    expect(screen.getByRole('combobox', { name: /^Startstatus/ }).textContent).toContain('Todo');
    expect(screen.queryByText('Der Workflow hat keinen Startstatus')).toBeNull();

    // Done becomes Started: no Completed status is left
    await user.click(screen.getByRole('combobox', { name: 'Kategorie von Done' }));
    await user.click(await screen.findByRole('option', { name: 'Started' }));
    expect(screen.getByText('Der Workflow braucht mindestens einen Status der Kategorie Completed')).toBeTruthy();
    expect(screen.getByText('Ein Problem verhindert das Speichern')).toBeTruthy();
    // the category says what it means for the status
    expect(within(nameOf(6).closest('li')!).getByText(/^In Arbeit\./)).toBeTruthy();
  });

  it('marks the status the server finds unreachable, found by the id it was sent with', async () => {
    const user = userEvent.setup();
    renderAt('/settings/workflows?workflow=wf_agency', {
      overrides: {
        'PUT /api/v1/workflows/wf_agency': () =>
          problem(422, 'invalid_workflow', {
            detail: 'Der Workflow lässt sich so nicht speichern.',
            errors: { unreachable_state: ['Review ist vom Startstatus aus nicht erreichbar.'] },
            issues: [
              { code: 'unreachable_state', state_id: 'app_review' },
              { code: 'unreachable_state', state_id: 'new:7' },
            ],
          }),
      },
    });

    // a change the client finds sound
    await user.type(await screen.findByRole('textbox', { name: 'Name' }), ' neu');
    await user.click(save());

    await waitFor(() => expect(within(issues()).getByText('Review ist vom Startstatus aus nicht erreichbar')).toBeTruthy());
    // a status the draft does not know is named all the same
    expect(within(issues()).getByText('Ein unbenannter Status ist vom Startstatus aus nicht erreichbar')).toBeTruthy();
    expect(document.activeElement).toBe(issues());
    expect(within(nameOf(4).closest('li')!).getByText('Nicht erreichbar')).toBeTruthy();
    expect(within(screen.getByRole('grid')).getByRole('rowheader', { name: /^Review/ }).textContent).toContain('nicht erreichbar');
    // the findings are not repeated as a notice
    expect(screen.queryByText('Der Workflow wurde nicht gespeichert')).toBeNull();
    expect(callsTo('PUT', '/api/v1/workflows/wf_agency')[0]!.body).not.toHaveProperty('state_mapping');

    // they hold for the draft that was sent: the next change is judged anew
    await user.type(screen.getByRole('textbox', { name: 'Name' }), '!');
    expect(within(issues()).getByText('Der Workflow ist vollständig')).toBeTruthy();
  });

  it('shows a refused name at the field, a refused status at its row and the rest as a notice with the focus', async () => {
    const user = userEvent.setup();
    let answer = invalid({ name: ['Diesen Namen gibt es schon.'] });
    renderAt('/settings/workflows?workflow=wf_agency', { overrides: { 'PUT /api/v1/workflows/wf_agency': () => answer } });
    answerSlowly();

    await user.type(await screen.findByRole('textbox', { name: 'Name' }), ' neu');
    await user.click(save());
    expect(await screen.findByText('Diesen Namen gibt es schon.')).toBeTruthy();
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Name' })));

    // the second status was refused; after a move to the top its message stays with it
    answer = invalid({ 'states.1.name': ['Den Namen gibt es in diesem Workflow schon.'], 'transitions.0': ['Der Übergang ist ungültig.'] });
    await user.click(save());
    await waitFor(() => expect(within(nameOf(2).closest('li')!).getByText('Den Namen gibt es in diesem Workflow schon.')).toBeTruthy());
    await waitFor(() => expect(document.activeElement).toBe(nameOf(2)));
    // what has no field is a notice
    expect(screen.getByText('Der Übergang ist ungültig.')).toBeTruthy();

    const handle = screen.getByRole('button', { name: 'Todo verschieben' });
    handle.focus();
    await user.keyboard(' ');
    await waitFor(() => expect(handle.getAttribute('aria-pressed')).toBe('true'));
    await user.keyboard('{ArrowUp}');
    await user.keyboard(' ');
    await waitFor(() => expect(nameOf(1).value).toBe('Todo'));
    expect(within(nameOf(1).closest('li')!).getByText('Den Namen gibt es in diesem Workflow schon.')).toBeTruthy();
    expect(within(nameOf(2).closest('li')!).queryByText('Den Namen gibt es in diesem Workflow schon.')).toBeNull();

    // a refusal of the description, which has no message place of its own, is a notice that takes the focus
    answer = invalid({ description: ['Die Beschreibung ist zu lang.'] });
    await user.click(save());
    const notice = await screen.findByText('Die Beschreibung ist zu lang.');
    expect(screen.getByText('Der Workflow wurde nicht gespeichert')).toBeTruthy();
    await waitFor(() => expect(document.activeElement).toBe(notice.closest('[tabindex="-1"]')));
  });

  it('keeps a refusal of a status with that status when an earlier row is removed', async () => {
    const user = userEvent.setup();
    renderAt('/settings/workflows?workflow=wf_agency', {
      overrides: { 'PUT /api/v1/workflows/wf_agency': () => invalid({ 'states.3.name': ['Den Namen gibt es in diesem Workflow schon.'] }) },
    });

    await user.type(await screen.findByRole('textbox', { name: 'Name' }), ' neu');
    await user.click(save());
    // Review was the fourth status sent
    await waitFor(() => expect(within(nameOf(4).closest('li')!).getByText('Den Namen gibt es in diesem Workflow schon.')).toBeTruthy());

    await user.click(screen.getByRole('button', { name: 'Todo entfernen' }));
    expect(nameOf(3).value).toBe('Review');
    expect(within(nameOf(3).closest('li')!).getByText('Den Namen gibt es in diesem Workflow schon.')).toBeTruthy();
    expect(within(nameOf(4).closest('li')!).queryByText('Den Namen gibt es in diesem Workflow schon.')).toBeNull();
  });

  it('discards the changes together with the refusals of the last send', async () => {
    const user = userEvent.setup();
    renderAt('/settings/workflows?workflow=wf_agency', {
      overrides: { 'PUT /api/v1/workflows/wf_agency': () => invalid({ name: ['Diesen Namen gibt es schon.'], description: ['Die Beschreibung ist zu lang.'] }) },
    });

    await user.type(await screen.findByRole('textbox', { name: 'Name' }), ' neu');
    await user.clear(screen.getByRole('textbox', { name: 'Name von Status 2' }));
    await user.click(save());
    expect(screen.getByText('Gib dem Status einen Namen.')).toBeTruthy();
    await user.type(screen.getByRole('textbox', { name: 'Name von Status 2' }), 'Todo');
    await user.click(save());
    expect(await screen.findByText('Diesen Namen gibt es schon.')).toBeTruthy();
    expect(screen.getByText('Die Beschreibung ist zu lang.')).toBeTruthy();

    await user.clear(screen.getByRole('textbox', { name: 'Name von Status 2' }));
    await user.click(screen.getByRole('button', { name: 'Verwerfen' }));
    expect(screen.getByRole<HTMLInputElement>('textbox', { name: 'Name' }).value).toBe('Agentur-Freigabe');
    expect(screen.queryByText('Diesen Namen gibt es schon.')).toBeNull();
    expect(screen.queryByText('Die Beschreibung ist zu lang.')).toBeNull();
    expect(screen.queryByText('Der Workflow wurde nicht gespeichert')).toBeNull();
    expect(screen.queryByText('Gib dem Status einen Namen.')).toBeNull();
    expect(issues().getAttribute('role')).toBe('status');
  });

  it('says when saving failed and tries again', async () => {
    const user = userEvent.setup();
    let fail = true;
    renderAt('/settings/workflows?workflow=wf_agency', {
      overrides: { 'PUT /api/v1/workflows/wf_agency': (body) => (fail ? unavailable() : { body: { data: store(saved(body as WorkflowInput, 'wf_agency')) } }) },
    });

    await user.type(await screen.findByRole('textbox', { name: 'Name' }), ' neu');
    await user.click(save());
    await waitFor(() => expect(toastNamed('Workflow nicht gespeichert')?.description).toBe('Der Server ist gerade nicht erreichbar.'));
    fail = false;
    act(() => toastNamed('Workflow nicht gespeichert')!.action!.onClick());
    await waitFor(() => expect(toastNamed('Workflow „Agentur-Freigabe neu“ gespeichert')).toBeDefined());
  });

  it('saves a removed status without asking, with the ids of the server afterwards', async () => {
    const user = userEvent.setup();
    renderAt('/settings/workflows?workflow=wf_standard');

    // the start status stays, and says why
    const keep = await screen.findByRole('button', { name: 'Backlog entfernen' });
    expect(keep.getAttribute('aria-disabled')).toBe('true');
    expect(describedBy(keep)).toBe('Das ist der Startstatus. Wähle zuerst einen anderen Startstatus.');

    await user.click(screen.getByRole('button', { name: 'Pending entfernen' }));
    // the focus goes on to the name of the next row
    await waitFor(() => expect(document.activeElement).toBe(nameOf(4)));
    expect(nameOf(4).value).toBe('Done');
    // a new status, named at once; removed again as the last row, the focus goes to the name of the row above
    await user.click(screen.getByRole('button', { name: 'Status hinzufügen' }));
    expect(document.activeElement).toBe(nameOf(6));
    await user.click(screen.getByRole('button', { name: 'Status 6 entfernen' }));
    await waitFor(() => expect(document.activeElement).toBe(nameOf(5)));
    expect(nameOf(5).value).toBe('Cancelled');
    await user.click(screen.getByRole('button', { name: 'Status hinzufügen' }));
    expect(document.activeElement).toBe(nameOf(6));
    await user.type(nameOf(6), 'QA');
    await user.click(save());

    await waitFor(() => expect(toastNamed('Workflow „Standard“ gespeichert')).toBeDefined());
    const body = callsTo('PUT', '/api/v1/workflows/wf_standard')[0]!.body as WorkflowInput & Record<string, unknown>;
    expect(body.states.map((state) => state.name)).toEqual(['Backlog', 'Todo', 'In Progress', 'Done', 'Cancelled', 'QA']);
    expect(body.states.map((state) => state.position)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(body.states[5]!.id).toMatch(/^st_/);
    expect(body).not.toHaveProperty('state_mapping');
    // the draft starts again from the answer: nothing left to save or discard
    expect(screen.queryByRole('button', { name: 'Verwerfen' })).toBeNull();
    await user.click(save());
    expect(toastNamed('Es gibt nichts zu speichern')).toBeDefined();
    expect(callsTo('PUT', '/api/v1/workflows/wf_standard')).toHaveLength(1);
  });

  it('starts a matrix with everything allowed when a free workflow gets one, and changes shape, description and default', async () => {
    const user = userEvent.setup();
    renderAt('/settings/workflows?workflow=wf_spare');

    expect(await screen.findByText(/Der Workflow ist frei/)).toBeTruthy();
    expect(screen.queryByRole('grid')).toBeNull();
    const free = screen.getByRole('switch', { name: 'Freie Übergänge' });
    expect(describedBy(free)).toBe('Alles ist erlaubt. Schalte aus, um nur bestimmte Übergänge zuzulassen.');
    await user.click(free);
    const grid = await screen.findByRole('grid', { name: 'Erlaubte Übergänge' });
    // seven statuses: every one may lead to the six others
    expect(within(grid).getAllByRole('checkbox').filter((cell) => cell.getAttribute('aria-checked') === 'true')).toHaveLength(42);
    expect(describedBy(free)).toBe('Nur die Übergänge der Matrix unten sind erlaubt.');
    // back to free and off again keeps the matrix it had
    await user.click(within(grid).getByRole('checkbox', { name: 'Von Backlog nach Done' }));
    await user.click(free);
    await user.click(free);
    expect(within(screen.getByRole('grid')).getAllByRole('checkbox').filter((cell) => cell.getAttribute('aria-checked') === 'true')).toHaveLength(41);

    await user.click(screen.getByRole('button', { name: 'Form von Review: Dreiviertel gefüllt' }));
    await user.click(await screen.findByRole('menuitemradio', { name: 'Pause' }));
    await user.keyboard('{Escape}');
    expect(screen.getByRole('button', { name: 'Form von Review: Pause' })).toBeTruthy();
    await user.type(screen.getByRole('textbox', { name: 'Beschreibung' }), '  Für Wartungsaufträge.  ');
    const standardSwitch = screen.getByRole('switch', { name: 'Standard-Workflow' });
    expect(describedBy(standardSwitch)).toBe('Jedes neue Projekt bekommt den Standard-Workflow.');
    await user.click(standardSwitch);

    // a removed status takes its transitions along
    await user.click(screen.getByRole('button', { name: 'Kundenfreigabe entfernen' }));

    await user.click(save());
    await waitFor(() => expect(callsTo('PUT', '/api/v1/workflows/wf_spare')).toHaveLength(1));
    const body = callsTo('PUT', '/api/v1/workflows/wf_spare')[0]!.body as WorkflowInput;
    expect(body).toMatchObject({ is_free: false, is_default: true, description: 'Für Wartungsaufträge.' });
    expect(body.states.find((state) => state.id === 'sp_review')!.icon).toBe('pause');
    expect(body.transitions).toHaveLength(29);
    expect(body.transitions.flat()).not.toContain('sp_approval');
  });

  it('keeps the default mark of the default workflow and discards changes on request', async () => {
    const user = userEvent.setup();
    renderAt('/settings/workflows?workflow=wf_standard');

    const standardSwitch = await screen.findByRole('switch', { name: 'Standard-Workflow' });
    expect(standardSwitch.hasAttribute('data-disabled')).toBe(true);
    expect(describedBy(standardSwitch)).toBe('Einer der Workflows muss der Standard sein. Mache einen anderen zum Standard, dann wechselt er.');

    await user.clear(screen.getByRole('textbox', { name: 'Name' }));
    expect(screen.getByRole('heading', { level: 2, name: 'Neuer Workflow' })).toBeTruthy();
    // without a name nothing is sent, the field says why and takes the focus
    await user.keyboard('{Control>}{Enter}{/Control}');
    expect(screen.getByText('Gib dem Workflow einen Namen.')).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Name' }));

    await user.click(screen.getByRole('button', { name: 'Verwerfen' }));
    expect(screen.getByRole<HTMLInputElement>('textbox', { name: 'Name' }).value).toBe('Standard');
    expect(screen.queryByRole('button', { name: 'Verwerfen' })).toBeNull();
  });

  it('asks for the name of a status before anything is sent', async () => {
    const user = userEvent.setup();
    renderAt('/settings/workflows?workflow=wf_standard');

    await user.clear(await screen.findByRole('textbox', { name: 'Name von Status 2' }));
    await user.click(save());
    expect(screen.getByText('Gib dem Status einen Namen.')).toBeTruthy();
    expect(document.activeElement).toBe(nameOf(2));
    // the matrix and the list name it all the same
    expect(screen.getByRole('button', { name: 'Status 2 entfernen' })).toBeTruthy();
    expect(callsTo('PUT', '/api/v1/workflows/wf_standard')).toHaveLength(0);
  });

  it('creates a workflow from the five standard statuses and moves to its address with the focus on the title', async () => {
    const user = userEvent.setup();
    const { navigate } = renderAt('/settings/workflows?workflow=new');

    expect(await screen.findByRole('heading', { level: 2, name: 'Neuer Workflow' })).toBeTruthy();
    expect(screen.getByText('Lege Status, Übergänge und den Startstatus fest. Neue Projekte können ihn dann benutzen.')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Alle Workflows' }).getAttribute('href')).toBe('/settings/workflows');
    // an untouched new workflow lets the page go
    expect(startVisit('/settings/people')).toBe(true);

    await user.type(screen.getByRole('textbox', { name: 'Name' }), 'Support');
    // Enter in a field sends the form
    fireEvent.submit(screen.getByRole('textbox', { name: 'Name' }).closest('form')!);

    await waitFor(() => expect(inertia.visit).toHaveBeenCalledWith('/settings/workflows?workflow=wf_new', { replace: true, preserveState: true, preserveScroll: true }));
    expect(toastNamed('Workflow „Support“ gespeichert')).toBeDefined();
    const body = callsTo('POST', '/api/v1/workflows')[0]!.body as WorkflowInput;
    expect(body.states.map((state) => state.name)).toEqual(['Backlog', 'Todo', 'In Progress', 'Done', 'Cancelled']);
    expect(body).toMatchObject({ name: 'Support', is_default: false, is_free: true, transitions: [], initial_state_id: body.states[0]!.id });
    // the move is meant: the guard lets it through
    expect(startVisit('/settings/workflows?workflow=wf_new')).toBe(true);

    navigate('/settings/workflows?workflow=wf_new');
    const title = await screen.findByRole('heading', { level: 2, name: 'Support' });
    await waitFor(() => expect(document.activeElement).toBe(title));
    expect(nameOf(1).value).toBe('Backlog');
  });

  it('opens a copy with new status ids, never the default, and saves it as a workflow of its own', async () => {
    const user = userEvent.setup();
    renderAt('/settings/workflows?workflow=new&from=wf_agency');

    const name = await screen.findByRole<HTMLInputElement>('textbox', { name: 'Name' });
    expect(name.value).toBe('Agentur-Freigabe (Kopie)');
    expect(screen.getByRole('switch', { name: 'Standard-Workflow' }).getAttribute('aria-checked')).toBe('false');
    expect(screen.queryByText(/Wird von/)).toBeNull();

    await user.click(save());
    await waitFor(() => expect(callsTo('POST', '/api/v1/workflows')).toHaveLength(1));
    const body = callsTo('POST', '/api/v1/workflows')[0]!.body as WorkflowInput;
    const ids = body.states.map((state) => state.id!);
    expect(body.states.map((state) => state.name)).toEqual(agency.states.map((state) => state.name));
    expect(ids.some((id) => agency.states.some((state) => state.id === id))).toBe(false);
    expect(body.initial_state_id).toBe(ids[0]);
    expect(body.transitions).toHaveLength(14);
    expect(body.transitions).toContainEqual([ids[2], ids[3]]);
  });

  it('says when the workflow to copy does not exist, and starts a new one', async () => {
    renderAt('/settings/workflows?workflow=new&from=wf_gone');

    expect(await screen.findByText('Diese Vorlage gibt es nicht')).toBeTruthy();
    expect(screen.getByText('Der Workflow, den du duplizieren wolltest, wurde gelöscht, oder der Link stimmt nicht. Du beginnst mit einem neuen Workflow.')).toBeTruthy();
    expect(screen.getByRole<HTMLInputElement>('textbox', { name: 'Name' }).value).toBe('');
    expect(screen.getAllByRole<HTMLInputElement>('textbox', { name: /^Name von Status/ }).map((field) => field.value)).toEqual(['Backlog', 'Todo', 'In Progress', 'Done', 'Cancelled']);
  });

  it('says nothing about a template when there is none or it exists', async () => {
    const { unmount } = renderAt('/settings/workflows?workflow=new');
    expect(await screen.findByRole('textbox', { name: 'Name' })).toBeTruthy();
    expect(screen.queryByText('Diese Vorlage gibt es nicht')).toBeNull();
    unmount();

    renderAt('/settings/workflows?workflow=new&from=wf_agency');
    expect(await screen.findByRole('textbox', { name: 'Name' })).toBeTruthy();
    expect(screen.queryByText('Diese Vorlage gibt es nicht')).toBeNull();
  });

  it('says that a workflow does not exist, with the way back', async () => {
    renderAt('/settings/workflows?workflow=wf_gone');

    expect(await screen.findByText('Diesen Workflow gibt es nicht')).toBeTruthy();
    expect(screen.getByText('Er wurde gelöscht, oder der Link stimmt nicht.')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Alle Workflows' }).getAttribute('href')).toBe('/settings/workflows');
  });

  it('gives a member the reason and the way back instead of an empty form', () => {
    renderAt('/settings/workflows?workflow=new', { reason: MEMBER });

    expect(screen.getByText(MEMBER)).toBeTruthy();
    expect(screen.getByText('Workflows legen nur Org-Admins an')).toBeTruthy();
    expect(screen.getAllByRole('link', { name: 'Alle Workflows' })).toHaveLength(2);
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.queryByRole('form')).toBeNull();
  });

  it('shows a member a workflow without any way to change it', async () => {
    const user = userEvent.setup();
    renderAt('/settings/workflows?workflow=wf_agency', { reason: MEMBER });

    const name = await screen.findByRole('textbox', { name: 'Name' });
    expect(name.hasAttribute('readonly')).toBe(true);
    expect(screen.getByText(MEMBER)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Speichern/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Status hinzufügen' })).toBeNull();
    expect(screen.queryByText(/Wird von/)).toBeNull();
    expect(screen.getByRole('grid').getAttribute('aria-readonly')).toBe('true');
    // ⌘↵ sends nothing
    await user.keyboard('{Control>}{Enter}{/Control}');
    expect(api!.calls.filter((call) => call.method !== 'GET')).toHaveLength(0);
  });

  it('asks before leaving unsaved changes, and goes on once told to', async () => {
    const user = userEvent.setup();
    renderAt('/settings/workflows?workflow=wf_agency');

    await user.type(await screen.findByRole('textbox', { name: 'Name' }), ' neu');
    let allowed = true;
    act(() => {
      allowed = startVisit('/settings/people');
    });
    expect(allowed).toBe(false);
    const question = await screen.findByRole('alertdialog', { name: 'Änderungen verwerfen?' });
    expect(question.textContent).toContain('Deine Änderungen am Workflow sind nicht gespeichert.');
    await user.click(within(question).getByRole('button', { name: 'Weiter bearbeiten' }));
    expect(screen.getByRole<HTMLInputElement>('textbox', { name: 'Name' }).value).toBe('Agentur-Freigabe neu');

    act(() => {
      startVisit('/settings/people');
    });
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Verwerfen' }));
    expect(inertia.visit).toHaveBeenCalledWith(new URL('/settings/people', window.location.origin), expect.anything());
  });

  it('says when the workflows could not be loaded', async () => {
    renderAt('/settings/workflows?workflow=wf_agency', { overrides: { 'GET /api/v1/projects': () => unavailable() } });

    expect(screen.getByText('Der Workflow wird geladen …')).toBeTruthy();
    expect(await screen.findByText('Die Workflows konnten nicht geladen werden')).toBeTruthy();
  });
});
