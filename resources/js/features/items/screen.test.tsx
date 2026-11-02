/*
 * The items screen against a fake REST API (`mockApi`): `/groups` and `/query` answer from a small set of items the
 * way the server does (filter, group, count), the catalogs come as lists. Inertia is a fake whose address the tests
 * change (`inertia.go`) and whose `router.get` moves the address as the server would answer. jsdom lays nothing out:
 * every row reports a height, `window.scrollTo` moves `scrollY` (as in list.test.tsx).
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { MouseEvent, ReactNode } from 'react';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { currentToasts, resetToasts } from '@/components/ui/toast';
import { TooltipProvider } from '@/components/ui/Tooltip';
import { qk } from '@/hooks/keys';
import { mockApi, type MockApi } from '@/test/api';
import { agency, labels, lene, list, makeView, makeWorkItem, mara, organization, project, properties, standard, types } from '@/test/fixtures';
import { useUiStore } from '@/store/ui';
import type { Condition, GroupBy, Project, View, WorkItem } from '@/types';
import { resultMessage, selectionMessage } from './ListAnnouncer';
import { ItemsScreen, type ItemsScreenProps } from './ItemsScreen';

/* --------------------------------------------------------------------- fake Inertia */

const inertia = vi.hoisted(() => {
  let url = '/projects/WEB';
  const listeners = new Set<() => void>();
  return {
    get url() {
      return url;
    },
    go(next: string) {
      url = next;
      listeners.forEach((listener) => listener());
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    get: vi.fn(),
    /** How the server answers a visit: by default at once, with the address asked for. */
    answer: (url: string, options: { onSuccess?: () => void; onFinish?: () => void }) => {
      inertia.go(url);
      options.onSuccess?.();
      options.onFinish?.();
    },
    visit: vi.fn(),
    replace: vi.fn(),
  };
});

vi.mock('@inertiajs/react', async () => {
  const { useSyncExternalStore } = await import('react');
  return {
    usePage: () => ({
      props: { auth: { user: lene, permissions: [] }, organization },
      url: useSyncExternalStore(inertia.subscribe, () => inertia.url),
    }),
    router: {
      // the server answers the address it was asked for
      get: (url: string, data: unknown, options: { onSuccess?: () => void; onFinish?: () => void }) => {
        inertia.get(url, data, options);
        inertia.answer(url, options);
      },
      visit: inertia.visit,
      replace: inertia.replace,
      on: () => () => {},
    },
    Link: ({ href, onClick, children, ...rest }: { href: string; onClick?: (event: MouseEvent) => void; children: ReactNode }) => (
      <a
        href={href}
        {...rest}
        onClick={(event) => {
          onClick?.(event);
          event.preventDefault();
        }}
      >
        {children}
      </a>
    ),
  };
});

/* ------------------------------------------------------------------- layout in jsdom */

let scrollY = 0;
const offsetHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight')!;
const scrollY0 = Object.getOwnPropertyDescriptor(window, 'scrollY');
const boundingRect = Element.prototype.getBoundingClientRect;
const scrollTo = window.scrollTo;

beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
    configurable: true,
    get(this: HTMLElement) {
      if (!this.hasAttribute('data-index')) return 0;
      return this.querySelector('h2') ? 48 : 36;
    },
  });
  Object.defineProperty(window, 'scrollY', { configurable: true, get: () => scrollY });
  // a column of the board and the table are boxes of their own, 600 px high
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
    configurable: true,
    get(this: HTMLElement) {
      return this.hasAttribute('data-board-list') || this.hasAttribute('data-table-scroller') ? 600 : 0;
    },
  });
  Element.prototype.getBoundingClientRect = function (this: Element) {
    return this.tagName === 'UL' ? new DOMRect(0, -scrollY, 1024, 0) : boundingRect.call(this);
  };
  Object.defineProperty(document.documentElement, 'scrollHeight', { configurable: true, get: () => 1_000_000 });
  window.scrollTo = ((options: ScrollToOptions) => {
    scrollY = Math.max(0, options.top ?? 0);
    window.dispatchEvent(new Event('scroll'));
  }) as typeof window.scrollTo;
  window.scrollBy = (() => {}) as typeof window.scrollBy;
});

afterAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', offsetHeight);
  Reflect.deleteProperty(HTMLElement.prototype, 'clientHeight');
  if (scrollY0) Object.defineProperty(window, 'scrollY', scrollY0);
  Reflect.deleteProperty(document.documentElement, 'scrollHeight');
  Element.prototype.getBoundingClientRect = boundingRect;
  window.scrollTo = scrollTo;
});

/* --------------------------------------------------------------------- fake server */

const item = (number: number, title: string, state_id: string, changes: Partial<WorkItem> = {}) =>
  makeWorkItem({ id: `wi_web_${number}`, number, key: `WEB-${number}`, title, state_id, rank: `a${number}`, ...changes });

const WEB_ITEMS: WorkItem[] = [
  item(1, 'Kontaktformular sendet doppelt', 'std_todo'),
  item(2, 'Formular-Validierung', 'std_todo'),
  item(3, 'Startseite überarbeiten', 'std_progress'),
  item(4, 'Logo austauschen', 'std_progress', { created_by: 'u_lene' }),
  item(5, 'Footer prüfen', 'std_done', { assignee_id: 'u_lene' }),
];

const CATEGORY: Record<string, string> = Object.fromEntries([...standard.states, ...agency.states].map((state) => [state.id, state.category]));

let items: WorkItem[];
let projects: Project[];
let views: View[];
/** The server answers a status grouping with categories (the items span several workflows). */
let fallBack: boolean;
/** What answers 503 for now. */
let failing: Set<'groups' | 'project' | 'view' | 'progress' | 'more'>;
/** How many items a page of the fake holds. */
let pageSize: number;
let api: MockApi | undefined;

interface Body {
  filter?: { conditions: Condition[] };
  group_by?: GroupBy;
  group?: string;
  per_page?: number;
  cursor?: string;
}

function matches(entry: WorkItem, condition: Condition): boolean {
  switch (condition.field) {
    case 'project':
      return entry.project_id === condition.value;
    case 'title':
      return entry.title.includes(String(condition.value));
    case 'assignee':
      return entry.assignee_id === (condition.value === 'me' ? lene.id : condition.value);
    case 'created_by':
      return entry.created_by === (condition.value === 'me' ? lene.id : condition.value);
    case 'subscribed':
      return entry.subscribed === condition.value;
    case 'state_category':
      return (condition.value as string[]).includes(CATEGORY[entry.state_id]!);
    default:
      return true;
  }
}

const hits = (body: Body) => items.filter((entry) => (body.filter?.conditions ?? []).every((condition) => matches(entry, condition)));

function keyOf(entry: WorkItem, by: GroupBy): string {
  if (by === 'category') return CATEGORY[entry.state_id]!;
  if (by === 'priority') return entry.priority;
  if (by === 'label') return entry.label_ids[0] ?? 'none';
  return by === 'state' ? entry.state_id : 'all';
}

/** Twenty labels, for a list of more groups than fit the window. */
const LABEL_KEYS = Array.from({ length: 20 }, (_, index) => `l_${index}`);

function groupsOf(body: Body) {
  const by: GroupBy = body.group_by === 'state' && fallBack ? 'category' : body.group_by!;
  const found = hits(body);
  const order =
    by === 'state'
      ? standard.states.map((state) => state.id)
      : by === 'category'
        ? ['backlog', 'unstarted', 'started', 'completed', 'canceled']
        : by === 'label'
          ? LABEL_KEYS
          : ['urgent', 'high', 'medium', 'low', 'none'];
  return { data: { group_by: by, total: found.length, groups: order.map((key) => ({ key, count: found.filter((entry) => keyOf(entry, by) === key).length })) } };
}

const UNAVAILABLE = { status: 503, body: { reason: 'unavailable', detail: 'Wartung.' } };

const queryBodies = () => (api?.calls ?? []).filter((call) => call.url === '/api/v1/work-items/query').map((call) => call.body as Body);
const groupBodies = () => (api?.calls ?? []).filter((call) => call.url === '/api/v1/work-items/groups').map((call) => call.body as Body);

beforeEach(() => {
  scrollY = 0;
  items = [...WEB_ITEMS];
  projects = [project('WEB', 'admin', { name: 'Website-Relaunch' })];
  views = [];
  fallBack = false;
  failing = new Set();
  pageSize = 100;
  inertia.go('/projects/WEB');
  inertia.get.mockClear();
  inertia.visit.mockClear();
  inertia.replace.mockClear();
  useUiStore.setState({ selection: [], peekItemId: null, createOpen: false, createDefaults: null });
  resetToasts();
  api = mockApi({
    'GET /api/v1/organization': () => ({ body: { data: organization } }),
    'GET /api/v1/projects': () => ({ body: list(projects) }),
    'GET /api/v1/projects/WEB': () => (failing.has('project') ? UNAVAILABLE : { body: { data: projects[0] } }),
    'GET /api/v1/projects/NOPE': () => ({ status: 404, body: { reason: 'not_found' } }),
    'GET /api/v1/workflows': () => ({ body: list([standard, agency]) }),
    'GET /api/v1/users': () => ({ body: list([mara, lene]) }),
    'GET /api/v1/labels': () => ({ body: list(labels) }),
    'GET /api/v1/work-item-types': () => ({ body: list(types) }),
    'GET /api/v1/properties': () => ({ body: list(properties) }),
    'GET /api/v1/favorites': () => ({ body: list([]) }),
    'GET /api/v1/views/v_due_week': () => {
      if (failing.has('view')) return UNAVAILABLE;
      const view = views.find((entry) => entry.id === 'v_due_week');
      return view ? { body: { data: view } } : { status: 404, body: { reason: 'not_found' } };
    },
    'POST /api/v1/work-items/groups': (body) => (failing.has('groups') ? UNAVAILABLE : { body: groupsOf(body as Body) }),
    'POST /api/v1/work-items/query': (body) => {
      const query = body as Body;
      if (failing.has('progress') && query.group === 'std_progress') return UNAVAILABLE;
      if (failing.has('more') && query.cursor !== undefined) return UNAVAILABLE;
      const found = hits(query).filter((entry) => query.group === undefined || keyOf(entry, query.group_by!) === query.group);
      const from = Number(query.cursor ?? 0);
      const next = from + pageSize < found.length ? String(from + pageSize) : null;
      return { body: { ...list(found.slice(from, from + pageSize), found.length), meta: { next_cursor: next, total: found.length } } };
    },
  });
});

afterEach(() => {
  api?.restore();
  api = undefined;
});

/** Holds the answers of the requests `when` names until the test lets them go. */
function hold(when: (body: Body, path: string) => boolean): { release(): void; held(): boolean } {
  let release = () => {};
  const gate = new Promise<void>((resolve) => (release = resolve));
  let held = false;
  const inner = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const path = new URL(String(input), window.location.origin).pathname;
    if (typeof init?.body === 'string' && when(JSON.parse(init.body) as Body, path)) {
      held = true;
      await gate;
    }
    return inner(input, init);
  };
  return { release, held: () => held };
}

let client: QueryClient;

function renderScreen(props: ItemsScreenProps = { preset: 'project', projectIdentifier: 'WEB' }) {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <TooltipProvider>
        <main id="main">
          <ItemsScreen {...props} />
        </main>
      </TooltipProvider>
    </QueryClientProvider>,
  );
}

const announcer = () => screen.getByRole('status', { name: 'Mitteilungen der Liste' });
const rowOf = (number: number) => document.querySelector<HTMLElement>(`[data-row-id="wi_web_${number}"]`);
const filterOf = (conditions: Condition[]) => encodeURIComponent(JSON.stringify(conditions));
const press = (key: string, init: KeyboardEventInit = {}) =>
  act(() => {
    (document.activeElement ?? document.body).dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }));
  });

/* -------------------------------------------------------------------------- tests */

describe('the item list screen', () => {
  it('empties the selection when the list goes away, so no other screen acts on it', async () => {
    const { unmount } = renderScreen();
    expect(await screen.findByRole('heading', { level: 1, name: 'Website-Relaunch' })).toBeTruthy();
    await screen.findByText('Kontaktformular sendet doppelt');
    act(() => useUiStore.getState().setSelection(['wi_web_1']));

    unmount();
    expect(useUiStore.getState().selection).toEqual([]);
  });

  it('names a project that does not exist instead of showing an empty list', async () => {
    renderScreen({ preset: 'project', projectIdentifier: 'NOPE' });
    expect(await screen.findByRole('heading', { level: 1, name: 'Das Projekt NOPE gibt es nicht' })).toBeTruthy();
    expect(groupBodies()).toEqual([]);
  });

  it('announces changes of the selection and of the results in one polite status region', async () => {
    renderScreen();
    await screen.findByText('Kontaktformular sendet doppelt');
    expect(announcer().getAttribute('aria-live') ?? 'polite').toBe('polite');
    // the first answer is the list itself: nothing to announce
    expect(announcer().textContent).toBe('');

    act(() => useUiStore.getState().setSelection(['wi_web_1']));
    await waitFor(() => expect(announcer().textContent).toBe('WEB-1 ausgewählt, 1 von 5'));
    act(() => useUiStore.getState().setSelection(['wi_web_1', 'wi_web_2']));
    await waitFor(() => expect(announcer().textContent).toBe('WEB-2 ausgewählt, 2 von 5'));
    act(() => useUiStore.getState().setSelection([]));
    await waitFor(() => expect(announcer().textContent).toBe('Auswahl aufgehoben'));

    act(() => inertia.go(`/projects/WEB?filter=${filterOf([{ field: 'title', op: 'contains', value: 'zzz' }])}`));
    await waitFor(() => expect(announcer().textContent).toBe('Kein Item passt zum Filter'));
    expect(screen.getByText('Ändere die Bedingungen oder setze den Filter zurück.')).toBeTruthy();
    act(() => inertia.go(`/projects/WEB?filter=${filterOf([{ field: 'title', op: 'contains', value: 'ormular' }])}`));
    await waitFor(() => expect(announcer().textContent).toBe('2 Items'));
    act(() => inertia.go(`/projects/WEB?filter=${filterOf([{ field: 'title', op: 'contains', value: 'Logo' }])}`));
    await waitFor(() => expect(announcer().textContent).toBe('Ein Item'));
  });

  it('filters by title from the filter bar and keeps the filter in the address', async () => {
    const user = userEvent.setup();
    renderScreen();
    await screen.findByText('Kontaktformular sendet doppelt');
    const search = screen.getByRole('searchbox', { name: 'Titel durchsuchen' });
    await user.type(search, 'Logo{Enter}');
    expect(inertia.url).toBe(`/projects/WEB?filter=${filterOf([{ field: 'title', op: 'contains', value: 'Logo' }])}`);
    await waitFor(() => expect(screen.queryByText('Kontaktformular sendet doppelt')).toBeNull());
    expect(screen.getByText('Logo austauschen')).toBeTruthy();
    expect(queryBodies().at(-1)!.filter!.conditions).toEqual([
      { field: 'project', op: 'is', value: 'p_web' },
      { field: 'title', op: 'contains', value: 'Logo' },
    ]);
  });

  it('sends no unfinished condition', async () => {
    const unfinished: Condition[] = [
      { field: 'state', op: 'in', value: [] },
      { field: 'title', op: 'contains', value: 'Logo' },
      { field: 'due_date', op: 'between', value: ['today', null] },
    ];
    inertia.go(`/projects/WEB?filter=${filterOf(unfinished)}`);
    renderScreen();
    expect(await screen.findByText('Logo austauschen')).toBeTruthy();
    // the chips stand, the server only hears the condition that says something
    expect(screen.getByRole('group', { name: /^Filter: Status ist kein Wert, noch ohne Wert$/ })).toBeTruthy();
    const sent = [{ field: 'project', op: 'is', value: 'p_web' }, unfinished[1]];
    expect(groupBodies().every((body) => JSON.stringify(body.filter!.conditions) === JSON.stringify(sent))).toBe(true);
    expect(queryBodies().every((body) => JSON.stringify(body.filter!.conditions) === JSON.stringify(sent))).toBe(true);
    // a list whose conditions are all unfinished is not filtered
    act(() => inertia.go(`/projects/WEB?filter=${filterOf([unfinished[0]!])}`));
    expect(await screen.findByText('Kontaktformular sendet doppelt')).toBeTruthy();
    expect(queryBodies().at(-1)!.filter!.conditions).toEqual([{ field: 'project', op: 'is', value: 'p_web' }]);
  });

  it('says every change of the selection in words', () => {
    const loaded = WEB_ITEMS;
    expect(selectionMessage([], [], loaded)).toBeNull();
    expect(selectionMessage(['wi_web_1'], [], loaded)).toBe('Auswahl aufgehoben');
    expect(selectionMessage([], ['wi_x'], loaded, 9)).toBe('Ein Item ausgewählt, 1 von 9');
    expect(selectionMessage(['wi_web_1', 'wi_web_2'], ['wi_web_1'], loaded)).toBe('WEB-2 abgewählt, 1 von 5');
    expect(selectionMessage([], loaded.map((entry) => entry.id), loaded)).toBe('Alle 5 Items ausgewählt');
    expect(selectionMessage([], ['wi_web_1', 'wi_web_2'], loaded, 1_200)).toBe('2 Items ausgewählt, 2 von 1.200');
    expect(selectionMessage(['wi_web_1'], ['wi_web_2'], loaded)).toBe('1 Item ausgewählt, 1 von 5');
    expect(selectionMessage(['wi_web_1', 'wi_web_2', 'wi_web_3'], ['wi_web_1'], loaded)).toBe('2 Items abgewählt, 1 von 5');
    expect(resultMessage(0, false)).toBe('Keine Items');
    expect(resultMessage(1_200, true)).toBe('1.200 Items');
  });

  it('switches the layout with 1 to 4 and keeps the focus on the list', async () => {
    renderScreen();
    await screen.findByText('Kontaktformular sendet doppelt');
    await waitFor(() => expect(rowOf(1)?.tabIndex).toBe(0));
    act(() => rowOf(1)!.focus());

    press('2');
    expect(inertia.get).toHaveBeenLastCalledWith('/projects/WEB?layout=board', {}, expect.objectContaining({ preserveState: true, replace: true }));
    const switches = screen.getAllByRole('group', { name: 'Layout' });
    await waitFor(() => expect(within(switches[0]!).getByRole('button', { name: /Board/ }).getAttribute('aria-pressed')).toBe('true'));
    // the board loads as a chunk of its own: the focus waits for it and goes to the card of the cursor
    await waitFor(() => expect(document.activeElement?.getAttribute('data-card-id')).toBe('wi_web_1'));

    press('3');
    expect(inertia.url).toBe('/projects/WEB?layout=table');
    // the table is a chunk of its own too: the focus waits for it (not the toolbar) and goes to the cell of the cursor
    await waitFor(() => expect([document.activeElement?.getAttribute('data-item-id'), document.activeElement?.getAttribute('data-column')]).toEqual(['wi_web_1', '0']));
    press('4');
    expect(inertia.url).toBe('/projects/WEB?layout=timeline');
    // back to the base: nothing left in the address
    press('1');
    expect(inertia.url).toBe('/projects/WEB');
    await waitFor(() => expect(document.activeElement?.closest('[data-row-id]')).toBe(rowOf(1)));

    // the switch itself, by click
    fireEvent.click(within(screen.getAllByRole('group', { name: 'Layout' })[0]!).getByRole('button', { name: /Tabelle/ }));
    expect(inertia.url).toBe('/projects/WEB?layout=table');
  });

  it('gives the focus back to the list when what had it goes away', async () => {
    renderScreen();
    await screen.findByText('Kontaktformular sendet doppelt');
    // the reset of an empty filter: a button that goes once the rows are back
    act(() => inertia.go(`/projects/WEB?filter=${filterOf([{ field: 'title', op: 'contains', value: 'zzz' }])}`));
    const reset = await screen.findByRole('button', { name: 'Filter zurücksetzen' });
    act(() => reset.focus());
    fireEvent.click(reset);
    expect(inertia.url).toBe('/projects/WEB');
    await screen.findByText('Kontaktformular sendet doppelt');
    await waitFor(() => expect(document.activeElement?.closest('[data-row-id]')).toBe(rowOf(1)));
  });

  it('keeps the rows of the old filter until the new answer is there', async () => {
    renderScreen();
    await screen.findByText('Kontaktformular sendet doppelt');

    const gate = hold((body) => (body.filter?.conditions ?? []).some((condition) => condition.field === 'title'));
    act(() => inertia.go(`/projects/WEB?filter=${filterOf([{ field: 'title', op: 'contains', value: 'Logo' }])}`));
    await waitFor(() => expect(gate.held()).toBe(true));
    // the old rows stay, marked busy; no skeleton
    expect(screen.getByText('Kontaktformular sendet doppelt')).toBeTruthy();
    expect(document.querySelector('[aria-busy="true"]')).toBeTruthy();
    expect(screen.queryByText('Items werden geladen …')).toBeNull();

    await act(async () => gate.release());
    await waitFor(() => expect(screen.queryByText('Kontaktformular sendet doppelt')).toBeNull());
    expect(screen.getByText('Logo austauschen')).toBeTruthy();
    expect(document.querySelector('[aria-busy="true"]')).toBeNull();
  });

  it.each([
    ['list', 'Liste'],
    ['board', 'Board'],
    ['table', 'Tabelle'],
    ['timeline', 'Timeline'],
  ])('shows a skeleton in the shape of the %s while it loads', async (layout) => {
    hold((_body, path) => path.endsWith('/groups'));
    inertia.go(`/projects/WEB?layout=${layout}`);
    renderScreen();
    await screen.findByRole('heading', { level: 1, name: 'Website-Relaunch' });
    // only after a moment, so a quick answer shows without it
    expect(document.querySelector('[data-skeleton]')).toBeNull();
    await waitFor(() => expect(document.querySelector(`[data-skeleton="${layout}"]`)).toBeTruthy());
    expect(screen.getByText('Items werden geladen …')).toBeTruthy();
  });

  it('says that it grouped by category when the items have several workflows', async () => {
    fallBack = true;
    renderScreen();
    expect(await screen.findByText('Mehrere Workflows: nach Kategorie gruppiert.')).toBeTruthy();
    expect(screen.getByRole('button', { name: /^Started/ })).toBeTruthy();
  });

  it('pages the groups of the category fallback with group_by category', async () => {
    fallBack = true;
    renderScreen();
    await screen.findByText('Startseite überarbeiten');
    expect(groupBodies().map((body) => body.group_by)).toEqual(['state']);
    const pages = queryBodies();
    expect(pages.length).toBeGreaterThan(0);
    expect(pages.every((body) => body.group_by === 'category')).toBe(true);
    expect(pages.map((body) => body.group)).toContain('started');
    // lean, with the sub-items of the state and the scope of the project
    expect(pages[0]).toMatchObject({ lean: true, show_sub_items: true, filter: { conditions: [{ field: 'project', op: 'is', value: 'p_web' }] } });
  });

  it('loads a group when its heading comes into view and not before', async () => {
    // twenty groups of three: the last ones are far below the window
    items = Array.from({ length: 60 }, (_, index) => item(100 + index, `Aufgabe ${index}`, 'std_todo', { label_ids: [LABEL_KEYS[index % 20]!] }));
    inertia.go('/projects/WEB?group=label');
    renderScreen();
    await screen.findByText('Aufgabe 0');
    expect(queryBodies().map((body) => body.group)).toContain('l_0');
    expect(queryBodies().map((body) => body.group)).not.toContain('l_19');

    act(() => window.scrollTo({ top: 3_000 }));
    await screen.findByText('Aufgabe 19');
    expect(queryBodies().map((body) => body.group)).toContain('l_19');
  });

  it('reads the state from the address and writes only what differs', async () => {
    inertia.go('/projects/WEB?create=1&group=priority');
    renderScreen();
    await screen.findByText('Kontaktformular sendet doppelt');
    expect(groupBodies()[0]).toMatchObject({ group_by: 'priority', sort: { field: 'rank', direction: 'asc' } });

    press('2');
    // what is not the view state stays; the grouping that differs stays; the layout joins it
    expect(inertia.url).toBe('/projects/WEB?create=1&layout=board&group=priority');
    press('1');
    expect(inertia.url).toBe('/projects/WEB?create=1&group=priority');
    // an unreadable part is left out: the base shows
    act(() => inertia.go('/projects/WEB?group=nonsense&layout=board'));
    await waitFor(() => expect(groupBodies().at(-1)).toMatchObject({ group_by: 'state' }));
  });

  it('shows the change at once, before the address of the server is there', async () => {
    renderScreen();
    await screen.findByText('Kontaktformular sendet doppelt');
    const board = () => within(screen.getAllByRole('group', { name: 'Layout' })[0]!).getByRole('button', { name: /Board/ });
    // the server takes its time
    const answer = inertia.answer;
    const visits: [string, { onSuccess?: () => void; onFinish?: () => void }][] = [];
    inertia.answer = (url, options) => void visits.push([url, options]);
    try {
      press('2');
      await waitFor(() => expect(board().getAttribute('aria-pressed')).toBe('true'));
      expect(inertia.url).toBe('/projects/WEB');
      // a second change builds on the first
      press('3');
      expect(visits.map(([url]) => url)).toEqual(['/projects/WEB?layout=board', '/projects/WEB?layout=table']);
      // the first visit is cancelled by the second: what shows stays the second
      act(() => visits[0]![1].onFinish?.());
      expect(within(screen.getAllByRole('group', { name: 'Layout' })[0]!).getByRole('button', { name: /Tabelle/ }).getAttribute('aria-pressed')).toBe('true');
      // the second fails: the address shows again
      act(() => visits[1]![1].onFinish?.());
      await waitFor(() => expect(within(screen.getAllByRole('group', { name: 'Layout' })[0]!).getByRole('button', { name: /Liste/ }).getAttribute('aria-pressed')).toBe('true'));
      // and once one gets through, the address is the state
      press('2');
      act(() => {
        inertia.go(visits[2]![0]);
        visits[2]![1].onSuccess?.();
        visits[2]![1].onFinish?.();
      });
      expect(board().getAttribute('aria-pressed')).toBe('true');
    } finally {
      inertia.answer = answer;
    }
  });

  it('shows the archived project read-only', async () => {
    projects = [project('WEB', 'admin', { name: 'Website-Relaunch', archived_at: '2026-10-20T10:00:00.000Z' })];
    renderScreen();
    expect(await screen.findByText('Archiviert, schreibgeschützt')).toBeTruthy();
    expect(screen.getByText('Das Projekt Website-Relaunch ist archiviert. Seine Items lassen sich lesen, aber nicht ändern.')).toBeTruthy();
    const create = screen.getByRole('button', { name: /^Neues Item/ });
    await waitFor(() => expect(create.getAttribute('aria-disabled')).toBe('true'));
    fireEvent.click(create);
    expect(useUiStore.getState().createOpen).toBe(false);
  });

  it('creates an item in the project from the toolbar', async () => {
    renderScreen();
    const create = await screen.findByRole('button', { name: /^Neues Item/ });
    await waitFor(() => expect(create.hasAttribute('aria-disabled')).toBe(false));
    fireEvent.click(create);
    expect(useUiStore.getState()).toMatchObject({ createOpen: true, createDefaults: { project_id: 'p_web' } });
  });

  it('opens the preview from the title and lets it follow the cursor', async () => {
    const user = userEvent.setup();
    renderScreen();
    const title = await screen.findByRole('link', { name: /Kontaktformular sendet doppelt/ });
    await user.click(title);
    expect(useUiStore.getState().peekItemId).toBe('wi_web_1');

    // j moves the cursor; the open preview follows it
    press('j');
    await waitFor(() => expect(useUiStore.getState().peekItemId).toBe('wi_web_2'));
    // without a preview the cursor moves alone
    act(() => useUiStore.getState().openPeek(null));
    press('j');
    await waitFor(() => expect(document.activeElement?.closest('[data-row-id]')).toBe(rowOf(3)));
    expect(useUiStore.getState().peekItemId).toBeNull();
    // the space bar opens it again, Enter opens the page
    press(' ');
    expect(useUiStore.getState().peekItemId).toBe('wi_web_3');
    press('Enter');
    expect(inertia.visit).toHaveBeenCalledWith('/items/WEB-3');
  });

  it('selects every item with mod+a, and drops the selection of items that leave the list', async () => {
    renderScreen();
    await screen.findByText('Kontaktformular sendet doppelt');
    act(() => rowOf(1)!.focus());
    press('a', { ctrlKey: true });
    await waitFor(() => expect(useUiStore.getState().selection).toHaveLength(5));
    await waitFor(() => expect(announcer().textContent).toBe('Alle 5 Items ausgewählt'));

    act(() => inertia.go(`/projects/WEB?filter=${filterOf([{ field: 'title', op: 'contains', value: 'ormular' }])}`));
    await waitFor(() => expect(useUiStore.getState().selection).toEqual(['wi_web_1', 'wi_web_2']));
  });

  it('says so when mod+a cannot load every item, and offers to try again', async () => {
    renderScreen();
    await screen.findByText('Kontaktformular sendet doppelt');
    // Done has not loaded yet (the layout enables a group once its rows are rendered): its page fails
    const done = rowOf(5);
    expect(done).toBeTruthy();
    const inner = globalThis.fetch;
    globalThis.fetch = (input, init) =>
      typeof init?.body === 'string' && (JSON.parse(init.body) as Body).group === 'std_done' && (JSON.parse(init.body) as { cursor?: string }).cursor === undefined
        ? Promise.resolve(new Response(JSON.stringify({ reason: 'unavailable' }), { status: 503, headers: { 'Content-Type': 'application/problem+json' } }))
        : inner(input, init);
    try {
      await act(() => client.invalidateQueries({ queryKey: qk.workItems.all }));
      act(() => rowOf(1)!.focus());
      press('a', { ctrlKey: true });
      await waitFor(() => expect(currentToasts().map((toast) => toast.title)).toContain('Nicht alle Items geladen'));
    } finally {
      globalThis.fetch = inner;
    }
  });

  it('drops ⌘A of a list that went away meanwhile', async () => {
    // a page each: ⌘A has further pages to load, and they wait
    pageSize = 1;
    const { unmount } = renderScreen();
    await screen.findByText('Kontaktformular sendet doppelt');
    const gate = hold((body) => body.cursor !== undefined);
    act(() => rowOf(1)!.focus());
    press('a', { ctrlKey: true });
    await waitFor(() => expect(gate.held()).toBe(true));

    unmount();
    expect(useUiStore.getState().selection).toEqual([]);
    await act(async () => gate.release());
    // the items of a list that is gone are of no use: no other screen may act on them
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(useUiStore.getState().selection).toEqual([]);
    expect(currentToasts()).toEqual([]);
  });

  it('drops ⌘A of a list whose filter changed meanwhile', async () => {
    renderScreen();
    await screen.findByText('Kontaktformular sendet doppelt');
    const gate = hold((body) => body.group === 'std_done');
    act(() => rowOf(1)!.focus());
    press('a', { ctrlKey: true });
    await waitFor(() => expect(gate.held()).toBe(true));
    act(() => inertia.go(`/projects/WEB?filter=${filterOf([{ field: 'title', op: 'contains', value: 'Logo' }])}`));
    await screen.findByText('Logo austauschen');
    await act(async () => gate.release());
    // the items of the old list are of no use: nothing selected, nothing said
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(useUiStore.getState().selection).toEqual([]);
    expect(currentToasts()).toEqual([]);
  });

  it('offers to try again when the list cannot be loaded', async () => {
    failing.add('groups');
    renderScreen();
    expect(await screen.findByText('Die Items konnten nicht geladen werden')).toBeTruthy();
    expect(screen.getByText('Wartung. Die Liste erscheint, sobald der Server wieder antwortet.')).toBeTruthy();
    failing.delete('groups');
    fireEvent.click(screen.getByRole('button', { name: 'Erneut versuchen' }));
    expect(await screen.findByText('Kontaktformular sendet doppelt')).toBeTruthy();
  });

  it('offers to load a group again whose first page failed', async () => {
    failing.add('progress');
    renderScreen();
    await screen.findByText('Kontaktformular sendet doppelt');
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Nicht geladen.');
    failing.delete('progress');
    fireEvent.click(within(alert).getByRole('button', { name: 'Erneut versuchen' }));
    expect(await screen.findByText('Startseite überarbeiten')).toBeTruthy();
  });

  it('keeps the rows of a group whose next page failed, and asks for that page again', async () => {
    pageSize = 1;
    failing.add('more');
    renderScreen();
    await screen.findByText('Kontaktformular sendet doppelt');
    // Todo and In Progress hold two items each: their second pages fail
    const [alert] = await screen.findAllByRole('alert');
    expect(screen.getByText('Kontaktformular sendet doppelt')).toBeTruthy();
    failing.delete('more');
    fireEvent.click(within(alert!).getByRole('button', { name: 'Erneut versuchen' }));
    expect(await screen.findByText('Formular-Validierung')).toBeTruthy();
  });

  it('lists without grouping as one group, its count from the first page', async () => {
    inertia.go('/projects/WEB?group=none');
    renderScreen();
    await screen.findByText('Footer prüfen');
    expect(groupBodies()).toEqual([]);
    expect(queryBodies()[0]).not.toHaveProperty('group_by');
    expect(screen.queryByRole('heading', { level: 2 })).toBeNull();
  });

  it('sticks the toolbar to the top and marks it once it is stuck', async () => {
    const observers: IntersectionObserverCallback[] = [];
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        constructor(callback: IntersectionObserverCallback) {
          observers.push(callback);
        }
        observe() {}
        disconnect() {}
      },
    );
    try {
      renderScreen();
      await screen.findByText('Kontaktformular sendet doppelt');
      const toolbar = document.querySelector('[data-items-toolbar]')!;
      expect(toolbar.className).not.toContain('bg-paper');
      act(() => observers[0]!([{ isIntersecting: false } as IntersectionObserverEntry], {} as IntersectionObserver));
      expect(toolbar.className).toContain('bg-paper');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('moves to the current identifier when the project was renamed meanwhile, with the state of the list', async () => {
    projects = [project('WEB', 'admin', { identifier: 'SITE', name: 'Website-Relaunch' })];
    inertia.go('/projects/WEB?layout=board');
    renderScreen();
    await waitFor(() => expect(inertia.visit).toHaveBeenCalledWith('/projects/SITE?layout=board', { replace: true, preserveState: false }));
  });

  it('writes the identifier of the project into an address in another spelling', async () => {
    inertia.go('/projects/web?layout=board');
    renderScreen();
    await screen.findByText('Kontaktformular sendet doppelt');
    expect(inertia.replace).toHaveBeenCalledWith({ url: '/projects/WEB?layout=board', preserveState: true, preserveScroll: true });
  });

  it('says when the project cannot be loaded and loads it again', async () => {
    failing.add('project');
    renderScreen();
    expect(await screen.findByText('Das Projekt konnte nicht geladen werden')).toBeTruthy();
    expect(document.title).toContain('Fehler');
    failing.delete('project');
    fireEvent.click(screen.getByRole('button', { name: 'Erneut versuchen' }));
    expect(await screen.findByText('Kontaktformular sendet doppelt')).toBeTruthy();
  });
});

describe('Meine Items', () => {
  it('lists what is assigned to me, with the tabs of the three lists', async () => {
    // Startseite is mine and open, Footer mine and done
    items = WEB_ITEMS.map((entry) => (entry.number === 3 ? { ...entry, assignee_id: lene.id } : entry));
    inertia.go('/my-items');
    renderScreen({ preset: 'my' });
    expect(await screen.findByRole('heading', { level: 1, name: 'Meine Items' })).toBeTruthy();
    expect(await screen.findByText('Startseite überarbeiten')).toBeTruthy();
    expect(screen.queryByText('Footer prüfen')).toBeNull();
    expect(screen.queryByText('Logo austauschen')).toBeNull();
    const tabs = screen.getByRole('navigation', { name: 'Meine Items' });
    expect(within(tabs).getByRole('link', { name: 'Zugewiesen' }).getAttribute('aria-current')).toBe('page');
    expect(within(tabs).getByRole('link', { name: 'Erstellt' }).getAttribute('href')).toBe('/created');
    expect(within(tabs).getByRole('link', { name: 'Beobachtet' }).getAttribute('href')).toBe('/subscribed');
    // open items, grouped by category, by priority; assignee and open categories are the scope and the base
    expect(groupBodies()[0]).toMatchObject({
      group_by: 'category',
      sort: { field: 'priority', direction: 'asc' },
      filter: {
        conditions: [
          { field: 'assignee', op: 'is', value: 'me' },
          { field: 'state_category', op: 'in', value: ['backlog', 'unstarted', 'started'] },
        ],
      },
    });
    // a new item from here is mine
    fireEvent.click(await screen.findByRole('button', { name: /^Neues Item/ }));
    expect(useUiStore.getState().createDefaults).toEqual({ assignee_id: lene.id });
  });

  it('says that nothing is assigned, with the ways on', async () => {
    items = [];
    inertia.go('/my-items');
    renderScreen({ preset: 'my' });
    expect(await screen.findByText('Dir ist nichts Offenes zugewiesen')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Projekte ansehen' })).toBeTruthy();
    expect(document.title).toContain('Meine Items');
  });

  it.each([
    ['created' as const, '/created', 'Du hast noch keine Items angelegt', 'Von mir erstellt'],
    ['subscribed' as const, '/subscribed', 'Du beobachtest noch keine Items', 'Beobachtet'],
  ])('says what an empty list of %s means', async (preset, url, empty, tab) => {
    items = [];
    inertia.go(url);
    renderScreen({ preset });
    expect(await screen.findByText(empty)).toBeTruthy();
    expect(document.title).toContain(tab);
    expect(within(screen.getByRole('navigation', { name: 'Meine Items' })).getAllByRole('link').find((link) => link.getAttribute('aria-current') === 'page')?.getAttribute('href')).toBe(url);
  });

  it('starts an empty project with its first item', async () => {
    items = [];
    renderScreen();
    expect(await screen.findByText('Noch keine Items in Website-Relaunch')).toBeTruthy();
    const buttons = screen.getAllByRole('button', { name: /^Neues Item/ });
    await waitFor(() => expect(buttons.at(-1)!.hasAttribute('aria-disabled')).toBe(false));
    fireEvent.click(buttons.at(-1)!);
    expect(useUiStore.getState().createDefaults).toEqual({ project_id: 'p_web' });
  });
});

describe('a view', () => {
  const dueWeek = () =>
    makeView({
      filter: { version: 1, conditions: [{ field: 'title', op: 'contains', value: 'Logo' }] },
      display: { layout: 'list', group_by: 'state', sort: { field: 'rank', direction: 'asc' }, fields: ['key'], show_sub_items: true },
    });

  it('shows the items of a saved view under Views, with its star', async () => {
    views = [dueWeek()];
    inertia.go('/views/v_due_week');
    renderScreen({ preset: 'view', viewId: 'v_due_week' });
    expect(await screen.findByRole('heading', { level: 1, name: 'Fällig diese Woche' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Views' }).getAttribute('href')).toBe('/views');
    expect(screen.getByRole('button', { name: /Fällig diese Woche/ })).toBeTruthy();
    expect(await screen.findByText('Logo austauschen')).toBeTruthy();
    expect(screen.queryByText('Kontaktformular sendet doppelt')).toBeNull();
  });

  it('says a view without matches, and shows every item without its conditions', async () => {
    views = [dueWeek()];
    items = WEB_ITEMS.filter((entry) => entry.title !== 'Logo austauschen');
    inertia.go('/views/v_due_week');
    renderScreen({ preset: 'view', viewId: 'v_due_week' });
    expect(await screen.findByText('Keine Treffer in „Fällig diese Woche“')).toBeTruthy();
    expect(screen.getByText('Gerade passt kein Item zu den Bedingungen dieser View. Ohne Bedingungen zeigt sie alle Items.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Filter zurücksetzen' }));
    expect(inertia.url).toBe('/views/v_due_week?filter=%5B%5D');
    expect(await screen.findByText('Kontaktformular sendet doppelt')).toBeTruthy();
  });

  it('loads a view whose property is gone as a list that matches nothing (P2)', async () => {
    views = [makeView({ ...dueWeek(), filter: { version: 1, conditions: [{ field: 'property:gone', op: 'is', value: 'opt_x' }] } })];
    inertia.go('/views/v_due_week');
    renderScreen({ preset: 'view', viewId: 'v_due_week' });
    expect(await screen.findByText('Keine Treffer in „Fällig diese Woche“')).toBeTruthy();
    expect(screen.getByRole('group', { name: 'Filter: Unbekanntes Feld property:gone' })).toBeTruthy();
    expect(screen.queryByText('Die Items konnten nicht geladen werden')).toBeNull();
    // the server refuses an unknown field: the list never asks it
    expect([...queryBodies(), ...groupBodies()].some((body) => JSON.stringify(body.filter).includes('property:gone'))).toBe(false);

    // the chip goes, and the list shows every item
    fireEvent.click(screen.getByRole('button', { name: 'Filter „Unbekanntes Feld“ entfernen' }));
    expect(await screen.findByText('Logo austauschen')).toBeTruthy();
  });

  it('sorts a view whose sort property is gone in the manual order (P2)', async () => {
    views = [makeView({ ...dueWeek(), display: { ...dueWeek().display, sort: { field: 'property:gone', direction: 'desc' } } })];
    inertia.go('/views/v_due_week');
    renderScreen({ preset: 'view', viewId: 'v_due_week' });
    expect(await screen.findByText('Logo austauschen')).toBeTruthy();
    expect(screen.queryByText('Die Items konnten nicht geladen werden')).toBeNull();
    // the server refuses an unknown sort: the list asks for the manual order
    const bodies = [...queryBodies(), ...groupBodies()] as (Body & { sort?: unknown })[];
    expect(bodies.length).toBeGreaterThan(0);
    expect(bodies.every((body) => JSON.stringify(body.sort) === JSON.stringify({ field: 'rank', direction: 'asc' }))).toBe(true);

    // a sort on a property that is there goes as it is, once the properties are known
    act(() => inertia.go('/views/v_due_week?sort=property:effort:desc'));
    await waitFor(() => expect((queryBodies().at(-1) as { sort?: unknown }).sort).toEqual({ field: 'property:effort', direction: 'desc' }));
  });

  it('asks the server for a property that is there, once the properties are known', async () => {
    const customer: Condition = { field: 'property:customer', op: 'is', value: 'opt_moos' };
    inertia.go(`/projects/WEB?filter=${filterOf([customer])}&group=none`);
    renderScreen();
    expect(await screen.findByText('Kontaktformular sendet doppelt')).toBeTruthy();
    expect(queryBodies().every((body) => JSON.stringify(body.filter!.conditions) === JSON.stringify([{ field: 'project', op: 'is', value: 'p_web' }, customer]))).toBe(true);
    // an unknown core field in a link matches nothing at once
    act(() => inertia.go(`/projects/WEB?filter=${filterOf([{ field: 'nonsense', op: 'is', value: 'x' }])}&group=none`));
    expect(await screen.findByText('Ändere die Bedingungen oder setze den Filter zurück.')).toBeTruthy();
    expect(queryBodies().some((body) => JSON.stringify(body.filter).includes('nonsense'))).toBe(false);
  });

  it('gives the focus to the toolbar when no row takes it', async () => {
    views = [dueWeek()];
    items = [];
    inertia.go('/views/v_due_week');
    renderScreen({ preset: 'view', viewId: 'v_due_week' });
    const reset = await screen.findByRole('button', { name: 'Filter zurücksetzen' });
    act(() => reset.focus());
    fireEvent.click(reset);
    expect(await screen.findByText('„Fällig diese Woche“ zeigt noch nichts')).toBeTruthy();
    // the first button of the toolbar: "Filter" of the filter bar
    await waitFor(() => expect(document.activeElement).toBe(within(document.querySelector<HTMLElement>('[data-items-toolbar]')!).getByRole('combobox', { name: 'Filter' })));
  });

  it('says that a view shows nothing yet', async () => {
    views = [makeView({ filter: { version: 1, conditions: [] } })];
    items = [];
    inertia.go('/views/v_due_week');
    renderScreen({ preset: 'view', viewId: 'v_due_week' });
    expect(await screen.findByText('„Fällig diese Woche“ zeigt noch nichts')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Alle Views' }).getAttribute('href')).toBe('/views');
  });

  it('names a view that does not exist', async () => {
    inertia.go('/views/v_due_week');
    renderScreen({ preset: 'view', viewId: 'v_due_week' });
    expect(await screen.findByRole('heading', { level: 1, name: 'Diese View gibt es nicht' })).toBeTruthy();
  });

  it('says when the view cannot be loaded', async () => {
    failing.add('view');
    renderScreen({ preset: 'view', viewId: 'v_due_week' });
    expect(await screen.findByText('Die View konnte nicht geladen werden')).toBeTruthy();
    expect(screen.getByText('Wartung.')).toBeTruthy();
    views = [makeView()];
    failing.delete('view');
    fireEvent.click(screen.getByRole('button', { name: 'Erneut versuchen' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Fällig diese Woche' })).toBeTruthy();
  });
});
