/*
 * Bot → Agent (spec 10.4, `?agent=<id>` of the bots section) and the agent line of the bot cards, against a small fake
 * server: switching on, the runner pool (empty is every runner), the CLI with its availability per runner, the default
 * model, a change of CLI that drops models, refusals at their fields, and the bots that cannot be agents. The keyboard
 * flow runs in e2e/tests/agents-bot.spec.ts.
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode, Ref } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { currentToasts, resetToasts, runToastAction } from '@/components/ui/toast';
import { mockApi, type MockApi, type MockRoute } from '@/test/api';
import { agency, list, mara, organization, person, project, standard } from '@/test/fixtures';
import type { AgentConfig, Runner, User } from '@/types';
import { OrgSettings } from '../OrgSettings';
import { agentSummary } from '../Bots';
import { cliState, shortId } from './BotAgent';

const inertia = vi.hoisted(() => ({ url: '/settings/bots?agent=u_kira' }));

vi.mock('@inertiajs/react', () => ({
  usePage: () => ({ props: { auth: { user: mara, permissions: [] }, organization }, url: inertia.url }),
  Link: ({ href, children, ref, ...rest }: { href: string; children: ReactNode; ref?: Ref<HTMLAnchorElement> }) => (
    <a href={href} ref={ref} {...rest}>
      {children}
    </a>
  ),
  router: { reload: vi.fn(), visit: vi.fn(), on: () => () => {} },
}));

/* -------------------------------------------------------------------------- data */

const bot = (id: string, name: string, changes: Partial<User> = {}): User => ({ ...person(id, name, id.slice(2)), type: 'bot', email: null, owner_id: 'u_mara', ...changes });
const kira = bot('u_kira', 'Kira', { description: 'Bot von Mara.' });
const otto = bot('u_otto', 'Otto');
const automation = bot('u_automation', 'Automation', { is_default_bot: true, owner_id: null, org_role: 'admin' });
const orphan = bot('u_orphan', 'Waise', { owner_id: null, disabled_at: '2026-10-01T10:00:00.000Z' });

const runner = (id: string, name: string, changes: Partial<Runner> = {}): Runner => ({
  id,
  name,
  os: 'darwin',
  arch: 'arm64',
  version: '0.3.0',
  protocol: 1,
  online: true,
  last_seen_at: '2026-10-30T08:59:30.000Z',
  slots: { total: 2, per_repo: 1, light: 2 },
  slots_used: { total: 0, per_repo: 0, light: 0 },
  load: null,
  clis: [
    { cli: 'claude', installed: true, version: '2.1.0', logged_in: true, path: '/usr/local/bin/claude' },
    { cli: 'codex', installed: true, version: '0.9.0', logged_in: false, path: '/usr/local/bin/codex' },
  ],
  equipment: null,
  usage: null,
  usage_limit: null,
  over_usage_limit: false,
  created_by: 'u_mara',
  created_at: '2026-10-20T10:00:00.000Z',
  updated_at: '2026-10-20T10:00:00.000Z',
  ...changes,
});
const studio = runner('r_studio', 'mac-studio');
const box = runner('r_box', 'build-box', { online: false, last_seen_at: '2026-10-29T18:00:00.000Z', slots: { total: 1, per_repo: 1, light: 1 }, clis: [] });
const fresh = runner('r_fresh', 'fresh', { online: false, last_seen_at: null, clis: [] });

const config = (bot_id: string, changes: Partial<AgentConfig> = {}): AgentConfig => ({
  bot_id,
  enabled: false,
  runner_ids: [],
  cli: 'claude',
  model: 'sonnet',
  models: {},
  updated_at: null,
  ...changes,
});

/* ------------------------------------------------------------------------ server */

let api: MockApi | undefined;
let stored: Record<string, AgentConfig> = {};

const problem = (status: number, reason: string, extra: Record<string, unknown> = {}) => ({ status, body: { type: 'about:blank', title: reason, status, reason, ...extra } });
const unavailable = () => problem(503, 'service_unavailable', { detail: 'Der Server ist gerade nicht erreichbar.' });

function renderAgent({ url = '/settings/bots?agent=u_kira', bots = [kira, otto, automation, orphan], runners = [studio, box], configs = { u_kira: config('u_kira') }, routes = {} }: {
  url?: string;
  bots?: User[];
  runners?: Runner[];
  configs?: Record<string, AgentConfig>;
  routes?: Record<string, MockRoute>;
} = {}) {
  inertia.url = url;
  stored = { ...configs };
  const agentRoutes = Object.fromEntries(
    bots.flatMap((entry) => [
      [`GET /api/v1/bots/${entry.id}/agent`, () => ({ body: { data: stored[entry.id] ?? config(entry.id) } })],
      [
        `PUT /api/v1/bots/${entry.id}/agent`,
        (body: unknown) => {
          stored[entry.id] = { ...config(entry.id), ...(body as AgentConfig), updated_at: '2026-10-30T09:00:00.000Z' };
          return { body: { data: stored[entry.id] } };
        },
      ],
    ]),
  ) as Record<string, MockRoute>;
  api = mockApi({
    'GET /api/v1/organization': () => ({ body: { data: organization } }),
    'GET /api/v1/projects': () => ({ body: list([]) }),
    'GET /api/v1/users': (_body, requested) => ({ body: list(requested.searchParams.get('filter[type]') === 'person' ? [mara] : bots) }),
    'GET /api/v1/tokens': () => ({ body: list([]) }),
    'GET /api/v1/runners': () => ({ body: list(runners) }),
    ...agentRoutes,
    ...routes,
  });
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}>
      <OrgSettings section="bots" />
    </QueryClientProvider>,
  );
}

const puts = (botId = 'u_kira') => api!.calls.filter((call) => call.method === 'PUT' && call.url === `/api/v1/bots/${botId}/agent`);
const toastNamed = (title: string) => currentToasts().find((entry) => entry.title === title);
const save = () => screen.getByRole('button', { name: /Speichern/ });

afterEach(() => {
  api?.restore();
  api = undefined;
  inertia.url = '/settings/bots?agent=u_kira';
  act(() => resetToasts());
});

/* ------------------------------------------------------------------------- rules */

describe('cliState', () => {
  it('reads whether a runner has a CLI installed and logged in', () => {
    expect(cliState(studio, 'claude')).toBe('ready');
    expect(cliState(studio, 'codex')).toBe('not_logged_in');
    expect(cliState(box, 'claude')).toBe('not_installed');
    expect(cliState({ clis: [{ cli: 'codex', installed: false, version: null, logged_in: false, path: null }] }, 'codex')).toBe('not_installed');
  });
});

describe('shortId', () => {
  it('shortens an id to its start and end, and leaves a short one', () => {
    expect(shortId('01m8a0b1c2d3e4f5g6h7jkabcd')).toBe('01m8…abcd');
    expect(shortId('r_gone')).toBe('r_gone');
  });
});

describe('agentSummary', () => {
  it('says off, or on with CLI, model and pool', () => {
    const names = new Map([['r_studio', 'mac-studio']]);
    expect(agentSummary(config('u_kira'), names)).toBe('Aus');
    expect(agentSummary(config('u_kira', { enabled: true }), names)).toBe('An: Claude Code mit sonnet, auf allen Runnern');
    expect(agentSummary(config('u_kira', { enabled: true, cli: 'codex', model: 'gpt-5-codex', runner_ids: ['r_studio', 'r_gone'] }), names)).toBe(
      'An: Codex mit gpt-5-codex, auf mac-studio und einem Runner',
    );
  });
});

/* ------------------------------------------------------------------------- cards */

describe('the agent line of the bot cards', () => {
  it('says per bot whether it is an agent and links to its agent', async () => {
    renderAgent({ url: '/settings/bots', configs: { u_kira: config('u_kira', { enabled: true, runner_ids: ['r_studio'] }), u_otto: config('u_otto') } });

    const cards = await screen.findAllByRole('article');
    const [defaultBot, ki, ot, gone] = cards as [HTMLElement, HTMLElement, HTMLElement, HTMLElement];
    await waitFor(() => expect(ki.textContent).toContain('An: Claude Code mit sonnet, auf mac-studio'));
    expect(within(ki).getByRole('link', { name: 'Agent bearbeiten für Kira' }).getAttribute('href')).toBe('/settings/bots?agent=u_kira');
    await waitFor(() => expect(ot.textContent).toContain('AgentAus'));
    expect(within(ot).getByRole('link', { name: 'Agent einrichten für Otto' })).toBeTruthy();
    expect(defaultBot.textContent).toContain('Kann kein Agent sein');
    expect(gone.textContent).toContain('Kann kein Agent sein');
    // only the bots that can be agents are asked for
    expect(api!.calls.some((call) => call.url === '/api/v1/bots/u_automation/agent')).toBe(false);
  });

  it('says while the agent loads and when it could not be loaded, and asks for no runners without such a bot', async () => {
    const view = renderAgent({ url: '/settings/bots', bots: [kira] });
    // the agent of Kira never answers
    const fetching = globalThis.fetch;
    globalThis.fetch = (input, init) => (String(input).includes('/bots/u_kira/agent') ? new Promise(() => {}) : fetching(input, init));
    const card = (await screen.findAllByRole('article'))[0]!;
    expect(card.textContent).toContain('Wird geladen …');
    view.unmount();
    api!.restore();

    const failed = renderAgent({ url: '/settings/bots', bots: [kira], routes: { 'GET /api/v1/bots/u_kira/agent': unavailable } });
    await waitFor(() => expect(screen.getByRole('article').textContent).toContain('Nicht geladen'));
    failed.unmount();
    api!.restore();

    renderAgent({ url: '/settings/bots', bots: [automation] });
    await screen.findAllByRole('article');
    expect(api!.calls.some((call) => call.url.startsWith('/api/v1/runners'))).toBe(false);
  });
});

/* ------------------------------------------------------------------------- agent */

describe('BotAgent', () => {
  it('shows the bot as an agent with its pool and CLI, and links back to the list', async () => {
    renderAgent();

    expect(await screen.findByRole('heading', { level: 2, name: 'Kira als Agent' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Alle Bots' }).getAttribute('href')).toBe('/settings/bots');
    await waitFor(() => expect(document.title).toBe('Kira als Agent – Bots – Einstellungen – werkbuch'));

    expect(await screen.findByRole('switch', { name: 'Als Agent arbeiten' })).toBeTruthy();
    const studioBox = await screen.findByRole('checkbox', { name: 'mac-studio' });
    expect(studioBox.getAttribute('aria-checked')).toBe('false');
    expect(screen.getByText('Online, 2 Plätze, 2 für Reviews und Antworten')).toBeTruthy();
    expect(screen.getByText('Offline seit 29.10.2026, 19:00, 1 Platz, 1 für Reviews und Antworten')).toBeTruthy();
    expect(screen.getByText(/Keiner gewählt: Der Agent arbeitet auf allen Runnern/)).toBeTruthy();

    // the CLI per runner of the pool, which is every runner
    const onRunners = screen.getByRole('list', { name: 'Claude Code auf den Runnern' });
    expect(within(onRunners).getAllByRole('listitem').map((item) => item.textContent)).toEqual(['mac-studioinstalliert und angemeldet', 'build-boxnicht installiert']);
    expect(screen.getByText(/Der Runner startet es headless/)).toBeTruthy();
    expect(screen.getByRole('combobox', { name: /Standard-Modell/ }).textContent).toContain('sonnet');
  });

  it('switches the agent on with a pool and saves it as a whole, then says so', async () => {
    const user = userEvent.setup();
    renderAgent({ configs: { u_kira: config('u_kira', { models: { review: 'haiku' } }) } });

    await user.click(await screen.findByRole('switch', { name: 'Als Agent arbeiten' }));
    await user.click(await screen.findByRole('checkbox', { name: 'mac-studio' }));
    expect(screen.getByText('Der Agent arbeitet nur auf diesem Runner.')).toBeTruthy();
    await user.click(screen.getByRole('checkbox', { name: 'build-box' }));
    expect(screen.getByText('Der Agent arbeitet nur auf diesen 2 Runnern.')).toBeTruthy();
    expect(screen.getByText('Nicht gespeicherte Änderungen')).toBeTruthy();
    await user.click(save());

    await waitFor(() => expect(puts()).toHaveLength(1));
    expect(puts()[0]!.body).toEqual({ enabled: true, runner_ids: ['r_box', 'r_studio'], cli: 'claude', model: 'sonnet', models: { review: 'haiku' } });
    await waitFor(() => expect(toastNamed('Kira: Agent gespeichert')).toBeTruthy());
    expect(toastNamed('Kira: Agent gespeichert')!.description).toBeUndefined();
  });

  it('says nothing changed, and that a saved agent that is off leaves assignments plain', async () => {
    const user = userEvent.setup();
    renderAgent({ configs: { u_kira: config('u_kira', { enabled: true, runner_ids: ['r_studio'] }) } });

    await user.click(await screen.findByRole('checkbox', { name: 'mac-studio' }));
    await user.click(screen.getByRole('checkbox', { name: 'mac-studio' }));
    await user.click(save());
    expect(await screen.findByText('Keine Änderungen zu speichern.')).toBeTruthy();
    expect(puts()).toHaveLength(0);

    await user.click(screen.getByRole('switch', { name: 'Als Agent arbeiten' }));
    await user.click(screen.getByRole('button', { name: 'Zurücksetzen' }));
    expect(screen.getByRole('switch', { name: 'Als Agent arbeiten' }).getAttribute('aria-checked')).toBe('true');
    await user.click(screen.getByRole('switch', { name: 'Als Agent arbeiten' }));
    await user.click(save());
    await waitFor(() => expect(toastNamed('Kira: Agent gespeichert')?.description).toBe('Der Agent ist aus. Zuweisungen bleiben normale Zuweisungen.'));
  });

  it('marks a CLI no runner of the pool has, and keeps the models of the new CLI with a note on what went', async () => {
    const user = userEvent.setup();
    renderAgent({ configs: { u_kira: config('u_kira', { runner_ids: ['r_studio'], model: 'opus', models: { review: 'haiku', task: 'opus' } }) } });

    const codex = await screen.findByRole('button', { name: 'Codex' });
    await user.click(codex);
    expect(await screen.findByText('Codex: auf keinem Runner im Pool verfügbar (installiert und angemeldet). Speichern geht; Aufträge warten, bis ein Runner es meldet.')).toBeTruthy();
    expect(within(screen.getByRole('list', { name: 'Codex auf den Runnern' })).getByText('installiert, nicht angemeldet')).toBeTruthy();
    expect(screen.getByText('Modelle angepasst')).toBeTruthy();
    expect(screen.getByText('„opus“ und „haiku“ gibt es bei Codex nicht. Standard-Modell ist jetzt gpt-5-codex, die Modelle je Auftragstyp sind wieder „Wie Standard“.')).toBeTruthy();
    expect(screen.getByRole('combobox', { name: /Standard-Modell/ }).textContent).toContain('gpt-5-codex');

    // the same CLI again changes nothing; back to Claude says what of Codex goes, and Claude is there
    await user.click(codex);
    await user.click(screen.getByRole('button', { name: 'Claude Code' }));
    expect(screen.getByText('„gpt-5-codex“ gibt es bei Claude Code nicht. Standard-Modell ist jetzt sonnet.')).toBeTruthy();
    expect(screen.queryByText(/auf keinem Runner im Pool/)).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Codex' }));
    await user.click(save());
    await waitFor(() => expect(puts()).toHaveLength(1));
    expect(puts()[0]!.body).toEqual({ enabled: false, runner_ids: ['r_studio'], cli: 'codex', model: 'gpt-5-codex', models: {} });
    await waitFor(() => expect(screen.queryByText('Modelle angepasst')).toBeNull());
  });

  it('says only what the default model was when no model per kind of run goes, and nothing when nothing goes', async () => {
    const user = userEvent.setup();
    renderAgent({ runners: [], configs: { u_kira: config('u_kira', { model: 'opus' }) } });

    await user.click(await screen.findByRole('button', { name: 'Codex' }));
    expect(screen.getByText('„opus“ gibt es bei Codex nicht. Standard-Modell ist jetzt gpt-5-codex.')).toBeTruthy();
    // without any runner the CLI is not marked missing: the pool says there is none
    expect(screen.queryByText(/auf keinem Runner/)).toBeNull();
    expect(screen.getByText('Noch kein Runner')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Zu den Runnern' }).getAttribute('href')).toBe('/settings/runners');

    await user.click(screen.getByRole('button', { name: 'Zurücksetzen' }));
    expect(screen.queryByText('Modelle angepasst')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Codex' }));
    await user.click(screen.getByRole('button', { name: 'Claude Code' }));
    await user.click(screen.getByRole('button', { name: 'Codex' }));
    expect(screen.getByText('„sonnet“ gibt es bei Codex nicht. Standard-Modell ist jetzt gpt-5-codex.')).toBeTruthy();
  });

  it('leaves no note when nothing goes, and none once the draft is the saved agent again', async () => {
    const user = userEvent.setup();
    renderAgent({ configs: { u_kira: config('u_kira', { cli: 'codex', model: 'gpt-5-codex' }) } });
    await user.click(await screen.findByRole('button', { name: 'Claude Code' }));
    expect(screen.getByText('„gpt-5-codex“ gibt es bei Claude Code nicht. Standard-Modell ist jetzt sonnet.')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Codex' }));
    // back where it was saved: nothing to say
    expect(screen.queryByText('Modelle angepasst')).toBeNull();
  });

  it('has no note for a change of CLI without any model to lose', async () => {
    const user = userEvent.setup();
    renderAgent({ configs: { u_kira: config('u_kira', { model: '' }) } });
    await user.click(await screen.findByRole('button', { name: 'Codex' }));
    expect(screen.getByRole('combobox', { name: /Standard-Modell/ }).textContent).toContain('gpt-5-codex');
    expect(screen.queryByText('Modelle angepasst')).toBeNull();
  });

  it('marks the CLI missing on every runner when the pool is all of them, and chooses a model', async () => {
    const user = userEvent.setup();
    renderAgent({ runners: [box, fresh] });

    expect(await screen.findByText('Claude Code: auf keinem Runner verfügbar (installiert und angemeldet). Speichern geht; Aufträge warten, bis ein Runner es meldet.')).toBeTruthy();
    expect(screen.getByText('Offline, 2 Plätze, 2 für Reviews und Antworten')).toBeTruthy();

    await user.click(screen.getByRole('combobox', { name: /Standard-Modell/ }));
    expect((await screen.findAllByRole('option')).map((option) => option.textContent)).toEqual(['haiku', 'sonnet', 'opus', 'fable']);
    await user.click(screen.getByRole('option', { name: 'opus' }));
    await user.click(save());
    await waitFor(() => expect(puts()[0]?.body).toMatchObject({ model: 'opus' }));
  });

  it('shows the revoked runners of the pool apart, to take them out', async () => {
    const user = userEvent.setup();
    renderAgent({ runners: [], configs: { u_kira: config('u_kira', { runner_ids: ['01m8a0b1c2d3e4f5g6h7jkabcd', '01m8z9y8x7w6v5t4s3r2qpwxyz'] }) } });

    const first = await screen.findByRole('checkbox', { name: 'Ein widerrufener Runner (01m8…abcd)' });
    expect(first.getAttribute('aria-checked')).toBe('true');
    expect(screen.getByRole('checkbox', { name: 'Ein widerrufener Runner (01m8…wxyz)' })).toBeTruthy();
    expect(screen.getAllByText('Er arbeitet nicht mehr. Nimm ihn aus dem Pool, sonst lehnt das Speichern ab.')).toHaveLength(2);
    await user.click(first);
    expect(screen.queryByRole('checkbox', { name: 'Ein widerrufener Runner (01m8…abcd)' })).toBeNull();
    const gone = screen.getByRole('checkbox', { name: 'Ein widerrufener Runner (01m8…wxyz)' });
    await user.click(gone);
    // out of the pool: no runner is left, and the pool says to connect one
    expect(await screen.findByText('Noch kein Runner')).toBeTruthy();
    await user.click(save());
    await waitFor(() => expect(puts()[0]?.body).toMatchObject({ runner_ids: [] }));
  });

  it('shows a model saved before the list changed for what it is', async () => {
    renderAgent({ configs: { u_kira: config('u_kira', { model: 'sonnet-legacy' }) } });
    expect((await screen.findByRole('combobox', { name: /Standard-Modell/ })).textContent).toContain('sonnet-legacy (nicht in der Liste)');
  });

  it('shows a refusal of the server at its field, and anything else as a toast that tries again', async () => {
    const user = userEvent.setup();
    let refusal: () => ReturnType<MockRoute> = () =>
      problem(422, 'validation_failed', { errors: { 'runner_ids.0': ['Diesen Runner gibt es nicht mehr.'], model: ['Wähle ein Modell der CLI.'], enabled: ['Der Bot ist deaktiviert.'] } });
    renderAgent({ routes: { 'PUT /api/v1/bots/u_kira/agent': () => refusal() } });

    await user.click(await screen.findByRole('switch', { name: 'Als Agent arbeiten' }));
    await user.click(await screen.findByRole('checkbox', { name: 'mac-studio' }));
    await user.click(save());
    expect(await screen.findByText('Diesen Runner gibt es nicht mehr.')).toBeTruthy();
    expect(screen.getByText('Wähle ein Modell der CLI.')).toBeTruthy();
    expect(screen.getByText('Der Bot ist deaktiviert.')).toBeTruthy();
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('switch', { name: 'Als Agent arbeiten' })));
    expect(screen.getByRole('checkbox', { name: 'mac-studio' }).getAttribute('aria-invalid')).toBe('true');

    // editing a field takes its error away
    await user.click(screen.getByRole('checkbox', { name: 'build-box' }));
    expect(screen.queryByText('Diesen Runner gibt es nicht mehr.')).toBeNull();

    refusal = () => problem(422, 'validation_failed', { errors: { cli: ['Diese CLI gibt es nicht.'] } });
    await user.click(save());
    expect(await screen.findByText('Diese CLI gibt es nicht.')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Codex' }));
    expect(screen.queryByText('Diese CLI gibt es nicht.')).toBeNull();

    // a model per kind stands at its field
    refusal = () => problem(422, 'validation_failed', { errors: { 'models.review': ['Unbekannt.'] } });
    await user.click(save());
    expect(await screen.findByText('Unbekannt.')).toBeTruthy();
    expect(screen.getByRole('combobox', { name: /^Review/ }).getAttribute('aria-invalid')).toBe('true');

    refusal = () => problem(422, 'validation_failed', { errors: { models: ['Nur Auftragstypen.'] } });
    await user.click(save());
    await waitFor(() => expect(toastNamed('Agent nicht gespeichert')).toBeTruthy());

    act(() => resetToasts());
    refusal = unavailable;
    await user.click(save());
    await waitFor(() => expect(toastNamed('Agent nicht gespeichert')).toBeTruthy());
    refusal = () => ({ body: { data: config('u_kira', { enabled: true }) } });
    await act(async () => runToastAction(toastNamed('Agent nicht gespeichert')!.id));
    await waitFor(() => expect(toastNamed('Kira: Agent gespeichert')).toBeTruthy());
  });

  it('chooses a model per kind of run, "Wie Standard" leaving the kind out, and saves them', async () => {
    const user = userEvent.setup();
    renderAgent({ configs: { u_kira: config('u_kira', { models: { review: 'haiku' } }) } });

    const review = await screen.findByRole('combobox', { name: /^Review/ });
    expect(review.textContent).toContain('haiku');
    expect(screen.getByRole('combobox', { name: /^Umsetzen/ }).textContent).toContain('Wie Standard (sonnet)');
    expect(screen.getByText('„Wie Standard“ nimmt das Standard-Modell.')).toBeTruthy();

    await user.click(screen.getByRole('combobox', { name: /^Umsetzen/ }));
    await user.click(await screen.findByRole('option', { name: 'opus' }));
    await user.click(review);
    await user.click(await screen.findByRole('option', { name: 'Wie Standard (sonnet)' }));
    await user.click(save());

    await waitFor(() => expect(puts()).toHaveLength(1));
    expect(puts()[0]!.body).toMatchObject({ models: { task: 'opus' } });
  });

  it('keeps the models per kind in their order, so a model chosen and chosen back is no change', async () => {
    const user = userEvent.setup();
    // the server answers them sorted by name
    renderAgent({ configs: { u_kira: config('u_kira', { models: { review: 'haiku', task: 'opus' } }) } });

    const task = await screen.findByRole('combobox', { name: /^Umsetzen/ });
    await user.click(task);
    await user.click(await screen.findByRole('option', { name: 'sonnet' }));
    expect(screen.getByText('Nicht gespeicherte Änderungen')).toBeTruthy();
    await user.click(task);
    await user.click(await screen.findByRole('option', { name: 'opus' }));
    expect(screen.queryByText('Nicht gespeicherte Änderungen')).toBeNull();

    await user.click(screen.getByRole('combobox', { name: /^Antwort/ }));
    await user.click(await screen.findByRole('option', { name: 'haiku' }));
    await user.click(save());
    await waitFor(() => expect(puts()).toHaveLength(1));
    expect(Object.keys((puts()[0]!.body as AgentConfig).models)).toEqual(['task', 'review', 'comment']);
  });

  it('says that an org admin bot reviews in every project, and its role as a member does not hold it back', async () => {
    const complete = { ...agency, agent_states: { working: 'app_progress', review: 'app_review', correction: 'app_todo', merged: 'app_done' } };
    const boss = bot('u_kira', 'Kira', { org_role: 'admin' });
    renderAgent({
      bots: [boss, otto, automation, orphan],
      routes: {
        'GET /api/v1/projects': (_body, requested) => ({ body: list(requested.searchParams.get('include') === 'members' ? [project('OPS', 'admin', { id: 'p_ops', name: 'Ops', workflow_id: complete.id, members: [{ project_id: 'p_ops', user_id: 'u_kira', role: 'viewer' }] })] : []) }),
        'GET /api/v1/workflows': () => ({ body: list([complete]) }),
      },
    });

    expect(await screen.findByText('Kira ist Org-Admin und darf die PRs in jedem Projekt reviewen; Items übernimmt Kira nur, wo Kira Mitglied ist.')).toBeTruthy();
    expect(within(screen.getByRole('list', { name: 'Projekte von Kira' })).getByRole('listitem').textContent).toContain('Arbeitet hier');
  });

  it('says it for an org admin bot in no project too', async () => {
    renderAgent({ bots: [bot('u_kira', 'Kira', { org_role: 'admin' }), otto, automation, orphan], routes: { 'GET /api/v1/workflows': () => ({ body: list([standard]) }) } });
    expect(await screen.findByText(/Kira ist in keinem Projekt Mitglied/)).toBeTruthy();
    expect(screen.getByText(/Kira ist Org-Admin/)).toBeTruthy();
  });

  it('lists the projects of the agent with whether it works there and why not', async () => {
    const complete = { ...agency, agent_states: { working: 'app_progress', review: 'app_review', correction: 'app_todo', merged: 'app_done' } };
    const member = (role: 'member' | 'viewer') => [{ project_id: 'x', user_id: 'u_kira', role }];
    const projects = [
      project('WEB', 'admin', { id: 'p_web', name: 'Website', workflow_id: standard.id, members: member('member') }),
      project('APP', 'admin', { id: 'p_app', name: 'App', workflow_id: complete.id, members: member('member') }),
      project('OPS', 'admin', { id: 'p_ops', name: 'Ops', workflow_id: complete.id, members: member('viewer') }),
      project('OLD', 'admin', { id: 'p_old', name: 'Alt', workflow_id: complete.id, archived_at: '2026-10-01T00:00:00.000Z', members: member('member') }),
      project('ZZZ', 'admin', { id: 'p_zzz', name: 'Ohne', workflow_id: complete.id, members: [] }),
    ];
    renderAgent({
      routes: {
        'GET /api/v1/projects': (_body, requested) => ({ body: list(requested.searchParams.get('include') === 'members' ? projects : []) }),
        'GET /api/v1/workflows': () => ({ body: list([standard, complete]) }),
      },
    });

    const listed = await screen.findByRole('list', { name: 'Projekte von Kira' });
    expect(within(listed).getAllByRole('listitem').map((entry) => entry.textContent)).toEqual([
      'OLD Alt: arbeitet hier nichtDas Projekt ist archiviert.',
      'APP App: arbeitet hierArbeitet hier: Zuweisen startet einen Auftrag.',
      'OPS Ops: arbeitet hier nichtLiest hier nur: gib ihm im Projekt die Rolle Member oder Admin.',
      'WEB Website: arbeitet hier nichtDer Workflow des Projekts hat noch nicht alle Agenten-Schritte.',
    ]);
    expect(within(listed).getByRole('link', { name: /APP App/ }).getAttribute('href')).toBe('/projects/APP/settings/agents');
  });

  it('says when the agent is in no project', async () => {
    renderAgent({ routes: { 'GET /api/v1/workflows': () => ({ body: list([standard]) }) } });
    expect(await screen.findByText('Kira ist in keinem Projekt Mitglied. Füge den Bot in den Projekteinstellungen unter „Mitglieder“ hinzu.')).toBeTruthy();
  });

  it('says why a bot cannot be an agent instead of the form', async () => {
    const view = renderAgent({ url: '/settings/bots?agent=u_automation' });
    expect(await screen.findByText('Automation kann kein Agent sein')).toBeTruthy();
    expect(screen.getByText(/Der Standard-Bot handelt für Automatisierungen und Vorlagen/)).toBeTruthy();
    expect(screen.queryByRole('switch')).toBeNull();
    view.unmount();
    api!.restore();
    renderAgent({ url: '/settings/bots?agent=u_orphan' });
    expect(await screen.findByText('Waise kann kein Agent sein')).toBeTruthy();
    const reasons = screen.getAllByRole('listitem').map((item) => item.textContent);
    expect(reasons).toContain('Der Bot hat keine verantwortliche Person. Sie bekommt das Ticket zurück, wenn die Bremse greift.');
    expect(reasons).toContain('Der Bot ist deaktiviert.');
  });

  it('says when the bot does not exist, or the bots, the agent or the runners could not be loaded', async () => {
    const views = [renderAgent({ url: '/settings/bots?agent=u_nobody' })];
    expect(await screen.findByText('Diesen Bot gibt es nicht')).toBeTruthy();
    expect(screen.getByRole('heading', { level: 2, name: 'Agent' })).toBeTruthy();
    const next = (options: Parameters<typeof renderAgent>[0]) => {
      views.pop()!.unmount();
      api!.restore();
      views.push(renderAgent(options));
    };

    next({ routes: { 'GET /api/v1/users': unavailable } });
    expect(await screen.findByText('Der Agent konnte nicht geladen werden')).toBeTruthy();

    next({ routes: { 'GET /api/v1/bots/u_kira/agent': unavailable } });
    expect(await screen.findByText('Der Agent konnte nicht geladen werden')).toBeTruthy();

    views.pop()!.unmount();
    api!.restore();
    renderAgent({ routes: { 'GET /api/v1/runners': unavailable } });
    expect(await screen.findByText('Die Runner konnten nicht geladen werden')).toBeTruthy();
  });
});
