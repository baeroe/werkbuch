/*
 * Settings → Runners (WEBU-27, spec 6.2, 8.4, 8.6, 10.1) against a fake REST API (`mockApi`): the cards with places,
 * load, CLIs, equipment and the runs on them, a runner that has not reported yet, the empty list, "Runner verbinden"
 * with its code (copy, a new code, an expired one, a runner that redeems it), the places, renaming, revoking and
 * canceling a run. The flow with a real server (a code redeemed over the protocol) runs in e2e/tests/runners.spec.ts.
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode, Ref } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { currentToasts, resetToasts, runToastAction } from '@/components/ui/toast';
import { mockApi, type MockApi, type MockRoute } from '@/test/api';
import { list, makeWorkItem, mara, organization, project } from '@/test/fixtures';
import type { AgentRun, Runner, RunnerPairing } from '@/types';
import { OrgSettings } from '../OrgSettings';

vi.mock('@inertiajs/react', () => ({
  usePage: () => ({ props: { auth: { user: mara, permissions: [] }, organization } }),
  Link: ({ href, children, ref, ...rest }: { href: string; children: ReactNode; ref?: Ref<HTMLAnchorElement> }) => (
    <a href={href} ref={ref} {...rest}>
      {children}
    </a>
  ),
  router: { reload: vi.fn(), visit: vi.fn(), on: () => () => {} },
}));

const problem = (status: number, reason: string, detail: string, errors?: Record<string, string[]>) => ({ status, body: { type: 'about:blank', title: reason, status, reason, detail, ...(errors && { errors }) } });

const recent = () => new Date(Date.now() - 20_000).toISOString();

function makeRunner(id: string, changes: Partial<Runner> = {}): Runner {
  return {
    id,
    name: `mac-${id}`,
    os: 'darwin',
    arch: 'arm64',
    version: '0.4.0',
    protocol: 1,
    online: true,
    last_seen_at: recent(),
    slots: { total: 2, per_repo: 1, light: 2 },
    slots_used: { total: 1, per_repo: 1, light: 0 },
    load: { cpu: 42, gpu: 95, ram_used: 12.5, ram_total: 16, disk_free: 200, disk_total: 500, measured_at: recent() },
    clis: [
      { cli: 'claude', installed: true, version: '2.1.0', logged_in: true, path: '/usr/local/bin/claude' },
      { cli: 'codex', installed: true, version: null, logged_in: false, path: '/usr/local/bin/codex' },
    ],
    equipment: { mcp_servers: ['context7'], skills: ['tdd', 'review'], plugins: ['superpowers'], werkbuch_access: [] },
    created_by: 'u_mara',
    created_at: '2026-10-20T08:00:00Z',
    updated_at: '2026-10-20T08:00:00Z',
    ...changes,
  };
}

function makeRun(id: string, changes: Partial<AgentRun> = {}): AgentRun {
  return {
    id,
    type: 'task',
    status: 'running',
    waiting_reason: null,
    bot_id: 'u_kira',
    cli: 'claude',
    model: 'sonnet',
    runner_id: 'r1',
    runner_name: 'mac-r1',
    runner_online: true,
    project_id: 'p_web',
    work_item_id: 'wi_47',
    started_at: '2026-10-28T08:41:00Z',
    finished_at: null,
    created_at: '2026-10-28T08:40:00Z',
    ...changes,
  };
}

const web47 = makeWorkItem({ id: 'wi_47', key: 'WEB-47', title: 'Kontaktformular prüfen' });

let api: MockApi | undefined;

type World = { runners: Runner[]; runs: AgentRun[]; routes?: Record<string, MockRoute> };

function renderRunners(world: World) {
  api = mockApi({
    'GET /api/v1/projects': () => ({ body: list([project('WEB', 'admin')]) }),
    'GET /api/v1/organization': () => ({ body: { data: organization } }),
    'GET /api/v1/runners': () => ({ body: list(world.runners) }),
    'GET /api/v1/runs': () => ({ body: list(world.runs) }),
    'GET /api/v1/references': (_body, url) => ({ body: { data: { items: [web47].filter((item) => (url.searchParams.get('items') ?? '').split(',').includes(item.id)), pages: [] } } }),
    ...world.routes,
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <OrgSettings section="runners" />
    </QueryClientProvider>,
  );
}

const calls = (method: string, path: string) => api!.calls.filter((call) => call.method === method && call.url === path);
const toastNamed = (title: string) => currentToasts().find((entry) => entry.title === title);
const cardOf = async (name: string) => (await screen.findByRole('heading', { level: 3, name })).closest('article')!;
/** The definition of a term of a card. */
const fact = (card: HTMLElement, term: string) => within(card).getByText(term, { selector: 'dt' }).nextElementSibling as HTMLElement;

afterEach(() => {
  api?.restore();
  api = undefined;
  resetToasts();
  vi.useRealTimers();
});

describe('Runners', () => {
  it('sits in the group "Betrieb" and shows a runner with places, load, CLIs, equipment and its runs', async () => {
    const skills = ['tdd', 'review', 'debug', 'plan', 'docs'];
    renderRunners({
      runners: [makeRunner('r1', { equipment: { mcp_servers: ['context7'], skills, plugins: ['superpowers'], werkbuch_access: ['werkbuch-prod'] } })],
      runs: [makeRun('run1'), makeRun('run2', { status: 'canceling', type: 'review', work_item_id: null, started_at: null }), makeRun('run3', { runner_id: 'r_other' })],
    });

    const nav = screen.getByRole('navigation', { name: 'Bereiche der Einstellungen' });
    expect(within(nav).getByRole('link', { name: 'Runner' }).getAttribute('href')).toBe('/settings/runners');
    expect(await screen.findByRole('heading', { level: 2, name: 'Runner' })).toBeTruthy();

    const card = await cardOf('mac-r1');
    expect(within(card).getByText('Online')).toBeTruthy();
    expect(within(card).getByText(/^Zuletzt gemeldet /)).toBeTruthy();
    expect(fact(card, 'System').textContent).toBe('macOS, Apple Silicon (arm64)');
    expect(fact(card, 'Version').textContent).toBe('0.4.0');
    expect(fact(card, 'Plätze').textContent).toBe('Gesamt 1 von 2Je Repo 1 von 1Reviews und Antworten 0 von 2');
    const load = fact(card, 'Auslastung');
    expect(load.textContent).toMatch(/42\s%/);
    expect(load.textContent).toContain('12,5 von 16 GB belegt');
    expect(load.textContent).toContain('200 von 500 GB frei');
    // an online runner's load is now: no "as of"
    expect(within(load).queryByText(/^Letzter Stand/)).toBeNull();
    expect(fact(card, 'CLIs').textContent).toBe('Claude Code2.1.0angemeldetCodexnicht angemeldet');
    const equipment = fact(card, 'Ausstattung');
    expect(equipment.textContent).toContain('MCP: context7');
    expect(within(equipment).getByText('Skills: 5').tagName).toBe('SUMMARY');
    expect(equipment.textContent).toContain('Plugins: superpowers');
    expect(within(equipment).getByText('werkbuch-prod').getAttribute('translate')).toBe('no');
    expect(equipment.textContent).toContain('erreicht werkbuch mit einem persönlichen Token');

    const runs = within(card).getByRole('list', { name: 'Aufträge auf mac-r1' });
    expect(within(runs).getAllByRole('listitem')).toHaveLength(2);
    const link = await within(runs).findByRole('link', { name: 'WEB-47 Kontaktformular prüfen' });
    expect(link.getAttribute('href')).toBe('/items/WEB-47');
    expect(within(runs).getByText('Umsetzen, Läuft seit 09:41')).toBeTruthy();
    expect(within(runs).getByText('Ohne Item')).toBeTruthy();
    expect(within(runs).getByText('Review, Wird abgebrochen')).toBeTruthy();
    expect(within(runs).getByRole('button', { name: 'Abbrechen: Umsetzen an WEB-47' }).getAttribute('aria-disabled')).toBeNull();
    expect(within(runs).getByRole('button', { name: 'Abbrechen: Review an Ohne Item' }).getAttribute('aria-disabled')).toBe('true');
    // the list asks for the active runs
    expect(api!.calls.some((call) => call.url.startsWith('/api/v1/runs?') && call.url.includes('filter%5Bstatus%5D=queued%2Cwaiting%2Crunning%2Ccanceling'))).toBe(true);
  });

  it('shows an offline runner with its waiting runs, and one that has not reported yet', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-28T10:00:00Z'));
    renderRunners({
      runners: [
        makeRunner('r1', { online: false, last_seen_at: '2026-10-28T07:12:00Z', clis: [{ cli: 'codex', installed: false, version: null, logged_in: false, path: null }], load: { cpu: 3, gpu: null, ram_used: 2, ram_total: 0, disk_free: 10, disk_total: 100, measured_at: '2026-10-28T07:12:00Z' } }),
        makeRunner('r2', { online: false, os: 'linux', arch: 'amd64', last_seen_at: null, load: null, clis: [], equipment: null }),
        makeRunner('r3', { equipment: { mcp_servers: [], skills: [], plugins: [], werkbuch_access: [] } }),
        makeRunner('r4', { online: false, last_seen_at: '2026-10-26T16:30:00Z' }),
      ],
      runs: [makeRun('run1', { work_item_id: 'wi_gone', status: 'waiting', started_at: null })],
    });

    const offline = await cardOf('mac-r1');
    // today: the time alone, in the zone of the organisation
    expect(within(offline).getByText('Offline seit 08:12')).toBeTruthy();
    expect(within(offline).getByText('Letzter Kontakt am 28.10.2026, 08:12')).toBeTruthy();
    expect(fact(offline, 'CLIs').textContent).toBe('Codexnicht installiert');
    expect(fact(offline, 'Auslastung').textContent).toContain('nicht verfügbar');
    expect(fact(offline, 'Auslastung').textContent).toContain('Letzter Stand vom 28.10.2026, 08:12');
    // an item the reader does not see
    expect(await within(offline).findByText('Verborgenes Item')).toBeTruthy();
    expect(within(offline).getByText('Umsetzen, Wartet auf Runner')).toBeTruthy();
    expect(screen.getByText('1 Auftrag wartet auf „mac-r1“')).toBeTruthy();

    const silent = await cardOf('mac-r2');
    expect(within(silent).getByText('Offline')).toBeTruthy();
    expect(within(silent).getByText('Noch kein Kontakt')).toBeTruthy();
    expect(fact(silent, 'System').textContent).toBe('Linux, x86-64 (amd64)');
    expect(fact(silent, 'Auslastung').textContent).toBe('Noch kein Bericht');
    expect(fact(silent, 'CLIs').textContent).toBe('Noch keine gemeldet');
    expect(fact(silent, 'Ausstattung').textContent).toBe('Noch kein Bericht');
    expect(fact(silent, 'Aufträge').textContent).toBe('Keine');

    // before today: with the day
    expect(within(await cardOf('mac-r4')).getByText('Offline seit 26.10.2026, 17:30')).toBeTruthy();

    const bare = await cardOf('mac-r3');
    expect(fact(bare, 'Ausstattung').textContent).toContain('Nichts eingerichtet: nur werkbuch');
    expect(fact(bare, 'Aufträge').textContent).toBe('Frei');
  });

  it('has an empty state that connects a runner, and says when the runners could not load', async () => {
    renderRunners({ runners: [], runs: [] });
    expect(await screen.findByText('Noch kein Runner')).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'Runner verbinden' })).toHaveLength(2);

    api!.restore();
    renderRunners({ runners: [], runs: [], routes: { 'GET /api/v1/runners': () => problem(500, 'server_error', 'Kaputt') } });
    expect(await screen.findByText('Die Runner konnten nicht geladen werden')).toBeTruthy();
  });
});

describe('Runner verbinden', () => {
  const pairingOf = (changes: Partial<RunnerPairing> = {}): RunnerPairing => ({
    id: 'pc1',
    code: 'ABCD-1234',
    command: 'curl -fsSL https://werkbuch.example.com/runner/install.sh | sh -s -- --code ABCD-1234',
    expires_at: new Date(Date.now() + 600_000).toISOString(),
    redeemed_at: null,
    runner_id: null,
    ...changes,
  });

  it('shows a code with its command, copies it, makes a new one and names the runner that redeemed it', async () => {
    const user = userEvent.setup();
    const writeText = vi.spyOn(navigator.clipboard, 'writeText');
    const world: World = { runners: [makeRunner('r1')], runs: [] };
    let made = 0;
    let redeemed = false;
    world.routes = {
      'POST /api/v1/runner-pairings': () => {
        made += 1;
        return { status: 201, body: { data: pairingOf({ id: `pc${made}`, code: `CODE-${made}`, command: `install --code CODE-${made}` }) } };
      },
      'GET /api/v1/runner-pairings/pc2': () => ({ body: { data: { ...pairingOf({ id: 'pc2', runner_id: redeemed ? 'r_new' : null }), code: undefined, command: undefined } } }),
      'GET /api/v1/runner-pairings/pc1': () => ({ body: { data: { ...pairingOf(), code: undefined, command: undefined } } }),
    };
    renderRunners(world);
    await cardOf('mac-r1');

    await user.click(screen.getAllByRole('button', { name: 'Runner verbinden' })[0]);
    const dialog = await screen.findByRole('dialog', { name: 'Runner verbinden' });
    expect(await within(dialog).findByText('install --code CODE-1')).toBeTruthy();
    expect(within(dialog).getByRole('group', { name: 'Befehl für das Terminal' })).toBeTruthy();
    expect(within(dialog).getByText('CODE-1').getAttribute('translate')).toBe('no');
    expect(within(dialog).getByText(/^\(noch \d+:\d\d Min\.\)$/)).toBeTruthy();
    expect(within(dialog).getByText('Wartet auf den Runner …')).toBeTruthy();
    expect(within(dialog).getByText('Am besten unter einem eigenen Benutzer')).toBeTruthy();

    await user.click(within(dialog).getByRole('button', { name: 'Befehl kopieren' }));
    expect(writeText).toHaveBeenCalledWith('install --code CODE-1');
    expect(within(dialog).getByText('In die Zwischenablage kopiert.')).toBeTruthy();

    await user.click(within(dialog).getByRole('button', { name: 'Neuer Code' }));
    expect(await within(dialog).findByText('install --code CODE-2')).toBeTruthy();
    expect(calls('POST', '/api/v1/runner-pairings')).toHaveLength(2);

    // the machine redeems the code: the next ask says so, the list loads the new runner
    world.runners = [...world.runners, makeRunner('r_new', { name: 'studio', os: 'linux', arch: 'arm64', version: '0.4.1' })];
    redeemed = true;
    const connected = await screen.findByRole('dialog', { name: '„studio“ ist verbunden' }, { timeout: 4000 });
    expect(fact(connected, 'System').textContent).toBe('Linux, Apple Silicon (arm64)');
    expect(fact(connected, 'Plätze').textContent).toBe('2 gesamt, 1 je Repo, 2 für Reviews und Antworten. Ändern kannst du sie an seiner Karte unter „Plätze“.');
    expect(fact(connected, 'Projekte').textContent).toBe('Alle.');
    const done = within(connected).getByRole('button', { name: 'Fertig' });
    await waitFor(() => expect(document.activeElement).toBe(done));
    const bots = within(connected).getByRole('link', { name: 'Zu den Bots' });
    expect(bots.getAttribute('href')).toBe('/settings/bots');
    await user.click(bots);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('says when copying failed and selects the command', async () => {
    const user = userEvent.setup();
    vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValue(new Error('denied'));
    renderRunners({ runners: [makeRunner('r1')], runs: [], routes: { 'POST /api/v1/runner-pairings': () => ({ status: 201, body: { data: pairingOf() } }), 'GET /api/v1/runner-pairings/pc1': () => ({ body: { data: pairingOf() } }) } });
    await cardOf('mac-r1');
    await user.click(screen.getAllByRole('button', { name: 'Runner verbinden' })[0]);
    const dialog = await screen.findByRole('dialog', { name: 'Runner verbinden' });
    await user.click(await within(dialog).findByRole('button', { name: 'Befehl kopieren' }));
    expect(await within(dialog).findByText(/Das Kopieren hat nicht geklappt/)).toBeTruthy();
    expect(window.getSelection()?.toString()).toBe(pairingOf().command);
  });

  it('stops asking for the code once the dialog is closed (A580)', async () => {
    const user = userEvent.setup();
    renderRunners({ runners: [makeRunner('r1')], runs: [], routes: { 'POST /api/v1/runner-pairings': () => ({ status: 201, body: { data: pairingOf() } }), 'GET /api/v1/runner-pairings/pc1': () => ({ body: { data: pairingOf() } }) } });
    await cardOf('mac-r1');
    await user.click(screen.getAllByRole('button', { name: 'Runner verbinden' })[0]);
    const dialog = await screen.findByRole('dialog', { name: 'Runner verbinden' });
    await waitFor(() => expect(calls('GET', '/api/v1/runner-pairings/pc1')).toHaveLength(1));
    await user.click(within(dialog).getAllByRole('button', { name: 'Schließen' })[0]);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    // longer than the 2 s between two asks
    await new Promise((resolve) => setTimeout(resolve, 2300));
    expect(calls('GET', '/api/v1/runner-pairings/pc1')).toHaveLength(1);
  });

  it('counts the code down and offers a new one once it expired', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-28T08:00:00Z'));
    const user = userEvent.setup();
    let made = 0;
    renderRunners({
      runners: [makeRunner('r1')],
      runs: [],
      routes: {
        'POST /api/v1/runner-pairings': () => {
          made += 1;
          return { status: 201, body: { data: pairingOf({ id: `pc${made}`, code: `CODE-${made}`, expires_at: made === 1 ? '2026-10-28T08:01:05Z' : '2026-10-28T08:20:00Z' }) } };
        },
        'GET /api/v1/runner-pairings/pc1': () => ({ body: { data: pairingOf({ id: 'pc1' }) } }),
        'GET /api/v1/runner-pairings/pc2': () => ({ body: { data: pairingOf({ id: 'pc2' }) } }),
      },
    });
    await cardOf('mac-r1');
    await user.click(screen.getAllByRole('button', { name: 'Runner verbinden' })[0]);
    const dialog = await screen.findByRole('dialog', { name: 'Runner verbinden' });
    expect(await within(dialog).findByText('(noch 1:05 Min.)')).toBeTruthy();
    expect(within(dialog).getByText(/gültig bis 09:01/)).toBeTruthy();

    // the clock ticks every second
    vi.setSystemTime(new Date('2026-10-28T08:00:30Z'));
    expect(await within(dialog).findByText('(noch 0:35 Min.)', {}, { timeout: 2500 })).toBeTruthy();

    // the focus is on "Neuer Code", which goes with the expired code: "Neuen Code erzeugen" takes it
    within(dialog).getByRole('button', { name: 'Neuer Code' }).focus();
    vi.setSystemTime(new Date('2026-10-28T08:02:00Z'));
    const expired = await within(dialog).findByRole('alert', {}, { timeout: 2500 });
    await waitFor(() => expect(document.activeElement).toBe(within(expired).getByRole('button', { name: 'Neuen Code erzeugen' })));
    expect(within(expired).getByText('Der Code ist abgelaufen')).toBeTruthy();
    expect(within(dialog).queryByText('Wartet auf den Runner …')).toBeNull();
    await user.click(within(expired).getByRole('button', { name: 'Neuen Code erzeugen' }));
    expect(await within(dialog).findByText('CODE-2')).toBeTruthy();
    expect(within(dialog).queryByRole('alert')).toBeNull();
  });

  it('says when no code was made, tries again, and tells a failed new code in a toast', async () => {
    const user = userEvent.setup();
    let made = 0;
    renderRunners({
      runners: [makeRunner('r1')],
      runs: [],
      routes: {
        'POST /api/v1/runner-pairings': () => {
          made += 1;
          return made === 2 ? { status: 201, body: { data: pairingOf() } } : problem(503, 'server_error', 'Gerade nicht');
        },
        'GET /api/v1/runner-pairings/pc1': () => ({ body: { data: pairingOf() } }),
      },
    });
    await cardOf('mac-r1');
    await user.click(screen.getAllByRole('button', { name: 'Runner verbinden' })[0]);
    const dialog = await screen.findByRole('dialog', { name: 'Runner verbinden' });
    const failed = await within(dialog).findByRole('alert');
    expect(within(failed).getByText('Kein Code erzeugt')).toBeTruthy();
    expect(within(failed).getByText('Gerade nicht')).toBeTruthy();
    // no toast besides the banner
    expect(toastNamed('Kein Code erzeugt')).toBeUndefined();

    await user.click(within(failed).getByRole('button', { name: 'Erneut versuchen' }));
    expect(await within(dialog).findByText('ABCD-1234')).toBeTruthy();

    await user.click(within(dialog).getByRole('button', { name: 'Neuer Code' }));
    await waitFor(() => expect(toastNamed('Kein Code erzeugt')).toBeTruthy());
    // the old code stays
    expect(within(dialog).getByText('ABCD-1234')).toBeTruthy();
  });

  it('says the runner reported while the list does not have it yet', async () => {
    const user = userEvent.setup();
    renderRunners({
      runners: [makeRunner('r1')],
      runs: [],
      routes: {
        'POST /api/v1/runner-pairings': () => ({ status: 201, body: { data: pairingOf() } }),
        'GET /api/v1/runner-pairings/pc1': () => ({ body: { data: pairingOf({ runner_id: 'r_unknown' }) } }),
      },
    });
    await cardOf('mac-r1');
    await user.click(screen.getAllByRole('button', { name: 'Runner verbinden' })[0]);
    const dialog = await screen.findByRole('dialog', { name: 'Runner verbinden' });
    expect(await within(dialog).findByText('Der Runner hat sich gemeldet …')).toBeTruthy();
    // the list is asked again for it
    await waitFor(() => expect(calls('GET', '/api/v1/runners').length).toBeGreaterThan(1));
  });
});

describe('Places, name and revoking', () => {
  it('sets the places; a refusal stands at its field, a failure is a toast that sends again', async () => {
    const user = userEvent.setup();
    let answer: 'refuse' | 'fail' | 'ok' = 'refuse';
    renderRunners({
      runners: [makeRunner('r1')],
      runs: [],
      routes: {
        'PATCH /api/v1/runners/r1': (body) => {
          if (answer === 'refuse') return problem(422, 'validation_failed', 'Nicht gespeichert', { 'slots.per_repo': ['Je Repo höchstens so viele wie gesamt.'], slots: ['Die Plätze sind ganze Zahlen.'] });
          if (answer === 'fail') return problem(500, 'server_error', 'Kaputt');
          const { slots } = body as { slots: Runner['slots'] };
          return { body: { data: makeRunner('r1', { slots }) } };
        },
      },
    });
    const card = await cardOf('mac-r1');
    await user.click(within(card).getByRole('button', { name: 'Plätze von „mac-r1“' }));
    const dialog = await screen.findByRole('dialog', { name: 'Plätze von „mac-r1“' });
    const total = within(dialog).getByRole('textbox', { name: 'Gesamt' });
    const perRepo = within(dialog).getByRole('textbox', { name: 'Je Repo' });
    const light = within(dialog).getByRole('textbox', { name: 'Reviews und Antworten' });
    expect([(total as HTMLInputElement).value, (perRepo as HTMLInputElement).value, (light as HTMLInputElement).value]).toEqual(['2', '1', '2']);

    await user.clear(perRepo);
    await user.type(perRepo, '3');
    await user.clear(light);
    await user.type(light, 'viele');
    await user.click(within(dialog).getByRole('button', { name: 'Speichern' }));
    expect(calls('PATCH', '/api/v1/runners/r1')[0].body).toEqual({ slots: { total: 2, per_repo: 3, light: null } });
    expect(await within(dialog).findByText('Je Repo höchstens so viele wie gesamt.')).toBeTruthy();
    expect(perRepo.getAttribute('aria-invalid')).toBe('true');
    // the field the server refused takes the focus
    await waitFor(() => expect(document.activeElement).toBe(perRepo));
    expect(within(dialog).getByText('Die Plätze sind ganze Zahlen.')).toBeTruthy();
    // typing there again takes its refusal away
    await user.type(perRepo, '{Backspace}');
    expect(within(dialog).queryByText('Je Repo höchstens so viele wie gesamt.')).toBeNull();
    expect(perRepo.getAttribute('aria-invalid')).toBeNull();

    answer = 'fail';
    await user.clear(perRepo);
    await user.type(perRepo, '1');
    await user.clear(light);
    await user.type(light, '4');
    await user.click(within(dialog).getByRole('button', { name: 'Speichern' }));
    await waitFor(() => expect(toastNamed('Plätze von „mac-r1“ nicht gespeichert')).toBeTruthy());

    answer = 'ok';
    act(() => runToastAction(toastNamed('Plätze von „mac-r1“ nicht gespeichert')!.id));
    await waitFor(() => expect(toastNamed('Plätze von „mac-r1“ gespeichert')).toBeTruthy());
    expect(toastNamed('Plätze von „mac-r1“ gespeichert')!.description).toBe('2 gesamt, 1 je Repo, 4 für Reviews und Antworten.');
    expect(calls('PATCH', '/api/v1/runners/r1').at(-1)!.body).toEqual({ slots: { total: 2, per_repo: 1, light: 4 } });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('renames a runner; an empty name and a name taken stay in the dialog', async () => {
    const user = userEvent.setup();
    let answer: 'taken' | 'fail' | 'ok' = 'taken';
    renderRunners({
      runners: [makeRunner('r1')],
      runs: [],
      routes: {
        'PATCH /api/v1/runners/r1': (body) => {
          if (answer === 'taken') return problem(422, 'validation_failed', 'Nicht gespeichert', { name: ['Ein anderer Runner heißt schon so.'] });
          if (answer === 'fail') return problem(502, 'server_error', 'Kaputt');
          return { body: { data: makeRunner('r1', { name: (body as { name: string }).name }) } };
        },
      },
    });
    const card = await cardOf('mac-r1');
    await user.click(within(card).getByRole('button', { name: 'Umbenennen: „mac-r1“' }));
    const dialog = await screen.findByRole('dialog', { name: '„mac-r1“ umbenennen' });
    const name = within(dialog).getByRole('textbox', { name: 'Name' });
    await user.clear(name);
    await user.click(within(dialog).getByRole('button', { name: 'Umbenennen' }));
    expect(within(dialog).getByText('Gib dem Runner einen Namen.')).toBeTruthy();
    expect(calls('PATCH', '/api/v1/runners/r1')).toHaveLength(0);

    await user.type(name, 'studio');
    expect(within(dialog).queryByText('Gib dem Runner einen Namen.')).toBeNull();
    await user.click(within(dialog).getByRole('button', { name: 'Umbenennen' }));
    expect(await within(dialog).findByText('Ein anderer Runner heißt schon so.')).toBeTruthy();
    await waitFor(() => expect(document.activeElement).toBe(name));
    await user.type(name, '-2');
    expect(within(dialog).queryByText('Ein anderer Runner heißt schon so.')).toBeNull();

    answer = 'fail';
    await user.click(within(dialog).getByRole('button', { name: 'Umbenennen' }));
    await waitFor(() => expect(toastNamed('„mac-r1“ nicht umbenannt')).toBeTruthy());
    answer = 'ok';
    act(() => runToastAction(toastNamed('„mac-r1“ nicht umbenannt')!.id));
    await waitFor(() => expect(toastNamed('Runner heißt jetzt „studio-2“')).toBeTruthy());
    expect(calls('PATCH', '/api/v1/runners/r1').at(-1)!.body).toEqual({ name: 'studio-2' });
  });

  it('revokes a runner after asking, says how many runs it ended, and moves the focus on', async () => {
    const user = userEvent.setup();
    const world: World = { runners: [makeRunner('r1'), makeRunner('r2')], runs: [makeRun('run1'), makeRun('run2', { status: 'running' })] };
    let fail = true;
    world.routes = {
      'DELETE /api/v1/runners/r1': () => {
        if (fail) return problem(500, 'server_error', 'Kaputt');
        world.runners = world.runners.filter((runner) => runner.id !== 'r1');
        world.runs = [];
        return { body: { canceled: 2 } };
      },
      'DELETE /api/v1/runners/r2': () => {
        world.runners = [];
        return { body: { canceled: 0 } };
      },
    };
    renderRunners(world);
    const card = await cardOf('mac-r1');
    const trigger = within(card).getByRole('button', { name: 'Widerrufen: „mac-r1“' });
    // asked and kept: the focus comes back to the trigger
    await user.click(trigger);
    await user.click(within(await screen.findByRole('alertdialog', { name: '„mac-r1“ widerrufen?' })).getByRole('button', { name: 'Abbrechen' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(trigger));
    expect(calls('DELETE', '/api/v1/runners/r1')).toHaveLength(0);

    await user.click(trigger);
    let question = await screen.findByRole('alertdialog', { name: '„mac-r1“ widerrufen?' });
    expect(within(question).getByText(/2 laufende Aufträge werden abgebrochen/)).toBeTruthy();
    await user.click(within(question).getByRole('button', { name: 'Widerrufen' }));
    await waitFor(() => expect(toastNamed('„mac-r1“ nicht widerrufen')).toBeTruthy());

    fail = false;
    act(() => runToastAction(toastNamed('„mac-r1“ nicht widerrufen')!.id));
    await waitFor(() => expect(toastNamed('„mac-r1“ widerrufen')).toBeTruthy());
    expect(toastNamed('„mac-r1“ widerrufen')!.description).toBe('2 Aufträge abgebrochen. Wartende Aufträge gehen an die anderen Runner des Pools.');
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Plätze von „mac-r2“' })));

    // the last one: the focus goes to "Runner verbinden" in the header
    await user.click(within(await cardOf('mac-r2')).getByRole('button', { name: 'Widerrufen: „mac-r2“' }));
    question = await screen.findByRole('alertdialog', { name: '„mac-r2“ widerrufen?' });
    expect(within(question).getByText('Sein Token gilt danach nicht mehr. Um ihn wieder zu nutzen, verbindest du ihn mit einem neuen Code.')).toBeTruthy();
    await user.click(within(question).getByRole('button', { name: 'Widerrufen' }));
    await waitFor(() => expect(toastNamed('„mac-r2“ widerrufen')!.description).toBe('Sein Token gilt nicht mehr.'));
    expect(await screen.findByText('Noch kein Runner')).toBeTruthy();
    await waitFor(() => expect(document.activeElement).toBe(screen.getAllByRole('button', { name: 'Runner verbinden' })[0]));
  });

  it('cancels a run after asking and moves the focus to the card', async () => {
    const user = userEvent.setup();
    const world: World = { runners: [makeRunner('r1')], runs: [makeRun('run1'), makeRun('run2', { status: 'waiting', work_item_id: null, started_at: null })] };
    let fail = true;
    world.routes = {
      'POST /api/v1/runs/run1/cancel': () => {
        if (fail) return problem(500, 'server_error', 'Kaputt');
        world.runs = world.runs.filter((run) => run.id !== 'run1');
        return { body: { data: makeRun('run1', { status: 'canceling' }) } };
      },
      'POST /api/v1/runs/run2/cancel': () => {
        world.runs = [];
        return { body: { data: makeRun('run2', { status: 'canceled' }) } };
      },
    };
    renderRunners(world);
    const card = await cardOf('mac-r1');
    await user.click(await within(card).findByRole('button', { name: 'Abbrechen: Umsetzen an WEB-47' }));
    let question = await screen.findByRole('alertdialog', { name: 'Auftrag „Umsetzen“ an WEB-47 abbrechen?' });
    expect(within(question).getByText(/Der Runner beendet das CLI/)).toBeTruthy();
    await user.click(within(question).getByRole('button', { name: 'Weiterlaufen lassen' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(calls('POST', '/api/v1/runs/run1/cancel')).toHaveLength(0);
    await user.click(within(card).getByRole('button', { name: 'Abbrechen: Umsetzen an WEB-47' }));
    question = await screen.findByRole('alertdialog', { name: 'Auftrag „Umsetzen“ an WEB-47 abbrechen?' });
    await user.click(within(question).getByRole('button', { name: 'Auftrag abbrechen' }));
    await waitFor(() => expect(toastNamed('Auftrag nicht abgebrochen')).toBeTruthy());

    fail = false;
    act(() => runToastAction(toastNamed('Auftrag nicht abgebrochen')!.id));
    await waitFor(() => expect(toastNamed('WEB-47: Auftrag wird abgebrochen')).toBeTruthy());
    expect(toastNamed('WEB-47: Auftrag wird abgebrochen')!.description).toBe('„mac-r1“ beendet das CLI beim nächsten Kontakt. Was nicht gepusht ist, bleibt im Worktree.');
    // the question closes: the focus goes to the runner's card
    await waitFor(() => expect(document.activeElement).toBe(document.getElementById('runner-card-r1')));

    // a run without an item, from the queue
    await user.click(within(card).getByRole('button', { name: 'Abbrechen: Umsetzen an Ohne Item' }));
    const plain = await screen.findByRole('alertdialog', { name: 'Auftrag „Umsetzen“ abbrechen?' });
    expect(within(plain).getByText('Der Auftrag kommt aus der Warteschlange. Am Item lässt er sich erneut starten.')).toBeTruthy();
    await user.click(within(plain).getByRole('button', { name: 'Auftrag abbrechen' }));
    await waitFor(() => expect(toastNamed('Auftrag wird abgebrochen')).toBeTruthy());
    expect(toastNamed('Auftrag wird abgebrochen')!.description).toBe('Der Auftrag ist aus der Warteschlange. Am Item lässt er sich erneut starten.');
    // the row is gone: the card takes the focus
    await waitFor(() => expect(document.activeElement).toBe(document.getElementById('runner-card-r1')));
  });
});
