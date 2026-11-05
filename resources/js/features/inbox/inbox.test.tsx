/*
 * The inbox against a fake REST API (`mockApi`): Mara's inbox as the NotificationsSeeder writes it (`maraInbox`), the
 * filters in the address (an Inertia mock whose `router.replace` moves it), the states of the list, a live message
 * that loads it again, the keys, reading on open, the read marks and deleting with undo. Ported from the clickdummy's
 * features/inbox/inbox.test.tsx; the counts while a mark is on its way: useReadMarks.test.ts. The flows with a real
 * server run in e2e/tests/inbox.spec.ts.
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useSyncExternalStore, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest';
import type { LiveEvent } from '@/api/live';
import { currentToasts, dismissToast, resetToasts } from '@/components/ui/toast';
import { CommandPalette } from '@/features/palette/CommandPalette';
import { useLiveSync } from '@/hooks/live';
import { listCommands } from '@/lib/commands';
import { useShortcut } from '@/lib/shortcuts/useShortcut';
import { canUndo, undoLatest } from '@/lib/undo';
import { useUiStore } from '@/store/ui';
import { mockApi, type MockApi, type MockRoute } from '@/test/api';
import { ida, lene, list, makeNotification, mara, maraInbox, organization, person, project, properties, standard, theo, types } from '@/test/fixtures';
import type { Notification, User } from '@/types';
import InboxPage from '@/pages/Inbox/Index';
import { shellLayout } from '@/shell/layout';
import { focusLater, InboxScreen } from './InboxScreen';

/* ----------------------------------------------------------------- Inertia, live */

/** The address of the page; `router.replace` moves it, and the screen reads it through `usePage`. */
const address = vi.hoisted(() => {
  let url = '/inbox';
  const listeners = new Set<() => void>();
  return {
    get: () => url,
    set: (next: string) => {
      url = next;
      listeners.forEach((listener) => listener());
    },
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    replace: vi.fn(),
    visit: vi.fn(),
  };
});

vi.mock('@inertiajs/react', () => ({
  usePage: () => ({ props: { auth: { user: mara, permissions: [] }, organization }, url: useSyncExternalStore(address.subscribe, address.get) }),
  Link: ({ href, children, ...rest }: { href: string; children?: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
  router: {
    replace: (options: { url: string }) => {
      address.replace(options);
      address.set(options.url);
    },
    visit: address.visit,
    reload: vi.fn(),
    on: () => () => {},
  },
}));

/* The live connection stands in as a bus the test sends messages over. */
const bus = vi.hoisted(() => ({ listeners: new Set<(event: LiveEvent) => void>() }));

vi.mock('@/api/live', () => ({
  subscribeLive: (callback: (event: LiveEvent) => void) => {
    bus.listeners.add(callback);
    return () => bus.listeners.delete(callback);
  },
  isLiveConnected: () => true,
  subscribeLiveStatus: () => () => {},
  watchItem: () => () => {},
}));

/* ----------------------------------------------------------------- fake server */

const jonas = person('u_jonas', 'Jonas Wolf', 'jonas');
const automation: User = { ...person('u_automation', 'Automation', 'automation', 'admin'), type: 'bot' };
const projects = [project('WEB', 'admin', { name: 'Website-Relaunch' }), project('APP', 'admin', { name: 'Kunden-App' }), project('OPS', 'admin', { name: 'Infrastruktur' })];
const customer = properties.find((property) => property.key === 'customer')!;

let notifications: Notification[];
/** Every call answers 503 while set. */
let failing: boolean;
/** Routes a test answers differently. */
let overrides: Record<string, MockRoute>;
let api: MockApi;
let client: QueryClient;

const unavailable = { status: 503, body: { type: 'about:blank', title: 'down', status: 503, reason: 'service_unavailable', detail: 'Der Server ist gerade nicht erreichbar.' } };

/** The inbox as `ListNotifications` answers it: newest first (the list is kept so), the filters, a page of `per_page`. */
const listRoute: MockRoute = (_, url) => {
  const unreadOnly = url.searchParams.get('unread_only') === '1';
  const mentionsOnly = url.searchParams.get('mentions_only') === '1';
  const perPage = Number(url.searchParams.get('per_page') ?? 100);
  const matching = notifications.filter((entry) => (!unreadOnly || entry.read_at === null) && (!mentionsOnly || entry.event === 'mentioned'));
  return { body: list(matching.slice(0, perPage), matching.length) };
};

function route(key: string): MockRoute | undefined {
  if (overrides[key]) return overrides[key];
  if (key === 'GET /api/v1/notifications') return listRoute;
  if (key === 'POST /api/v1/notifications/read')
    return (body) => {
      const { ids, all, mentions_only: mentionsOnly } = body as { ids?: string[]; all?: true; mentions_only?: boolean };
      let updated = 0;
      notifications = notifications.map((entry) => {
        if (entry.read_at !== null || (all ? mentionsOnly && entry.event !== 'mentioned' : !ids!.includes(entry.id))) return entry;
        updated += 1;
        return { ...entry, read_at: '2026-10-28T09:00:00.000Z' };
      });
      return { body: { updated } };
    };
  if (key === 'POST /api/v1/notifications/unread')
    return (body) => {
      const { ids } = body as { ids: string[] };
      notifications = notifications.map((entry) => (ids.includes(entry.id) ? { ...entry, read_at: null } : entry));
      return { body: { updated: ids.length } };
    };
  if (key.startsWith('DELETE /api/v1/notifications/'))
    return () => {
      notifications = notifications.filter((entry) => entry.id !== key.slice('DELETE /api/v1/notifications/'.length));
      return { status: 204 };
    };
  if (key === 'GET /api/v1/projects') return () => ({ body: list(projects) });
  if (key === 'GET /api/v1/work-item-types') return () => ({ body: list(types) });
  if (key === 'GET /api/v1/workflows') return () => ({ body: list([standard]) });
  if (key === 'GET /api/v1/properties') return () => ({ body: list(properties) });
  if (key === 'GET /api/v1/users') return () => ({ body: list([mara, ida, theo, lene, jonas, automation]) });
  return undefined;
}

const server = new Proxy({} as Record<string, MockRoute>, {
  get: (_, key: string) => {
    const answer = route(key);
    return answer && ((body: unknown, url: URL) => (failing ? unavailable : answer(body, url)));
  },
});

beforeEach(() => {
  // 10:00 in Berlin on the day of the seed
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-28T09:00:00.000Z'));
  notifications = maraInbox.map((entry) => ({ ...entry }));
  failing = false;
  overrides = {};
  address.set('/inbox');
  address.replace.mockClear();
  address.visit.mockClear();
  useUiStore.setState(useUiStore.getInitialState());
  resetToasts();
  api = mockApi(server);
});

afterEach(() => {
  api.restore();
  bus.listeners.clear();
  vi.useRealTimers();
});

/** What the shell does for the screen: the live sync and mod+z. */
function LiveSync() {
  useLiveSync();
  useShortcut('shell.undo', () => undoLatest(), { when: canUndo });
  return null;
}

function renderInbox(url = '/inbox', { palette = false } = {}) {
  address.set(url);
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <LiveSync />
      <main id="main" tabIndex={-1}>
        <InboxScreen />
      </main>
      {palette && <CommandPalette />}
    </QueryClientProvider>,
  );
}

/** The list once its first load is over (the skeleton is gone). */
const loaded = () => screen.findByRole('article', { name: /WEB-42/ });
const rows = () => screen.getAllByRole('listitem');
const rowLinks = () => screen.getAllByRole('link').filter((link) => link.hasAttribute('data-nav-target'));
const card = (name: RegExp) => screen.getByRole('article', { name });
const status = () => screen.getByRole('status');

const posts = (path: string) => api.calls.filter((call) => call.method === 'POST' && call.url === `/api/v1/notifications/${path}`).map((call) => call.body);
const toastTitles = () => currentToasts().map((toast) => toast.title);
const rowOf = (pattern: RegExp) => rows().find((row) => pattern.test(row.textContent ?? ''))!;

function send(event: Partial<LiveEvent>): void {
  act(() => bus.listeners.forEach((listener) => listener({ event_id: null, type: 'notifications.changed', project_id: null, page_id: null, template_id: null, item_id: null, comment_id: null, actor_id: null, ...event })));
}

/* ------------------------------------------------------------------------ tests */

describe('the inbox', () => {
  it('groups Mara’s inbox by item, newest first', async () => {
    renderInbox();
    await loaded();

    // 14 notifications in 11 groups: nine items, the project OPS (a failed template) and the organisation (a webhook)
    expect(rows()).toHaveLength(14);
    expect(screen.getAllByRole('article').map((article) => within(article).getByRole('heading', { level: 2 }).textContent)).toEqual([
      'WEB-42: Startseite: Hero und Teaser bauen',
      'APP-18: TestFlight-Gruppe für Kunden einrichten',
      'APP-24: Feedback der Beta-Tester sammeln',
      'APP-15: Bestellhistorie als PDF exportieren',
      'OPS-11: DNS-Einträge umstellen',
      'WEB-47: Kontaktformular sendet doppelt',
      'OPS-3: Server-Migration',
      'OPS-12: Mail-Limits am Server erhöhen',
      'WEB-40: Favicon fehlt im Safari',
    ]);
    // the newest first inside a card as well
    const web47 = card(/WEB-47/);
    expect(within(web47).getAllByRole('listitem').map((row) => row.textContent)).toEqual([
      expect.stringContaining('Ida Brenner hat Priorität geändert'),
      expect.stringContaining('Jonas Wolf hat den Status von Todo auf In Progress gesetzt'),
      expect.stringContaining('Ida Brenner hat dich erwähnt'),
    ]);
    // the title leads to the item's page, the project stands beside it, the tab carries the key and the type
    expect(within(web47).getByRole('link', { name: 'WEB-47: Kontaktformular sendet doppelt' }).getAttribute('href')).toBe('/items/WEB-47');
    expect(within(web47).getByText('Website-Relaunch')).toBeTruthy();
    expect(web47.getAttribute('data-tone')).toBe(types.find((type) => type.id === 't_bug')!.tone);
    // what belongs to no item: the project of a failed template, the organisation for a switched-off webhook
    expect(screen.getAllByRole('region')).toEqual([screen.getByRole('region', { name: 'Organisation' }), screen.getByRole('region', { name: 'Infrastruktur' })]);
    // three unread ones, with the ink-blue dot and a word for screen readers
    expect(rows().filter((row) => row.hasAttribute('data-unread'))).toHaveLength(3);
    expect(screen.getByRole('link', { name: /^Ungelesen: Ida Brenner hat dich erwähnt/ })).toBeTruthy();
    await waitFor(() => expect(status().textContent).toBe('3 ungelesen'));
    // the list asks for the newest fifty
    expect(api.calls.some((call) => call.url === '/api/v1/notifications?per_page=50')).toBe(true);
  });

  it('says who did what, with an excerpt and how long ago', async () => {
    renderInbox();
    await loaded();

    const mention = screen.getByRole('link', { name: /Ida Brenner hat dich erwähnt.*Hero-Entwurf/ });
    expect(mention.textContent).toContain('„Hero-Entwurf ist drin, die Teaser kommen heute Nachmittag.');
    expect(screen.getByRole('link', { name: /^Ungelesen: Theo Okafor hat dir das Item zugewiesen/ })).toBeTruthy();
    expect(screen.getByRole('link', { name: /Theo Okafor hat kommentiert/ }).textContent).toContain('„Hafenkontor möchte das bis Ende November.');
    // how long ago, in the time zone of the organisation, the moment in full as its title
    const time = within(rows()[0]!).getAllByText('vor 1 Std.')[0]!;
    expect(time.tagName).toBe('TIME');
    expect(time.getAttribute('dateTime')).toBe('2026-10-28T07:40:00.000Z');
    expect(time.getAttribute('title')).toContain('08:40');
    expect(within(card(/WEB-40/)).getAllByText('23.10.').length).toBeGreaterThan(0);
  });

  it('names a reminder’s due date and a state change by name', async () => {
    notifications = [
      makeNotification({ id: 'n_due', event: 'due', actor_id: null, data: { due_date: '2026-10-28', overdue: false }, created_at: '2026-10-28T07:00:00.000Z' }),
      makeNotification({ id: 'n_overdue', event: 'due', actor_id: null, data: { due_date: '2026-10-21', overdue: true }, created_at: '2026-10-28T06:59:00.000Z' }),
      makeNotification({
        id: 'n_state',
        event: 'state_changed',
        actor_id: 'u_automation',
        data: { from: { id: 'gone', name: 'Review', category: 'started' }, to: { id: 'std_done', name: 'Done', category: 'completed' } },
        created_at: '2026-10-28T06:58:00.000Z',
      }),
      makeNotification({ id: 'n_fields', event: 'item_changed', actor_id: 'u_lene', data: { fields: ['title', `values.${customer.key}`] }, created_at: '2026-10-28T06:57:00.000Z' }),
      makeNotification({ id: 'n_created', event: 'item_created', actor_id: 'u_gone', created_at: '2026-10-28T06:56:00.000Z' }),
    ];
    renderInbox();

    // the reminder has nobody behind it: werkbuch reminds, by the day of `data`, overdue only as `data` says
    expect(await screen.findByRole('link', { name: /werkbuch erinnert: fällig am 28\.10\.2026/ })).toBeTruthy();
    expect(screen.getByRole('link', { name: /werkbuch erinnert: überfällig seit 21\.10\.2026/ })).toBeTruthy();
    // the states by the names they had at the move, also one that is gone since; a bot with the word "Bot"
    expect(screen.getByRole('link', { name: /Automation Bot hat den Status von Review auf Done gesetzt/ })).toBeTruthy();
    expect(screen.getByRole('link', { name: new RegExp(`Lene Vogt hat Titel und ${customer.label} geändert`) })).toBeTruthy();
    // an account the list does not know
    expect(screen.getByRole('link', { name: /Jemand hat das Item angelegt/ })).toBeTruthy();
  });

  it('keeps the inbox for a kind it does not know yet and a reminder without its day (T16-M5)', async () => {
    notifications = [
      makeNotification({ id: 'n_new', event: 'something_new' as Notification['event'], actor_id: 'u_lene', excerpt: 'Geheim', created_at: '2026-10-28T07:00:00.000Z' }),
      makeNotification({ id: 'n_due', event: 'due', actor_id: null, data: {}, created_at: '2026-10-28T06:59:00.000Z' }),
      makeNotification({ id: 'n_comment', event: 'comment', actor_id: 'u_lene', created_at: '2026-10-28T06:58:00.000Z' }),
    ];
    renderInbox();

    const unknown = await screen.findByRole('link', { name: /Lene Vogt hat etwas geändert/ });
    expect(unknown.textContent).not.toContain('Geheim');
    // the reminder without a day: no empty place for it
    const due = screen.getByRole('link', { name: /werkbuch erinnert: fällig/ });
    expect(due.textContent).not.toMatch(/fällig am/);
    expect(screen.getByRole('link', { name: /Lene Vogt hat kommentiert/ })).toBeTruthy();
  });

  it('shows what belongs to no item without the template or the webhook behind it', async () => {
    renderInbox();
    await loaded();

    const organisation = screen.getByRole('region', { name: 'Organisation' });
    const webhook = within(organisation).getByRole('link', { name: /Ein Webhook wurde abgeschaltet/ });
    expect(webhook.textContent).toContain('Er war 24');
    expect(webhook.getAttribute('href')).toBe('/settings');
    const template = within(screen.getByRole('region', { name: 'Infrastruktur' })).getByRole('link', { name: /Eine Vorlage hat kein Item angelegt/ });
    expect(template.textContent).toContain('„Pflicht-Property Umgebung fehlt“');
    // without the template behind it (the demo row): the templates of its project
    expect(template.getAttribute('href')).toBe('/projects/OPS/templates');

    // a plain click leads to its page: nothing to preview
    fireEvent.click(template);
    expect(address.visit).toHaveBeenCalledWith('/projects/OPS/templates');
    expect(useUiStore.getState().peekItemId).toBeNull();
  });

  it('leads a failed run to its template (T9-M5)', async () => {
    notifications = [
      makeNotification({ id: 'n_tpl', event: 'template_run_failed', work_item_id: null, item: null, actor_id: null, project_id: 'p_ops', data: { template_id: 'tpl_ops_certs', error: 'kaputt' } }),
    ];
    renderInbox();

    const row = await screen.findByRole('link', { name: /Eine Vorlage hat kein Item angelegt/ });
    // a template deleted since: its page says it does not exist, without asking for it (no 404)
    expect(row.getAttribute('href')).toBe('/projects/OPS/templates/tpl_ops_certs');
    fireEvent.click(row);
    expect(address.visit).toHaveBeenCalledWith('/projects/OPS/templates/tpl_ops_certs');
  });

  it('shows a card whose item is no longer available', async () => {
    // the project went into deletion between counting and reading: the notification comes without its item
    notifications = [makeNotification({ id: 'n_gone', work_item_id: 'wi_gone', project_id: 'p_ops', item: null })];
    renderInbox();

    const gone = await screen.findByRole('article', { name: /Nicht mehr verfügbar/ });
    expect(screen.queryByText(/gibt es nicht mehr/)).toBeNull();
    expect(within(gone).getByText('Infrastruktur')).toBeTruthy();
    // the row still opens: the preview says why it cannot show the item
    fireEvent.click(within(gone).getByRole('link', { name: /Ida Brenner hat dir das Item zugewiesen/ }));
    expect(useUiStore.getState().peekItemId).toBe('wi_gone');
  });

  it('names cards whose item is no longer available apart, by their project (T16-M6)', async () => {
    notifications = [
      makeNotification({ id: 'n_gone_ops', work_item_id: 'wi_gone_1', project_id: 'p_ops', item: null }),
      makeNotification({ id: 'n_gone_web', work_item_id: 'wi_gone_2', project_id: 'p_web', item: null, created_at: '2026-10-28T06:40:00.000Z' }),
    ];
    renderInbox();

    expect(await screen.findByRole('article', { name: 'Nicht mehr verfügbar Infrastruktur' })).toBeTruthy();
    expect(screen.getByRole('article', { name: 'Nicht mehr verfügbar Website-Relaunch' })).toBeTruthy();
  });

  it('shows the state of a move with its shape and colour (T16-M1)', async () => {
    notifications = [
      makeNotification({
        id: 'n_state',
        event: 'state_changed',
        data: { from: { id: 'std_todo', name: 'Todo', category: 'unstarted' }, to: { id: 'std_done', name: 'Done', category: 'completed' } },
      }),
    ];
    renderInbox();

    const link = await screen.findByRole('link', { name: /hat den Status von Todo auf Done gesetzt/ });
    // decorative next to the name, as everywhere a state is named
    expect(link.querySelectorAll('svg[aria-hidden="true"].text-st-unstarted, svg[aria-hidden="true"].text-st-completed')).toHaveLength(2);
  });

  it('shows no hidden project on a card without an item while the projects load (T16-M3)', async () => {
    notifications = [makeNotification({ id: 'n_tpl', event: 'template_run_failed', work_item_id: null, item: null, actor_id: null, data: { error: 'kaputt' } })];
    let release = () => {};
    const gate = new Promise<void>((resolve) => (release = resolve));
    const inner = globalThis.fetch;
    globalThis.fetch = async (input, init) => {
      if (String(input).includes('/api/v1/projects')) await gate;
      return inner(input, init);
    };
    onTestFinished(() => void (globalThis.fetch = inner));
    renderInbox();

    await screen.findByRole('link', { name: /Eine Vorlage hat kein Item angelegt/ });
    expect(screen.queryByText('Verborgenes Projekt')).toBeNull();
    release();
    expect(await screen.findByRole('region', { name: 'Website-Relaunch' })).toBeTruthy();
  });

  it('opens the item in the preview on a plain click and leaves a click with a modifier to the browser', async () => {
    renderInbox();
    await loaded();
    const row = screen.getByRole('link', { name: /Theo Okafor hat kommentiert/ });
    expect(row.getAttribute('href')).toBe('/items/APP-15');

    expect(fireEvent.click(row, { ctrlKey: true })).toBe(true);
    expect(useUiStore.getState().peekItemId).toBeNull();
    expect(fireEvent.click(row)).toBe(false);
    expect(useUiStore.getState().peekItemId).toBe('wi_app_15');
    // the card of the previewed item stands out
    expect(card(/APP-15/).hasAttribute('data-selected')).toBe(true);
  });

  it('filters unread and mentions from the address', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderInbox('/inbox?unread=1&mentions=1');
    await loaded();

    expect(rows()).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Ungelesen' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: 'Erwähnungen' }).getAttribute('aria-pressed')).toBe('true');
    expect(api.calls.some((call) => call.url === '/api/v1/notifications?per_page=50&unread_only=1&mentions_only=1')).toBe(true);

    // the filter goes into the address, without a visit to the server
    await user.click(screen.getByRole('button', { name: 'Ungelesen' }));
    expect(address.replace).toHaveBeenLastCalledWith({ url: '/inbox?mentions=1', preserveState: true, preserveScroll: true });
    await waitFor(() => expect(rows()).toHaveLength(3));
    expect(rowLinks().every((link) => /erwähnt/.test(link.textContent ?? ''))).toBe(true);

    await user.click(screen.getByRole('button', { name: 'Erwähnungen' }));
    expect(address.get()).toBe('/inbox');
    await waitFor(() => expect(rows()).toHaveLength(14));
    await user.click(screen.getByRole('button', { name: 'Ungelesen' }));
    expect(address.get()).toBe('/inbox?unread=1');
    await waitFor(() => expect(rows()).toHaveLength(3));
  });

  it('marks all read, only the mentions in the mentions filter', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderInbox('/inbox?mentions=1');
    await loaded();

    await user.click(screen.getByRole('button', { name: 'Alle als gelesen markieren' }));
    await waitFor(() => expect(status().textContent).toBe('2 ungelesen'));
    expect(api.calls.filter((call) => call.method === 'POST').map((call) => call.body)).toEqual([{ all: true, mentions_only: true }]);

    address.set('/inbox');
    await user.click(screen.getByRole('button', { name: 'Alle als gelesen markieren' }));
    await waitFor(() => expect(status().textContent).toBe('Alles gelesen'));
    expect(api.calls.filter((call) => call.method === 'POST').at(-1)!.body).toEqual({ all: true });
    // nothing left to mark: the button says why it is off
    const button = screen.getByRole('button', { name: 'Alle als gelesen markieren' });
    expect(button.getAttribute('aria-disabled')).toBe('true');
    expect(button.getAttribute('aria-describedby')).not.toBeNull();
  });

  it('says when marking all read failed', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    overrides['POST /api/v1/notifications/read'] = () => unavailable;
    renderInbox();
    await loaded();

    await user.click(screen.getByRole('button', { name: 'Alle als gelesen markieren' }));
    const { currentToasts } = await import('@/components/ui/toast');
    await waitFor(() => expect(currentToasts().map((toast) => toast.title)).toContain('Nicht als gelesen markiert'));
    expect(status().textContent).toBe('3 ungelesen');
  });

  it('names the key of the row with the cursor: e for an unread one, u for a read one', async () => {
    renderInbox();
    await loaded();
    expect(screen.queryByText('als gelesen')).toBeNull();

    // the list is one stop in the tab order: the first row, then the row the focus went to
    expect(rowLinks().map((link) => link.tabIndex)).toEqual([0, ...Array<number>(13).fill(-1)]);
    act(() => rowLinks()[0]!.focus());
    expect(within(rows()[0]!).getByText('als gelesen')).toBeTruthy();
    expect(within(rows()[0]!).getByRole('img', { name: 'E' })).toBeTruthy();

    act(() => rowLinks()[1]!.focus());
    expect(within(rows()[0]!).queryByText('als gelesen')).toBeNull();
    expect(within(rows()[1]!).getByText('wieder ungelesen')).toBeTruthy();
    expect(within(rows()[1]!).getByRole('img', { name: 'U' })).toBeTruthy();
    expect(rowLinks()[1]!.tabIndex).toBe(0);
    expect(rowLinks()[0]!.tabIndex).toBe(-1);
  });

  it('shows the newest fifty and says how many there are', async () => {
    notifications = Array.from({ length: 60 }, (_, index) =>
      makeNotification({ id: `n_${index}`, read_at: '2026-10-28T08:00:00.000Z', created_at: new Date(Date.parse('2026-10-28T08:00:00.000Z') - index * 60_000).toISOString() }),
    );
    renderInbox();

    expect(await screen.findByText(/Die neuesten 50 von 60\sBenachrichtigungen/)).toBeTruthy();
    expect(rows()).toHaveLength(50);
  });

  it('shows the skeleton, the empty inbox per filter and the error with retry', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    notifications = [];
    // the first answer waits until the test has seen the skeleton
    const original = globalThis.fetch;
    globalThis.fetch = async (input, init) => {
      if (String(input).includes('/notifications')) await held;
      return original(input, init);
    };
    renderInbox();
    expect(screen.getByText('Inbox wird geladen …')).toBeTruthy();
    release();

    // no notifications at all: what lands here, and the way to the settings
    expect(await screen.findByText('Inbox ist leer')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Benachrichtigungen einstellen' }).getAttribute('href')).toBe('/me/notifications');
    globalThis.fetch = original;

    // nothing unread: the way back to all
    act(() => address.set('/inbox?unread=1'));
    const showAll = await screen.findByRole('button', { name: 'Alle anzeigen' });
    expect(screen.getByText('Alles gelesen', { selector: 'p:not([role])' })).toBeTruthy();
    await user.click(showAll);
    expect(address.get()).toBe('/inbox');

    act(() => address.set('/inbox?mentions=1'));
    expect(await screen.findByText('Keine Erwähnungen')).toBeTruthy();
    act(() => address.set('/inbox?unread=1&mentions=1'));
    expect(await screen.findByText('Keine ungelesenen Erwähnungen')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Filter zurücksetzen' }));
    expect(address.get()).toBe('/inbox');

    // the server fails before the first answer: the cause and "Erneut versuchen", then the list
    failing = true;
    notifications = maraInbox.map((entry) => ({ ...entry }));
    act(() => client.clear());
    act(() => address.set('/inbox?mentions=1'));
    expect(await screen.findByText('Die Inbox konnte nicht geladen werden')).toBeTruthy();
    expect(screen.getByText('Der Server ist gerade nicht erreichbar.')).toBeTruthy();
    failing = false;
    await user.click(screen.getByRole('button', { name: 'Erneut versuchen' }));
    expect(await screen.findByRole('article', { name: /WEB-42/ })).toBeTruthy();
  });

  it('keeps the list when a reload fails', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderInbox();
    await loaded();

    failing = true;
    await act(() => client.refetchQueries().catch(() => undefined));
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByText('Die Inbox ist nicht auf dem neuesten Stand')).toBeTruthy();
    expect(rows()).toHaveLength(14);

    failing = false;
    notifications = notifications.slice(1);
    await user.click(screen.getByRole('button', { name: 'Erneut versuchen' }));
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
    expect(rows()).toHaveLength(13);
  });

  it('shows a new notification after a live event', async () => {
    renderInbox();
    await loaded();
    await waitFor(() => expect(status().textContent).toBe('3 ungelesen'));

    notifications = [makeNotification({ id: 'n_new', event: 'comment', actor_id: 'u_lene', excerpt: 'Neu von Lene.', created_at: '2026-10-28T08:59:30.000Z' }), ...notifications];
    send({ unread_changed: true });

    expect(await screen.findByRole('link', { name: /^Ungelesen: Lene Vogt hat kommentiert/ })).toBeTruthy();
    await waitFor(() => expect(status().textContent).toBe('4 ungelesen'));
    expect(within(card(/WEB-47/)).getAllByRole('listitem')).toHaveLength(4);
  });
});

describe('the keys and the read marks', () => {
  const setup = () => userEvent.setup({ advanceTimers: vi.advanceTimersByTime });

  it('marks read with e and unread with u', async () => {
    const user = setup();
    renderInbox();
    await loaded();
    await waitFor(() => expect(status().textContent).toBe('3 ungelesen'));

    // without a cursor e says how to get one and changes nothing
    await user.keyboard('e');
    expect(toastTitles()).toContain('Keine Benachrichtigung ausgewählt');
    expect(posts('read')).toEqual([]);

    // j puts the cursor and the focus on the first row
    await user.keyboard('j');
    expect(document.activeElement).toBe(rowLinks()[0]);
    expect(rows()[0]!.hasAttribute('data-unread')).toBe(true);

    await user.keyboard('e');
    // at once: the dot goes, the count follows, no toast for it
    expect(rows()[0]!.hasAttribute('data-unread')).toBe(false);
    expect(status().textContent).toBe('2 ungelesen');
    await waitFor(() => expect(posts('read')).toEqual([{ ids: ['n_01'] }]));
    // the cursor stays on the row, which now names u
    expect(within(rows()[0]!).getByText('wieder ungelesen')).toBeTruthy();

    await user.keyboard('u');
    expect(rows()[0]!.hasAttribute('data-unread')).toBe(true);
    expect(status().textContent).toBe('3 ungelesen');
    await waitFor(() => expect(posts('unread')).toEqual([{ ids: ['n_01'] }]));
    await waitFor(() => expect(notifications.find((entry) => entry.id === 'n_01')!.read_at).toBeNull());
    expect(status().textContent).toBe('3 ungelesen');

    // e on a read row and u on an unread one change nothing
    await user.keyboard('u');
    await user.keyboard('j');
    expect(document.activeElement).toBe(rowLinks()[1]);
    await user.keyboard('e');
    expect(posts('read')).toHaveLength(1);
    expect(posts('unread')).toHaveLength(1);
    expect(toastTitles().filter((title) => title !== 'Keine Benachrichtigung ausgewählt')).toEqual([]);
  });

  it('leaves the row alone with u and # while the focus is in the preview (T17-M6)', async () => {
    const user = setup();
    renderInbox();
    await loaded();
    await user.keyboard('j');
    await user.keyboard('e');
    await waitFor(() => expect(posts('read')).toHaveLength(1));
    const preview = document.createElement('aside');
    preview.setAttribute('data-peek-panel', '');
    const inside = document.createElement('button');
    preview.append(inside);
    document.body.append(preview);
    onTestFinished(() => preview.remove());

    act(() => inside.focus());
    await user.keyboard('u');
    await user.keyboard('#');
    expect(posts('unread')).toEqual([]);
    expect(rows()[0]!.hasAttribute('data-unread')).toBe(false);
    expect(canUndo()).toBe(false);
  });

  it('describes the buttons of a row by its sentence (T17-M1)', async () => {
    renderInbox();
    await loaded();

    const menu = within(rows()[0]!).getByRole('button', { name: /^Aktionen/ });
    const described = document.getElementById(menu.getAttribute('aria-describedby')!);
    expect(described?.textContent).toMatch(/Ida Brenner hat dich erwähnt/);
  });

  it('says that all was read when marking all finds nothing left (T17-M4)', async () => {
    const user = setup();
    overrides['POST /api/v1/notifications/read'] = () => ({ body: { updated: 0 } });
    renderInbox();
    await loaded();
    await waitFor(() => expect(status().textContent).toBe('3 ungelesen'));

    await user.keyboard('{Shift>}E{/Shift}');
    await waitFor(() => expect(posts('read')).toEqual([{ all: true }]));
    await waitFor(() => expect(toastTitles()).toContain('Alles gelesen'));
    expect(toastTitles().some((title) => title.startsWith('0 '))).toBe(false);
  });

  it('marks all read with shift+e, only mentions in the mentions filter', async () => {
    const user = setup();
    renderInbox('/inbox?mentions=1');
    await loaded();
    await waitFor(() => expect(status().textContent).toBe('3 ungelesen'));
    const button = () => screen.getByRole('button', { name: /Alle als gelesen markieren/ });
    expect(button().getAttribute('aria-disabled')).toBeNull();
    expect(button().getAttribute('aria-keyshortcuts')).toBe('Shift+E');

    await user.keyboard('{Shift>}E{/Shift}');
    await waitFor(() => expect(posts('read')).toEqual([{ all: true, mentions_only: true }]));
    // the toast says how many; the other unread ones stay
    await waitFor(() => expect(toastTitles()).toContain('1 Erwähnung als gelesen markiert'));
    expect(status().textContent).toBe('2 ungelesen');
    // nothing unread in the filter: the button is off and says why, shift+e says so without asking the server
    await waitFor(() => expect(button().getAttribute('aria-disabled')).toBe('true'));
    expect(screen.getByText('Es gibt keine ungelesenen Erwähnungen.')).toBeTruthy();
    await user.keyboard('{Shift>}E{/Shift}');
    expect(toastTitles()).toContain('Alles gelesen');
    expect(posts('read')).toHaveLength(1);

    // without the filter: everything
    act(() => address.set('/inbox'));
    await waitFor(() => expect(button().getAttribute('aria-disabled')).toBeNull());
    await user.keyboard('{Shift>}E{/Shift}');
    // at once, before the answer
    expect(rows().filter((row) => row.hasAttribute('data-unread'))).toHaveLength(0);
    await waitFor(() => expect(posts('read').at(-1)).toEqual({ all: true }));
    await waitFor(() => expect(toastTitles()).toContain('2 Benachrichtigungen als gelesen markiert'));
    await waitFor(() => expect(status().textContent).toBe('Alles gelesen'));
  });

  it('deletes with # and brings it back with mod+z', async () => {
    const user = setup();
    renderInbox();
    await loaded();

    await user.keyboard('j');
    await user.keyboard('#');
    // the row goes at once, the focus goes on to the row that moves up
    expect(rows()).toHaveLength(13);
    expect(screen.queryByRole('article', { name: /WEB-42/ })).toBeNull();
    expect(document.activeElement).toBe(rowLinks()[0]);
    expect(rowLinks()[0]!.textContent).toContain('erinnert');
    expect(toastTitles()).toContain('Benachrichtigung gelöscht');

    await user.keyboard('{Control>}z{/Control}');
    expect(rows()).toHaveLength(14);
    expect(api.calls.some((call) => call.method === 'DELETE')).toBe(false);

    // the next one goes for real when the toast runs out
    await user.keyboard('#');
    expect(rows()).toHaveLength(13);
    act(() => currentToasts().forEach((toast) => dismissToast(toast.id)));
    await waitFor(() => expect(api.calls.filter((call) => call.method === 'DELETE').map((call) => call.url)).toEqual(['/api/v1/notifications/n_02']));
    await waitFor(() => expect(notifications).toHaveLength(13));
    expect(rows()).toHaveLength(13);
  });

  it('puts the focus on "Alle als gelesen markieren" when the last row goes', async () => {
    const user = setup();
    notifications = notifications.slice(0, 1);
    renderInbox();
    await loaded();

    await user.keyboard('j');
    await user.keyboard('#');
    expect(screen.queryAllByRole('listitem')).toHaveLength(0);
    expect(document.activeElement).toBe(screen.getByRole('button', { name: /Alle als gelesen markieren/ }));
  });

  it('brings a row back and says why when the delete fails', async () => {
    const user = setup();
    overrides['DELETE /api/v1/notifications/n_01'] = () => unavailable;
    renderInbox();
    await loaded();

    await user.keyboard('j');
    await user.keyboard('#');
    act(() => currentToasts().forEach((toast) => dismissToast(toast.id)));
    await waitFor(() => expect(toastTitles()).toContain('Benachrichtigung nicht gelöscht'));
    expect(rows()).toHaveLength(14);
  });

  it('opens the preview with Enter and reads it', async () => {
    const user = setup();
    renderInbox();
    await loaded();

    await user.keyboard('j');
    await user.keyboard('{Enter}');
    // the preview, not the page; the notification is read, the cursor stays on it
    expect(useUiStore.getState().peekItemId).toBe('wi_web_42');
    expect(address.visit).not.toHaveBeenCalled();
    expect(rows()[0]!.hasAttribute('data-unread')).toBe(false);
    expect(status().textContent).toBe('2 ungelesen');
    await waitFor(() => expect(posts('read')).toEqual([{ ids: ['n_01'] }]));
    expect(rows()[0]!.hasAttribute('data-current')).toBe(true);

    // with the focus nowhere in particular Enter opens the row under the cursor as well
    act(() => useUiStore.getState().openPeek(null));
    await user.keyboard('j');
    await user.keyboard('j');
    await user.keyboard('j');
    act(() => (document.activeElement as HTMLElement).blur());
    await user.keyboard('{Enter}');
    expect(useUiStore.getState().peekItemId).toBe('wi_app_24');
    await waitFor(() => expect(posts('read')).toEqual([{ ids: ['n_01'] }, { ids: ['n_04'] }]));
    // the focus goes back to the row, so e and u act on it beside the preview
    expect(document.activeElement).toBe(rowLinks()[3]);
    // the space bar hides the preview of the row's item and shows it again
    await user.keyboard(' ');
    expect(useUiStore.getState().peekItemId).toBeNull();
    await user.keyboard(' ');
    expect(useUiStore.getState().peekItemId).toBe('wi_app_24');
  });

  it('reads on a click with mod and on a middle click', async () => {
    // jsdom cannot open a new tab: the click ends with the screen
    const stay = (event: Event) => event.preventDefault();
    document.addEventListener('click', stay);
    onTestFinished(() => document.removeEventListener('click', stay));
    renderInbox();
    await loaded();

    // ⌘/Ctrl or ⇧ and the middle button: the browser opens the page in a new tab, the notification is read
    fireEvent.click(screen.getByRole('link', { name: /^Ungelesen: Theo Okafor hat dir das Item zugewiesen/ }), { ctrlKey: true });
    fireEvent(screen.getByRole('link', { name: /Theo Okafor hat kommentiert/ }), new MouseEvent('auxclick', { bubbles: true, button: 1 }));
    // Alt saves the link: nothing opens, nothing is read
    fireEvent.click(screen.getByRole('link', { name: /Ida Brenner hat dich erwähnt.*Hero/ }), { altKey: true });
    expect(useUiStore.getState().peekItemId).toBeNull();
    await waitFor(() => expect(posts('read')).toEqual([{ ids: ['n_04'] }, { ids: ['n_03'] }]));
    expect(rowOf(/hat dich erwähnt.*Hero/).hasAttribute('data-unread')).toBe(true);

    // the title of a card opens the item's page: all of its notifications are read
    fireEvent.click(screen.getByRole('link', { name: 'WEB-42: Startseite: Hero und Teaser bauen' }), { metaKey: true });
    await waitFor(() => expect(posts('read').at(-1)).toEqual({ ids: ['n_01'] }));
    await waitFor(() => expect(status().textContent).toBe('Alles gelesen'));
    // in a new tab by the middle button as well; a card with nothing unread asks nothing
    fireEvent(screen.getByRole('link', { name: 'APP-18: TestFlight-Gruppe für Kunden einrichten' }), new MouseEvent('auxclick', { bubbles: true, button: 1 }));
    expect(posts('read')).toHaveLength(3);
  });

  it('moves on when a read row leaves the unread filter', async () => {
    const user = setup();
    renderInbox('/inbox?unread=1');
    await loaded();
    expect(rows()).toHaveLength(3);

    await user.keyboard('j');
    await user.keyboard('e');
    // the row leaves, the cursor and the focus go on to the row that moves up
    expect(rows()).toHaveLength(2);
    expect(document.activeElement).toBe(rowLinks()[0]);
    expect(rowLinks()[0]!.textContent).toContain('Theo Okafor hat dir das Item zugewiesen');
    expect(rows()[0]!.hasAttribute('data-current')).toBe(true);

    // opening reads as well: the row leaves, the preview stays open
    await user.keyboard('{Enter}');
    expect(useUiStore.getState().peekItemId).toBe('wi_app_24');
    expect(rows()).toHaveLength(1);
    expect(document.activeElement).toBe(rowLinks()[0]);
    expect(rowLinks()[0]!.textContent).toContain('Theo Okafor hat kommentiert');

    // the last one goes: the focus stays in reach, on the button of the header
    await user.keyboard('e');
    expect(screen.queryAllByRole('listitem')).toHaveLength(0);
    expect(document.activeElement).toBe(screen.getByRole('button', { name: /Alle als gelesen markieren/ }));
    await waitFor(() => expect(posts('read')).toEqual([{ ids: ['n_01'] }, { ids: ['n_04'] }, { ids: ['n_03'] }]));
  });

  it('reaches the row actions with Tab', async () => {
    const user = setup();
    renderInbox();
    await loaded();
    const read = (key: string) => screen.getByRole('button', { name: `Als gelesen markieren: ${key}` });

    // the row is one stop, its actions follow it; the actions of the other rows are no stops
    expect(read('WEB-42').tabIndex).toBe(0);
    expect(read('APP-24').tabIndex).toBe(-1);
    await user.keyboard('j');
    await user.tab();
    expect(document.activeElement).toBe(read('WEB-42'));
    await user.tab();
    expect(document.activeElement).toBe(screen.getAllByRole('button', { name: 'Löschen: WEB-42' })[0]);

    // the button acts on its row and keeps the focus, now as the way back
    await user.tab({ shift: true });
    await user.keyboard('{Enter}');
    await waitFor(() => expect(posts('read')).toEqual([{ ids: ['n_01'] }]));
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Als ungelesen markieren: WEB-42' }));

    await user.keyboard('{Enter}');
    await waitFor(() => expect(posts('unread')).toEqual([{ ids: ['n_01'] }]));
    expect(document.activeElement).toBe(read('WEB-42'));

    // the delete button takes the row away, the focus goes on to the row that moves up
    await user.tab();
    await user.keyboard('{Enter}');
    expect(screen.queryByRole('article', { name: /WEB-42/ })).toBeNull();
    expect(document.activeElement).toBe(rowLinks()[0]);
    expect(rowLinks()[0]!.textContent).toContain('erinnert');

    // what belongs to no item names its card
    expect(screen.getByRole('button', { name: 'Löschen: Organisation' })).toBeTruthy();
    // a mouse click on a row's button is that row's
    await user.click(screen.getByRole('button', { name: 'Als gelesen markieren: APP-24' }));
    await waitFor(() => expect(posts('read').at(-1)).toEqual({ ids: ['n_04'] }));
    expect(useUiStore.getState().peekItemId).toBeNull();
  });

  it('reads and deletes from the menu of a row without opening it, also a row without an item', async () => {
    const user = setup();
    renderInbox();
    await loaded();

    // every row has the menu of a touch screen; an unread one is read there, nothing opens
    await user.click(screen.getByRole('button', { name: 'Aktionen: WEB-42' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Als gelesen markieren' }));
    await waitFor(() => expect(posts('read')).toEqual([{ ids: ['n_01'] }]));
    expect(useUiStore.getState().peekItemId).toBeNull();
    expect(address.visit).not.toHaveBeenCalled();
    expect(rows()[0]!.hasAttribute('data-unread')).toBe(false);
    // and unread again
    await user.click(screen.getByRole('button', { name: 'Aktionen: WEB-42' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Als ungelesen markieren' }));
    await waitFor(() => expect(posts('unread')).toEqual([{ ids: ['n_01'] }]));

    // the switched-off webhook belongs to no item: deleted from its menu, the focus goes on to the row that moves up
    await user.click(screen.getByRole('button', { name: 'Aktionen: Organisation' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Benachrichtigung löschen' }));
    expect(screen.queryByRole('region', { name: 'Organisation' })).toBeNull();
    expect(address.visit).not.toHaveBeenCalled();
    // the link of that row, not a container on the way (Base UI hands the focus back a frame later; `main` holds the text too)
    await waitFor(() => {
      expect(document.activeElement?.hasAttribute('data-nav-target')).toBe(true);
      expect(document.activeElement?.textContent).toContain('Eine Vorlage hat kein Item angelegt');
    });
    act(() => currentToasts().forEach((toast) => dismissToast(toast.id)));
    await waitFor(() => expect(api.calls.filter((call) => call.method === 'DELETE').map((call) => call.url)).toEqual(['/api/v1/notifications/n_10']));
  });

  it('puts the focus on the next row after a delete from the palette', async () => {
    const user = setup();
    renderInbox('/inbox', { palette: true });
    await loaded();

    await user.keyboard('j');
    act(() => useUiStore.getState().setPaletteOpen(true));
    const input = await screen.findByRole('combobox');
    await waitFor(() => expect(document.activeElement).toBe(input));
    await user.keyboard('Benachrichtigung löschen');
    await user.keyboard('{Enter}');

    // the palette gave the focus back to the row that left: it goes on to the row that moved up, not to the page
    expect(screen.queryByRole('article', { name: /WEB-42/ })).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(rowLinks()[0]));
    expect(rowLinks()[0]!.textContent).toContain('erinnert');
  });

  it('waits until a popup has given the focus back, and takes it only when it fell to the page', async () => {
    const popup = document.createElement('div');
    popup.setAttribute('role', 'menu');
    const entry = document.createElement('button');
    popup.append(entry);
    const target = document.createElement('button');
    const elsewhere = document.createElement('button');
    document.body.append(popup, target, elsewhere);
    onTestFinished(() => [popup, target, elsewhere].forEach((element) => element.remove()));
    const frame = () => act(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));

    // the popup is still open: nothing moves
    entry.focus();
    focusLater(() => target);
    await frame();
    expect(document.activeElement).toBe(entry);
    // it closed and the focus fell to the page: the target takes it
    popup.remove();
    await waitFor(() => expect(document.activeElement).toBe(target));

    // a popup that gave the focus somewhere else leaves it there
    document.body.append(popup);
    entry.focus();
    focusLater(() => target);
    elsewhere.focus();
    await frame();
    expect(document.activeElement).toBe(elsewhere);
  });

  it('offers the row commands in the palette', async () => {
    const user = setup();
    renderInbox();
    await loaded();
    const offered = () =>
      listCommands()
        .filter((command) => command.id.startsWith('inbox.') && (command.when?.() ?? true))
        .map((command) => [command.label, command.keys]);
    const run = (id: string) => act(() => listCommands().find((command) => command.id === id)!.run());

    // without a cursor only "all read"
    expect(offered()).toEqual([['Alle Benachrichtigungen als gelesen markieren', 'shift+e']]);
    await user.keyboard('j');
    expect(offered()).toEqual([
      ['Benachrichtigung als gelesen markieren', 'e'],
      ['Benachrichtigung löschen', '#'],
      ['Alle Benachrichtigungen als gelesen markieren', 'shift+e'],
    ]);
    run('inbox.read');
    await waitFor(() => expect(posts('read')).toEqual([{ ids: ['n_01'] }]));
    expect(offered().map(([label]) => label)).toContain('Benachrichtigung als ungelesen markieren');
    run('inbox.unread');
    await waitFor(() => expect(posts('unread')).toEqual([{ ids: ['n_01'] }]));
    run('inbox.delete');
    expect(rows()).toHaveLength(13);
    run('inbox.read_all');
    await waitFor(() => expect(posts('read').at(-1)).toEqual({ all: true }));

    // in the mentions filter "all read" names the mentions
    act(() => address.set('/inbox?mentions=1'));
    await waitFor(() => expect(offered().map(([label]) => label)).toContain('Alle Erwähnungen als gelesen markieren'));
  });
});

describe('the page', () => {
  it('shows the inbox screen in the shell', async () => {
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <InboxPage />
      </QueryClientProvider>,
    );

    expect(await screen.findByRole('heading', { level: 1, name: 'Inbox' })).toBeTruthy();
    expect(InboxPage.layout).toBe(shellLayout);
    expect(document.title).toContain('Inbox');
  });
});
