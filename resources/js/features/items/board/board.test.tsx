/*
 * The board on the items screen against a fake REST API: `/groups` and `/query` answer from a small set of items of
 * two projects (WEB with the free standard workflow, APP with the agency workflow) the way the server does; a move
 * (`/transition`, `PATCH`) changes the item there. Ported from the clickdummy's `BoardLayout.test.tsx` without pointer
 * drags and the quick add (task 19). jsdom lays nothing out: a column's box is 600 px high and every card 96 px, so the
 * virtualizer of a column renders what fits in it.
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { MouseEvent, ReactNode } from 'react';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ItemDialogsHost } from '@/components/fields/ItemDialogs';
import { currentToasts, resetToasts } from '@/components/ui/toast';
import { TooltipProvider } from '@/components/ui/Tooltip';
import type { BoardReason } from '@/domain/boardRules';
import { CommandPalette } from '@/features/palette/CommandPalette';
import { listCommands } from '@/lib/commands';
import { useUiStore } from '@/store/ui';
import { mockApi, type MockApi, type MockRoute } from '@/test/api';
import { agency, ida, labels, lene, list, makeWorkItem, mara, organization, project, properties, resolutions, standard, types } from '@/test/fixtures';
import type { Condition, GroupBy, Project, ProjectRole, StateCategory, WorkItem } from '@/types';
import { ItemsScreen } from '../ItemsScreen';
import { reasonText } from './moves';

/* --------------------------------------------------------------------- fake Inertia */

const inertia = vi.hoisted(() => {
  let url = '/projects/APP?layout=board';
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
  };
});

vi.mock('@inertiajs/react', async () => {
  const { useSyncExternalStore } = await import('react');
  return {
    usePage: () => ({ props: { auth: { user: lene, permissions: [] }, organization }, url: useSyncExternalStore(inertia.subscribe, () => inertia.url) }),
    router: {
      get: (url: string, _data: unknown, options: { onSuccess?: () => void; onFinish?: () => void }) => {
        inertia.go(url);
        options.onSuccess?.();
        options.onFinish?.();
      },
      visit: vi.fn(),
      replace: vi.fn(),
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

const BOX = 600;
const CARD = 96;
const offsetHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight')!;
const boundingRect = Element.prototype.getBoundingClientRect;

beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
    configurable: true,
    get(this: HTMLElement) {
      return this.hasAttribute('data-board-list') ? BOX : 0;
    },
  });
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
    configurable: true,
    get(this: HTMLElement) {
      return this.hasAttribute('data-index') ? CARD : 0;
    },
  });
  // a card lies at the place of its li in the column (all columns start at the same height)
  Element.prototype.getBoundingClientRect = function (this: Element) {
    const place = this.hasAttribute('data-card-id') ? this.closest('[data-index]') : null;
    return place ? new DOMRect(0, Number(place.getAttribute('data-index')) * CARD, 256, CARD - 10) : boundingRect.call(this);
  };
  window.scrollBy = (() => {}) as typeof window.scrollBy;
});

afterAll(() => {
  Element.prototype.getBoundingClientRect = boundingRect;
  // the own definition goes; the one of Element shows again
  Reflect.deleteProperty(HTMLElement.prototype, 'clientHeight');
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', offsetHeight);
});

/* --------------------------------------------------------------------- fake server */

/** The digits of a rank (`Rank::DIGITS`): a rank `b` + two of them is a valid key, in the order of the number. */
const DIGITS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const rankOf = (number: number) => `b${DIGITS[Math.floor(number / 62)]}${DIGITS[number % 62]}`;
const app = (number: number, title: string, state_id: string, changes: Partial<WorkItem> = {}) =>
  makeWorkItem({ id: `wi_app_${number}`, project_id: 'p_app', number, key: `APP-${number}`, title, state_id, rank: rankOf(number), ...changes });
const web = (number: number, title: string, state_id: string, changes: Partial<WorkItem> = {}) =>
  makeWorkItem({ id: `wi_web_${number}`, project_id: 'p_web', number, key: `WEB-${number}`, title, state_id, rank: rankOf(number), ...changes });
const epicRef = (item: WorkItem) => ({ id: item.id, key: item.key, title: item.title, type_id: item.type_id });

const web30 = web(30, 'Relaunch Phase 1', 'std_progress', { type_id: 't_epic' });
const web50 = web(50, 'Relaunch Phase 2', 'std_backlog', { type_id: 't_epic' });

function seed(): WorkItem[] {
  return [
    app(13, 'Moodboard sammeln', 'app_backlog'),
    app(16, 'Login-Maske', 'app_todo'),
    app(17, 'Passwort vergessen', 'app_todo'),
    app(18, 'Registrierung', 'app_todo'),
    app(20, 'Profilseite', 'app_progress'),
    app(15, 'Startbildschirm', 'app_approval'),
    web30,
    web50,
    web(41, 'Kontaktformular', 'std_progress'),
    web(42, 'Startseite: Hero und Teaser bauen', 'std_progress', { parent_id: web30.id, parent: epicRef(web30) }),
    web(43, 'Impressum', 'std_todo', { rank: 'a1' }),
    web(44, 'Datenschutz', 'std_todo', { rank: 'a2' }),
    web(48, 'Footer', 'std_todo', { rank: 'a3' }),
  ];
}

const CATEGORY: Record<string, StateCategory> = Object.fromEntries([...standard.states, ...agency.states].map((state) => [state.id, state.category]));
const CATEGORIES: StateCategory[] = ['backlog', 'unstarted', 'started', 'completed', 'canceled'];

let items: WorkItem[];
let roles: Record<string, ProjectRole>;
/** The server answers a status grouping with categories (the items span several workflows). */
let fallBack: boolean;
let pageSize: number;
/** Answers of transitions that wait until the test lets them go. */
let holdMoves: Promise<void> | null;
/** Next pages of a column that wait until the test lets them go. */
let holdMore: Promise<void> | null;
/** The server refuses every transition (409). */
let refuseMoves: boolean;
/** The first pages of these groups, and every next page (`more`), answer 503. */
let failing: Set<string>;
let api: MockApi | undefined;

const projects = (): Project[] => [
  project('WEB', roles.WEB!, { name: 'Website-Relaunch' }),
  project('APP', roles.APP!, { name: 'Kunden-App', workflow_id: 'wf_agency' }),
];

interface Body {
  filter?: { conditions: Condition[] };
  shorthand?: { project?: string };
  group_by?: GroupBy;
  group?: string;
  cursor?: string;
}

function matches(entry: WorkItem, condition: Condition): boolean {
  const values = Array.isArray(condition.value) ? condition.value : [condition.value];
  switch (condition.field) {
    case 'project':
      return values.includes(entry.project_id);
    case 'type':
      return values.includes(entry.type_id);
    case 'epic':
      return (entry.type_id === 't_epic') === condition.value;
    default:
      return true;
  }
}

const hits = (body: Body) =>
  items.filter(
    (entry) =>
      (body.filter?.conditions ?? []).every((condition) => matches(entry, condition)) &&
      (body.shorthand?.project === undefined || [entry.project_id, entry.key.split('-')[0]].includes(body.shorthand.project)),
  );

function keyOf(entry: WorkItem, by: GroupBy): string {
  switch (by) {
    case 'category':
      return CATEGORY[entry.state_id]!;
    case 'priority':
      return entry.priority;
    case 'parent':
      return entry.parent_id ?? 'none';
    case 'assignee':
      return entry.assignee_id ?? 'none';
    case 'state':
      return entry.state_id;
    default:
      return 'all';
  }
}

function groupsOf(body: Body) {
  const found = hits(body);
  const by: GroupBy = body.group_by === 'state' && fallBack ? 'category' : body.group_by!;
  const named = body.filter?.conditions.find((condition) => condition.field === 'project')?.value;
  const workflow = named === 'p_app' ? agency : standard;
  const epics = items.filter((entry) => entry.type_id === 't_epic' && found.some((hit) => hit.parent_id === entry.id));
  const order =
    by === 'state'
      ? workflow.states.map((state) => state.id)
      : by === 'category'
        ? CATEGORIES
        : by === 'parent'
          ? [...epics.map((epic) => epic.id), 'none']
          : by === 'assignee'
            ? ['u_ida', 'u_lene', 'u_mara', 'none']
            : ['urgent', 'high', 'medium', 'low', 'none'];
  return {
    data: {
      group_by: by,
      total: found.length,
      groups: order.map((key) => {
        const epic = by === 'parent' ? items.find((entry) => entry.id === key) : undefined;
        return { key, count: found.filter((entry) => keyOf(entry, by) === key).length, ...(by === 'parent' && { item: epic ? epicRef(epic) : null }) };
      }),
    },
  };
}

function query(body: Body) {
  if (failing.has(body.cursor === undefined ? String(body.group) : 'more')) return { status: 503, body: { reason: 'unavailable', detail: 'Wartung.' } };
  const found = hits(body)
    .filter((entry) => body.group === undefined || keyOf(entry, body.group_by!) === body.group)
    .sort((a, b) => (a.rank < b.rank ? -1 : a.rank > b.rank ? 1 : 0));
  const from = Number(body.cursor ?? 0);
  const next = from + pageSize < found.length ? String(from + pageSize) : null;
  return { body: { ...list(found.slice(from, from + pageSize), found.length), meta: { next_cursor: next, total: found.length } } };
}

/** Changes an item of the fake as the server would and answers it. */
function change(id: string, patch: Partial<WorkItem>) {
  const index = items.findIndex((entry) => entry.id === id);
  const parent = patch.parent_id === undefined ? {} : { parent: patch.parent_id ? epicRef(items.find((entry) => entry.id === patch.parent_id)!) : null };
  items[index] = { ...items[index]!, ...patch, ...parent };
  return { body: { data: items[index] } };
}

/** The routes of the fake; the item routes by pattern. */
function route(key: string): MockRoute | undefined {
  const fixed: Record<string, MockRoute> = {
    'GET /api/v1/organization': () => ({ body: { data: organization } }),
    'GET /api/v1/projects': () => ({ body: list(projects()) }),
    'GET /api/v1/projects/WEB': () => ({ body: { data: projects()[0] } }),
    'GET /api/v1/projects/APP': () => ({ body: { data: projects()[1] } }),
    'GET /api/v1/projects/p_web/members': () => ({ body: list([{ project_id: 'p_web', user_id: 'u_lene', role: 'member' }]) }),
    'GET /api/v1/projects/p_app/members': () => ({ body: list([{ project_id: 'p_app', user_id: 'u_lene', role: 'member' }]) }),
    'GET /api/v1/workflows': () => ({ body: list([standard, agency]) }),
    'GET /api/v1/users': () => ({ body: list([ida, mara, lene]) }),
    'GET /api/v1/labels': () => ({ body: list(labels) }),
    'GET /api/v1/work-item-types': () => ({ body: list(types) }),
    'GET /api/v1/properties': () => ({ body: list(properties) }),
    'GET /api/v1/resolutions': () => ({ body: list(resolutions) }),
    'GET /api/v1/favorites': () => ({ body: list([]) }),
    'POST /api/v1/work-items/groups': (body) => ({ body: groupsOf(body as Body) }),
    'POST /api/v1/work-items/query': (body) => query(body as Body),
  };
  if (fixed[key]) return fixed[key];
  const transition = key.match(/^POST \/api\/v1\/work-items\/([^/]+)\/transition$/);
  if (transition) {
    return (body) => {
      if (refuseMoves) return { status: 409, body: { reason: 'transition_not_allowed', detail: 'Nicht erlaubt.' } };
      const { to_state_id, resolution_id } = body as { to_state_id: string; resolution_id: string | null };
      return change(transition[1]!, { state_id: to_state_id, ...(resolution_id !== null && { resolution_id }) });
    };
  }
  const patch = key.match(/^PATCH \/api\/v1\/work-items\/([^/]+)$/);
  if (patch) return (body) => change(patch[1]!, body as Partial<WorkItem>);
  return undefined;
}

beforeEach(() => {
  items = seed();
  roles = { WEB: 'admin', APP: 'admin' };
  fallBack = false;
  pageSize = 100;
  holdMoves = null;
  holdMore = null;
  refuseMoves = false;
  failing = new Set();
  inertia.go('/projects/APP?layout=board');
  useUiStore.setState({ selection: [], peekItemId: null, paletteOpen: false });
  resetToasts();
  api = mockApi(new Proxy({}, { get: (_target, key) => (typeof key === 'string' ? route(key) : undefined) }) as Record<string, MockRoute>);
  const answering = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    if (holdMoves && String(input).includes('/transition')) await holdMoves;
    if (holdMore && typeof init?.body === 'string' && (JSON.parse(init.body) as Body).cursor !== undefined) await holdMore;
    return answering(input, init);
  };
});

afterEach(() => {
  api?.restore();
  api = undefined;
});

function renderBoard(path: string, { palette = false } = {}) {
  inertia.go(path);
  const [identifier] = path.slice('/projects/'.length).split('?');
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <TooltipProvider>
        <main id="main">
          <ItemsScreen preset="project" projectIdentifier={identifier} />
        </main>
        {palette && <CommandPalette />}
        <ItemDialogsHost />
      </TooltipProvider>
    </QueryClientProvider>,
  );
}

const column = (name: string) => screen.getByRole('region', { name });
const cardIn = (columnName: string, key: string) => within(column(columnName)).getByRole('article', { name: new RegExp(`^${key} `) });
const countOf = (name: string) => column(name).querySelector('header .sr-only')?.textContent;
/** A key on the focused element, as the shortcut registry hears it. */
const press = (key: string, init: KeyboardEventInit = {}) =>
  act(() => {
    (document.activeElement ?? document.body).dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }));
  });
const lastToast = () => currentToasts().at(-1);
const sent = (method: string, path: string) => (api?.calls ?? []).filter((call) => call.method === method && call.url === path).map((call) => call.body);
const announced = () => screen.getByRole('status', { name: 'Mitteilungen des Boards' }).textContent;
const stateOf = (id: string) => items.find((entry) => entry.id === id)!.state_id;

/* -------------------------------------------------------------------------- tests */

describe('the board', () => {
  it('shows a column for every status of the workflow, empty ones included, with the cards in them', async () => {
    renderBoard('/projects/APP?layout=board');
    expect(await within(await screen.findByRole('region', { name: 'Kundenfreigabe' })).findByRole('article', { name: /^APP-15 / })).toBeTruthy();
    for (const name of ['Backlog', 'Todo', 'In Progress', 'Review', 'Done', 'Cancelled']) expect(column(name)).toBeTruthy();
    expect(cardIn('Todo', 'APP-16')).toBeTruthy();
    expect(countOf('Todo')).toBe(', 3 Items');
    expect(within(column('Review')).getByText('Keine Items')).toBeTruthy();
    // every column asked for its cards at once, the empty ones included
    expect(new Set(sent('POST', '/api/v1/work-items/query').map((body) => (body as Body).group))).toEqual(new Set(agency.states.map((state) => state.id)));
    // one card is the tab stop
    expect(document.querySelectorAll('[data-nav-target][tabindex="0"]')).toHaveLength(1);
  });

  it('moves the card under the cursor to the next allowed column with ⇧→ and keeps the focus on it', async () => {
    renderBoard('/projects/APP?layout=board');
    const card = await waitFor(() => cardIn('Todo', 'APP-16'));
    act(() => card.focus());

    press('ArrowRight', { shiftKey: true });
    await waitFor(() => expect(stateOf('wi_app_16')).toBe('app_progress'));
    await waitFor(() => expect(document.activeElement).toBe(cardIn('In Progress', 'APP-16')));
    await waitFor(() => expect(announced()).toBe('APP-16 steht jetzt in In Progress.'));
    // no success toast: the status line says it
    expect(currentToasts()).toEqual([]);
  });

  it('refuses ⇧← where the workflow allows no move and names the transition in a toast', async () => {
    renderBoard('/projects/APP?layout=board');
    const card = await waitFor(() => cardIn('Todo', 'APP-16'));
    act(() => card.focus());

    press('ArrowLeft', { shiftKey: true });
    expect(lastToast()).toMatchObject({ tone: 'error', title: 'APP-16 nicht verschoben', description: 'Von „Todo“ nach „Backlog“ ist im Workflow „Agentur-Freigabe“ nicht erlaubt.' });
    expect(sent('POST', '/api/v1/work-items/wi_app_16/transition')).toEqual([]);
    expect(cardIn('Todo', 'APP-16')).toBe(document.activeElement);
  });

  it('asks for the resolution before a card moves into Done', async () => {
    const user = userEvent.setup();
    renderBoard('/projects/APP?layout=board');
    const card = await waitFor(() => cardIn('Kundenfreigabe', 'APP-15'));
    act(() => card.focus());

    press('ArrowRight', { shiftKey: true });
    const dialog = await screen.findByRole('dialog', { name: 'APP-15 auf Done setzen' });
    await waitFor(() => expect(document.activeElement).toBe(within(dialog).getByRole('radio', { name: /^Done/ })));
    // nothing went out yet
    expect(sent('POST', '/api/v1/work-items/wi_app_15/transition')).toEqual([]);
    await user.keyboard('{Enter}');

    await waitFor(() => expect(items.find((entry) => entry.id === 'wi_app_15')).toMatchObject({ state_id: 'app_done', resolution_id: 'res_done' }));
    await waitFor(() => expect(document.activeElement).toBe(cardIn('Done', 'APP-15')));
  });

  it('leaves the card where it is when the question of the resolution is cancelled', async () => {
    const user = userEvent.setup();
    renderBoard('/projects/APP?layout=board');
    const card = await waitFor(() => cardIn('Kundenfreigabe', 'APP-15'));
    act(() => card.focus());

    press('ArrowRight', { shiftKey: true });
    await screen.findByRole('dialog', { name: 'APP-15 auf Done setzen' });
    await user.keyboard('{Escape}');

    await waitFor(() => expect(announced()).toBe('Abgebrochen. APP-15 bleibt in Kundenfreigabe.'));
    expect(sent('POST', '/api/v1/work-items/wi_app_15/transition')).toEqual([]);
    await waitFor(() => expect(document.activeElement).toBe(cardIn('Kundenfreigabe', 'APP-15')));
  });

  it('moves the cursor down a column with ↓, stops at its end, and goes into the next column with →', async () => {
    renderBoard('/projects/APP?layout=board');
    await waitFor(() => expect(within(column('Todo')).getAllByRole('article')).toHaveLength(3));
    // without a cursor j starts at the first card
    press('j');
    await waitFor(() => expect(document.activeElement).toBe(cardIn('Backlog', 'APP-13')));
    const todo = within(column('Todo')).getAllByRole('article');
    act(() => todo[0]!.focus());

    press('ArrowDown');
    await waitFor(() => expect(document.activeElement).toBe(todo[1]));
    // at the end of a column ↓ and j stay there; in the order of the whole list they would go on to the next column
    act(() => todo.at(-1)!.focus());
    press('ArrowDown');
    expect(document.activeElement).toBe(todo.at(-1));
    press('j');
    expect(document.activeElement).toBe(todo.at(-1));
    press('ArrowRight');
    await waitFor(() => expect(document.activeElement).toBe(cardIn('In Progress', 'APP-20')));
    // → passes the empty Review
    press('ArrowRight');
    await waitFor(() => expect(document.activeElement).toBe(cardIn('Kundenfreigabe', 'APP-15')));
    press('ArrowRight');
    expect(document.activeElement).toBe(cardIn('Kundenfreigabe', 'APP-15'));
    press('ArrowLeft');
    await waitFor(() => expect(document.activeElement).toBe(cardIn('In Progress', 'APP-20')));
    // ← takes the card at the same height: the first of Todo
    press('ArrowLeft');
    await waitFor(() => expect(document.activeElement).toBe(todo[0]));
    expect(document.querySelectorAll('[data-nav-target][tabindex="0"]')).toHaveLength(1);
  });

  it('goes to the first card with → while no card has the cursor, and moves nothing with ⇧→ or ⌥↑', async () => {
    renderBoard('/projects/APP?layout=board');
    await waitFor(() => cardIn('Backlog', 'APP-13'));
    press('ArrowRight', { shiftKey: true });
    press('ArrowUp', { altKey: true });
    expect(currentToasts()).toEqual([]);

    press('ArrowRight');
    await waitFor(() => expect(document.activeElement).toBe(cardIn('Backlog', 'APP-13')));
  });

  it('selects the range up to a card with ⇧ and a click on its title, and opens the preview with a plain click', async () => {
    renderBoard('/projects/APP?layout=board');
    const first = await waitFor(() => cardIn('Todo', 'APP-16'));
    act(() => first.focus());
    press('x');
    expect(useUiStore.getState().selection).toEqual(['wi_app_16']);

    fireEvent.click(within(cardIn('Todo', 'APP-18')).getByRole('link'), { shiftKey: true });
    expect(useUiStore.getState().selection).toEqual(['wi_app_16', 'wi_app_17', 'wi_app_18']);
    expect(useUiStore.getState().peekItemId).toBeNull();

    fireEvent.click(within(cardIn('Todo', 'APP-17')).getByRole('link'));
    expect(useUiStore.getState().peekItemId).toBe('wi_app_17');
  });

  it('says why at the edge of the board when ⇧← finds no column', async () => {
    renderBoard('/projects/APP?layout=board');
    const card = await waitFor(() => cardIn('Backlog', 'APP-13'));
    act(() => card.focus());

    press('ArrowLeft', { shiftKey: true });
    expect(lastToast()).toMatchObject({ tone: 'error', description: '„Backlog“ ist die erste Spalte.' });
  });

  it('moves the cursor card down its column from the palette, a way without dragging (WCAG 2.5.7)', async () => {
    renderBoard('/projects/WEB?layout=board', { palette: true });
    const card = await waitFor(() => cardIn('Todo', 'WEB-43'));
    act(() => card.focus());
    await waitFor(() => expect(listCommands().find((entry) => entry.id === 'board.list.move_down')?.when?.()).toBe(true));
    // the first card cannot go further up
    expect(listCommands().find((entry) => entry.id === 'board.list.move_up')?.when?.()).toBe(false);

    act(() => useUiStore.getState().setPaletteOpen(true));
    const input = await screen.findByRole('combobox', { name: 'Befehl eingeben' });
    fireEvent.change(input, { target: { value: 'Spalte nach unten' } });
    await screen.findByRole('option', { name: /Karte in der Spalte nach unten/ });
    fireEvent.keyDown(input, { key: 'Enter' });

    // between WEB-44 (a2) and WEB-48 (a3)
    await waitFor(() => expect(sent('PATCH', '/api/v1/work-items/wi_web_43')).toHaveLength(1));
    const { rank } = sent('PATCH', '/api/v1/work-items/wi_web_43')[0] as { rank: string };
    expect('a2' < rank && rank < 'a3').toBe(true);
    await waitFor(() => expect(within(column('Todo')).getAllByRole('article').map((entry) => entry.getAttribute('data-card-id'))).toEqual(['wi_web_44', 'wi_web_43', 'wi_web_48']));
    await waitFor(() => expect(announced()).toBe('WEB-43 steht jetzt an Stelle 2 von 3 in Todo.'));
    await waitFor(() => expect(document.activeElement).toBe(cardIn('Todo', 'WEB-43')));
  });

  it('changes the place of a card with ⌥↑ and ⌥↓, says when it is at the end, and that a sorted column keeps its order', async () => {
    renderBoard('/projects/WEB?layout=board');
    const card = await waitFor(() => cardIn('Todo', 'WEB-48'));
    act(() => card.focus());

    press('ArrowDown', { altKey: true });
    expect(announced()).toBe('WEB-48 steht schon unten in Todo.');
    press('ArrowUp', { altKey: true });
    await waitFor(() => expect(sent('PATCH', '/api/v1/work-items/wi_web_48')).toHaveLength(1));
    const { rank } = sent('PATCH', '/api/v1/work-items/wi_web_48')[0] as { rank: string };
    expect('a1' < rank && rank < 'a2').toBe(true);

    act(() => inertia.go('/projects/WEB?layout=board&sort=priority'));
    await waitFor(() => expect(sent('POST', '/api/v1/work-items/groups').at(-1)).toMatchObject({ sort: { field: 'priority' } }));
    act(() => cardIn('Todo', 'WEB-44').focus());
    press('ArrowUp', { altKey: true });
    press('ArrowUp', { altKey: true });
    // one hint, not one per key, and no such command in the palette
    expect(currentToasts().filter((entry) => entry.title === 'Die Reihenfolge folgt der Sortierung')).toHaveLength(1);
    expect(listCommands().find((entry) => entry.id === 'board.list.move_down')?.when?.()).toBe(false);
    expect(sent('PATCH', '/api/v1/work-items/wi_web_44')).toEqual([]);
  });

  it('keeps the cards of a viewer in place and says why', async () => {
    roles.WEB = 'viewer';
    renderBoard('/projects/WEB?layout=board');
    const card = await waitFor(() => cardIn('Todo', 'WEB-48'));
    act(() => card.focus());
    await waitFor(() => expect(listCommands().some((entry) => entry.id === 'board.list.move_right')).toBe(true));

    press('ArrowRight', { shiftKey: true });
    await waitFor(() =>
      expect(lastToast()).toMatchObject({ tone: 'error', description: 'Im Projekt WEB darfst du nur lesen. Items ändern dürfen Member und Admins.' }),
    );
    press('ArrowUp', { altKey: true });
    expect(lastToast()).toMatchObject({ tone: 'error', title: 'WEB-48 nicht verschoben' });
    expect(stateOf('wi_web_48')).toBe('std_todo');
    // the palette offers no move it would refuse
    expect(listCommands().find((entry) => entry.id === 'board.list.move_right')?.when?.()).toBe(false);
  });

  it('takes the first allowed status of a category column and keeps the own status in the own category', async () => {
    fallBack = true;
    renderBoard('/projects/APP?layout=board');
    const card = await waitFor(() => cardIn('Unstarted', 'APP-16'));
    act(() => card.focus());

    // from Todo the agency workflow allows In Progress, not Review or Kundenfreigabe
    press('ArrowRight', { shiftKey: true });
    await waitFor(() => expect(stateOf('wi_app_16')).toBe('app_progress'));
    await waitFor(() => expect(document.activeElement).toBe(cardIn('Started', 'APP-16')));
    // the card already in the category keeps its own status
    expect(stateOf('wi_app_15')).toBe('app_approval');
    expect(sent('POST', '/api/v1/work-items/wi_app_15/transition')).toEqual([]);
  });

  it('moves the card to its new column at once and fixes the counts', async () => {
    let release = () => {};
    holdMoves = new Promise((resolve) => (release = resolve));
    renderBoard('/projects/APP?layout=board');
    const card = await waitFor(() => cardIn('Todo', 'APP-16'));
    await waitFor(() => expect(countOf('In Progress')).toBe(', 1 Item'));
    act(() => card.focus());

    press('ArrowRight', { shiftKey: true });
    // before the server answers
    await waitFor(() => expect(cardIn('In Progress', 'APP-16')).toBeTruthy());
    expect(countOf('Todo')).toBe(', 2 Items');
    expect(countOf('In Progress')).toBe(', 2 Items');
    expect(cardIn('In Progress', 'APP-16').getAttribute('aria-busy')).toBe('true');

    await act(async () => release());
    await waitFor(() => expect(cardIn('In Progress', 'APP-16').getAttribute('aria-busy')).toBeNull());
    expect(countOf('Todo')).toBe(', 2 Items');
    expect(countOf('In Progress')).toBe(', 2 Items');
  });

  it('keeps a card in place when its new rank would grow too long', async () => {
    // WEB-44 lies right after WEB-43, with a rank of 128 characters: between the two there is no room left
    items = items.map((entry) => (entry.id === 'wi_web_44' ? { ...entry, rank: `a1${'0'.repeat(125)}1` } : entry));
    renderBoard('/projects/WEB?layout=board');
    const card = await waitFor(() => cardIn('Todo', 'WEB-48'));
    act(() => card.focus());

    press('ArrowUp', { altKey: true });
    expect(lastToast()).toMatchObject({ tone: 'error', title: 'WEB-48 nicht verschoben', description: 'Hier ist kein Platz mehr. Verschiebe die Karte an eine andere Stelle.' });
    expect(sent('PATCH', '/api/v1/work-items/wi_web_48')).toEqual([]);
  });

  it('moves a card to another priority and another person, and refuses one who cannot take it', async () => {
    items = items.map((entry) => (entry.id === 'wi_app_16' ? { ...entry, assignee_id: 'u_lene' } : entry));
    renderBoard('/projects/APP?layout=board&group=priority');
    const card = await waitFor(() => cardIn('None', 'APP-16'));
    act(() => card.focus());
    press('ArrowLeft', { shiftKey: true });
    await waitFor(() => expect(sent('PATCH', '/api/v1/work-items/wi_app_16')).toEqual([{ priority: 'low' }]));
    await waitFor(() => expect(announced()).toBe('APP-16 hat jetzt die Priorität Low.'));

    act(() => inertia.go('/projects/APP?layout=board&group=assignee'));
    const assigned = await waitFor(() => cardIn('Lene Vogt', 'APP-16'));
    act(() => assigned.focus());
    await waitFor(() => expect(listCommands().find((entry) => entry.id === 'board.list.move_left')?.when?.()).toBe(false));
    // Ida is no member of APP; Mara is an org admin
    press('ArrowLeft', { shiftKey: true });
    expect(lastToast()).toMatchObject({ tone: 'error', description: 'Ida Brenner ist nicht Mitglied im Projekt APP und kann das Item nicht übernehmen.' });
    press('ArrowRight', { shiftKey: true });
    await waitFor(() => expect(announced()).toBe('APP-16 ist jetzt Mara Lindqvist zugewiesen.'));
    await waitFor(() => expect(document.activeElement).toBe(cardIn('Mara Lindqvist', 'APP-16')));
    press('ArrowRight', { shiftKey: true });
    await waitFor(() => expect(announced()).toBe('APP-16 ist jetzt niemandem zugewiesen.'));
    expect(sent('PATCH', '/api/v1/work-items/wi_app_16').slice(1)).toEqual([{ assignee_id: 'u_mara' }, { assignee_id: null }]);
  });

  it('puts the card back with the focus when the server refuses the move', async () => {
    refuseMoves = true;
    renderBoard('/projects/APP?layout=board');
    const card = await waitFor(() => cardIn('Todo', 'APP-16'));
    act(() => card.focus());

    press('ArrowRight', { shiftKey: true });
    await waitFor(() => expect(lastToast()).toMatchObject({ tone: 'error', description: 'Nicht erlaubt.' }));
    await waitFor(() => expect(document.activeElement).toBe(cardIn('Todo', 'APP-16')));
    expect(countOf('Todo')).toBe(', 3 Items');
    expect(announced()).toBe('');
  });

  it('says when a column could not load and loads it again', async () => {
    failing.add('app_todo');
    renderBoard('/projects/APP?layout=board');
    const alert = await within(await screen.findByRole('region', { name: 'Todo' })).findByRole('alert');
    expect(alert.textContent).toContain('Nicht geladen.');

    failing.clear();
    fireEvent.click(within(alert).getByRole('button', { name: 'Erneut versuchen' }));
    expect(await within(column('Todo')).findByRole('article', { name: /^APP-16 / })).toBeTruthy();
  });

  it('loads the next page of a column at its end, and offers to try again when it fails', async () => {
    pageSize = 2;
    let release = () => {};
    holdMore = new Promise((resolve) => (release = resolve));
    failing.add('more');
    renderBoard('/projects/APP?layout=board');
    // the end of the column shows: the next page is on its way
    expect(await within(await screen.findByRole('region', { name: 'Todo' })).findByText('Weitere Items werden geladen …')).toBeTruthy();
    await act(async () => release());
    const alert = await within(await screen.findByRole('region', { name: 'Todo' })).findByRole('alert');
    expect(within(column('Todo')).getAllByRole('article')).toHaveLength(2);

    failing.clear();
    fireEvent.click(within(alert).getByRole('button', { name: 'Erneut versuchen' }));
    expect(await within(column('Todo')).findByRole('article', { name: /^APP-18 / })).toBeTruthy();
    expect(within(column('Todo')).queryByText('Weitere Items werden geladen …')).toBeNull();
  });

  it('renders only the cards in view of a column with 500 cards', async () => {
    items = Array.from({ length: 500 }, (_, index) => app(index + 1, `Aufgabe ${index + 1}`, 'app_todo'));
    renderBoard('/projects/APP?layout=board');
    await waitFor(() => expect(countOf('Todo')).toBe(', 500 Items'));
    const shown = await waitFor(() => {
      const cards = within(column('Todo')).getAllByRole('article');
      expect(cards.length).toBeGreaterThan(0);
      return cards;
    });
    // 600 px of 96 px cards and a few beyond
    expect(shown.length).toBeLessThan(15);
    // the next page is not asked for until the end of the cards shows
    expect(sent('POST', '/api/v1/work-items/query').filter((body) => (body as Body).cursor !== undefined)).toEqual([]);

    // the cursor goes beyond the cards in view: its card is rendered and gets the focus
    act(() => shown[0]!.focus());
    for (let step = 0; step < 20; step += 1) press('j');
    await waitFor(() => expect(document.activeElement?.getAttribute('data-card-id')).toBe('wi_app_21'));
    expect(within(column('Todo')).getAllByRole('article').length).toBeLessThan(16);
  });
});

describe('the epic on the cards of child items', () => {
  /** What a card names before its key: its epic, in the row of its tab. */
  const epicOf = (card: HTMLElement) => card.querySelector<HTMLElement>('[data-parent-crumb]');

  it('a board grouped by parent names none: its columns are the epics', async () => {
    renderBoard('/projects/WEB?layout=board&group=parent');
    const card = await waitFor(() => cardIn('WEB-30 Relaunch Phase 1', 'WEB-42'));
    expect(epicOf(card)).toBeNull();
    expect(card.getAttribute('aria-label')).toBe('WEB-42 Startseite: Hero und Teaser bauen');
    // grouped by parent a card stays in its column
    act(() => card.focus());
    press('ArrowRight', { shiftKey: true });
    expect(lastToast()?.description).toBe(reasonText({ code: 'stays_parent', params: {} } satisfies BoardReason));
  });

  it('names the right epic where the filter leaves the epic out (Typ = Task)', async () => {
    const filter = encodeURIComponent(JSON.stringify([{ field: 'type', op: 'is', value: 't_task' }]));
    renderBoard(`/projects/WEB?layout=board&filter=${filter}`);
    const card = await waitFor(() => cardIn('In Progress', 'WEB-42'));
    expect(within(column('In Progress')).queryByRole('article', { name: /^WEB-30 / })).toBeNull();
    expect(epicOf(card)?.textContent).toBe('Relaunch Phase 1');
    expect(card.getAttribute('aria-label')).toContain('Teil von WEB-30 Relaunch Phase 1');
  });

  it('⇧P gives a card another epic, and the card names the new one', async () => {
    renderBoard('/projects/WEB?layout=board', { palette: true });
    const card = await waitFor(() => cardIn('In Progress', 'WEB-42'));
    act(() => card.focus());
    await waitFor(() => expect(listCommands().find((entry) => entry.id === 'item.parent')?.when?.()).toBe(true));

    press('P', { shiftKey: true });
    const list = await screen.findByRole('listbox', { name: 'Eltern-Item setzen …' });
    fireEvent.click(await within(list).findByRole('option', { name: /Relaunch Phase 2/ }));

    await waitFor(() => expect(epicOf(cardIn('In Progress', 'WEB-42'))?.textContent).toBe('Relaunch Phase 2'));
    expect(cardIn('In Progress', 'WEB-42').getAttribute('aria-label')).toBe('WEB-42 Startseite: Hero und Teaser bauen, Teil von WEB-50 Relaunch Phase 2');
    expect(items.find((entry) => entry.id === 'wi_web_42')?.parent_id).toBe(web50.id);
  });
});
