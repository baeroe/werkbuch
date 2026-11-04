/*
 * Settings → Notifications against a fake REST API (`mockApi`): the matrix of events and channels, saving only what
 * changed, the defaults, the mail column without a mail server and the leave guard. The flow with a real server (mail
 * off for comments with the keyboard, kept after a reload) runs in e2e/tests/notification-settings.spec.ts.
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode, Ref } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NOTIFICATION_EVENTS } from '@/api/notifications';
import { currentToasts, resetToasts, runToastAction } from '@/components/ui/toast';
import { mockApi, type MockApi, type MockRoute } from '@/test/api';
import { ida, mara, organization } from '@/test/fixtures';
import type { NotificationChannel, NotificationEvent, NotificationPreference, User } from '@/types';
import { PersonalSettings } from '../PersonalSettings';
import notificationKindPhp from '/app/Domain/Notifications/NotificationKind.php?raw';
import { cellKey, changedPreferences, defaultEnabled, defaultsFor, toChoices } from './matrix';

type Visit = { url: URL; method: string; prefetch: boolean; preserveUrl: boolean };
type Listener = (event: { detail: { visit: Visit } }) => boolean | void;

const inertia = vi.hoisted(() => ({ listeners: new Map<string, Set<(event: never) => unknown>>() }));
let signedIn: User = mara;
let mail = true;

vi.mock('@inertiajs/react', () => ({
  usePage: () => ({ props: { auth: { user: signedIn, permissions: [] }, organization, features: { mail, live: null, attachments_max_mb: 20 } } }),
  Link: ({ href, children, ref, ...rest }: { href: string; children: ReactNode; ref?: Ref<HTMLAnchorElement> }) => (
    <a href={href} ref={ref} {...rest}>
      {children}
    </a>
  ),
  router: {
    reload: vi.fn(),
    visit: vi.fn(),
    on: (event: string, listener: (event: never) => unknown) => {
      const set = inertia.listeners.get(event) ?? new Set();
      set.add(listener);
      inertia.listeners.set(event, set);
      return () => set.delete(listener);
    },
  },
}));

/** What Inertia does when a visit starts: asks every `before` listener; one that answers false stops it. */
function leaveTo(path: string): 'stopped' | 'goes on' {
  const visit: Visit = { url: new URL(path, window.location.origin), method: 'get', prefetch: false, preserveUrl: false };
  let answer: 'stopped' | 'goes on' = 'goes on';
  act(() => {
    const answers = [...(inertia.listeners.get('before') ?? [])].map((listener) => (listener as Listener)({ detail: { visit } }));
    if (answers.includes(false)) answer = 'stopped';
  });
  return answer;
}

/* -------------------------------------------------------------------------- data */

const CHANNELS: NotificationChannel[] = ['inbox', 'mail'];

/** The whole matrix as the server answers it: the defaults, with `stored` on top (`"<event>:<channel>"` → on). */
function matrix(stored: Record<string, boolean> = {}, user = mara.id): NotificationPreference[] {
  return NOTIFICATION_EVENTS.flatMap((event) =>
    CHANNELS.map((channel) => ({ user_id: user, event, channel, enabled: stored[`${event}:${channel}`] ?? defaultEnabled(event, channel) })),
  );
}

const problem = (status: number, reason: string, extra: Record<string, unknown> = {}) => ({ status, body: { type: 'about:blank', title: reason, status, reason, ...extra } });
const unavailable = () => problem(503, 'service_unavailable', { detail: 'Der Server ist gerade nicht erreichbar.' });

/* ------------------------------------------------------------------------ render */

let api: MockApi | undefined;
/** What the server holds: a PUT stores its rows, the next GET answers them. */
let stored: Record<string, boolean>;

function renderSettings(overrides: Record<string, MockRoute> = {}) {
  api = mockApi({
    'GET /api/v1/organization': () => ({ body: { data: organization } }),
    'GET /api/v1/notification-preferences': () => ({ body: { data: matrix(stored) } }),
    'PUT /api/v1/notification-preferences': (body) => {
      for (const row of (body as { preferences: NotificationPreference[] }).preferences) stored[`${row.event}:${row.channel}`] = row.enabled;
      return { body: { data: matrix(stored) } };
    },
    ...overrides,
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <PersonalSettings section="notifications" />
    </QueryClientProvider>,
  );
}

const cell = (label: string, channel: 'In-App' | 'E-Mail') => screen.getByRole('checkbox', { name: `${label}, ${channel}` });
const checked = (label: string, channel: 'In-App' | 'E-Mail') => cell(label, channel).getAttribute('aria-checked') === 'true';
const puts = () => api!.calls.filter((call) => call.method === 'PUT' && call.url === '/api/v1/notification-preferences');
const toastTitles = () => currentToasts().map((entry) => entry.title);

beforeEach(() => {
  stored = {};
  inertia.listeners.clear();
});

afterEach(() => {
  api?.restore();
  api = undefined;
  signedIn = mara;
  mail = true;
  act(() => resetToasts());
});

/* ------------------------------------------------------------------------- tests */

describe('matrix', () => {
  it('reads the rows as cells and writes back only the cells that differ', () => {
    expect(cellKey('comment', 'mail')).toBe('comment:mail');
    const saved = toChoices(matrix());
    expect(saved['comment:mail']).toBe(true);
    expect(saved['state_changed:mail']).toBe(false);
    expect(changedPreferences('u_mara', saved, { ...saved, 'comment:mail': false, 'due:inbox': true })).toEqual([
      { user_id: 'u_mara', event: 'comment', channel: 'mail', enabled: false },
    ]);
  });

  it('has the inbox on for every event and mail on for assigned, mentioned, comment and due', () => {
    const on = NOTIFICATION_EVENTS.filter((event) => defaultEnabled(event, 'mail'));
    expect(on).toEqual(['assigned', 'mentioned', 'comment', 'due']);
    expect(NOTIFICATION_EVENTS.every((event) => defaultEnabled(event, 'inbox'))).toBe(true);
    expect(defaultsFor(['comment', 'item_changed'], ['mail'])).toEqual({ 'comment:mail': true, 'item_changed:mail': false });
  });
});

describe('Notifications', () => {
  it('shows the defaults of the spec', async () => {
    renderSettings();
    // the section between Security and API & MCP, with a skeleton while the matrix loads
    const nav = screen.getByRole('navigation', { name: 'Bereiche der persönlichen Einstellungen' });
    expect(within(nav).getAllByRole('link').map((link) => link.textContent)).toEqual(['Profil', 'Sicherheit', 'Benachrichtigungen', 'API & MCP']);
    expect(screen.getByText('Benachrichtigungen werden geladen …')).toBeTruthy();

    const table = await screen.findByRole('table', { name: 'Benachrichtigungen nach Ereignis und Kanal' });
    expect(within(table).getAllByRole('columnheader').map((header) => header.textContent)).toEqual(['Ereignis', 'In-App', 'E-Mail']);
    // one row per event in the order of the server, with what it is and when it happens; an org admin sees webhooks too
    const rows = within(table).getAllByRole('rowheader');
    expect(rows.map((row) => row.firstElementChild?.textContent)).toEqual([
      'Zugewiesen',
      'Erwähnt',
      'Neuer Kommentar',
      'Statuswechsel',
      'Sonstige Änderungen',
      'Fällig oder überfällig',
      'Neues Item im Projekt',
      'Vorlage fehlgeschlagen',
      'Webhook abgeschaltet',
    ]);
    expect(rows[5]!.textContent).toContain('Deine zugewiesenen Items, täglich um 08:00 in deiner Zeitzone.');

    // the inbox for everything, mail for four
    for (const label of ['Zugewiesen', 'Erwähnt', 'Neuer Kommentar', 'Fällig oder überfällig']) expect(checked(label, 'E-Mail')).toBe(true);
    for (const label of ['Statuswechsel', 'Sonstige Änderungen', 'Neues Item im Projekt', 'Vorlage fehlgeschlagen', 'Webhook abgeschaltet']) {
      expect(checked(label, 'E-Mail')).toBe(false);
    }
    expect(rows.every((row) => checked(row.firstElementChild!.textContent!, 'In-App'))).toBe(true);
    expect(cell('Zugewiesen', 'E-Mail').getAttribute('aria-disabled')).not.toBe('true');
  });

  it('leaves the webhooks out for members', async () => {
    signedIn = ida;
    renderSettings();
    await screen.findByRole('table');
    expect(screen.queryByRole('checkbox', { name: 'Webhook abgeschaltet, In-App' })).toBeNull();
    expect(screen.getAllByRole('rowheader')).toHaveLength(8);
  });

  it('says when the matrix could not be loaded and loads it again', async () => {
    let answer: MockRoute = unavailable;
    renderSettings({ 'GET /api/v1/notification-preferences': (body, url) => answer(body, url) });
    expect(await screen.findByText('Die Benachrichtigungen konnten nicht geladen werden')).toBeTruthy();
    expect(screen.getByText('Der Server ist gerade nicht erreichbar.')).toBeTruthy();

    answer = () => ({ body: { data: matrix() } });
    await userEvent.click(screen.getByRole('button', { name: 'Erneut versuchen' }));
    expect(await screen.findByRole('table')).toBeTruthy();
  });

  it('saves only the changes and keeps the rest', async () => {
    const user = userEvent.setup();
    stored = { 'item_changed:inbox': false };
    renderSettings();
    await screen.findByRole('table');

    // saving without a change says so and sends nothing
    await user.click(screen.getByRole('button', { name: 'Speichern' }));
    expect(await screen.findByText('Keine Änderungen zu speichern.')).toBeTruthy();
    expect(puts()).toEqual([]);

    await user.click(cell('Neuer Kommentar', 'E-Mail'));
    await user.click(cell('Statuswechsel', 'E-Mail'));
    // a cell switched twice is no change
    await user.click(cell('Erwähnt', 'In-App'));
    await user.click(cell('Erwähnt', 'In-App'));
    expect(screen.getByText('Nicht gespeicherte Änderungen')).toBeTruthy();

    // ⌘↵ saves from anywhere in the form
    await user.keyboard('{Control>}{Enter}{/Control}');
    await waitFor(() => expect(toastTitles()).toContain('Benachrichtigungen gespeichert'));
    expect(puts().map((call) => call.body)).toEqual([
      {
        preferences: [
          { user_id: 'u_mara', event: 'comment', channel: 'mail', enabled: false },
          { user_id: 'u_mara', event: 'state_changed', channel: 'mail', enabled: true },
        ],
      },
    ]);
    // the rest stays as the server holds it, the form shows what it stored
    expect(checked('Sonstige Änderungen', 'In-App')).toBe(false);
    expect(checked('Neuer Kommentar', 'E-Mail')).toBe(false);
    expect(checked('Statuswechsel', 'E-Mail')).toBe(true);
    expect(screen.queryByText('Nicht gespeicherte Änderungen')).toBeNull();
  });

  it('keeps the changes when saving fails and tries again from the toast', async () => {
    const user = userEvent.setup();
    let answer: MockRoute = unavailable;
    renderSettings({
      'PUT /api/v1/notification-preferences': (body, url) => answer(body, url),
    });
    await screen.findByRole('table');

    await user.click(cell('Neuer Kommentar', 'E-Mail'));
    await user.click(screen.getByRole('button', { name: 'Speichern' }));
    await waitFor(() => expect(toastTitles()).toContain('Benachrichtigungen nicht gespeichert'));
    expect(checked('Neuer Kommentar', 'E-Mail')).toBe(false);
    expect(screen.getByText('Nicht gespeicherte Änderungen')).toBeTruthy();

    answer = () => {
      stored['comment:mail'] = false;
      return { body: { data: matrix(stored) } };
    };
    const failed = currentToasts().find((entry) => entry.title === 'Benachrichtigungen nicht gespeichert')!;
    act(() => runToastAction(failed.id));
    await waitFor(() => expect(toastTitles()).toContain('Benachrichtigungen gespeichert'));
    expect(screen.queryByText('Nicht gespeicherte Änderungen')).toBeNull();
  });

  it('puts the defaults back', async () => {
    const user = userEvent.setup();
    stored = { 'comment:mail': false, 'state_changed:mail': true, 'item_created:inbox': false };
    renderSettings();
    await screen.findByRole('table');
    expect(checked('Neuer Kommentar', 'E-Mail')).toBe(false);

    await user.click(screen.getByRole('button', { name: 'Standardwerte' }));
    expect(checked('Neuer Kommentar', 'E-Mail')).toBe(true);
    expect(checked('Statuswechsel', 'E-Mail')).toBe(false);
    expect(checked('Neues Item im Projekt', 'In-App')).toBe(true);

    // "Verwerfen" brings the stored choices back; the defaults again, then saved: only the three cells go
    await user.click(screen.getByRole('button', { name: 'Zurücksetzen' }));
    expect(checked('Neuer Kommentar', 'E-Mail')).toBe(false);
    await user.click(screen.getByRole('button', { name: 'Standardwerte' }));
    await user.click(screen.getByRole('button', { name: 'Speichern' }));
    await waitFor(() => expect(puts()).toHaveLength(1));
    expect((puts()[0]!.body as { preferences: NotificationPreference[] }).preferences.map((row) => cellKey(row.event as NotificationEvent, row.channel))).toEqual([
      'comment:mail',
      'state_changed:mail',
      'item_created:inbox',
    ]);
  });

  it('locks the mail column without a mail server and says why', async () => {
    const user = userEvent.setup();
    mail = false;
    stored = { 'state_changed:mail': true, 'item_created:inbox': false };
    renderSettings();
    await screen.findByRole('table');

    const reason = 'Diese Instanz hat keinen Mailserver: E-Mails gehen erst raus, wenn eine Administratorin ihn eingerichtet hat.';
    const note = screen.getByText(reason);
    for (const row of screen.getAllByRole('rowheader')) {
      const box = cell(row.firstElementChild!.textContent!, 'E-Mail');
      expect(box.getAttribute('aria-disabled')).toBe('true');
      expect(box.getAttribute('aria-describedby')).toBe(note.id);
    }
    // the stored choice still shows; a click changes nothing
    expect(checked('Statuswechsel', 'E-Mail')).toBe(true);
    await user.click(cell('Neuer Kommentar', 'E-Mail'));
    expect(checked('Neuer Kommentar', 'E-Mail')).toBe(true);
    expect(cell('Neuer Kommentar', 'In-App').getAttribute('aria-disabled')).not.toBe('true');

    // the defaults only touch what can be chosen: the inbox
    await user.click(screen.getByRole('button', { name: 'Standardwerte' }));
    expect(checked('Neues Item im Projekt', 'In-App')).toBe(true);
    expect(checked('Statuswechsel', 'E-Mail')).toBe(true);
    await user.click(screen.getByRole('button', { name: 'Speichern' }));
    await waitFor(() => expect(puts()).toHaveLength(1));
    expect(puts()[0]!.body).toEqual({ preferences: [{ user_id: 'u_mara', event: 'item_created', channel: 'inbox', enabled: true }] });
  });

  it('guards unsaved changes', async () => {
    const user = userEvent.setup();
    renderSettings();
    await screen.findByRole('table');
    expect(leaveTo('/projects')).toBe('goes on');

    await user.click(cell('Sonstige Änderungen', 'In-App'));
    expect(leaveTo('/projects')).toBe('stopped');
    expect(await screen.findByRole('alertdialog', { name: 'Änderungen verwerfen?' })).toBeTruthy();
    expect(screen.getByText(/Deine Änderungen an den Benachrichtigungen sind nicht gespeichert/)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Weiter bearbeiten' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(checked('Sonstige Änderungen', 'In-App')).toBe(false);
  });
});

describe('the defaults', () => {
  it('mails by default exactly what NotificationKind::mailByDefault names (T18-M4)', () => {
    const cases = Object.fromEntries([...notificationKindPhp.matchAll(/case (\w+) = '(\w+)';/g)].map((match) => [match[1], match[2]]));
    const list = /function mailByDefault\(\)[^[]*\[([^\]]*)\]/.exec(notificationKindPhp)![1]!;
    const server = [...list.matchAll(/self::(\w+)/g)].map((match) => cases[match[1]!]!);

    expect(NOTIFICATION_EVENTS.filter((event) => defaultEnabled(event, 'mail')).sort()).toEqual([...server].sort());
    expect(server.length).toBeGreaterThan(0);
  });
});

