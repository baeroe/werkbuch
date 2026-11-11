/*
 * Settings → Automations against a fake server that keeps the five automations of WEB and answers like
 * `SaveAutomation` (a Canceled state to switch Auto-Close on, days 1–3650); a key without a stored row reads as it starts:
 * off, but `link_references` on (A452). The main flows run in
 * e2e/tests/automations.spec.ts.
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode, Ref } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { currentToasts, resetToasts, runToastAction } from '@/components/ui/toast';
import { mockApi, type MockApi, type MockRoute } from '@/test/api';
import { agency, ida, lene, list, organization, project, standard } from '@/test/fixtures';
import type { Automation, AutomationKey, User, Workflow } from '@/types';
import { ProjectSettings } from './ProjectSettings';

const inertia = vi.hoisted(() => ({ url: '/projects/WEB/settings/automations' }));
let signedIn: User = ida;

vi.mock('@inertiajs/react', () => ({
  usePage: () => ({ props: { auth: { user: signedIn, permissions: [] }, organization }, url: inertia.url }),
  Link: ({ href, children, ref, ...rest }: { href: string; children: ReactNode; ref?: Ref<HTMLAnchorElement> }) => (
    <a href={href} ref={ref} {...rest}>
      {children}
    </a>
  ),
  router: { visit: vi.fn(), replace: vi.fn(), reload: vi.fn(), on: () => () => {} },
}));

/* -------------------------------------------------------------------------- data */

const web = project('WEB', 'admin', { id: 'p_web', name: 'Website-Relaunch', lead_id: 'u_ida' });
const KEYS: AutomationKey[] = ['auto_archive', 'auto_close', 'close_parent', 'assign_on_start', 'link_references'];
const DEFAULTS: Record<AutomationKey, Automation['settings']> = { auto_archive: { days: 30 }, auto_close: { days: 90, state_id: null }, close_parent: {}, assign_on_start: {}, link_references: {} };

/** A workflow without a Canceled state. */
const lean: Workflow = {
  ...standard,
  id: 'wf_lean',
  name: 'Schlank',
  is_default: false,
  states: standard.states.filter((state) => state.category !== 'canceled'),
};

/** Only a started item may be cancelled: Auto-Close has to skip Backlog and Todo. */
const strict: Workflow = { ...agency, id: 'wf_strict', name: 'Streng', transitions: agency.transitions.filter(([from, to]) => !(to === 'app_cancelled' && from !== 'app_progress')) };

const problem = (status: number, reason: string, extra: Record<string, unknown> = {}) => ({ status, body: { type: 'about:blank', title: reason, status, reason, ...extra } });

/* ------------------------------------------------------------------------ server */

let api: MockApi | undefined;
let stored: Record<AutomationKey, Automation>;
/** The PUTs whose answer waits until `releaseOne()`, one per held call, in order. */
let holding = false;
const held: (() => void)[] = [];
const releaseOne = () => act(() => held.shift()!());

function fakeServer(workflow: Workflow, initial: Partial<Record<AutomationKey, Partial<Automation>>>): Record<string, MockRoute> {
  stored = Object.fromEntries(
    KEYS.map((key) => [key, { id: initial[key] ? `au_${key}` : null, project_id: 'p_web', key, enabled: key === 'link_references', settings: DEFAULTS[key], ...initial[key] }]),
  ) as Record<AutomationKey, Automation>;
  const routes: Record<string, MockRoute> = {
    'GET /api/v1/projects/p_web/automations': () => ({ body: { data: KEYS.map((key) => stored[key]) } }),
  };
  for (const key of KEYS) {
    routes[`PUT /api/v1/projects/p_web/automations/${key}`] = (body) => {
      const input = body as { enabled: boolean; settings: Automation['settings'] };
      const settings = { ...stored[key].settings, ...input.settings };
      if (settings.days !== undefined && (settings.days < 1 || settings.days > 3650)) {
        return problem(422, 'validation_failed', { errors: { 'settings.days': ['Die Tage sind eine ganze Zahl von 1 bis 3650.'] } });
      }
      if (key === 'auto_close' && input.enabled && !workflow.states.some((state) => state.id === settings.state_id && state.category === 'canceled')) {
        return problem(422, 'validation_failed', { errors: { 'settings.state_id': ['Wähle einen Status der Kategorie Canceled.'] } });
      }
      stored[key] = { ...stored[key], id: `au_${key}`, enabled: input.enabled, settings };
      return { body: { data: stored[key] } };
    };
  }
  return routes;
}

function renderAutomations(
  { workflow = standard, initial = {}, shown = web, overrides = {} }: { workflow?: Workflow; initial?: Partial<Record<AutomationKey, Partial<Automation>>>; shown?: typeof web; overrides?: Record<string, MockRoute> } = {},
) {
  api = mockApi({
    'GET /api/v1/projects/WEB': () => ({ body: { data: { ...shown, workflow_id: workflow.id } } }),
    'GET /api/v1/projects': () => ({ body: list([{ ...shown, workflow_id: workflow.id }]) }),
    'GET /api/v1/workflows': () => ({ body: list([standard, agency, lean, strict]) }),
    ...fakeServer(workflow, initial),
    ...overrides,
  });
  // the answers of the PUTs wait while `holding` is set (the server has the call already)
  const fetching = globalThis.fetch;
  globalThis.fetch = (input, init) => {
    const answer = fetching(input, init);
    return init?.method === 'PUT' && holding ? new Promise<Response>((resolve) => held.push(() => resolve(answer))) : answer;
  };
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const tree = () => (
    <QueryClientProvider client={client}>
      <ProjectSettings identifier="WEB" section="automations" />
    </QueryClientProvider>
  );
  const view = render(tree());
  return { client, ...view, again: () => render(tree()) };
}

const switchOf = (name: string) => screen.findByRole('switch', { name });
const textbox = (name: string) => screen.findByRole<HTMLInputElement>('textbox', { name: new RegExp(`^${name}`) });
const puts = (key: AutomationKey) => api!.calls.filter((call) => call.method === 'PUT' && call.url === `/api/v1/projects/p_web/automations/${key}`);
const toastTitles = () => currentToasts().map((entry) => entry.title);

afterEach(() => {
  api?.restore();
  api = undefined;
  holding = false;
  held.length = 0;
  signedIn = ida;
  act(() => resetToasts());
});

/* ------------------------------------------------------------------------- tests */

describe('Automations', () => {
  it('shows the five automations with what they do, and the days of the ones that are on', async () => {
    renderAutomations({ initial: { auto_archive: { enabled: true, settings: { days: 30 } }, assign_on_start: { enabled: true } } });

    expect(screen.getByText('Projekteinstellungen werden geladen …')).toBeTruthy();
    const archive = await switchOf('Auto-Archiv');
    expect(archive.getAttribute('aria-checked')).toBe('true');
    expect((await switchOf('Auto-Close')).getAttribute('aria-checked')).toBe('false');
    expect((await switchOf('Eltern schließen')).getAttribute('aria-checked')).toBe('false');
    expect((await switchOf('Assignee beim Start')).getAttribute('aria-checked')).toBe('true');
    expect((await switchOf('Erwähnte Items verknüpfen')).getAttribute('aria-checked')).toBe('true');
    // the switch is described by what the automation does; the nightly ones notify nobody (A357)
    const description = document.getElementById(archive.getAttribute('aria-describedby')!.split(' ')[0]!)!;
    expect(description.textContent).toBe('Archiviert Items, die seit der eingestellten Zeit geschlossen sind. Läuft jede Nacht und benachrichtigt niemanden.');
    expect(screen.getByText(/Auto-Archiv und Auto-Close laufen jede Nacht um 3 Uhr/)).toBeTruthy();
    expect((await textbox('Tage nach dem Schließen')).value).toBe('30');
    expect(screen.queryByRole('textbox', { name: /Tage ohne Aktivität/ })).toBeNull();
    expect(document.title).toBe('Automatisierungen – Einstellungen WEB – werkbuch');
  });

  it('turns an automation on at once and saves it once', async () => {
    const user = userEvent.setup();
    renderAutomations();
    holding = true;

    const parent = await switchOf('Eltern schließen');
    await user.click(parent);
    // on at once, while the call runs
    expect(parent.getAttribute('aria-checked')).toBe('true');
    await waitFor(() => expect(puts('close_parent')).toHaveLength(1));
    expect(puts('close_parent')[0]!.body).toEqual({ enabled: true, settings: {} });
    releaseOne();

    await waitFor(() => expect(toastTitles()).toContain('Eltern schließen eingeschaltet'));
    expect(stored.close_parent.enabled).toBe(true);
    expect(parent.getAttribute('aria-checked')).toBe('true');
  });

  it('lets a second switch wait for the first call, and the other automations not', async () => {
    const user = userEvent.setup();
    renderAutomations();
    holding = true;

    const parent = await switchOf('Eltern schließen');
    await user.click(parent);
    await user.click(parent);
    // off again at once; the second call waits for the first
    expect(parent.getAttribute('aria-checked')).toBe('false');
    await waitFor(() => expect(puts('close_parent')).toHaveLength(1));
    // another automation does not wait for this one
    await user.click(await switchOf('Assignee beim Start'));
    await waitFor(() => expect(puts('assign_on_start')).toHaveLength(1));
    expect(puts('close_parent')).toHaveLength(1);

    releaseOne();
    await waitFor(() => expect(puts('close_parent')).toHaveLength(2));
    expect(puts('close_parent')[1]!.body).toEqual({ enabled: false, settings: {} });
    releaseOne();
    releaseOne();
    await waitFor(() => expect(toastTitles()).toContain('Eltern schließen ausgeschaltet'));
    expect(stored.close_parent.enabled).toBe(false);
    expect(parent.getAttribute('aria-checked')).toBe('false');
  });

  it('shows what is on its way after the screen comes back, and sends nothing twice', async () => {
    const user = userEvent.setup();
    const { unmount, again } = renderAutomations();
    holding = true;

    await user.click(await switchOf('Eltern schließen'));
    await waitFor(() => expect(puts('close_parent')).toHaveLength(1));
    unmount();
    again();

    const parent = await switchOf('Eltern schließen');
    expect(parent.getAttribute('aria-checked')).toBe('true');
    // off and on again while the first call runs: the waiting change ends where the call goes, so nothing more goes out
    await user.click(parent);
    expect(parent.getAttribute('aria-checked')).toBe('false');
    await user.click(parent);
    expect(parent.getAttribute('aria-checked')).toBe('true');
    releaseOne();
    await waitFor(() => expect(toastTitles()).toContain('Eltern schließen eingeschaltet'));
    expect(puts('close_parent')).toHaveLength(1);
    expect(stored.close_parent.enabled).toBe(true);
    expect(parent.getAttribute('aria-checked')).toBe('true');
  });

  it('turns Auto-Close on with the first Canceled status and the days it waits', async () => {
    const user = userEvent.setup();
    renderAutomations();

    await user.click(await switchOf('Auto-Close'));

    expect((await textbox('Tage ohne Aktivität')).value).toBe('90');
    expect(screen.getByRole('combobox', { name: /^Canceled-Status/ }).textContent).toContain('Cancelled');
    await waitFor(() => expect(puts('auto_close')).toHaveLength(1));
    expect(puts('auto_close')[0]!.body).toEqual({ enabled: true, settings: { days: 90, state_id: 'std_cancelled' } });
    await waitFor(() => expect(toastTitles()).toContain('Auto-Close eingeschaltet'));
  });

  it('saves another Canceled status', async () => {
    const user = userEvent.setup();
    const two: Workflow = { ...standard, states: [...standard.states, { id: 'std_dropped', name: 'Dropped', icon: 'cross', category: 'canceled', position: 6 }] };
    renderAutomations({
      workflow: two,
      overrides: { 'GET /api/v1/workflows': () => ({ body: list([two]) }) },
      initial: { auto_close: { enabled: true, settings: { days: 90, state_id: 'std_cancelled' } } },
    });

    await user.click(await screen.findByRole('combobox', { name: /^Canceled-Status/ }));
    await user.click(await screen.findByRole('option', { name: 'Dropped' }));

    await waitFor(() => expect(toastTitles()).toContain('Auto-Close gespeichert'));
    expect(puts('auto_close')[0]!.body).toEqual({ enabled: true, settings: { days: 90, state_id: 'std_dropped' } });
  });

  it('saves the days once when the blur follows Enter before the first save has come back', async () => {
    const user = userEvent.setup();
    renderAutomations({ initial: { auto_archive: { enabled: true, settings: { days: 30 } } } });
    const days = await textbox('Tage nach dem Schließen');
    holding = true;
    await user.clear(days);
    await user.type(days, '45');

    fireEvent.keyDown(days, { key: 'Enter' });
    fireEvent.blur(days);
    fireEvent.keyDown(days, { key: 'Enter' });

    await waitFor(() => expect(puts('auto_archive')).toHaveLength(1));
    releaseOne();
    await waitFor(() => expect(toastTitles()).toContain('Auto-Archiv gespeichert'));
    expect(puts('auto_archive')).toHaveLength(1);
    expect(puts('auto_archive')[0]!.body).toEqual({ enabled: true, settings: { days: 45 } });
    expect(currentToasts().filter((entry) => entry.title === 'Auto-Archiv gespeichert')).toHaveLength(1);
    expect(days.value).toBe('45');
  });

  it('keeps what is typed while the first save is on its way, and saves it after the first when the field is left', async () => {
    const user = userEvent.setup();
    renderAutomations({ initial: { auto_archive: { enabled: true, settings: { days: 30 } } } });
    const days = await textbox('Tage nach dem Schließen');
    holding = true;
    await user.clear(days);
    await user.type(days, '45');

    fireEvent.keyDown(days, { key: 'Enter' });
    fireEvent.change(days, { target: { value: '450' } });
    fireEvent.blur(days);
    await waitFor(() => expect(puts('auto_archive')).toHaveLength(1));

    releaseOne();
    await waitFor(() => expect(puts('auto_archive')).toHaveLength(2));
    expect(days.value).toBe('450');
    releaseOne();
    await waitFor(() => expect(stored.auto_archive.settings.days).toBe(450));
    await waitFor(() => expect(days.value).toBe('450'));
    expect(days.getAttribute('aria-invalid')).toBeNull();
  });

  it('shows a number that is no days at the field, and a refusal of the server there too', async () => {
    const user = userEvent.setup();
    renderAutomations({ initial: { auto_archive: { enabled: true, settings: { days: 30 } } } });
    const days = await textbox('Tage nach dem Schließen');

    await user.clear(days);
    await user.type(days, '0{Enter}');
    expect(await screen.findByText('Die Tage sind eine ganze Zahl von 1 bis 3650.')).toBeTruthy();
    expect(days.getAttribute('aria-invalid')).toBe('true');
    expect(puts('auto_archive')).toHaveLength(0);
    // the error goes as soon as the person types again
    await user.type(days, '5');
    expect(days.getAttribute('aria-invalid')).toBeNull();

    // the saved value again: nothing to save
    await user.clear(days);
    await user.type(days, '30{Enter}');
    expect(puts('auto_archive')).toHaveLength(0);

    await user.clear(days);
    await user.type(days, '45{Enter}');
    await waitFor(() => expect(stored.auto_archive.settings.days).toBe(45));
    await waitFor(() => expect(toastTitles()).toContain('Auto-Archiv gespeichert'));
  });

  it('puts a refusal of the days at the field', async () => {
    const user = userEvent.setup();
    renderAutomations({
      initial: { auto_archive: { enabled: true, settings: { days: 30 } } },
      overrides: { 'PUT /api/v1/projects/p_web/automations/auto_archive': () => problem(422, 'validation_failed', { errors: { 'settings.days': ['Zu viele Tage.'] } }) },
    });
    const days = await textbox('Tage nach dem Schließen');

    await user.clear(days);
    await user.type(days, '45{Enter}');
    expect(await screen.findByText('Zu viele Tage.')).toBeTruthy();
    expect(days.getAttribute('aria-invalid')).toBe('true');
    expect(days.value).toBe('45');
    expect(toastTitles()).toEqual([]);
    // typing again answers it
    await user.type(days, '0');
    expect(days.getAttribute('aria-invalid')).toBeNull();
  });

  it('says when a switch was not saved, with "Erneut versuchen", and shows it as it is', async () => {
    const user = userEvent.setup();
    let fail = true;
    const routes = fakeServer(standard, {});
    renderAutomations({
      overrides: {
        'PUT /api/v1/projects/p_web/automations/close_parent': (body, url) =>
          fail ? problem(503, 'service_unavailable', { detail: 'Der Server ist gerade nicht erreichbar.' }) : routes['PUT /api/v1/projects/p_web/automations/close_parent']!(body, url),
      },
    });

    const parent = await switchOf('Eltern schließen');
    await user.click(parent);
    await waitFor(() => expect(toastTitles()).toContain('Eltern schließen nicht gespeichert'));
    await waitFor(() => expect(parent.getAttribute('aria-checked')).toBe('false'));

    fail = false;
    act(() => runToastAction(currentToasts().find((entry) => entry.title === 'Eltern schließen nicht gespeichert')!.id));
    await waitFor(() => expect(toastTitles()).toContain('Eltern schließen eingeschaltet'));
    expect(parent.getAttribute('aria-checked')).toBe('true');
  });

  it('says when switching Auto-Close on was refused, in the toast: the field is not there', async () => {
    const user = userEvent.setup();
    renderAutomations({
      overrides: { 'PUT /api/v1/projects/p_web/automations/auto_close': () => problem(422, 'validation_failed', { errors: { 'settings.state_id': ['Wähle einen Status der Kategorie Canceled.'] } }) },
    });

    const close = await switchOf('Auto-Close');
    await user.click(close);
    await waitFor(() => expect(toastTitles()).toContain('Auto-Close nicht gespeichert'));
    expect(currentToasts().find((entry) => entry.title === 'Auto-Close nicht gespeichert')!.description).toBe('Wähle einen Status der Kategorie Canceled.');
    await waitFor(() => expect(close.getAttribute('aria-checked')).toBe('false'));
  });

  it('puts a refused Canceled status at its field', async () => {
    const user = userEvent.setup();
    const two: Workflow = { ...standard, states: [...standard.states, { id: 'std_dropped', name: 'Dropped', icon: 'cross', category: 'canceled', position: 6 }] };
    renderAutomations({
      workflow: two,
      overrides: {
        'GET /api/v1/workflows': () => ({ body: list([two]) }),
        'PUT /api/v1/projects/p_web/automations/auto_close': () => problem(422, 'validation_failed', { errors: { 'settings.state_id': ['Wähle einen Status der Kategorie Canceled.'] } }),
      },
      initial: { auto_close: { enabled: true, settings: { days: 90, state_id: 'std_cancelled' } } },
    });

    await user.click(await screen.findByRole('combobox', { name: /^Canceled-Status/ }));
    await user.click(await screen.findByRole('option', { name: 'Dropped' }));

    expect(await screen.findByText('Wähle einen Status der Kategorie Canceled.')).toBeTruthy();
    expect(toastTitles()).toEqual([]);
  });

  it('keeps Auto-Close off with the reason in a workflow without a Canceled status', async () => {
    renderAutomations({ workflow: lean, initial: { auto_close: { enabled: true, settings: { days: 90, state_id: 'std_cancelled' } } } });

    const close = await switchOf('Auto-Close');
    expect(close.hasAttribute('data-disabled')).toBe(true);
    expect(close.getAttribute('aria-checked')).toBe('false');
    const reason = 'Der Workflow „Schlank“ hat keinen Status der Kategorie Canceled. Org-Admins können einen ergänzen; bis dahin bleibt Auto-Close aus.';
    expect(screen.getByText(reason)).toBeTruthy();
    const described = close.getAttribute('aria-describedby')!.split(' ').map((id) => document.getElementById(id)!.textContent);
    expect(described).toContain(reason);
    expect(screen.queryByRole('textbox', { name: /Tage ohne Aktivität/ })).toBeNull();
  });

  it('names the states Auto-Close skips because the workflow forbids the move to the Canceled status', async () => {
    renderAutomations({ workflow: strict, initial: { auto_close: { enabled: true, settings: { days: 90, state_id: 'app_cancelled' } } } });

    const banner = await screen.findByText('Auto-Close überspringt Items in Backlog und Todo.');
    expect(banner.closest('[role="status"]')).toBeTruthy();
    expect(screen.getByText('„Streng“ erlaubt von dort keinen Übergang nach „Cancelled“. Wähle einen anderen Status oder erlaube den Übergang im Workflow.')).toBeTruthy();
  });

  it('lets somebody who does not manage the project read the automations, unchangeable', async () => {
    signedIn = lene;
    renderAutomations({
      shown: { ...web, my_role: 'member' },
      initial: { auto_archive: { enabled: true, settings: { days: 30 } }, auto_close: { enabled: true, settings: { days: 90, state_id: 'std_cancelled' } } },
    });

    const archive = await switchOf('Auto-Archiv');
    expect(archive.getAttribute('aria-checked')).toBe('true');
    expect(archive.hasAttribute('data-disabled')).toBe(true);
    expect(screen.getByText('Du kannst das nur lesen')).toBeTruthy();
    expect(screen.getByText('Projekteinstellungen ändern dürfen nur Admins des Projekts WEB.')).toBeTruthy();
    const days = await textbox('Tage nach dem Schließen');
    expect(days.readOnly).toBe(true);
    fireEvent.keyDown(days, { key: 'Enter' });
    fireEvent.blur(days);
    const state = screen.getByRole('combobox', { name: /^Canceled-Status/ });
    expect(state.getAttribute('aria-readonly') ?? state.getAttribute('data-readonly')).not.toBeNull();
    expect(api!.calls.filter((call) => call.method === 'PUT')).toHaveLength(0);
  });

  it('says when the automations could not be loaded and loads them again on request', async () => {
    const user = userEvent.setup();
    let fail = true;
    const routes = fakeServer(standard, {});
    renderAutomations({
      overrides: {
        'GET /api/v1/projects/p_web/automations': (body, url) => (fail ? problem(503, 'service_unavailable') : routes['GET /api/v1/projects/p_web/automations']!(body, url)),
      },
    });

    expect(await screen.findByText('Die Automatisierungen konnten nicht geladen werden')).toBeTruthy();
    fail = false;
    await user.click(screen.getByRole('button', { name: 'Erneut versuchen' }));
    expect(await switchOf('Auto-Archiv')).toBeTruthy();
  });

  it('shows link_references on without a stored row and switches it off', async () => {
    const user = userEvent.setup();
    // the server answers a key without a row as on, without an id; Auto-Archiv on shows the one field of days
    renderAutomations({ initial: { auto_archive: { enabled: true, settings: { days: 30 } } } });
    const link = await switchOf('Erwähnte Items verknüpfen');
    expect(link.getAttribute('aria-checked')).toBe('true');
    expect(screen.getByText(/Standardmäßig an\./)).toBeTruthy();
    // link_references has no settings: the only field of days is Auto-Archiv's, outside its row
    const row = link.closest('li')!;
    const days = screen.getAllByRole('textbox', { name: /Tage/ });
    expect(days).toHaveLength(1);
    expect(row.contains(days[0]!)).toBe(false);
    expect(within(row).getAllByRole('switch')).toEqual([link]);

    await user.click(link);
    await waitFor(() => expect(puts('link_references')).toHaveLength(1));
    expect(puts('link_references')[0]!.body).toEqual({ enabled: false, settings: {} });
    await waitFor(() => expect(toastTitles()).toContain('Erwähnte Items verknüpfen ausgeschaltet'));
    expect(link.getAttribute('aria-checked')).toBe('false');
  });

  it('lists the automations as one list in the order of the server', async () => {
    renderAutomations();
    const rows = within(await screen.findByRole('list', { name: 'Automatisierungen' })).getAllByRole('heading', { level: 3 });
    expect(rows.map((row) => row.textContent)).toEqual(['Auto-Archiv', 'Auto-Close', 'Eltern schließen', 'Assignee beim Start', 'Erwähnte Items verknüpfen']);
  });
});
