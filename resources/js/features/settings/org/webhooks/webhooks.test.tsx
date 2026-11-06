/*
 * Settings → Webhooks (spec 6.3, org admins) against a small fake server (`mockApi`): the cards with their state, the
 * form with the event tree, the secret shown once (Escape asks, the dialog keeps nothing afterwards), a new secret that
 * leaves the open form as it was typed (13c), the refusals of the server, removing with undo, members and loading. The
 * flows with the keyboard against a real server run in e2e/tests/webhooks.spec.ts.
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode, Ref } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { WebhookInput } from '@/api/webhooks';
import { currentToasts, dismissToast, resetToasts, runToastAction } from '@/components/ui/toast';
import { useShortcut } from '@/lib/shortcuts/useShortcut';
import { canUndo, undoLatest } from '@/lib/undo';
import { mockApi, type MockApi, type MockRoute } from '@/test/api';
import { demoWebhooks, lene, list, makeWebhook, mara, organization, person, project } from '@/test/fixtures';
import type { User, Webhook } from '@/types';
import { OrgSettings } from '../OrgSettings';

let signedIn: User = mara;
const inertia = vi.hoisted(() => ({ url: '/settings/webhooks' }));

vi.mock('@inertiajs/react', () => ({
  usePage: () => ({ props: { auth: { user: signedIn, permissions: [] }, organization }, url: inertia.url }),
  Link: ({ href, children, ref, ...rest }: { href: string; children: ReactNode; ref?: Ref<HTMLAnchorElement> }) => (
    <a href={href} ref={ref} {...rest}>
      {children}
    </a>
  ),
  router: { reload: vi.fn(), visit: vi.fn(), on: () => () => {} },
}));

/* -------------------------------------------------------------------------- data */

const kira: User = { ...person('u_kira', 'Kira', 'kira'), type: 'bot', email: null, owner_id: 'u_mara' };
const rex: User = { ...person('u_rex', 'Rex', 'rex'), type: 'bot', email: null, disabled_at: '2026-10-01T10:00:00.000Z' };
const web = project('WEB', 'admin', { name: 'Website-Relaunch' });
const app = project('APP', 'admin', { name: 'Kunden-App' });

const problem = (status: number, reason: string, extra: Record<string, unknown> = {}) => ({ status, body: { type: 'about:blank', title: reason, status, reason, ...extra } });
const invalid = (errors: Record<string, string[]>) => problem(422, 'validation_failed', { detail: 'Die Eingaben sind nicht gültig.', errors });
const unavailable = () => problem(503, 'service_unavailable', { detail: 'Der Server ist gerade nicht erreichbar.' });

/* ---------------------------------------------------------------------- the server */

let api: MockApi | undefined;
let client: QueryClient;
let stored: Webhook[] = [];
let secrets = 0;

function renderWebhooks(overrides: Record<string, MockRoute> = {}, webhooks: Webhook[] = demoWebhooks) {
  stored = [...webhooks];
  secrets = 0;
  const save = (body: unknown, id: string): Webhook => {
    const input = body as Omit<WebhookInput, 'id'>;
    const before = stored.find((webhook) => webhook.id === id);
    const saved = makeWebhook({ ...before, ...input, id, disabled_at: input.active ? null : (before?.disabled_at ?? null) });
    stored = before ? stored.map((webhook) => (webhook.id === id ? saved : webhook)) : [...stored, saved];
    return saved;
  };
  api = mockApi({
    'GET /api/v1/projects': () => ({ body: list([web, app]) }),
    'GET /api/v1/organization': () => ({ body: { data: organization } }),
    'GET /api/v1/users': (_body, url) => ({ body: list([mara, lene, kira, rex].filter((user) => !url.searchParams.get('filter[type]') || user.type === url.searchParams.get('filter[type]'))) }),
    'GET /api/v1/webhooks': () => ({ body: list(stored) }),
    'POST /api/v1/webhooks': (body) => ({ status: 201, body: { data: save(body, 'wh_new'), secret: `whsec_neu_${++secrets}` } }),
    ...Object.fromEntries(
      stored.flatMap((webhook) => [
        [`PUT /api/v1/webhooks/${webhook.id}`, (body: unknown) => ({ body: { data: save(body, webhook.id) } })],
        [`POST /api/v1/webhooks/${webhook.id}/rotate-secret`, () => ({ body: { data: webhook, secret: `whsec_erneuert_${++secrets}` } })],
        [
          `DELETE /api/v1/webhooks/${webhook.id}`,
          () => {
            stored = stored.filter((entry) => entry.id !== webhook.id);
            return { status: 204 };
          },
        ],
      ]),
    ),
    ...overrides,
  });
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <Undo />
      <OrgSettings section="webhooks" />
    </QueryClientProvider>,
  );
}

/** ⌘Z of the shell. */
function Undo() {
  useShortcut('shell.undo', () => undoLatest(), { when: canUndo });
  return null;
}

const calls = (method: string, path: string) => api!.calls.filter((call) => call.method === method && call.url === path);
const cardOf = (name: string) => screen.findByRole('article', { name });
const toastNamed = (title: string) => currentToasts().find((entry) => entry.title === title);
/** Everything the mutations of the page still hold: a secret must not stay there after it was shown (gcTime 0, reset). */
/** The names of the open list's options, without their decorative icons. */
const optionNames = async () =>
  (await screen.findAllByRole('option')).map((option) =>
    [...option.childNodes]
      .filter((node) => !(node instanceof Element && node.getAttribute('aria-hidden') === 'true'))
      .map((node) => node.textContent)
      .join(''),
  );
const mutationData = () => JSON.stringify(client.getMutationCache().getAll().map((mutation) => mutation.state.data ?? null));

afterEach(() => {
  api?.restore();
  api = undefined;
  signedIn = mara;
  inertia.url = '/settings/webhooks';
  act(() => resetToasts());
});

/* -------------------------------------------------------------------------- tests */

describe('Webhooks', () => {
  it('sits in the group "Betrieb" before System', async () => {
    renderWebhooks();

    const nav = screen.getByRole('navigation', { name: 'Bereiche der Einstellungen' });
    const links = within(nav).getAllByRole('link').map((link) => link.textContent);
    expect(links.indexOf('Webhooks')).toBe(links.indexOf('System') - 1);
    expect(within(nav).getByRole('link', { name: 'Webhooks' }).getAttribute('href')).toBe('/settings/webhooks');
    expect(await screen.findByRole('heading', { level: 2, name: 'Webhooks' })).toBeTruthy();
    expect(document.title).toBe('Webhooks – Einstellungen – werkbuch');
  });

  it('shows each webhook with its state, address, scope, events, bot and day', async () => {
    renderWebhooks({}, [...demoWebhooks, makeWebhook({ id: 'wh_off', name: 'Pausiert', active: false, project_id: 'p_gone', events: ['project.*', 'work_item.created', 'comment.*', 'page.moved', 'bot.assigned'] })]);

    const deploy = await cardOf('Deploy-Bot');
    expect(within(deploy).getByText('Aktiv')).toBeTruthy();
    expect(within(deploy).getByText('https://deploy.feldwerk.example.com/hooks/werkbuch').getAttribute('translate')).toBe('no');
    expect(within(deploy).getByText('Gesamte Organisation')).toBeTruthy();
    expect(within(deploy).getByText('Status geändert')).toBeTruthy();
    expect(within(deploy).getByText('02.10.2026, 10:30')).toBeTruthy();
    expect(within(deploy).queryByText('Nur für Bot')).toBeNull();
    expect(within(deploy).getByRole('link', { name: 'Zustellungen von Deploy-Bot' }).getAttribute('href')).toBe('/settings/webhooks?deliveries=wh_1');

    const bot = await cardOf('Kira');
    expect(within(bot).getByText('Alle Bots')).toBeTruthy();
    expect(within(bot).getByText('Nur für Bot').nextElementSibling?.textContent).toBe('Kira');

    const crm = await cardOf('Altes CRM');
    expect(within(crm).getByText('Abgeschaltet')).toBeTruthy();
    expect(within(crm).getByText('APP Kunden-App')).toBeTruthy();

    const paused = await cardOf('Pausiert');
    expect(within(paused).getByText('Aus')).toBeTruthy();
    // a project the list does not know (any more)
    expect(within(paused).getByText('Ein Projekt')).toBeTruthy();
    // three events, then how many more
    const events = within(paused).getByRole('list', { name: 'Ereignisse' });
    expect(within(events).getAllByRole('listitem').map((item) => item.textContent)).toEqual(['Alle Projekte', 'Item angelegt', 'Alle Kommentare', '+2 weitere']);
  });

  it('creates a webhook with the keyboard, shows its secret once and keeps it nowhere afterwards', async () => {
    const user = userEvent.setup();
    const writeText = vi.spyOn(navigator.clipboard, 'writeText');
    renderWebhooks();
    await cardOf('Deploy-Bot');

    screen.getByRole('button', { name: 'Webhook anlegen' }).focus();
    await user.keyboard('{Enter}');
    const form = await screen.findByRole('dialog', { name: 'Webhook anlegen' });
    const name = within(form).getByRole('textbox', { name: 'Name' });
    await waitFor(() => expect(document.activeElement).toBe(name));
    await user.keyboard('Chat-Hinweise');
    await user.tab();
    await user.keyboard('https://chat.example.com/hooks/werkbuch');
    const comments = within(form).getByRole('checkbox', { name: /^Kommentare/ });
    while (document.activeElement !== comments) await user.tab();
    await user.keyboard(' ');
    expect(within(form).getByText('3 Ereignisse gewählt.')).toBeTruthy();
    // two presses in one go are one intent: one request
    await user.keyboard('{Control>}{Enter}{Enter}{/Control}');

    const result = await screen.findByRole('dialog', { name: 'Webhook ist angelegt' });
    expect(calls('POST', '/api/v1/webhooks')).toHaveLength(1);
    expect(calls('POST', '/api/v1/webhooks')[0].body).toEqual({ name: 'Chat-Hinweise', url: 'https://chat.example.com/hooks/werkbuch', project_id: null, events: ['comment.*'], bot_id: null, active: true });
    const field = within(result).getByRole<HTMLInputElement>('textbox', { name: 'Geheimnis' });
    expect(field.value).toBe('whsec_neu_1');
    expect(field.name).toBe('webhook_secret');
    expect(within(result).getByText('Kopiere das Geheimnis jetzt')).toBeTruthy();
    // the screen holds the secret in its own state only: the answer of the call is gone from the mutations
    await waitFor(() => expect(mutationData()).not.toContain('whsec_neu_1'));

    await user.click(within(result).getByRole('button', { name: 'Geheimnis kopieren' }));
    expect(writeText).toHaveBeenCalledWith('whsec_neu_1');

    // Escape does not close it; it asks first, and "Zurück" keeps it
    await user.keyboard('{Escape}');
    const question = await screen.findByRole('alertdialog', { name: 'Ohne Kopie schließen?' });
    await user.click(within(question).getByRole('button', { name: 'Zurück' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(screen.getByRole('dialog', { name: 'Webhook ist angelegt' })).toBeTruthy();

    await user.click(within(result).getByRole('button', { name: 'Fertig' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(await cardOf('Chat-Hinweise')).toBeTruthy();
    expect(document.body.innerHTML).not.toContain('whsec_neu_1');
    expect(mutationData()).not.toContain('whsec_neu_1');
  });

  it('closes the secret after Escape once the question is answered', async () => {
    const user = userEvent.setup();
    renderWebhooks();
    await user.click(await screen.findByRole('button', { name: 'Webhook anlegen' }));
    const form = await screen.findByRole('dialog', { name: 'Webhook anlegen' });
    await user.type(within(form).getByRole('textbox', { name: 'Name' }), 'Chat');
    await user.type(within(form).getByRole('textbox', { name: 'URL' }), 'https://chat.example.com/hook');
    await user.click(within(form).getByRole('checkbox', { name: /^Bots/ }));
    await user.click(within(form).getByRole('button', { name: 'Anlegen' }));
    const result = await screen.findByRole('dialog', { name: 'Webhook ist angelegt' });

    await user.keyboard('{Escape}');
    await user.click(within(await screen.findByRole('alertdialog', { name: 'Ohne Kopie schließen?' })).getByRole('button', { name: 'Schließen' }));
    await waitFor(() => expect(result.isConnected).toBe(false));
    expect(document.body.innerHTML).not.toContain('whsec_neu');
  });

  it('says what is missing before it sends, and puts the focus there', async () => {
    const user = userEvent.setup();
    renderWebhooks();
    await user.click(await screen.findByRole('button', { name: 'Webhook anlegen' }));
    const form = await screen.findByRole('dialog', { name: 'Webhook anlegen' });

    await user.click(within(form).getByRole('button', { name: 'Anlegen' }));
    expect(within(form).getByText('Gib dem Webhook einen Namen.')).toBeTruthy();
    expect(within(form).getByText('Gib die Adresse ein, an die werkbuch sendet.')).toBeTruthy();
    expect(within(form).getByText('Wähle mindestens ein Ereignis.')).toBeTruthy();
    expect(document.activeElement).toBe(within(form).getByRole('textbox', { name: 'Name' }));

    await user.type(within(form).getByRole('textbox', { name: 'Name' }), 'Chat');
    await user.click(within(form).getByRole('button', { name: 'Anlegen' }));
    expect(document.activeElement).toBe(within(form).getByRole('textbox', { name: 'URL' }));
    await user.type(within(form).getByRole('textbox', { name: 'URL' }), 'https://chat.example.com/hook');
    await user.click(within(form).getByRole('button', { name: 'Anlegen' }));
    expect(document.activeElement).toBe(within(form).getByRole('checkbox', { name: /^Projekte/ }));
    expect(calls('POST', '/api/v1/webhooks')).toHaveLength(0);
  });

  it('shows a refused address next to the URL field and moves the focus there', async () => {
    const user = userEvent.setup();
    renderWebhooks({ 'POST /api/v1/webhooks': () => invalid({ url: ['Ziele in privaten Netzen sind gesperrt.'], bot_id: ['Das ist kein aktiver Bot.'], extra: ['Etwas anderes stimmt nicht.'] }) });
    await user.click(await screen.findByRole('button', { name: 'Webhook anlegen' }));
    const form = await screen.findByRole('dialog', { name: 'Webhook anlegen' });
    await user.type(within(form).getByRole('textbox', { name: 'Name' }), 'Lokal');
    await user.type(within(form).getByRole('textbox', { name: 'URL' }), 'http://localhost:3000/hook');
    await user.click(within(form).getByRole('checkbox', { name: /^Bots/ }));
    await user.click(within(form).getByRole('button', { name: 'Anlegen' }));

    const url = within(form).getByRole('textbox', { name: 'URL' });
    expect(await within(form).findByText('Ziele in privaten Netzen sind gesperrt.')).toBeTruthy();
    expect(url.getAttribute('aria-invalid')).toBe('true');
    await waitFor(() => expect(document.activeElement).toBe(url));
    expect(within(form).getByText('Das ist kein aktiver Bot.')).toBeTruthy();
    // a path without a field of its own stands on top
    expect(within(form).getByText('Etwas anderes stimmt nicht.')).toBeTruthy();
    expect(screen.queryByRole('dialog', { name: 'Webhook ist angelegt' })).toBeNull();
  });

  it('shows another refusal on top of the form and a failed server as a toast to try again', async () => {
    const user = userEvent.setup();
    let answer: () => ReturnType<MockRoute> = () => problem(403, 'forbidden', { detail: 'Webhooks verwalten nur Org-Admins.' });
    renderWebhooks({ 'POST /api/v1/webhooks': () => answer() });
    await user.click(await screen.findByRole('button', { name: 'Webhook anlegen' }));
    const form = await screen.findByRole('dialog', { name: 'Webhook anlegen' });
    await user.type(within(form).getByRole('textbox', { name: 'Name' }), 'Chat');
    await user.type(within(form).getByRole('textbox', { name: 'URL' }), 'https://chat.example.com/hook');
    await user.click(within(form).getByRole('checkbox', { name: /^Bots/ }));
    await user.click(within(form).getByRole('button', { name: 'Anlegen' }));
    expect(await within(form).findByText('Webhooks verwalten nur Org-Admins.')).toBeTruthy();

    answer = unavailable;
    await user.click(within(form).getByRole('button', { name: 'Anlegen' }));
    await waitFor(() => expect(toastNamed('Webhook nicht gespeichert')?.description).toBe('Der Server ist gerade nicht erreichbar.'));
    expect(within(form).queryByText('Der Server ist gerade nicht erreichbar.')).toBeNull();

    answer = () => ({ status: 201, body: { data: makeWebhook({ id: 'wh_new', name: 'Chat' }), secret: 'whsec_spaet' } });
    act(() => runToastAction(toastNamed('Webhook nicht gespeichert')!.id));
    expect(await screen.findByRole('dialog', { name: 'Webhook ist angelegt' })).toBeTruthy();
    expect(calls('POST', '/api/v1/webhooks')).toHaveLength(3);
  });

  it('saves a change without a secret and the scope of a project with a bot', async () => {
    const user = userEvent.setup();
    renderWebhooks();
    await user.click(within(await cardOf('Kira')).getByRole('button', { name: 'Webhook „Kira“ bearbeiten' }));
    const form = await screen.findByRole('dialog', { name: 'Webhook „Kira“ bearbeiten' });
    // a stored group is ticked as a whole, the other groups are closed
    expect(within(form).getByRole<HTMLInputElement>('checkbox', { name: /^Bots/ }).getAttribute('aria-checked')).toBe('true');

    await user.clear(within(form).getByRole('textbox', { name: 'Name' }));
    await user.type(within(form).getByRole('textbox', { name: 'Name' }), 'Kira-Agent');
    await user.click(within(form).getByRole('combobox', { name: /^Geltungsbereich/ }));
    await user.click(await screen.findByRole('option', { name: 'WEB Website-Relaunch' }));
    await user.click(within(form).getByRole('switch', { name: 'Aktiv' }));
    await user.click(within(form).getByRole('button', { name: 'Speichern' }));

    await waitFor(() => expect(toastNamed('Webhook „Kira-Agent“ gespeichert')).toBeDefined());
    expect(calls('PUT', '/api/v1/webhooks/wh_kira')[0].body).toEqual({ name: 'Kira-Agent', url: 'https://kira.feldwerk.example.com/werkbuch/webhook', project_id: 'p_web', events: ['bot.*'], bot_id: 'u_kira', active: false });
    expect(screen.queryByRole('dialog', { name: /Geheimnis|angelegt/ })).toBeNull();
    expect(within(await cardOf('Kira-Agent')).getByText('Aus')).toBeTruthy();
  });

  it('warns that a project webhook without a bot reads like an org admin (K10)', async () => {
    const user = userEvent.setup();
    renderWebhooks();
    await user.click(await screen.findByRole('button', { name: 'Webhook anlegen' }));
    const form = await screen.findByRole('dialog', { name: 'Webhook anlegen' });
    const warning = /wie ein Org-Admin/;
    expect(within(form).queryByText(warning)).toBeNull();

    await user.click(within(form).getByRole('combobox', { name: /^Geltungsbereich/ }));
    // the organisation comes first, then the projects
    expect(await optionNames()).toEqual(['Gesamte Organisation', 'WEB Website-Relaunch', 'APP Kunden-App']);
    await user.click(screen.getByRole('option', { name: 'APP Kunden-App' }));
    expect(within(form).getByText(warning)).toBeTruthy();

    // only active bots, and none to begin with
    await user.click(within(form).getByRole('combobox', { name: /^Nur für einen Bot/ }));
    expect(await optionNames()).toEqual(['Alle', 'Kira']);
    await user.click(screen.getByRole('option', { name: 'Kira' }));
    expect(within(form).queryByText(warning)).toBeNull();
  });

  it('makes a new secret and leaves the open form as it was typed (13c)', async () => {
    const user = userEvent.setup();
    renderWebhooks();
    await user.click(within(await cardOf('Deploy-Bot')).getByRole('button', { name: 'Webhook „Deploy-Bot“ bearbeiten' }));
    const form = await screen.findByRole('dialog', { name: 'Webhook „Deploy-Bot“ bearbeiten' });
    await user.type(within(form).getByRole('textbox', { name: 'Name' }), ' neu');

    // "Abbrechen" asks nothing of the server
    await user.click(within(form).getByRole('button', { name: 'Neues Geheimnis erzeugen' }));
    await user.click(within(await screen.findByRole('alertdialog', { name: 'Neues Geheimnis erzeugen?' })).getByRole('button', { name: 'Abbrechen' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(calls('POST', '/api/v1/webhooks/wh_1/rotate-secret')).toHaveLength(0);

    await user.click(within(form).getByRole('button', { name: 'Neues Geheimnis erzeugen' }));
    const question = await screen.findByRole('alertdialog', { name: 'Neues Geheimnis erzeugen?' });
    await user.click(within(question).getByRole('button', { name: 'Neues Geheimnis erzeugen' }));

    const result = await screen.findByRole('dialog', { name: 'Neues Geheimnis ist erzeugt' });
    expect(within(result).getByRole<HTMLInputElement>('textbox', { name: 'Geheimnis' }).value).toBe('whsec_erneuert_1');
    expect(calls('POST', '/api/v1/webhooks/wh_1/rotate-secret')).toHaveLength(1);
    expect(calls('PUT', '/api/v1/webhooks/wh_1')).toHaveLength(0);
    await waitFor(() => expect(mutationData()).not.toContain('whsec_erneuert_1'));
    // ⌘↵ over the secret sends nothing
    await user.keyboard('{Control>}{Enter}{/Control}');
    expect(calls('PUT', '/api/v1/webhooks/wh_1')).toHaveLength(0);

    await user.click(within(result).getByRole('button', { name: 'Fertig' }));
    await waitFor(() => expect(result.isConnected).toBe(false));
    expect(screen.getByRole('dialog', { name: 'Webhook „Deploy-Bot“ bearbeiten' })).toBe(form);
    expect(within(form).getByRole<HTMLInputElement>('textbox', { name: 'Name' }).value).toBe('Deploy-Bot neu');
    expect(document.body.innerHTML).not.toContain('whsec_erneuert_1');
  });

  it('says when a new secret could not be made, and tries again', async () => {
    const user = userEvent.setup();
    let fail = true;
    renderWebhooks({ 'POST /api/v1/webhooks/wh_1/rotate-secret': () => (fail ? unavailable() : { body: { data: demoWebhooks[0], secret: 'whsec_zweiter' } }) });
    await user.click(within(await cardOf('Deploy-Bot')).getByRole('button', { name: 'Webhook „Deploy-Bot“ bearbeiten' }));
    const form = await screen.findByRole('dialog', { name: 'Webhook „Deploy-Bot“ bearbeiten' });
    await user.click(within(form).getByRole('button', { name: 'Neues Geheimnis erzeugen' }));
    await user.click(within(await screen.findByRole('alertdialog', { name: 'Neues Geheimnis erzeugen?' })).getByRole('button', { name: 'Neues Geheimnis erzeugen' }));

    await waitFor(() => expect(toastNamed('Geheimnis nicht erneuert')).toBeDefined());
    fail = false;
    act(() => runToastAction(toastNamed('Geheimnis nicht erneuert')!.id));
    expect(within(await screen.findByRole('dialog', { name: 'Neues Geheimnis ist erzeugt' })).getByRole<HTMLInputElement>('textbox', { name: 'Geheimnis' }).value).toBe('whsec_zweiter');
  });

  it('removes a webhook at once and brings it back with ⌘Z, or deletes it when the toast runs out', async () => {
    const user = userEvent.setup();
    renderWebhooks();
    await user.click(within(await cardOf('Deploy-Bot')).getByRole('button', { name: 'Webhook „Deploy-Bot“ löschen' }));
    expect(screen.queryByRole('article', { name: 'Deploy-Bot' })).toBeNull();
    expect(toastNamed('Webhook „Deploy-Bot“ gelöscht')).toBeDefined();

    await user.keyboard('{Control>}z{/Control}');
    expect(await cardOf('Deploy-Bot')).toBeTruthy();
    expect(calls('DELETE', '/api/v1/webhooks/wh_1')).toHaveLength(0);

    await user.click(within(await cardOf('Deploy-Bot')).getByRole('button', { name: 'Webhook „Deploy-Bot“ löschen' }));
    act(() => dismissToast(toastNamed('Webhook „Deploy-Bot“ gelöscht')!.id));
    await waitFor(() => expect(calls('DELETE', '/api/v1/webhooks/wh_1')).toHaveLength(1));
    await waitFor(() => expect(screen.queryByRole('article', { name: 'Deploy-Bot' })).toBeNull());
  });

  it('offers the first webhook in the empty state', async () => {
    const user = userEvent.setup();
    renderWebhooks({}, []);
    expect(await screen.findByText('Noch kein Webhook')).toBeTruthy();
    const buttons = screen.getAllByRole('button', { name: 'Webhook anlegen' });
    await user.click(buttons[buttons.length - 1]);
    expect(await screen.findByRole('dialog', { name: 'Webhook anlegen' })).toBeTruthy();
  });

  it('says when the webhooks could not be loaded, and loads them again', async () => {
    const user = userEvent.setup();
    let fail = true;
    renderWebhooks({ 'GET /api/v1/webhooks': () => (fail ? unavailable() : { body: list(demoWebhooks) }) });
    expect(await screen.findByText('Die Webhooks konnten nicht geladen werden')).toBeTruthy();
    fail = false;
    await user.click(screen.getByRole('button', { name: 'Erneut versuchen' }));
    expect(await cardOf('Deploy-Bot')).toBeTruthy();
  });

  it('blocks members and loads nothing', async () => {
    signedIn = lene;
    renderWebhooks();

    expect(await screen.findByText('Nur für Admins')).toBeTruthy();
    expect(screen.getByText(/„Webhooks“/)).toBeTruthy();
    const nav = screen.getByRole('navigation', { name: 'Bereiche der Einstellungen' });
    expect(within(nav).getByRole('link', { name: /Webhooks/ }).textContent).toContain('nur für Admins');
    expect(calls('GET', '/api/v1/webhooks')).toEqual([]);
  });
});

describe('Webhooks: focus and retry (T13 findings)', () => {
  it('gives the focus to "Webhook anlegen" in the header after the first webhook of the empty state was made', async () => {
    const user = userEvent.setup();
    renderWebhooks({}, []);
    await screen.findByText('Noch kein Webhook');
    const buttons = screen.getAllByRole('button', { name: 'Webhook anlegen' });
    await user.click(buttons[buttons.length - 1]);
    const form = await screen.findByRole('dialog', { name: 'Webhook anlegen' });
    await user.type(within(form).getByRole('textbox', { name: 'Name' }), 'Chat');
    await user.type(within(form).getByRole('textbox', { name: 'URL' }), 'https://chat.example.com/hook');
    await user.click(within(form).getByRole('checkbox', { name: /^Bots/ }));
    await user.click(within(form).getByRole('button', { name: 'Anlegen' }));

    const result = await screen.findByRole('dialog', { name: 'Webhook ist angelegt' });
    await user.click(within(result).getByRole('button', { name: 'Fertig' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(screen.getAllByRole('button', { name: 'Webhook anlegen' })[0]));
  });

  it('gives the focus back to "Neues Geheimnis erzeugen" after the new secret, and to the opener after the form', async () => {
    const user = userEvent.setup();
    renderWebhooks();
    const edit = within(await cardOf('Deploy-Bot')).getByRole('button', { name: 'Webhook „Deploy-Bot“ bearbeiten' });
    await user.click(edit);
    const form = await screen.findByRole('dialog', { name: 'Webhook „Deploy-Bot“ bearbeiten' });
    await user.click(within(form).getByRole('button', { name: 'Neues Geheimnis erzeugen' }));
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Neues Geheimnis erzeugen' }));
    const result = await screen.findByRole('dialog', { name: 'Neues Geheimnis ist erzeugt' });
    await user.click(within(result).getByRole('button', { name: 'Fertig' }));
    await waitFor(() => expect(result.isConnected).toBe(false));
    await waitFor(() => expect(document.activeElement).toBe(within(form).getByRole('button', { name: 'Neues Geheimnis erzeugen' })));

    await user.click(within(form).getByRole('button', { name: 'Abbrechen' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(edit));
  });

  it('moves the focus to "Webhook anlegen" after the last webhook was removed', async () => {
    const user = userEvent.setup();
    renderWebhooks({}, [demoWebhooks[0]]);
    await user.click(within(await cardOf('Deploy-Bot')).getByRole('button', { name: 'Webhook „Deploy-Bot“ löschen' }));
    await screen.findByText('Noch kein Webhook');
    await waitFor(() => expect(document.activeElement).toBe(screen.getAllByRole('button', { name: 'Webhook anlegen' })[0]));
  });

  it('sends the form as it is by then when the toast says "Erneut versuchen"', async () => {
    const user = userEvent.setup();
    let answer: () => ReturnType<MockRoute> = unavailable;
    renderWebhooks({ 'POST /api/v1/webhooks': () => answer() });
    await user.click(await screen.findByRole('button', { name: 'Webhook anlegen' }));
    const form = await screen.findByRole('dialog', { name: 'Webhook anlegen' });
    await user.type(within(form).getByRole('textbox', { name: 'Name' }), 'Chat');
    await user.type(within(form).getByRole('textbox', { name: 'URL' }), 'https://chat.example.com/hook');
    await user.click(within(form).getByRole('checkbox', { name: /^Bots/ }));
    await user.click(within(form).getByRole('button', { name: 'Anlegen' }));
    await waitFor(() => expect(toastNamed('Webhook nicht gespeichert')).toBeDefined());

    await user.type(within(form).getByRole('textbox', { name: 'Name' }), ' neu');
    answer = () => ({ status: 201, body: { data: makeWebhook({ id: 'wh_new', name: 'Chat neu' }), secret: 'whsec_x' } });
    act(() => runToastAction(toastNamed('Webhook nicht gespeichert')!.id));
    await screen.findByRole('dialog', { name: 'Webhook ist angelegt' });
    expect((calls('POST', '/api/v1/webhooks')[1].body as WebhookInput).name).toBe('Chat neu');
  });

  it('shows a refusal of the switch in the notice on top of the form', async () => {
    const user = userEvent.setup();
    renderWebhooks({ 'PUT /api/v1/webhooks/wh_1': () => invalid({ active: ['Der Webhook lässt sich nicht aktivieren.'] }) });
    await user.click(within(await cardOf('Deploy-Bot')).getByRole('button', { name: 'Webhook „Deploy-Bot“ bearbeiten' }));
    const form = await screen.findByRole('dialog', { name: 'Webhook „Deploy-Bot“ bearbeiten' });
    await user.click(within(form).getByRole('button', { name: 'Speichern' }));
    expect(await within(form).findByText('Der Webhook lässt sich nicht aktivieren.')).toBeTruthy();
  });
});

describe('EventTree', () => {
  it('stores single events by name, a full group as its wildcard, and shows a mixed group open with a dash', async () => {
    const user = userEvent.setup();
    renderWebhooks();
    await user.click(within(await cardOf('Altes CRM')).getByRole('button', { name: 'Webhook „Altes CRM“ bearbeiten' }));
    const form = await screen.findByRole('dialog', { name: 'Webhook „Altes CRM“ bearbeiten' });

    // two of nine: the group shows the dash and starts open
    const items = within(form).getByRole('checkbox', { name: /^Work Items/ });
    expect(items.getAttribute('aria-checked')).toBe('mixed');
    expect(within(form).getByText('2 von 9')).toBeTruthy();
    expect(within(form).getByRole('button', { name: 'Work Items: Ereignisse ausblenden' }).getAttribute('aria-expanded')).toBe('true');
    expect(within(form).getByText('2 Ereignisse gewählt.')).toBeTruthy();

    // one more single event
    await user.click(within(form).getByRole('checkbox', { name: /^Status geändert/ }));
    // and one less
    await user.click(within(form).getByRole('checkbox', { name: /^Item geändert/ }));
    // a closed group opens to pick single events
    await user.click(within(form).getByRole('button', { name: 'Wiki-Seiten: Ereignisse einzeln wählen' }));
    await user.click(within(form).getByRole('checkbox', { name: /^Seite verschoben/ }));
    await user.click(within(form).getByRole('button', { name: 'Speichern' }));
    await waitFor(() => expect(calls('PUT', '/api/v1/webhooks/wh_crm')).toHaveLength(1));
    expect((calls('PUT', '/api/v1/webhooks/wh_crm')[0].body as WebhookInput).events).toEqual(['work_item.created', 'work_item.state_changed', 'page.moved']);
  });

  it('ticks a whole group in one go and clears it again', async () => {
    const user = userEvent.setup();
    renderWebhooks();
    await user.click(within(await cardOf('Altes CRM')).getByRole('button', { name: 'Webhook „Altes CRM“ bearbeiten' }));
    const form = await screen.findByRole('dialog', { name: 'Webhook „Altes CRM“ bearbeiten' });

    const items = within(form).getByRole('checkbox', { name: /^Work Items/ });
    await user.click(items);
    expect(items.getAttribute('aria-checked')).toBe('true');
    expect(within(form).getByText('9 von 9')).toBeTruthy();
    await user.click(within(form).getByRole('checkbox', { name: /^Projekte/ }));
    await user.click(within(form).getByRole('button', { name: 'Speichern' }));
    await waitFor(() => expect(calls('PUT', '/api/v1/webhooks/wh_crm')).toHaveLength(1));
    expect((calls('PUT', '/api/v1/webhooks/wh_crm')[0].body as WebhookInput).events).toEqual(['project.*', 'work_item.*']);
  });

  it('collapses an open group and says that one event is chosen', async () => {
    const user = userEvent.setup();
    renderWebhooks({}, [makeWebhook({ events: ['template.run_failed'] })]);
    await user.click(within(await cardOf('Deploy-Bot')).getByRole('button', { name: 'Webhook „Deploy-Bot“ bearbeiten' }));
    const form = await screen.findByRole('dialog', { name: 'Webhook „Deploy-Bot“ bearbeiten' });
    expect(within(form).getByText('1 Ereignis gewählt.')).toBeTruthy();

    await user.click(within(form).getByRole('button', { name: 'Kommentare: Ereignisse einzeln wählen' }));
    expect(within(form).getByRole('checkbox', { name: /^Kommentar bearbeitet/ })).toBeTruthy();
    await user.click(within(form).getByRole('button', { name: 'Kommentare: Ereignisse ausblenden' }));
    expect(within(form).queryByRole('checkbox', { name: /^Kommentar bearbeitet/ })).toBeNull();
    await user.click(within(form).getByRole('checkbox', { name: /^Vorlagen/ }));
    expect(within(form).getByText('Wähle, wovon der Webhook erfährt. Eine ganze Gruppe schließt künftige Ereignisse ein.')).toBeTruthy();
  });
});
