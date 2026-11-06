/*
 * The log of one webhook (spec 6.3, `?deliveries=<id>`) against a small fake server: the attempts newest first, the test
 * ping and "send again" with the answer in a toast and the new attempt on top, the notice of a webhook the system shut
 * down with its way back, more pages, and the cards' own test ping. The keyboard flows run in e2e/tests/webhooks.spec.ts.
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode, Ref } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { currentToasts, resetToasts } from '@/components/ui/toast';
import { mockApi, type MockApi, type MockRoute } from '@/test/api';
import { demoWebhooks, lene, list, makeDelivery, makeWebhook, mara, organization, project } from '@/test/fixtures';
import type { User, Webhook, WebhookDelivery } from '@/types';
import { OrgSettings } from '../OrgSettings';
import { formatDuration } from './webhookParts';

const signedIn: User = mara;
const inertia = vi.hoisted(() => ({ url: '/settings/webhooks?deliveries=wh_1' }));

vi.mock('@inertiajs/react', () => ({
  usePage: () => ({ props: { auth: { user: signedIn, permissions: [] }, organization }, url: inertia.url }),
  Link: ({ href, children, ref, ...rest }: { href: string; children: ReactNode; ref?: Ref<HTMLAnchorElement> }) => (
    <a href={href} ref={ref} {...rest}>
      {children}
    </a>
  ),
  router: { reload: vi.fn(), visit: vi.fn(), on: () => () => {} },
}));

const problem = (status: number, reason: string, extra: Record<string, unknown> = {}) => ({ status, body: { type: 'about:blank', title: reason, status, reason, ...extra } });

let api: MockApi | undefined;
let stored: Webhook[] = [];
let log: WebhookDelivery[] = [];
let sequence = 0;

const crm = demoWebhooks[2];
const first = makeDelivery({ id: 'at_1', delivery_id: 'dl_1' });
const second = makeDelivery({ id: 'at_2', delivery_id: 'dl_2', event: 'comment.created', attempt: 2, status_code: 500, duration_ms: 1500, response_excerpt: 'Internal Server Error', created_at: '2026-10-27T15:10:00.000Z' });
const timeout = makeDelivery({ id: 'at_3', delivery_id: 'dl_3', event: 'work_item.created', status_code: null, duration_ms: 10000, response_excerpt: null, error: 'Zeitüberschreitung', created_at: '2026-10-27T15:00:00.000Z' });

function renderLog(deliveries: Record<string, MockRoute> = {}, entries: WebhookDelivery[] = [first, second, timeout], webhooks: Webhook[] = demoWebhooks, url = '/settings/webhooks?deliveries=wh_1') {
  stored = [...webhooks];
  log = [...entries];
  sequence = 0;
  inertia.url = url;
  const attempt = (kind: 'ping' | 'manual', delivery_id: string): WebhookDelivery => {
    const created = makeDelivery({ id: `at_new${++sequence}`, delivery_id, event: kind === 'ping' ? 'ping' : 'work_item.state_changed', kind, attempt: 1, status_code: 200, duration_ms: 87, created_at: '2026-10-28T09:00:00.000Z' });
    log = [created, ...log];
    return created;
  };
  api = mockApi({
    'GET /api/v1/projects': () => ({ body: list([project('APP', 'admin', { name: 'Kunden-App' })]) }),
    'GET /api/v1/organization': () => ({ body: { data: organization } }),
    'GET /api/v1/users': () => ({ body: list([mara, lene]) }),
    'GET /api/v1/webhooks': () => ({ body: list(stored) }),
    'GET /api/v1/webhooks/wh_1/deliveries': (_body, requested) => {
      const cursor = requested.searchParams.get('cursor');
      const page = cursor === 'c2' ? log.slice(2) : log.length > 3 ? log.slice(0, 2) : log;
      return { body: { data: page, links: {}, meta: { next_cursor: log.length > 3 && cursor !== 'c2' ? 'c2' : null, total: log.length } } };
    },
    'GET /api/v1/webhooks/wh_crm/deliveries': () => ({ body: list([]) }),
    'POST /api/v1/webhooks/wh_1/ping': () => ({ body: { data: attempt('ping', 'dl_ping') } }),
    'POST /api/v1/webhooks/wh_1/deliveries/dl_2/redeliver': () => ({ body: { data: attempt('manual', 'dl_2') } }),
    'PUT /api/v1/webhooks/wh_crm': (body) => {
      stored = stored.map((webhook) => (webhook.id === 'wh_crm' ? { ...webhook, ...(body as object), disabled_at: null } : webhook));
      return { body: { data: stored.find((webhook) => webhook.id === 'wh_crm') } };
    },
    ...deliveries,
  });
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}>
      <OrgSettings section="webhooks" />
    </QueryClientProvider>,
  );
}

const calls = (method: string, path: string) => api!.calls.filter((call) => call.method === method && call.url.split('?')[0] === path);
const toastNamed = (title: string) => currentToasts().find((entry) => entry.title === title);
const noticeTitle = 'Das System hat diesen Webhook abgeschaltet';
/** The banner of a shut-down webhook (a status region has no name of its own: found by its title). */
const noticeOf = (scope: Pick<typeof screen, 'queryByText'> = screen) => (scope.queryByText(noticeTitle)?.closest('[role="status"]') ?? null) as HTMLElement | null;
const rows = () => within(screen.getByRole('list', { name: 'Zustellungen' })).getAllByRole('listitem');

afterEach(() => {
  api?.restore();
  api = undefined;
  inertia.url = '/settings/webhooks?deliveries=wh_1';
  act(() => resetToasts());
});

describe('formatDuration', () => {
  it('says milliseconds below a second and seconds above, in the language of the page', () => {
    expect(formatDuration(142)).toBe('142 ms');
    expect(formatDuration(1500)).toBe('1,5 s');
    expect(formatDuration(10000)).toBe('10 s');
  });
});

describe('WebhookDeliveries', () => {
  it('lists the attempts newest first with event, time, attempt, status, duration and the answer', async () => {
    renderLog();

    expect(await screen.findByRole('heading', { level: 2, name: 'Zustellungen von Deploy-Bot' })).toBeTruthy();
    expect(screen.getByText('https://deploy.feldwerk.example.com/hooks/werkbuch').getAttribute('translate')).toBe('no');
    expect(document.title).toBe('Zustellungen von Deploy-Bot – Webhooks – Einstellungen – werkbuch');
    expect(screen.getByRole('link', { name: 'Alle Webhooks' }).getAttribute('href')).toBe('/settings/webhooks');

    const [ok, failed, none] = await waitFor(() => {
      const found = rows();
      expect(found).toHaveLength(3);
      return found;
    });
    expect(within(ok).getByText('Status geändert')).toBeTruthy();
    expect(within(ok).getByText('work_item.state_changed').getAttribute('translate')).toBe('no');
    expect(within(ok).getByText('27.10.2026, 16:20')).toBeTruthy();
    expect(within(ok).getByText('Versuch 1')).toBeTruthy();
    expect(within(ok).getByText('200')).toBeTruthy();
    expect(within(ok).getByText('142 ms')).toBeTruthy();
    expect(within(ok).getByText('{"ok":true}')).toBeTruthy();
    expect(within(failed).getByText('500')).toBeTruthy();
    expect(within(failed).getByText('Versuch 2')).toBeTruthy();
    expect(within(failed).getByText('1,5 s')).toBeTruthy();
    expect(within(none).getByText('Keine Antwort')).toBeTruthy();
    expect(within(none).getByText('Zeitüberschreitung')).toBeTruthy();
  });

  it('names every "Erneut senden" by its event and attempt, and gives a test ping none', async () => {
    renderLog({}, [makeDelivery({ id: 'at_p', delivery_id: 'dl_p', kind: 'ping', event: 'ping' }), second]);

    await waitFor(() => expect(rows()).toHaveLength(2));
    const buttons = screen.getAllByRole('button', { name: /^Erneut senden/ });
    expect(buttons.map((button) => button.getAttribute('aria-label'))).toEqual(['Erneut senden (Kommentar geschrieben, Versuch 2)']);
    const [ping] = rows();
    expect(within(ping).getByText('Test-Ping')).toBeTruthy();
    expect(within(ping).getByText('Ein Test-Ping lässt sich nicht erneut senden. Sende einen neuen.')).toBeTruthy();
  });

  it('sends a test ping, tells what the receiver said, and shows the attempt on top', async () => {
    const user = userEvent.setup();
    let release: (() => void) | undefined;
    const held = new Promise<void>((resolve) => (release = resolve));
    renderLog();
    // the answer of the ping is held back until the test lets it go
    const send = globalThis.fetch;
    globalThis.fetch = async (input, init) => {
      if (String(input).endsWith('/webhooks/wh_1/ping')) await held;
      return send(input, init);
    };
    await waitFor(() => expect(rows()).toHaveLength(3));

    const button = screen.getByRole('button', { name: 'Test-Ping' });
    await user.click(button);
    // the button is busy until the answer is here (K17)
    await waitFor(() => expect(button.getAttribute('aria-busy')).toBe('true'));
    await user.click(button);
    release!();

    await waitFor(() => expect(toastNamed('Test-Ping an „Deploy-Bot“ angekommen')).toBeDefined());
    expect(toastNamed('Test-Ping an „Deploy-Bot“ angekommen')?.description).toBe('Antwort 200 nach 87 ms.');
    expect(calls('POST', '/api/v1/webhooks/wh_1/ping')).toHaveLength(1);
  });

  it('puts the attempt of a send-again on top and says when the receiver refused', async () => {
    const user = userEvent.setup();
    renderLog();
    await waitFor(() => expect(rows()).toHaveLength(3));

    await user.click(screen.getByRole('button', { name: 'Erneut senden (Kommentar geschrieben, Versuch 2)' }));
    await waitFor(() => expect(toastNamed('Zustellung an „Deploy-Bot“ angekommen')).toBeDefined());
    expect(calls('POST', '/api/v1/webhooks/wh_1/deliveries/dl_2/redeliver')).toHaveLength(1);
    // the log is reloaded: the new attempt is the first row (the fake server pages four entries by two)
    await waitFor(() => expect(within(rows()[0]).getByText('Erneut gesendet')).toBeTruthy());
    expect(within(rows()[0]).getByText('Versuch 1')).toBeTruthy();
  });

  it('says failed with the code, or that there was no answer', async () => {
    const user = userEvent.setup();
    renderLog({
      'POST /api/v1/webhooks/wh_1/ping': () => ({ body: { data: makeDelivery({ kind: 'ping', event: 'ping', status_code: 502, duration_ms: 460 }) } }),
      'POST /api/v1/webhooks/wh_1/deliveries/dl_2/redeliver': () => ({ body: { data: makeDelivery({ status_code: null, duration_ms: 10000 }) } }),
    });
    await waitFor(() => expect(rows()).toHaveLength(3));

    await user.click(screen.getByRole('button', { name: 'Test-Ping' }));
    await waitFor(() => expect(toastNamed('Test-Ping an „Deploy-Bot“ fehlgeschlagen')).toBeDefined());
    expect(toastNamed('Test-Ping an „Deploy-Bot“ fehlgeschlagen')?.description).toBe('Antwort 502 nach 460 ms.');

    await user.click(screen.getByRole('button', { name: 'Erneut senden (Kommentar geschrieben, Versuch 2)' }));
    await waitFor(() => expect(toastNamed('Zustellung an „Deploy-Bot“ fehlgeschlagen')).toBeDefined());
    expect(toastNamed('Zustellung an „Deploy-Bot“ fehlgeschlagen')?.description).toBe('Keine Antwort nach 10 s.');
  });

  it('shows a refusal as a toast with the way to try again', async () => {
    const user = userEvent.setup();
    let refuse = true;
    renderLog({
      'POST /api/v1/webhooks/wh_1/ping': () => (refuse ? problem(503, 'service_unavailable', { detail: 'Der Server ist gerade nicht erreichbar.' }) : { body: { data: makeDelivery({ kind: 'ping', event: 'ping' }) } }),
    });
    await waitFor(() => expect(rows()).toHaveLength(3));

    await user.click(screen.getByRole('button', { name: 'Test-Ping' }));
    await waitFor(() => expect(toastNamed('Test-Ping nicht gesendet')).toBeDefined());
    expect(toastNamed('Test-Ping nicht gesendet')?.description).toBe('Der Server ist gerade nicht erreichbar.');
    refuse = false;
    act(() => toastNamed('Test-Ping nicht gesendet')!.action!.onClick());
    await waitFor(() => expect(toastNamed('Test-Ping an „Deploy-Bot“ angekommen')).toBeDefined());
  });

  it('offers no second try when the receiver was called but the attempt is not in the log (503 webhook_not_logged)', async () => {
    const user = userEvent.setup();
    const notLogged = () => problem(503, 'webhook_not_logged', { detail: 'Der Webhook wurde aufgerufen, der Versuch ließ sich aber nicht protokollieren.' });
    renderLog({ 'POST /api/v1/webhooks/wh_1/ping': notLogged, 'POST /api/v1/webhooks/wh_1/deliveries/dl_2/redeliver': notLogged });
    await waitFor(() => expect(rows()).toHaveLength(3));

    await user.click(screen.getByRole('button', { name: 'Test-Ping' }));
    await waitFor(() => expect(toastNamed('Test-Ping nicht gesendet')).toBeDefined());
    expect(toastNamed('Test-Ping nicht gesendet')?.description).toContain('nicht protokollieren');
    expect(toastNamed('Test-Ping nicht gesendet')?.action).toBeUndefined();

    await user.click(screen.getByRole('button', { name: 'Erneut senden (Kommentar geschrieben, Versuch 2)' }));
    await waitFor(() => expect(toastNamed('Zustellung nicht gesendet')).toBeDefined());
    expect(toastNamed('Zustellung nicht gesendet')?.action).toBeUndefined();
  });

  it('keeps every "Erneut senden" busy until its own answer is here, while another one runs', async () => {
    const user = userEvent.setup();
    const releases: Record<string, () => void> = {};
    const held: Record<string, Promise<void>> = {
      dl_1: new Promise<void>((resolve) => (releases.dl_1 = resolve)),
      dl_2: new Promise<void>((resolve) => (releases.dl_2 = resolve)),
    };
    renderLog({ 'POST /api/v1/webhooks/wh_1/deliveries/dl_1/redeliver': () => ({ body: { data: makeDelivery({ id: 'at_m1', delivery_id: 'dl_1', kind: 'manual' }) } }) });
    const send = globalThis.fetch;
    globalThis.fetch = async (input, init) => {
      const id = /deliveries\/(dl_\d)\/redeliver$/.exec(String(input))?.[1];
      if (id) await held[id];
      return send(input, init);
    };
    await waitFor(() => expect(rows()).toHaveLength(3));

    const a = screen.getByRole('button', { name: 'Erneut senden (Status geändert, Versuch 1)' });
    const b = screen.getByRole('button', { name: 'Erneut senden (Kommentar geschrieben, Versuch 2)' });
    await user.click(a);
    await waitFor(() => expect(a.getAttribute('aria-busy')).toBe('true'));
    await user.click(b);
    await waitFor(() => expect(b.getAttribute('aria-busy')).toBe('true'));
    // the first call still runs: its button stays busy and a second press sends nothing
    expect(a.getAttribute('aria-busy')).toBe('true');
    await user.click(a);

    releases.dl_2();
    await waitFor(() => expect(toastNamed('Zustellung an „Deploy-Bot“ angekommen')).toBeDefined());
    expect(a.isConnected).toBe(true);
    expect(a.getAttribute('aria-busy')).toBe('true');
    releases.dl_1();
    await waitFor(() => expect(a.getAttribute('aria-busy')).not.toBe('true'));
    expect(calls('POST', '/api/v1/webhooks/wh_1/deliveries/dl_1/redeliver')).toHaveLength(1);
    globalThis.fetch = send;
  });

  it('reads the reason of an attempt without an answer and shows the rest as its detail', async () => {
    const refused = makeDelivery({ id: 'at_r', delivery_id: 'dl_r', status_code: null, duration_ms: 0, response_excerpt: null, error: 'private_address: Webhook target hooks.example.com refused: private_address' });
    const slow = makeDelivery({ id: 'at_s', delivery_id: 'dl_s', status_code: null, duration_ms: 10000, response_excerpt: null, error: 'timeout: cURL error 28: Operation timed out after 10001 milliseconds' });
    const bot = makeDelivery({ id: 'at_b', delivery_id: 'dl_b', status_code: null, duration_ms: 0, response_excerpt: null, error: 'bot_access: Webhook target refused: bot_access' });
    renderLog({}, [refused, slow, bot]);

    const [first, second, third] = await waitFor(() => {
      const found = rows();
      expect(found).toHaveLength(3);
      return found;
    });
    expect(within(first).getByText('Die Adresse zeigt in ein privates oder gesperrtes Netz.')).toBeTruthy();
    const detail = within(first).getByText('Webhook target hooks.example.com refused: private_address');
    expect(detail.getAttribute('translate')).toBe('no');
    expect(within(first).queryByText(/^private_address:/)).toBeNull();
    expect(within(second).getByText('Der Empfänger hat nicht rechtzeitig geantwortet.')).toBeTruthy();
    expect(within(second).getByText('cURL error 28: Operation timed out after 10001 milliseconds')).toBeTruthy();
    expect(within(third).getByText('Der Bot dieses Webhooks sieht das Projekt nicht mehr.')).toBeTruthy();
  });

  it('says why a test ping got no answer', async () => {
    const user = userEvent.setup();
    renderLog({
      'POST /api/v1/webhooks/wh_1/ping': () => ({ body: { data: makeDelivery({ kind: 'ping', event: 'ping', status_code: null, duration_ms: 0, response_excerpt: null, error: 'private_address: Webhook target hooks.example.com refused: private_address' }) } }),
    });
    await waitFor(() => expect(rows()).toHaveLength(3));

    await user.click(screen.getByRole('button', { name: 'Test-Ping' }));
    await waitFor(() => expect(toastNamed('Test-Ping an „Deploy-Bot“ fehlgeschlagen')).toBeDefined());
    expect(toastNamed('Test-Ping an „Deploy-Bot“ fehlgeschlagen')?.description).toBe('Keine Antwort nach 0\u00a0ms. Die Adresse zeigt in ein privates oder gesperrtes Netz.');
  });

  it('rules the note off across the whole log, not at the measure of its text (13c)', async () => {
    renderLog();
    const note = await screen.findByText(/Jeder Versuch wird 30 Tage aufbewahrt/);
    expect(note.className).toMatch(/max-w-\[65ch\]/);
    const ruled = note.closest('.border-b') as HTMLElement | null;
    expect(ruled).not.toBeNull();
    expect(ruled!.className).not.toMatch(/max-w-/);
  });

  it('says why a delivery could not be sent again', async () => {
    const user = userEvent.setup();
    renderLog({ 'POST /api/v1/webhooks/wh_1/deliveries/dl_2/redeliver': () => problem(409, 'bot_access', { detail: 'Der Bot sieht dieses Ereignis nicht mehr.' }) });
    await waitFor(() => expect(rows()).toHaveLength(3));

    await user.click(screen.getByRole('button', { name: 'Erneut senden (Kommentar geschrieben, Versuch 2)' }));
    await waitFor(() => expect(toastNamed('Zustellung nicht gesendet')).toBeDefined());
    expect(toastNamed('Zustellung nicht gesendet')?.description).toBe('Der Bot sieht dieses Ereignis nicht mehr.');
  });

  it('loads more attempts page by page', async () => {
    const user = userEvent.setup();
    const many = [first, second, timeout, makeDelivery({ id: 'at_4', delivery_id: 'dl_4', attempt: 3 })];
    renderLog({}, many);
    await waitFor(() => expect(rows()).toHaveLength(2));

    await user.click(screen.getByRole('button', { name: 'Mehr laden' }));
    await waitFor(() => expect(rows()).toHaveLength(4));
    expect(screen.queryByRole('button', { name: 'Mehr laden' })).toBeNull();
    expect(calls('GET', '/api/v1/webhooks/wh_1/deliveries').map((call) => call.url)).toEqual(['/api/v1/webhooks/wh_1/deliveries', '/api/v1/webhooks/wh_1/deliveries?cursor=c2']);
  });

  it('offers a test ping in the empty log and gives the focus to the log when the empty state goes', async () => {
    const user = userEvent.setup();
    renderLog({}, [], demoWebhooks);

    expect(await screen.findByText('Noch keine Zustellungen')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Test-Ping senden' }));
    await waitFor(() => expect(toastNamed('Test-Ping an „Deploy-Bot“ angekommen')).toBeDefined());
    expect(await screen.findByRole('list', { name: 'Zustellungen' })).toBeTruthy();
    const heading = screen.getByRole('heading', { level: 2, name: 'Zustellungen von Deploy-Bot' });
    await waitFor(() => expect(document.activeElement).toBe(heading));
  });

  it('shares one test ping between the header and the empty log', async () => {
    const user = userEvent.setup();
    let release: (() => void) | undefined;
    const held = new Promise<void>((resolve) => (release = resolve));
    renderLog({}, [], demoWebhooks);
    const send = globalThis.fetch;
    globalThis.fetch = async (input, init) => {
      if (String(input).endsWith('/webhooks/wh_1/ping')) await held;
      return send(input, init);
    };

    await user.click(await screen.findByRole('button', { name: 'Test-Ping senden' }));
    const header = screen.getByRole('button', { name: 'Test-Ping' });
    await waitFor(() => expect(header.getAttribute('aria-busy')).toBe('true'));
    await user.click(header);
    release!();
    await waitFor(() => expect(toastNamed('Test-Ping an „Deploy-Bot“ angekommen')).toBeDefined());
    expect(calls('POST', '/api/v1/webhooks/wh_1/ping')).toHaveLength(1);
    globalThis.fetch = send;
  });

  it('says an unknown webhook does not exist and leads back to the list', async () => {
    renderLog({ 'GET /api/v1/webhooks/wh_gone/deliveries': () => problem(404, 'not_found') }, [], demoWebhooks, '/settings/webhooks?deliveries=wh_gone');

    expect(await screen.findByText('Diesen Webhook gibt es nicht')).toBeTruthy();
    const links = screen.getAllByRole('link', { name: 'Alle Webhooks' });
    expect(links.every((link) => link.getAttribute('href') === '/settings/webhooks')).toBe(true);
    expect(screen.queryByRole('button', { name: 'Test-Ping' })).toBeNull();
    expect(calls('GET', '/api/v1/webhooks/wh_gone/deliveries')).toHaveLength(0);
  });

  it('says when the log could not be loaded, and loads it again', async () => {
    const user = userEvent.setup();
    let failing = true;
    renderLog({ 'GET /api/v1/webhooks/wh_1/deliveries': () => (failing ? problem(503, 'service_unavailable') : { body: list([first]) }) });

    expect(await screen.findByText('Das Zustellprotokoll konnte nicht geladen werden')).toBeTruthy();
    failing = false;
    await user.click(screen.getByRole('button', { name: 'Erneut versuchen' }));
    await waitFor(() => expect(rows()).toHaveLength(1));
  });

  it('shows the notice of a shut-down webhook and takes it away with "Wieder aktivieren"', async () => {
    const user = userEvent.setup();
    renderLog({}, [], demoWebhooks, '/settings/webhooks?deliveries=wh_crm');

    await screen.findByText(noticeTitle);
    const notice = noticeOf()!;
    expect(within(notice).getByText(/Seit 24 Stunden kam keine erfolgreiche Zustellung an/)).toBeTruthy();
    await user.click(within(notice).getByRole('button', { name: 'Wieder aktivieren' }));

    await waitFor(() => expect(toastNamed('Webhook „Altes CRM“ ist wieder aktiv')).toBeDefined());
    expect(calls('PUT', '/api/v1/webhooks/wh_crm')[0].body).toEqual({ name: 'Altes CRM', url: crm.url, project_id: 'p_app', events: crm.events, bot_id: null, active: true });
    await waitFor(() => expect(noticeOf()).toBeNull());
    // the button went with the notice: the focus goes to the heading of the log, not to the page
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('heading', { level: 2, name: 'Zustellungen von Altes CRM' })));
  });

  it('shows no notice for a webhook somebody switched off', async () => {
    renderLog({}, [first], [makeWebhook({ active: false })]);

    await waitFor(() => expect(rows()).toHaveLength(1));
    expect(noticeOf()).toBeNull();
  });

  it('keeps the notice and says so when turning it on fails', async () => {
    const user = userEvent.setup();
    renderLog({ 'PUT /api/v1/webhooks/wh_crm': () => problem(503, 'service_unavailable', { detail: 'Der Server ist gerade nicht erreichbar.' }) }, [], demoWebhooks, '/settings/webhooks?deliveries=wh_crm');

    await user.click(await screen.findByRole('button', { name: 'Wieder aktivieren' }));
    await waitFor(() => expect(toastNamed('Webhook „Altes CRM“ nicht aktiviert')).toBeDefined());
    expect(screen.getByRole('button', { name: 'Wieder aktivieren' })).toBeTruthy();
  });
});

describe('WebhookCard', () => {
  it('pings from the card and shows the notice of a shut-down webhook there too', async () => {
    const user = userEvent.setup();
    renderLog({}, [], demoWebhooks, '/settings/webhooks');

    const deploy = await screen.findByRole('article', { name: 'Deploy-Bot' });
    await user.click(within(deploy).getByRole('button', { name: 'Test-Ping an Deploy-Bot senden' }));
    await waitFor(() => expect(toastNamed('Test-Ping an „Deploy-Bot“ angekommen')).toBeDefined());

    const old = await screen.findByRole('article', { name: 'Altes CRM' });
    expect(noticeOf(within(old))).toBeTruthy();
    await user.click(within(old).getByRole('button', { name: 'Wieder aktivieren' }));
    await waitFor(() => expect(toastNamed('Webhook „Altes CRM“ ist wieder aktiv')).toBeDefined());
    await waitFor(() => expect(within(old).queryByRole('status')).toBeNull());
    // the button went with the notice: the focus goes to the name of the card, not to the page
    await waitFor(() => expect(document.activeElement).toBe(within(old).getByRole('heading', { level: 3, name: 'Altes CRM' })));
  });
});
