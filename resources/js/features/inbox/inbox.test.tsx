/*
 * The inbox against a fake REST API (`mockApi`): Mara's inbox as the NotificationsSeeder writes it (`maraInbox`), the
 * filters in the address (an Inertia mock whose `router.replace` moves it), the states of the list and a live message
 * that loads it again. Ported from the clickdummy's features/inbox/inbox.test.tsx ("the list" and the states); the keys,
 * the read marks and deleting come with task 17. The flows with a real server run in e2e/tests/inbox.spec.ts.
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useSyncExternalStore, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LiveEvent } from '@/api/live';
import { useLiveSync } from '@/hooks/live';
import { useUiStore } from '@/store/ui';
import { mockApi, type MockApi, type MockRoute } from '@/test/api';
import { ida, lene, list, makeNotification, mara, maraInbox, organization, person, project, properties, theo, types } from '@/test/fixtures';
import type { Notification, User } from '@/types';
import InboxPage from '@/pages/Inbox/Index';
import { shellLayout } from '@/shell/layout';
import { InboxScreen } from './InboxScreen';

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
      const { mentions_only: mentionsOnly } = body as { all: true; mentions_only?: boolean };
      let updated = 0;
      notifications = notifications.map((entry) => {
        if (entry.read_at !== null || (mentionsOnly && entry.event !== 'mentioned')) return entry;
        updated += 1;
        return { ...entry, read_at: '2026-10-28T09:00:00.000Z' };
      });
      return { body: { updated } };
    };
  if (key === 'GET /api/v1/projects') return () => ({ body: list(projects) });
  if (key === 'GET /api/v1/work-item-types') return () => ({ body: list(types) });
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
  api = mockApi(server);
});

afterEach(() => {
  api.restore();
  bus.listeners.clear();
  vi.useRealTimers();
});

/** What the shell does for the screen: the live sync. */
function LiveSync() {
  useLiveSync();
  return null;
}

function renderInbox(url = '/inbox') {
  address.set(url);
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <LiveSync />
      <main id="main" tabIndex={-1}>
        <InboxScreen />
      </main>
    </QueryClientProvider>,
  );
}

/** The list once its first load is over (the skeleton is gone). */
const loaded = () => screen.findByRole('article', { name: /WEB-42/ });
const rows = () => screen.getAllByRole('listitem');
const rowLinks = () => screen.getAllByRole('link').filter((link) => link.hasAttribute('data-nav-target'));
const card = (name: RegExp) => screen.getByRole('article', { name });
const status = () => screen.getByRole('status');

function send(event: Partial<LiveEvent>): void {
  act(() => bus.listeners.forEach((listener) => listener({ event_id: null, type: 'notifications.changed', project_id: null, item_id: null, comment_id: null, actor_id: null, ...event })));
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

  it('shows what belongs to no item without the template or the webhook behind it', async () => {
    renderInbox();
    await loaded();

    const organisation = screen.getByRole('region', { name: 'Organisation' });
    const webhook = within(organisation).getByRole('link', { name: /Ein Webhook wurde abgeschaltet/ });
    expect(webhook.textContent).toContain('Er war 24');
    expect(webhook.getAttribute('href')).toBe('/settings');
    const template = within(screen.getByRole('region', { name: 'Infrastruktur' })).getByRole('link', { name: /Eine Vorlage hat kein Item angelegt/ });
    expect(template.textContent).toContain('„Pflicht-Property Umgebung fehlt“');
    expect(template.getAttribute('href')).toBe('/projects/OPS');

    // a plain click leads to its page: nothing to preview
    fireEvent.click(template);
    expect(address.visit).toHaveBeenCalledWith('/projects/OPS');
    expect(useUiStore.getState().peekItemId).toBeNull();
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
