/*
 * Settings → System (spec 5.2, org admins) against a fake REST API (`mockApi`): the state of the instance, the failed
 * jobs with "Alle erneut versuchen", the test mail and its refusals, members, loading and a failed load. The flow with a
 * real server (opened with the keyboard, a test mail that arrives in Mailpit) runs in e2e/tests/system.spec.ts.
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode, Ref } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { currentToasts, resetToasts, runToastAction } from '@/components/ui/toast';
import { mockApi, type MockApi, type MockRoute } from '@/test/api';
import { lene, list, makeSystemStatus, mara, organization, project } from '@/test/fixtures';
import type { SystemStatus, User } from '@/types';
import { OrgSettings } from '../OrgSettings';

let signedIn: User = mara;

vi.mock('@inertiajs/react', () => ({
  usePage: () => ({ props: { auth: { user: signedIn, permissions: [] }, organization } }),
  Link: ({ href, children, ref, ...rest }: { href: string; children: ReactNode; ref?: Ref<HTMLAnchorElement> }) => (
    <a href={href} ref={ref} {...rest}>
      {children}
    </a>
  ),
  router: { reload: vi.fn(), visit: vi.fn(), on: () => () => {} },
}));

const problem = (status: number, reason: string, detail: string) => ({ status, body: { type: 'about:blank', title: reason, status, reason, detail } });

let api: MockApi | undefined;

function renderSystem(status: SystemStatus | MockRoute = makeSystemStatus(), overrides: Record<string, MockRoute> = {}) {
  api = mockApi({
    'GET /api/v1/projects': () => ({ body: list([project('WEB', 'admin')]) }),
    'GET /api/v1/organization': () => ({ body: { data: organization } }),
    'GET /api/v1/system': typeof status === 'function' ? status : () => ({ body: { data: status } }),
    ...overrides,
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <OrgSettings section="system" />
    </QueryClientProvider>,
  );
}

const calls = (method: string, path: string) => api!.calls.filter((call) => call.method === method && call.url === path);
const toastNamed = (title: string) => currentToasts().find((entry) => entry.title === title);
/** A fact of the instance by its label: the row that holds it. */
const fact = (instance: HTMLElement, label: string) => within(instance).getByText(label, { selector: 'span' }).closest('li')!;

afterEach(() => {
  api?.restore();
  api = undefined;
  signedIn = mara;
  resetToasts();
});

describe('System', () => {
  it('sits in the group "Betrieb" of the organisation settings', async () => {
    renderSystem();

    const nav = screen.getByRole('navigation', { name: 'Bereiche der Einstellungen' });
    expect(within(nav).getByText('Betrieb')).toBeTruthy();
    expect(within(nav).getByRole('link', { name: 'System' }).getAttribute('href')).toBe('/settings/system');
    expect(await screen.findByRole('heading', { level: 2, name: 'System' })).toBeTruthy();
    expect(document.title).toBe('System – Einstellungen – werkbuch');
  });

  it('shows version, backlog, search, mail and live', async () => {
    renderSystem(makeSystemStatus({ search_tasks: { enqueued: 1, processing: 1, failed_last_day: 1 } }));

    const instance = await screen.findByRole('list', { name: 'Zustand der Instanz' });
    expect(within(fact(instance, 'Version')).getByText('0.1.0-dev').getAttribute('translate')).toBe('no');

    const queues = fact(instance, 'Queues');
    expect(within(queues).getByText('3 Jobs warten')).toBeTruthy();
    expect(within(queues).getByText('Aufgaben, die noch laufen müssen, etwa Zustellungen und Mails.')).toBeTruthy();
    const perQueue = within(queues).getByRole('list', { name: 'Rückstand je Queue' });
    const rows = within(perQueue).getAllByRole('listitem');
    expect(rows.map((row) => row.textContent)).toEqual([
      // the oldest job in the time zone of the organisation (Berlin, CET after the 25th)
      'default2 Jobsältester seit 28.10.2026, 08:59',
      'liveleer',
      'notifications1 Jobältester seit 28.10.2026, 08:58',
      'webhooksleer',
      'searchleer',
      'medialeer',
      'bulkleer',
    ]);

    // the delayed jobs apart: they are no backlog
    const delayed = fact(instance, 'Geplante Jobs');
    expect(within(delayed).getByText('1 Job geplant')).toBeTruthy();
    expect(within(delayed).getByText('Jobs, die erst später laufen sollen, etwa Sammelmails. Sie zählen nicht zum Rückstand.')).toBeTruthy();

    const search = fact(instance, 'Suche (Meilisearch)');
    expect(within(search).getByText('Läuft')).toBeTruthy();
    // open are the enqueued and the processing; the hours stay with their number
    expect(within(search).getByText('Aufgaben: 2 offen, 1 in den letzten 24 Stunden gescheitert.').textContent).toContain('24\u00a0Stunden');

    expect(within(fact(instance, 'E-Mail')).getByText('Mailserver eingerichtet')).toBeTruthy();

    const live = fact(instance, 'Live-Updates (Reverb)');
    expect(within(live).getByText('Läuft')).toBeTruthy();
    expect(within(live).getByText('Bleiben die Live-Updates im Browser trotzdem pausiert, fehlt im Proxy (etwa Nginx Proxy Manager) der Schalter „Websockets Support“.')).toBeTruthy();
  });

  it('says the queues are empty when nothing waits', async () => {
    renderSystem(makeSystemStatus({ queued_jobs: 0, delayed_jobs: 0, queues: [{ queue: 'default', pending: 0, oldest_at: null }] }));

    const queues = fact(await screen.findByRole('list', { name: 'Zustand der Instanz' }), 'Queues');
    expect(within(queues).getByText('0 Jobs warten')).toBeTruthy();
    expect(within(queues).getByText('Die Queues sind leer, alles ist abgearbeitet.')).toBeTruthy();
    expect(within(fact(screen.getByRole('list', { name: 'Zustand der Instanz' }), 'Geplante Jobs')).getByText('0 Jobs geplant')).toBeTruthy();
  });

  it('says search is down and live is off', async () => {
    renderSystem(makeSystemStatus({ search: 'down', search_tasks: null, live: 'off' }));

    const instance = await screen.findByRole('list', { name: 'Zustand der Instanz' });
    const search = fact(instance, 'Suche (Meilisearch)');
    expect(within(search).getByText('Nicht erreichbar')).toBeTruthy();
    expect(within(search).getByText('Die Suche findet nichts, bis Meilisearch wieder antwortet.')).toBeTruthy();
    expect(within(search).queryByText(/Aufgaben/)).toBeNull();

    const live = fact(instance, 'Live-Updates (Reverb)');
    expect(within(live).getByText('Aus')).toBeTruthy();
    expect(within(live).getByText('Live-Updates sind nicht eingerichtet: Listen und Inbox aktualisieren sich beim nächsten Laden.')).toBeTruthy();
    // without Reverb there is no proxy to blame
    expect(within(live).queryByText(/Websockets Support/)).toBeNull();
  });

  it('says live is down and points at the switch of the proxy', async () => {
    renderSystem(makeSystemStatus({ live: 'down' }));

    const live = fact(await screen.findByRole('list', { name: 'Zustand der Instanz' }), 'Live-Updates (Reverb)');
    expect(within(live).getByText('Nicht erreichbar')).toBeTruthy();
    expect(within(live).getByText('Reverb antwortet nicht: Listen und Inbox aktualisieren sich erst beim nächsten Laden.')).toBeTruthy();
    expect(within(live).getByText(/„Websockets Support“/)).toBeTruthy();
  });

  it('lists failed jobs and retries them all', async () => {
    const user = userEvent.setup();
    let status = makeSystemStatus();
    renderSystem(() => ({ body: { data: status } }), {
      'POST /api/v1/system/failed-jobs/retry': () => {
        status = makeSystemStatus({ failed_jobs: [], failed_jobs_total: 0, queued_jobs: 4 });
        return { body: { retried: 1 } };
      },
    });

    const panel = (await screen.findByRole('heading', { name: 'Fehlgeschlagene Jobs (1)' })).closest('section')!;
    const failed = within(panel).getByRole('list', { name: 'Fehlgeschlagene Jobs' });
    const [job] = within(failed).getAllByRole('listitem');
    expect(within(job!).getByText('App\\Jobs\\SendNotificationMailJob').getAttribute('translate')).toBe('no');
    expect(within(job!).getByText('notifications')).toBeTruthy();
    expect(within(job!).getByText('Connection to mail-1.feldwerk.example.com:587 refused')).toBeTruthy();
    expect(within(job!).getByText('26.10.2026, 13:05')).toBeTruthy();
    // all of them fit on the page: no hint at older ones
    expect(within(panel).queryByText(/Die neuesten/)).toBeNull();

    await user.click(within(panel).getByRole('button', { name: 'Alle erneut versuchen' }));

    expect(await screen.findByText('Keine fehlgeschlagenen Jobs')).toBeTruthy();
    expect(calls('POST', '/api/v1/system/failed-jobs/retry').map((call) => call.body)).toEqual([{}]);
    expect(toastNamed('1 Job wieder eingereiht')?.description).toBe('Sie laufen mit der nächsten Runde der Queue.');
    // reloaded: the queue holds them now
    expect(within(screen.getByRole('list', { name: 'Zustand der Instanz' })).getByText('4 Jobs warten')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Fehlgeschlagene Jobs' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Alle erneut versuchen' })).toBeNull();
  });

  it('says that only the newest failed jobs are listed', async () => {
    renderSystem(makeSystemStatus({ failed_jobs_total: 73 }));

    const panel = (await screen.findByRole('heading', { name: 'Fehlgeschlagene Jobs (73)' })).closest('section')!;
    expect(within(panel).getByText('Die neuesten 1 von 73.')).toBeTruthy();
  });

  it('says when the failed jobs could not be put back, with "Erneut versuchen"', async () => {
    const user = userEvent.setup();
    renderSystem(makeSystemStatus(), { 'POST /api/v1/system/failed-jobs/retry': () => problem(503, 'service_unavailable', 'Der Server ist gerade nicht erreichbar.') });

    await user.click(await screen.findByRole('button', { name: 'Alle erneut versuchen' }));

    await waitFor(() => expect(toastNamed('Jobs nicht wieder eingereiht')?.description).toBe('Der Server ist gerade nicht erreichbar.'));
    runToastAction(toastNamed('Jobs nicht wieder eingereiht')!.id);
    await waitFor(() => expect(calls('POST', '/api/v1/system/failed-jobs/retry')).toHaveLength(2));
  });

  it('sends a test mail and says to whom', async () => {
    const user = userEvent.setup();
    renderSystem(makeSystemStatus(), { 'POST /api/v1/system/test-mail': () => ({ body: { sent_to: 'mara@feldwerk.example.com' } }) });

    const panel = (await screen.findByRole('heading', { name: 'Testmail' })).closest('section')!;
    expect(within(panel).getByText('Schickt eine Mail an deine Adresse, damit du siehst, ob der Mailserver arbeitet.')).toBeTruthy();
    await user.click(within(panel).getByRole('button', { name: 'Testmail an mara@feldwerk.example.com' }));

    await waitFor(() => expect(toastNamed('Testmail an mara@feldwerk.example.com gesendet')?.description).toBe('Sie sollte in wenigen Sekunden ankommen.'));
    expect(calls('POST', '/api/v1/system/test-mail')).toHaveLength(1);
  });

  it('says when the mail server refused the test mail, with "Erneut versuchen"', async () => {
    const user = userEvent.setup();
    renderSystem(makeSystemStatus(), { 'POST /api/v1/system/test-mail': () => problem(503, 'mail_failed', 'Der Mailserver hat die Mail nicht angenommen.') });

    await user.click(await screen.findByRole('button', { name: 'Testmail an mara@feldwerk.example.com' }));

    await waitFor(() => expect(toastNamed('Testmail nicht gesendet')?.description).toBe('Der Mailserver hat die Mail nicht angenommen.'));
    expect(toastNamed('Testmail nicht gesendet')?.tone).toBe('error');
    runToastAction(toastNamed('Testmail nicht gesendet')!.id);
    await waitFor(() => expect(calls('POST', '/api/v1/system/test-mail')).toHaveLength(2));
  });

  it('says in the panel that the mail server went away since the page loaded', async () => {
    const user = userEvent.setup();
    renderSystem(makeSystemStatus(), { 'POST /api/v1/system/test-mail': () => problem(409, 'mail_not_configured', 'Es ist kein Mailserver eingerichtet.') });

    await user.click(await screen.findByRole('button', { name: 'Testmail an mara@feldwerk.example.com' }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Die Testmail ist nicht rausgegangen');
    expect(alert.textContent).toContain('Es ist kein Mailserver eingerichtet.');
    expect(currentToasts()).toEqual([]);
  });

  it('offers no test mail without a mail server', async () => {
    renderSystem(makeSystemStatus({ mail_configured: false }));

    const panel = (await screen.findByRole('heading', { name: 'Testmail' })).closest('section')!;
    expect(within(panel).queryByRole('button')).toBeNull();
    expect(within(panel).getByText(/^Es ist kein Mailserver eingerichtet\. Trage ihn in der Konfiguration/)).toBeTruthy();
    expect(within(fact(screen.getByRole('list', { name: 'Zustand der Instanz' }), 'E-Mail')).getByText('Nicht eingerichtet')).toBeTruthy();
  });

  it('blocks members', async () => {
    signedIn = lene;
    renderSystem();

    expect(await screen.findByText('Nur für Admins')).toBeTruthy();
    expect(screen.getByText(/„System“/)).toBeTruthy();
    const nav = screen.getByRole('navigation', { name: 'Bereiche der Einstellungen' });
    expect(within(nav).getByRole('link', { name: /System/ }).textContent).toContain('nur für Admins');
    expect(calls('GET', '/api/v1/system')).toEqual([]);
  });

  it('shows the outline while it loads and the cause with "Erneut versuchen" when it failed', async () => {
    const user = userEvent.setup();
    let fail = true;
    renderSystem(() => (fail ? problem(500, 'server_error', 'Auf dem Server ist etwas schiefgegangen.') : { body: { data: makeSystemStatus() } }));

    expect(await screen.findByText('Der Systemzustand wird geladen …')).toBeTruthy();
    expect(await screen.findByText('Der Systemzustand konnte nicht geladen werden')).toBeTruthy();
    expect(screen.getByText('Auf dem Server ist etwas schiefgegangen.')).toBeTruthy();

    fail = false;
    await user.click(screen.getByRole('button', { name: 'Erneut versuchen' }));

    expect(await screen.findByRole('list', { name: 'Zustand der Instanz' })).toBeTruthy();
  });
});
