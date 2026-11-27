/*
 * The runs of agents and the pull requests at an item (WEBU-28) against a fake REST API: run lines in the activity with
 * their facts and log, the chip and the notices under the title, cancel, start again, give back and resume, the reasons
 * a bot is no agent here, and the pull requests with their CI, checks and review.
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { currentToasts, resetToasts, runToastAction } from '@/components/ui/toast';
import { qk } from '@/hooks/keys';
import { useUiStore } from '@/store/ui';
import { mockApi, type MockApi, type MockRoute } from '@/test/api';
import { ida, labels, lene, list, makeWorkItem, mara, organization, person, project, properties, relationTypes, resolutions, standard, types } from '@/test/fixtures';
import type { AgentRun, ItemAgentState, LinkCheck, Project, RunEvent, User, WorkItem, WorkItemLink } from '@/types';
import { router } from '@inertiajs/react';
import { ItemPage } from '../ItemPage';
import { focusNewRun, showRun } from './runFocus';
import { clearLiveGone, markLiveGone } from '@/lib/liveGone';
import { ANNOUNCE_MS, RunLog } from './RunLog';
import { canRetry, effortOrigin, formatDuration, modelOrigin, needsGiveBack, offsetText, waitingText } from './runParts';

let signedIn: User = mara;
let address = '/items/WEB-51';

vi.mock('@inertiajs/react', () => ({
  usePage: () => ({ props: { auth: { user: signedIn, permissions: [] }, organization }, url: address }),
  router: { visit: vi.fn(), replace: vi.fn(), on: () => () => {} },
  Link: ({ href, children, ...rest }: { href: string; children?: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

/* -------------------------------------------------------------------------- data */

const kira: User = { ...person('u_kira', 'Kira', 'kira'), type: 'bot', owner_id: 'u_mara' };
const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();

const makeRun = (overrides: Partial<AgentRun> = {}): AgentRun => ({
  id: 'run_1',
  type: 'task',
  status: 'succeeded',
  waiting_reason: null,
  bot_id: 'u_kira',
  cli: 'claude',
  model: 'sonnet',
  model_source: 'bot',
  model_label_id: null,
  runner_id: 'r_studio',
  runner_name: 'mac-studio',
  runner_online: true,
  runner_last_seen_at: minutesAgo(0),
  project_id: 'p_web',
  work_item_id: 'wi_web_51',
  thread_id: 'th_1',
  head_sha: null,
  attempt: 1,
  started_at: minutesAgo(30),
  deadline_at: null,
  finished_at: minutesAgo(16),
  result: null,
  usage: null,
  error: null,
  canceled_by: null,
  events_dropped: 0,
  created_at: minutesAgo(31),
  updated_at: minutesAgo(16),
  ...overrides,
});

const line = (id: string, kind: RunEvent['kind'], text: string, at = minutesAgo(29)): RunEvent => ({ id, attempt: 1, kind, text, at });

const openThread = (overrides: Partial<NonNullable<ItemAgentState['thread']>> = {}): NonNullable<ItemAgentState['thread']> => ({
  id: 'th_1',
  bot_id: 'u_kira',
  status: 'open',
  pause_reason: null,
  corrections: 0,
  conflicts: 0,
  pr_number: null,
  branch: 'agent/WEB-51-cookie-banner',
  runner_id: 'r_studio',
  ...overrides,
});

const state = (overrides: Partial<ItemAgentState> = {}): ItemAgentState => ({
  thread: openThread(),
  refusal: null,
  brakes: { max_corrections: 3, max_conflicts: 2 },
  repository: true,
  guard: null,
  runs: 1,
  ...overrides,
});

const check = (name: string, status: string, conclusion: string | null = null): LinkCheck => ({ name, app: 'github-actions', status, conclusion, url: null });

const pr = (overrides: Partial<WorkItemLink> = {}): WorkItemLink => ({
  id: 'lk_1',
  work_item_id: 'wi_web_51',
  kind: 'pull_request',
  repository: 'feldwerk/website',
  number: 211,
  title: 'Fix the banner (WEB-51)',
  url: 'https://github.com/feldwerk/website/pull/211',
  state: 'open',
  draft: false,
  head_branch: 'fix/WEB-51',
  base_branch: 'main',
  head_sha: 'c0ffee',
  closes: true,
  author: 'jonas-feldwerk',
  thread_id: null,
  review: null,
  ci: 'none',
  checks: [],
  merged_at: null,
  created_at: null,
  updated_at: null,
  ...overrides,
});

let item: WorkItem;
let agent: ItemAgentState | null;
let links: WorkItemLink[];
let runs: AgentRun[];
let events: Record<string, RunEvent[]>;
let projects: Project[];

/* ------------------------------------------------------------------------ render */

let api: MockApi | undefined;
let client: QueryClient;

function renderItem(routes: Record<string, MockRoute> = {}) {
  if (projects.length === 0) projects = [project('WEB', 'member', { name: 'Website-Relaunch' })];
  const detail = () => ({ body: { data: { ...item, children: [], relations: [], type: types[0], workflow: standard, attachments: [], links, agent } } });
  api = mockApi({
    'GET /api/v1/projects': () => ({ body: list(projects) }),
    'GET /api/v1/workflows': () => ({ body: list([standard]) }),
    'GET /api/v1/resolutions': () => ({ body: list(resolutions) }),
    'GET /api/v1/users': () => ({ body: list([mara, ida, lene, kira]) }),
    'GET /api/v1/projects/p_web/members': () => ({ body: list([]) }),
    'GET /api/v1/labels': () => ({ body: list(labels) }),
    'GET /api/v1/relation-types': () => ({ body: list(relationTypes) }),
    'GET /api/v1/work-item-types': () => ({ body: list(types) }),
    'GET /api/v1/properties': () => ({ body: list(properties) }),
    [`GET /api/v1/work-items/${item.key}`]: detail,
    [`GET /api/v1/work-items/${item.id}`]: detail,
    [`GET /api/v1/work-items/${item.id}/history`]: () => ({ body: list([]) }),
    'GET /api/v1/runs': () => ({ body: list([...runs].reverse()) }),
    ...Object.fromEntries(
      Object.keys(events).map((id) => [
        `GET /api/v1/runs/${id}/events`,
        (_body: unknown, url: URL) => {
          const after = url.searchParams.get('filter[after]');
          const all = events[id];
          return { body: list(after === null ? all : all.slice(all.findIndex((entry) => entry.id === after) + 1)) };
        },
      ]),
    ),
    [`PATCH /api/v1/work-items/${item.id}`]: (body) => {
      item = { ...item, ...(body as Partial<WorkItem>) };
      return { body: { data: item } };
    },
    ...routes,
  });
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ItemPage itemKey={item.key} />
    </QueryClientProvider>,
  );
}

const sent = (method: string, path: string) => api!.calls.filter((call) => call.method === method && call.url.split('?')[0] === path);
const lastToast = () => currentToasts().at(-1);
const runCard = (name: RegExp | string) => screen.findByRole('article', { name });
const notice = () => document.querySelector<HTMLElement>('[data-agent-notice]');

beforeAll(() => {
  // jsdom has no layout: a run asked for scrolls into view
  Element.prototype.scrollIntoView = () => {};
});

beforeEach(() => {
  useUiStore.setState(useUiStore.getInitialState());
  signedIn = mara;
  address = '/items/WEB-51';
  item = makeWorkItem({ id: 'wi_web_51', number: 51, key: 'WEB-51', title: 'Cookie-Banner auf Consent v2 umstellen', assignee_id: 'u_kira', state_id: 'std_progress' });
  agent = state();
  links = [];
  runs = [];
  events = {};
  projects = [];
});

afterEach(() => {
  api?.restore();
  api = undefined;
  act(() => resetToasts());
  clearLiveGone();
  vi.useRealTimers();
});

/* ---------------------------------------------------------------------- run lines */

describe('a run in the activity', () => {
  it('shows a running run with its facts, the chip and its log growing live', async () => {
    runs = [makeRun({ status: 'running', finished_at: null, started_at: minutesAgo(4), model: 'opus', model_source: 'label', model_label_id: labels[0].id, effort: 'xhigh', effort_source: 'project', attempt: 2 })];
    events = { run_1: [line('l_1', 'system', 'Worktree angelegt', minutesAgo(4)), line('l_2', 'tool', 'Bash pnpm test', minutesAgo(3)), line('l_3', 'error', 'Boom', minutesAgo(3))] };
    renderItem();

    const card = await runCard('Auftrag „Umsetzen“ von Kira');
    expect(within(card).getByText('Läuft')).toBeTruthy();
    expect(within(card).getByText(`vom Label ${labels[0].name}`)).toBeTruthy();
    expect(within(card).getByText('xhigh')).toBeTruthy();
    expect(within(card).getByText('aus dem Projekt')).toBeTruthy();
    expect(within(card).getByText('mac-studio')).toBeTruthy();
    expect(within(card).getByText('Versuch')).toBeTruthy();
    const log = await within(card).findByRole('log', { name: 'Protokoll: Umsetzen' });
    // the log is no live region: a status says how many lines came
    expect((log).getAttribute('aria-live')).toBe('off');
    expect(within(log).getByText('Fehler:', { exact: false })).toBeTruthy();
    expect((within(log).getByText('Bash pnpm test')).getAttribute('translate')).toBe('no');
    expect(within(log).getAllByText(/^\+\d+:\d\d$/)).toHaveLength(3);

    // the chip under the title shows the run
    const chip = await screen.findByRole('button', { name: /Kira arbeitet: Umsetzen/ });
    await userEvent.click(chip);
    await waitFor(() => expect(document.activeElement).toBe(card));

    // the log grows by the lines after the last one
    events.run_1 = [...events.run_1, line('l_4', 'result', '12 passed', minutesAgo(1))];
    await act(() => client.invalidateQueries({ queryKey: qk.runs.log('run_1') }));
    expect(await within(log).findByText('12 passed')).toBeTruthy();
    expect(await within(card).findByText('1 neue Zeile im Protokoll')).toBeTruthy();
    expect(within(card).getByRole('status').textContent).toBe('1 neue Zeile im Protokoll');
    expect(sent('GET', '/api/v1/runs/run_1/events').at(-1)!.url).toContain('filter%5Bafter%5D=l_3');

    // folded and unfolded
    await userEvent.click(within(card).getByRole('button', { name: 'Protokoll ausblenden' }));
    expect(within(card).queryByRole('log')).toBeNull();
    await userEvent.click(within(card).getByRole('button', { name: 'Protokoll' }));
    expect(await within(card).findByRole('log')).toBeTruthy();
  });

  it('shows what a finished run reported: commit, verdict, tokens, summary, and an empty or failed log', async () => {
    runs = [
      makeRun({ id: 'run_1', result: { commit: 'a41c9e2d0b7f', summary: 'PR #214 geöffnet.' }, usage: { input: 412300, output: 18900 }, model_source: 'project', events_dropped: 3 }),
      makeRun({ id: 'run_2', type: 'review', result: { verdict: 'approve' }, model_source: 'default', created_at: minutesAgo(15) }),
      makeRun({ id: 'run_3', type: 'review', result: { verdict: 'changes' }, model_source: 'label', model_label_id: 'lb_gone', created_at: minutesAgo(14), runner_online: false, runner_last_seen_at: null }),
      makeRun({ id: 'run_4', type: 'comment', status: 'queued', runner_id: null, runner_name: null, started_at: null, finished_at: null, created_at: minutesAgo(1) }),
    ];
    events = { run_1: [line('l_1', 'text', 'Fertig.')], run_2: [], run_4: [] };
    renderItem({ 'GET /api/v1/runs/run_3/events': () => ({ status: 500, body: { reason: 'server_error' } }) });

    const task = await runCard('Auftrag „Umsetzen“ von Kira');
    expect(within(task).getByText('a41c9e2')).toBeTruthy();
    expect(within(task).getByText('412.300 ein, 18.900 aus')).toBeTruthy();
    expect(within(task).getByText('PR #214 geöffnet.')).toBeTruthy();
    expect(within(task).getByText('aus dem Projekt')).toBeTruthy();
    expect(within(task).getByText('14 Min.')).toBeTruthy();
    await userEvent.click(within(task).getByRole('button', { name: 'Protokoll' }));
    expect(await within(task).findByText('3 frühere Zeilen gingen über die Grenze des Protokolls.')).toBeTruthy();
    expect((within(task).getByRole('log')).getAttribute('aria-live')).toBe('off');

    // newest first: the later review stands above the earlier one
    const [changes, approve] = await screen.findAllByRole('article', { name: 'Auftrag „Review“ von Kira' });
    expect(within(approve).getByText('Ohne Befunde')).toBeTruthy();
    expect(within(approve).getByText('Standard')).toBeTruthy();
    await userEvent.click(within(approve).getByRole('button', { name: 'Protokoll' }));
    expect(await within(approve).findByText('Noch keine Zeile.')).toBeTruthy();
    expect(within(changes).getByText('Befunde')).toBeTruthy();
    expect(within(changes).getByText('von einem gelöschten Label')).toBeTruthy();
    expect(within(changes).getByText('(offline)', { exact: false })).toBeTruthy();
    await userEvent.click(within(changes).getByRole('button', { name: 'Protokoll' }));
    expect(await within(changes).findByText('Das Protokoll wurde nicht geladen.')).toBeTruthy();
    const asked = sent('GET', '/api/v1/runs/run_3/events').length;
    await userEvent.click(within(changes).getByRole('button', { name: 'Erneut versuchen' }));
    await waitFor(() => expect(sent('GET', '/api/v1/runs/run_3/events').length).toBe(asked + 1));

    const comment = await runCard('Auftrag „Antwort“ von Kira');
    expect(within(comment).getByText('Wartet auf einen freien Platz auf einem Runner des Pools.')).toBeTruthy();
    await userEvent.click(within(comment).getByRole('button', { name: 'Protokoll' }));
    expect(await within(comment).findByText('Das Protokoll beginnt, sobald ein Runner den Auftrag abholt.')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Antwort wartet auf einen Runner/ })).toBeTruthy();
  });

  it('cancels an active run after a question, and says so when it fails', async () => {
    runs = [makeRun({ status: 'running', finished_at: null })];
    let refuse = true;
    renderItem({
      'POST /api/v1/runs/run_1/cancel': () => {
        if (refuse) return { status: 500, body: { reason: 'server_error' } };
        runs = [{ ...runs[0], status: 'canceling', canceled_by: 'u_mara' }];
        return { body: { data: runs[0] } };
      },
    });
    const card = await runCard('Auftrag „Umsetzen“ von Kira');
    await userEvent.click(within(card).getByRole('button', { name: 'Abbrechen' }));
    const dialog = await screen.findByRole('alertdialog', { name: 'Auftrag „Umsetzen“ abbrechen?' });
    expect(within(dialog).getByText(/Der Runner beendet das CLI/)).toBeTruthy();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Auftrag abbrechen' }));
    await waitFor(() => expect(lastToast()?.title).toBe('Auftrag nicht abgebrochen'));

    refuse = false;
    act(() => runToastAction(lastToast()!.id));
    await waitFor(() => expect(lastToast()?.title).toBe('WEB-51: Auftrag wird abgebrochen'));
    await waitFor(() => expect(within(card).getByText('Wird abgebrochen')).toBeTruthy());
    expect((within(card).getByRole('button', { name: 'Abbrechen' })).getAttribute('aria-disabled')).toBe('true');
    expect(await screen.findByRole('button', { name: /Kira hört auf: Umsetzen wird abgebrochen/ })).toBeTruthy();
  });

  it('asks a different question for a run that still waits, and shows who canceled one', async () => {
    runs = [
      makeRun({ id: 'run_0', status: 'canceled', canceled_by: 'u_mara', created_at: minutesAgo(50), finished_at: minutesAgo(40) }),
      makeRun({ id: 'run_00', status: 'canceled', canceled_by: 'u_ida', created_at: minutesAgo(45), finished_at: null, started_at: null }),
      makeRun({ status: 'queued', started_at: null, finished_at: null, runner_name: null }),
    ];
    renderItem();
    // newest first: the waiting run on top, then the two canceled ones
    const [waiting, second, first] = await screen.findAllByRole('article', { name: 'Auftrag „Umsetzen“ von Kira' });
    expect(within(first).getByText(/Abgebrochen von Mara Lindqvist um \d\d:\d\d\./)).toBeTruthy();
    expect(within(second).getByText('Abgebrochen von Ida Brenner.')).toBeTruthy();
    await userEvent.click(within(waiting).getByRole('button', { name: 'Abbrechen' }));
    expect(await screen.findByText(/Der Auftrag kommt aus der Warteschlange/)).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Weiterlaufen lassen' }));
  });
});

/* ------------------------------------------------------------- the ways back */

describe('the ways back', () => {
  it('starts a failed run again from its line and from the notice', async () => {
    runs = [makeRun({ status: 'failed', error: 'Der Setup-Befehl ist gescheitert.' })];
    let fail = true;
    renderItem({
      'POST /api/v1/runs/run_1/retry': () => {
        if (fail) return { status: 500, body: { reason: 'server_error' } };
        const next = makeRun({ id: 'run_2', status: 'queued', started_at: null, finished_at: null, created_at: new Date().toISOString() });
        runs = [...runs, next];
        return { status: 201, body: { data: next } };
      },
    });
    const banner = await screen.findByText('Auftrag gescheitert: Umsetzen');
    const box = banner.closest('div')!.parentElement!;
    expect(within(notice()!).getByText(/Der Setup-Befehl ist gescheitert\. „Erneut starten“ macht im selben Strang weiter/)).toBeTruthy();
    expect(box).toBeTruthy();

    const card = await runCard('Auftrag „Umsetzen“ von Kira');
    await userEvent.click(within(card).getByRole('button', { name: 'Erneut starten' }));
    await waitFor(() => expect(lastToast()?.title).toBe('Auftrag nicht neu gestartet'));

    fail = false;
    act(() => runToastAction(lastToast()!.id));
    await waitFor(() => expect(lastToast()?.title).toBe('WEB-51: Umsetzen neu eingereiht'));
    await waitFor(() => expect(screen.getAllByRole('article', { name: 'Auftrag „Umsetzen“ von Kira' })).toHaveLength(2));
    expect(screen.queryByText('Auftrag gescheitert: Umsetzen')).toBeNull();
  });

  it('says who canceled the last run and offers to start it again', async () => {
    runs = [makeRun({ status: 'canceled', canceled_by: 'u_ida', error: null })];
    renderItem({ 'POST /api/v1/runs/run_1/retry': () => ({ status: 201, body: { data: makeRun({ id: 'run_2', status: 'queued' }) } }) });
    expect(await screen.findByText('Auftrag abgebrochen: Umsetzen')).toBeTruthy();
    expect(within(notice()!).getByText('Abgebrochen von Ida Brenner.', { exact: false })).toBeTruthy();

    runs = [makeRun({ status: 'timed_out', error: null })];
    await act(() => client.invalidateQueries({ queryKey: qk.runs.all }));
    expect(await screen.findByText('Auftrag gescheitert: Umsetzen')).toBeTruthy();
    expect(within(notice()!).getByText(/Der Runner hat einen Fehler gemeldet\./)).toBeTruthy();
    // the notice starts it again too
    await userEvent.click(within(notice()!).getByRole('button', { name: 'Erneut starten' }));
    await waitFor(() => expect(sent('POST', '/api/v1/runs/run_1/retry')).toHaveLength(1));
  });

  it('gives an item that somebody else has back to the bot', async () => {
    item = { ...item, assignee_id: 'u_mara' };
    agent = state({ thread: openThread({ status: 'paused', pause_reason: 'reassigned', pr_number: 214 }) });
    runs = [makeRun({ status: 'failed' })];
    renderItem();

    const banner = await screen.findByText('Kira arbeitet nicht mehr daran');
    expect(within(notice()!).getByText(/Das Item wurde Mara Lindqvist zugewiesen; der Strang ist pausiert #214\./)).toBeTruthy();
    expect(banner).toBeTruthy();
    const card = await runCard('Auftrag „Umsetzen“ von Kira');
    expect(within(card).getByText(/WEB-51 ist nicht mehr bei Kira/)).toBeTruthy();
    await userEvent.click(within(card).getByRole('button', { name: 'Wieder Kira zuweisen' }));
    await waitFor(() => expect(lastToast()?.title).toBe('WEB-51 ist wieder bei Kira'));
    expect(sent('PATCH', '/api/v1/work-items/wi_web_51').map((call) => call.body)).toEqual([{ assignee_id: 'u_kira' }]);
  });

  it('names the brake, a run that changed nothing, and gives the item back from the notice', async () => {
    item = { ...item, assignee_id: 'u_mara' };
    agent = state({ thread: openThread({ status: 'paused', pause_reason: 'brake', corrections: 3, pr_number: 208 }) });
    renderItem();
    expect(await screen.findByText('Bremse gezogen: Kira hat nach 3 Korrekturen aufgehört')).toBeTruthy();
    expect(within(notice()!).getByText(/Das Item ging an Mara Lindqvist/)).toBeTruthy();

    agent = state({ thread: openThread({ status: 'paused', pause_reason: 'brake', conflicts: 1, corrections: 0 }), brakes: { max_corrections: 3, max_conflicts: 1 } });
    await act(() => client.invalidateQueries({ queryKey: qk.workItems.all }));
    expect(await screen.findByText('Bremse gezogen: Kira hat nach 1 Konflikt mit der Basis aufgehört')).toBeTruthy();

    agent = state({ thread: openThread({ status: 'paused', pause_reason: 'brake' }) });
    await act(() => client.invalidateQueries({ queryKey: qk.workItems.all }));
    expect(await screen.findByText('Kira arbeitet nicht mehr daran')).toBeTruthy();

    agent = state({ thread: openThread({ status: 'paused', pause_reason: 'no_change' }) });
    await act(() => client.invalidateQueries({ queryKey: qk.workItems.all }));
    expect(await screen.findByText('Kira hat aufgehört: der letzte Auftrag hat nichts geändert')).toBeTruthy();
    agent = state({ thread: openThread({ status: 'paused', pause_reason: 'needs_person' }) });
    await act(() => client.invalidateQueries({ queryKey: qk.workItems.all }));
    expect(await screen.findByText('Kira kommt nicht weiter und braucht eine Person')).toBeTruthy();
    await userEvent.click(within(notice()!).getByRole('button', { name: 'Wieder Kira zuweisen' }));
    await waitFor(() => expect(lastToast()?.title).toBe('WEB-51 ist wieder bei Kira'));
  });

  it('names the child an epic on its own branch works on now (WEBU-71)', async () => {
    agent = state({ thread: openThread({ child: { id: 'wi_web_52', key: 'WEB-52' } }) });
    renderItem();
    expect(await screen.findByText('Kira arbeitet am Kind')).toBeTruthy();
    expect(within(notice()!).getByRole('link', { name: 'WEB-52' }).getAttribute('href')).toBe('/items/WEB-52');
  });

  it('resumes a strand GitHub paused once the project has its repo, and says when the brake stopped it', async () => {
    agent = state({ thread: openThread({ status: 'paused', pause_reason: 'github', pr_number: 214 }), repository: false });
    let answer: { status?: number; body?: unknown } = { status: 500, body: { reason: 'server_error' } };
    renderItem({ 'POST /api/v1/work-items/wi_web_51/agent/resume': () => answer });

    expect(await screen.findByText('Kira hat aufgehört: GitHub ist getrennt')).toBeTruthy();
    const resume = within(notice()!).getByRole('button', { name: 'Weitermachen' });
    expect((resume).getAttribute('aria-disabled')).toBe('true');

    agent = state({ thread: openThread({ status: 'paused', pause_reason: 'github' }), repository: true });
    await act(() => client.invalidateQueries({ queryKey: qk.workItems.all }));
    await waitFor(() => expect((within(notice()!).getByRole('button', { name: 'Weitermachen' })).getAttribute('aria-disabled')).toBeNull());
    await userEvent.click(within(notice()!).getByRole('button', { name: 'Weitermachen' }));
    await waitFor(() => expect(lastToast()?.title).toBe('Nicht weitergemacht'));

    answer = { body: { data: { run: makeRun({ id: 'run_9', type: 'correction', status: 'queued' }), braked: false } } };
    act(() => runToastAction(lastToast()!.id));
    await waitFor(() => expect(lastToast()?.title).toBe('WEB-51: Kira macht weiter'));

    answer = { body: { data: { run: null, braked: true } } };
    await userEvent.click(within(notice()!).getByRole('button', { name: 'Weitermachen' }));
    await waitFor(() => expect(lastToast()?.title).toBe('WEB-51: Bremse gezogen'));
  });

  it('shows the guard: from this item with the way to confirm, from another without it for a member', async () => {
    projects = [project('WEB', 'admin', { name: 'Website-Relaunch' })];
    agent = state({ thread: openThread({ status: 'paused', pause_reason: 'guard' }), guard: { branch: 'main', sha: 'abcdef1234', here: true } });
    renderItem();
    expect(await screen.findByText('Eigenmächtiger Merge erkannt: Kira hat auf main gepusht')).toBeTruthy();
    expect(within(notice()!).getByText(/\(abcdef1\)/)).toBeTruthy();
    expect((within(notice()!).getByRole('link', { name: 'In Projekt → Agenten bestätigen' })).getAttribute('href')).toBe('/projects/WEB/settings/agents');

    projects = [project('WEB', 'member', { name: 'Website-Relaunch' })];
    agent = state({ thread: openThread({ status: 'paused', pause_reason: 'guard' }), guard: null });
    await act(() => client.invalidateQueries());
    expect(await screen.findByText('Kira pausiert: eigenmächtiger Merge in WEB')).toBeTruthy();
    await waitFor(() => expect(within(notice()!).queryByRole('link')).toBeNull());
  });
});

/* --------------------------------------------------------------- waiting runs */

describe('a run that waits', () => {
  it('waits for the offline runner of its strand, and says when another may take over', async () => {
    runs = [makeRun({ type: 'correction', status: 'waiting', waiting_reason: 'runner_offline', runner_name: 'mac-mini-alt', runner_online: false, runner_last_seen_at: minutesAgo(12), started_at: null, finished_at: null })];
    renderItem();
    expect(await screen.findByText('Korrektur wartet auf mac-mini-alt')).toBeTruthy();
    expect(within(notice()!).getByText(/mac-mini-alt ist seit \d\d:\d\d offline\. .* Ab \d\d:\d\d übernimmt/)).toBeTruthy();
    const card = await runCard('Auftrag „Korrektur“ von Kira');
    expect(within(card).getByText(/offline seit \d\d:\d\d/)).toBeTruthy();
    expect(within(card).getByText(/Wartet auf mac-mini-alt: Korrekturen laufen auf dem Runner ihres Strangs/)).toBeTruthy();

    await userEvent.click(within(notice()!).getByRole('button', { name: 'Auftrag zeigen' }));
    await waitFor(() => expect(document.activeElement).toBe(card));

    runs = [{ ...runs[0], runner_last_seen_at: minutesAgo(40) }];
    await act(() => client.invalidateQueries({ queryKey: qk.runs.all }));
    expect(await within(notice()!).findByText(/Seit \d\d:\d\d darf ein anderer Runner/)).toBeTruthy();

    runs = [{ ...runs[0], runner_last_seen_at: null }];
    await act(() => client.invalidateQueries({ queryKey: qk.runs.all }));
    expect(await within(notice()!).findByText('mac-mini-alt ist offline. Dort liegen Worktree und Session des Strangs.')).toBeTruthy();
  });

  it('waits for a runner with its CLI', async () => {
    runs = [makeRun({ status: 'waiting', waiting_reason: 'no_cli', cli: 'codex', runner_id: null, runner_name: null, started_at: null, finished_at: null })];
    renderItem();
    expect(await screen.findByText('Umsetzen wartet')).toBeTruthy();
    expect(within(notice()!).getByText(/Wartet: kein Runner im Pool hat Codex installiert und angemeldet\. Der Auftrag startet, sobald/)).toBeTruthy();
  });

  it('says every reason a run waits', () => {
    const run = makeRun({ status: 'waiting', runner_name: null });
    expect(waitingText({ ...run, waiting_reason: 'agent_off' })).toBe('Wartet: der Agent ist ausgeschaltet.');
    expect(waitingText({ ...run, waiting_reason: 'merge_guard' })).toMatch(/eigenmächtiger Merge/);
    expect(waitingText({ ...run, waiting_reason: 'github_unavailable' })).toMatch(/GitHub hat eben kein Token/);
    expect(waitingText({ ...run, waiting_reason: 'usage_limit' })).toMatch(/Limit für das Claude-Abo erreicht/);
    expect(waitingText({ ...run, waiting_reason: 'runner_offline' })).toMatch(/Wartet auf den Runner seines Strangs/);
    expect(waitingText({ ...run, waiting_reason: null })).toBe('Wartet auf einen freien Platz auf einem Runner des Pools.');
  });
});

/* --------------------------------------------------------- an item that waits for Todo */

describe('an item in the backlog of a bot that begins in Todo', () => {
  it('says what it waits for', async () => {
    agent = state({ thread: null, ready_state: 'Todo' });
    renderItem();
    expect(await screen.findByText('Kira beginnt, sobald das Item auf „Todo“ steht')).toBeTruthy();
  });
});

describe('an item that an open item blocks', () => {
  it('says which blockers it waits for', async () => {
    agent = state({ thread: null, blocked_by: ['WEB-44', 'WEB-45'] });
    renderItem();
    expect(await screen.findByText(/beginnt, sobald WEB-44, WEB-45 erledigt ist/)).toBeTruthy();
  });
});

/* --------------------------------------------------------- a bot that is no agent */

describe('a bot that does not work here as an agent', () => {
  it('says why, with the way to change it for who may', async () => {
    agent = state({ thread: null, refusal: 'agent_off' });
    renderItem();
    expect(await screen.findByText('Kira arbeitet hier nicht als Agent')).toBeTruthy();
    expect((await within(notice()!).findByRole('link', { name: 'Kira als Agent einrichten' })).getAttribute('href')).toBe('/settings/bots?agent=u_kira');

    projects = [project('WEB', 'admin', { name: 'Website-Relaunch' })];
    agent = state({ thread: null, refusal: 'no_steps' });
    await act(() => client.invalidateQueries());
    expect((await within(notice()!).findByRole('link', { name: 'Agenten von WEB' })).getAttribute('href')).toBe('/projects/WEB/settings/agents');

    agent = state({ thread: null, refusal: 'not_member' });
    await act(() => client.invalidateQueries({ queryKey: qk.workItems.all }));
    expect((await within(notice()!).findByRole('link', { name: 'Mitglieder von WEB' })).getAttribute('href')).toBe('/projects/WEB/settings/members');

    agent = state({ thread: null, refusal: 'archived' });
    await act(() => client.invalidateQueries({ queryKey: qk.workItems.all }));
    expect(await within(notice()!).findByText(/WEB ist archiviert/)).toBeTruthy();
    expect(within(notice()!).queryByRole('link')).toBeNull();
  });

  it('gives a member no way to change it', async () => {
    signedIn = lene;
    agent = state({ thread: null, refusal: 'no_owner' });
    renderItem();
    expect(await screen.findByText(/Kira hat keine verantwortliche Person/)).toBeTruthy();
    expect(within(notice()!).queryByRole('link')).toBeNull();
  });

  it('shows nothing without a run, a strand or a reason', async () => {
    agent = null;
    renderItem();
    await screen.findByRole('heading', { name: 'Aktivität' });
    expect(notice()).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Pull Requests' })).toBeNull();
  });
});

/* -------------------------------------------------------------- pull requests */

describe('pull requests', () => {
  it('lists the PRs with their state, CI, checks, review and author', async () => {
    runs = [makeRun({ thread_id: 'th_agent' })];
    links = [
      pr({
        ci: 'pending',
        review: 'approve',
        checks: [check('tests', 'completed', 'success'), check('e2e', 'in_progress'), check('lint', 'queued'), check('docs', 'completed', 'skipped'), check('size', 'completed', 'neutral')],
      }),
      pr({ id: 'lk_2', number: 212, ci: 'failure', review: 'changes', closes: false, checks: [check('tests', 'completed', 'failure'), check('flaky', 'completed', 'cancelled'), check('ci/status', 'pending'), check('odd', 'completed', null)] }),
      pr({ id: 'lk_3', number: 215, draft: true, thread_id: 'th_agent', author: 'werkbuch[bot]', review: 'approve', ci: 'success' }),
      pr({ id: 'lk_4', number: 198, state: 'merged', ci: 'success', thread_id: 'th_gone', author: 'app[bot]' }),
      pr({ id: 'lk_5', number: 190, state: 'closed' }),
      pr({ id: 'lk_6', number: 191, ci: 'success' }),
      pr({ id: 'lk_7', number: 192, ci: 'none' }),
    ];
    renderItem();
    const list = await screen.findByRole('list', { name: 'Pull Requests von WEB-51' });
    const rows = within(list).getAllByRole('listitem').filter((row) => row.parentElement === list);
    expect(rows).toHaveLength(7);
    expect(within(rows[0]).getByRole('link', { name: /Fix the banner \(WEB-51\)/ }).getAttribute('href')).toBe('https://github.com/feldwerk/website/pull/211');
    expect(within(rows[0]).getByText('CI läuft')).toBeTruthy();
    expect(within(rows[0]).getByText('Review: Approve')).toBeTruthy();
    expect(within(rows[0]).getByText('schließt beim Merge')).toBeTruthy();
    const checks = within(rows[0]).getByRole('list', { name: 'Checks von #211' });
    expect(within(checks).getAllByText(/^(grün|läuft|wartet|übersprungen|neutral)$/).map((node) => node.textContent)).toEqual(['grün', 'läuft', 'wartet', 'übersprungen', 'neutral']);
    expect(within(rows[1]).getByText('CI rot')).toBeTruthy();
    expect(within(rows[1]).getByText('Review: Befunde')).toBeTruthy();
    expect(within(rows[1]).getByText('nur verknüpft')).toBeTruthy();
    expect(within(within(rows[1]).getByRole('list')).getAllByText(/^(rot|abgebrochen|wartet)$/).map((node) => node.textContent)).toEqual(['rot', 'abgebrochen', 'wartet', 'rot']);
    expect(within(rows[2]).getByText('Entwurf')).toBeTruthy();
    expect(within(rows[2]).getByText('von Kira (Agent)')).toBeTruthy();
    expect(within(rows[2]).getByText('Review: ohne Befunde')).toBeTruthy();
    expect(within(rows[2]).getByText(/Ein Entwurf löst nichts aus/)).toBeTruthy();
    expect(within(rows[3]).getByText('Gemergt')).toBeTruthy();
    expect(within(rows[3]).getByText('von app[bot] (Agent)')).toBeTruthy();
    expect(within(rows[3]).queryByText(/^CI/)).toBeNull();
    expect(within(rows[4]).getByText('Geschlossen')).toBeTruthy();
    expect(within(rows[5]).getByText('CI grün')).toBeTruthy();
    expect(within(rows[6]).getByText('Keine Checks')).toBeTruthy();
  });

  it('says how a PR gets here in a project with a repo', async () => {
    renderItem();
    expect(await screen.findByText(/Noch kein PR\. Ein PR im Repo des Projekts erscheint hier, sobald sein Titel, seine Beschreibung oder sein Branch WEB-51 nennt/)).toBeTruthy();
  });
});

/* ------------------------------------------------------------------- activity */

describe('the filter of the activity', () => {
  it('offers "Aufträge" only with runs', async () => {
    address = '/items/WEB-51?activity=runs';
    renderItem();
    const filter = await screen.findByRole('group', { name: 'Aktivität filtern' });
    expect(within(filter).queryByRole('button', { name: 'Aufträge' })).toBeNull();
    expect(within(filter).getByRole('button', { name: 'Alles' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('shows only the runs under "Aufträge"', async () => {
    address = '/items/WEB-51?activity=runs';
    runs = [makeRun()];
    events = { run_1: [] };
    renderItem();
    const filter = await screen.findByRole('group', { name: 'Aktivität filtern' });
    await waitFor(() => expect(within(filter).getByRole('button', { name: 'Aufträge' }).getAttribute('aria-pressed')).toBe('true'));
    expect(await runCard('Auftrag „Umsetzen“ von Kira')).toBeTruthy();
  });

  it('brings a filter that hides runs back to "Alles" when the chip asks for a run', async () => {
    address = '/items/WEB-51?activity=comments';
    runs = [makeRun({ status: 'running', finished_at: null })];
    events = { run_1: [] };
    renderItem();
    const chip = await screen.findByRole('button', { name: /Kira arbeitet: Umsetzen/ });
    expect(screen.queryByRole('article', { name: /Auftrag/ })).toBeNull();
    await userEvent.click(chip);
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith(expect.objectContaining({ url: '/items/WEB-51' })));
  });
});

describe('review round of PR #77', () => {
  it('unfolds the log of a run that starts', async () => {
    runs = [makeRun({ status: 'queued', started_at: null, finished_at: null })];
    events = { run_1: [line('l_1', 'system', 'Worktree angelegt')] };
    renderItem();
    const card = await runCard('Auftrag „Umsetzen“ von Kira');
    expect(within(card).queryByRole('log')).toBeNull();

    runs = [{ ...runs[0], status: 'running', started_at: minutesAgo(1) }];
    await act(() => client.invalidateQueries({ queryKey: qk.runs.all }));
    expect(await within(card).findByRole('log')).toBeTruthy();
  });

  it('asks for the runs only of an item that has some, and for no log of a deleted item', async () => {
    agent = state({ runs: 0, thread: null });
    renderItem();
    await screen.findByRole('heading', { name: 'Aktivität' });
    expect(sent('GET', '/api/v1/runs')).toEqual([]);
    api!.restore();

    agent = state();
    runs = [makeRun()];
    renderItem();
    const card = await runCard('Auftrag „Umsetzen“ von Kira');
    // the item was deleted meanwhile: its runs stay on the screen, its log is not asked for (it would answer 404)
    act(() => markLiveGone(item.id));
    await userEvent.click(within(card).getByRole('button', { name: 'Protokoll' }));
    expect(within(card).getByRole('button', { name: 'Protokoll ausblenden' })).toBeTruthy();
    expect(sent('GET', '/api/v1/runs/run_1/events')).toEqual([]);
  });

  it('asks a person who has an item GitHub paused to give it back first', async () => {
    item = { ...item, assignee_id: 'u_mara' };
    agent = state({ thread: openThread({ status: 'paused', pause_reason: 'github' }) });
    renderItem();
    expect(await screen.findByText('Kira hat aufgehört: GitHub ist getrennt')).toBeTruthy();
    expect(within(notice()!).getByText(/das Item ist jetzt bei Mara Lindqvist\. Weise es wieder Kira zu/)).toBeTruthy();
    expect(within(notice()!).queryByRole('button', { name: 'Weitermachen' })).toBeNull();
    await userEvent.click(within(notice()!).getByRole('button', { name: 'Wieder Kira zuweisen' }));
    await waitFor(() => expect(lastToast()?.title).toBe('WEB-51 ist wieder bei Kira'));
  });

  it('names the default bot and a deactivated bot, with a way back only for the deactivated one', async () => {
    agent = state({ thread: null, refusal: 'default_bot' });
    renderItem();
    expect(await screen.findByText(/Kira ist der Standard-Bot der Organisation/)).toBeTruthy();
    expect(within(notice()!).queryByRole('link')).toBeNull();

    agent = state({ thread: null, refusal: 'disabled' });
    await act(() => client.invalidateQueries({ queryKey: qk.workItems.all }));
    expect(await within(notice()!).findByRole('link', { name: 'Unter Bots reaktivieren' })).toBeTruthy();
  });

  it('links a comment that answers a run to the run', async () => {
    runs = [makeRun({ type: 'review' })];
    events = { run_1: [] };
    const comment = { id: 'c_1', work_item_id: item.id, author_id: 'u_kira', body: 'Ohne Befunde.', body_json: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Ohne Befunde.' }] }] }, created_at: minutesAgo(10), edited_at: null, reactions: [], run_id: 'run_1' };
    const elsewhere = { ...comment, id: 'c_2', body: 'Anderswo.', body_json: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Anderswo.' }] }] }, run_id: 'run_other' };
    renderItem({ [`GET /api/v1/work-items/${item.id}/comments`]: () => ({ body: list([comment, elsewhere]) }) });
    const link = await screen.findByRole('button', { name: 'Ergebnis eines Auftrags' });
    // only a run of the item's own runs has a line to jump to
    expect(screen.getAllByRole('button', { name: 'Ergebnis eines Auftrags' })).toHaveLength(1);
    await userEvent.click(link);
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('article', { name: 'Auftrag „Review“ von Kira' })));
  });

  it('says how many lines came at most every few seconds', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    let lines = [line('l_1', 'text', 'eins')];
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    queryClient.setQueryData(qk.runs.log('run_1'), lines);
    api = mockApi({ 'GET /api/v1/runs/run_1/events': () => ({ body: list([]) }) });
    const run = makeRun({ status: 'running', finished_at: null });
    const view = render(
      <QueryClientProvider client={queryClient}>
        <RunLog run={run} id="log" enabled={false} />
      </QueryClientProvider>,
    );
    const status = () => view.container.querySelector('[role="status"]')!.textContent;
    const add = async (id: string) => {
      lines = [...lines, line(id, 'text', id)];
      await act(async () => queryClient.setQueryData(qk.runs.log('run_1'), lines));
      await act(() => vi.advanceTimersByTimeAsync(0));
    };
    await act(() => vi.advanceTimersByTimeAsync(0));
    await add('l_2');
    await act(() => vi.advanceTimersByTimeAsync(1));
    expect(status()).toBe('1 neue Zeile im Protokoll');
    await add('l_3');
    await add('l_4');
    await act(() => vi.advanceTimersByTimeAsync(ANNOUNCE_MS / 2));
    expect(status()).toBe('1 neue Zeile im Protokoll');
    await act(() => vi.advanceTimersByTimeAsync(ANNOUNCE_MS));
    expect(status()).toBe('2 neue Zeilen im Protokoll');
    // the same words again are new text for a screen reader: a new node
    const before = view.container.querySelector('[role="status"] span');
    await add('l_5');
    await add('l_6');
    await act(() => vi.advanceTimersByTimeAsync(ANNOUNCE_MS));
    expect(status()).toBe('2 neue Zeilen im Protokoll');
    expect(view.container.querySelector('[role="status"] span')).not.toBe(before);
    view.unmount();
    // a finished run says nothing
    const done = render(
      <QueryClientProvider client={queryClient}>
        <RunLog run={makeRun()} id="log" enabled={false} />
      </QueryClientProvider>,
    );
    await add('l_7');
    await act(() => vi.advanceTimersByTimeAsync(ANNOUNCE_MS));
    expect(done.container.querySelector('[role="status"]')!.textContent).toBe('');
  });
});

/* ------------------------------------------------------------------- the rules */

describe('the rules of the runs', () => {
  it('formats durations and offsets', () => {
    expect(formatDuration(42_000)).toBe('42 s');
    expect(formatDuration(-5)).toBe('0 s');
    expect(formatDuration(240_000)).toBe('4 Min.');
    expect(formatDuration(252_000)).toBe('4 Min. 12 s');
    expect(formatDuration(3_600_000)).toBe('1 Std.');
    expect(formatDuration(3_780_000)).toBe('1 Std. 3 Min.');
    expect(offsetText(252)).toBe('+4:12');
    expect(offsetText(3852)).toBe('+1:04:12');
    expect(offsetText(-3)).toBe('+0:00');
  });

  it('names where a model came from', () => {
    expect(modelOrigin({ model_source: 'bot', model_label_id: null }, undefined)).toBe('vom Bot');
    expect(modelOrigin({ model_source: 'label', model_label_id: 'x' }, undefined)).toBe('von einem gelöschten Label');
    expect(modelOrigin({ model_source: null, model_label_id: null }, labels)).toBe('Standard');
    expect([effortOrigin({ effort_source: 'label' }), effortOrigin({ effort_source: 'bot' }), effortOrigin({ effort_source: 'project' }), effortOrigin({ effort_source: 'default' })]).toEqual([
      'von einem Label',
      'vom Bot',
      'aus dem Projekt',
      'Standard',
    ]);
  });

  it('offers to start again only the newest run that ended badly, with the item at the bot on an open strand', () => {
    const failed = makeRun({ status: 'failed' });
    const atBot = { assignee_id: 'u_kira' };
    expect(canRetry(failed, [failed], atBot, { status: 'open' })).toBe(true);
    expect(canRetry(failed, [failed], atBot, null)).toBe(true);
    expect(canRetry(failed, [failed], atBot, { status: 'paused' })).toBe(false);
    expect(canRetry(failed, [failed, makeRun({ id: 'run_2', status: 'queued' })], atBot, null)).toBe(false);
    expect(canRetry(makeRun({ status: 'succeeded' }), [makeRun({ status: 'succeeded' })], atBot, null)).toBe(false);
    expect(needsGiveBack(failed, [failed], { assignee_id: 'u_mara' }, null)).toBe(true);
    expect(needsGiveBack(failed, [failed], atBot, null)).toBe(false);
  });
});

describe('the focus around runs', () => {
  it('shows a run once its line is drawn, and gives a lost focus to the title when no new run came', async () => {
    const frames: FrameRequestCallback[] = [];
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => frames.push(callback));
    const flush = (count = 1) => {
      for (let index = 0; index < count; index += 1) frames.shift()?.(0);
    };
    const shown = vi.fn();
    window.addEventListener('werkbuch:show-runs', shown);
    document.body.innerHTML = '<h1 data-item-title tabindex="-1">Titel</h1>';
    showRun('run_x');
    flush(2);
    const card = document.createElement('article');
    card.id = 'run-run_x';
    card.tabIndex = -1;
    card.scrollIntoView = vi.fn();
    document.body.append(card);
    flush();
    expect(shown).toHaveBeenCalled();
    expect(document.activeElement).toBe(card);

    // nothing new within the watch: a lost focus goes to the title
    card.remove();
    const now = vi.spyOn(performance, 'now');
    now.mockReturnValue(0);
    focusNewRun(new Set());
    flush();
    now.mockReturnValue(10_000);
    flush();
    expect(document.activeElement).toBe(document.querySelector('[data-item-title]'));

    // a click ends the watch
    focusNewRun(new Set());
    document.dispatchEvent(new PointerEvent('pointerdown'));
    flush();
    now.mockRestore();
    window.removeEventListener('werkbuch:show-runs', shown);
    vi.restoreAllMocks();
  });
});
