/*
 * The fake REST API of the board tests (`features/items/board/*.test.tsx`): `/groups` and `/query` answer from a
 * small set of items of two projects (WEB with the free standard workflow, APP with the agency workflow) the way the
 * server does; a move (`/transition`, `PATCH`) changes the item there, `POST /work-items` makes one, `POST
 * /projects/<id>/redistribute-ranks` gives the items of a project short ranks in their order (A448). jsdom lays nothing
 * out: `layBoardOut()` gives a column's box 600 px, every card 96 px, and puts the columns side by side (270 px apart),
 * so the virtualizer of a column renders what fits in it and a pointer can be dropped on a card.
 *
 * Each test file mocks `@inertiajs/react` itself (`vi.mock` is hoisted per file) and hands its `go(url)` to
 * `renderBoard`. The state of the fake is `board`: tests change it before they render.
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, within } from '@testing-library/react';
import { generateNKeysBetween } from 'fractional-indexing';
import { ItemDialogsHost } from '@/components/fields/ItemDialogs';
import { currentToasts } from '@/components/ui/toast';
import { TooltipProvider } from '@/components/ui/Tooltip';
import { ItemsScreen } from '@/features/items/ItemsScreen';
import { CommandPalette } from '@/features/palette/CommandPalette';
import type { Condition, GroupBy, Project, ProjectRole, StateCategory, WorkItem } from '@/types';
import { mockApi, type MockApi, type MockRoute } from './api';
import { agency, ida, labels, lene, list, makeWorkItem, mara, organization, project, properties, resolutions, standard, types } from './fixtures';

/* ------------------------------------------------------------------- layout in jsdom */

export const BOX = 600;
export const CARD = 96;
/** The height of a column's header above its box. */
export const HEADER = 44;
/** How far apart the columns stand. */
export const COLUMN = 270;

/** The place of a column on the board: its position among the columns. */
const columnX = (element: Element) => {
  const section = element.closest('[data-column-key]');
  return section ? [...document.querySelectorAll('[data-column-key]')].indexOf(section) * COLUMN : 0;
};

/** Lays the board out in jsdom; returns the function that takes it back. */
export function layBoardOut(): () => void {
  const offsetHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight')!;
  const boundingRect = Element.prototype.getBoundingClientRect;
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
  // a card (and the frame dnd-kit measures) lies at the place of its li in its column; a column is its header and box
  Element.prototype.getBoundingClientRect = function (this: Element) {
    if (this.hasAttribute('data-column-key')) return new DOMRect(columnX(this), 0, 256, HEADER + BOX);
    const place = this.hasAttribute('data-card-id') || this.hasAttribute('data-card-frame') ? this.closest('[data-index]') : null;
    return place ? new DOMRect(columnX(this), HEADER + Number(place.getAttribute('data-index')) * CARD, 256, CARD - 10) : boundingRect.call(this);
  };
  window.scrollBy = (() => {}) as typeof window.scrollBy;
  return () => {
    Element.prototype.getBoundingClientRect = boundingRect;
    // the own definition goes; the one of Element shows again
    Reflect.deleteProperty(HTMLElement.prototype, 'clientHeight');
    Object.defineProperty(HTMLElement.prototype, 'offsetHeight', offsetHeight);
  };
}

/* --------------------------------------------------------------------- the items */

/** The digits of a rank (`Rank::DIGITS`): a rank `b` + two of them is a valid key, in the order of the number. */
const DIGITS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
export const rankOf = (number: number) => `b${DIGITS[Math.floor(number / 62)]}${DIGITS[number % 62]}`;
export const app = (number: number, title: string, state_id: string, changes: Partial<WorkItem> = {}) =>
  makeWorkItem({ id: `wi_app_${number}`, project_id: 'p_app', number, key: `APP-${number}`, title, state_id, rank: rankOf(number), ...changes });
export const web = (number: number, title: string, state_id: string, changes: Partial<WorkItem> = {}) =>
  makeWorkItem({ id: `wi_web_${number}`, project_id: 'p_web', number, key: `WEB-${number}`, title, state_id, rank: rankOf(number), ...changes });
export const epicRef = (item: WorkItem) => ({ id: item.id, key: item.key, title: item.title, type_id: item.type_id });

export const web30 = web(30, 'Relaunch Phase 1', 'std_progress', { type_id: 't_epic' });
export const web50 = web(50, 'Relaunch Phase 2', 'std_backlog', { type_id: 't_epic' });

export function seed(): WorkItem[] {
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

/** The state of the fake; tests change it before they render. */
export const board = {
  items: [] as WorkItem[],
  roles: {} as Record<string, ProjectRole>,
  /** The server answers a status grouping with categories (the items span several workflows). */
  fallBack: false,
  pageSize: 100,
  /** The default type of WEB. */
  webDefaultType: 't_task',
  /** Answers of transitions and of rank changes that wait until the test lets them go. */
  holdMoves: null as Promise<void> | null,
  /** Next pages of a column that wait until the test lets them go. */
  holdMore: null as Promise<void> | null,
  /** The server refuses every transition (409). */
  refuseMoves: false,
  /** The server answers every transition with 503. */
  failMoves: false,
  /** The server refuses every change of fields (422 on the dates). */
  refuseDates: false,
  /** Redistributions of ranks that wait until the test lets them go. */
  holdRanks: null as Promise<void> | null,
  /** The server answers every redistribution of ranks with 503. */
  failRanks: false,
  /** The first pages of these groups, and every next page (`more`), answer 503. */
  failing: new Set<string>(),
  api: undefined as MockApi | undefined,
};

const projects = (): Project[] => [
  project('WEB', board.roles.WEB!, { name: 'Website-Relaunch', default_type_id: board.webDefaultType }),
  project('APP', board.roles.APP!, { name: 'Kunden-App', workflow_id: 'wf_agency' }),
];

export interface Body {
  filter?: { conditions: Condition[] };
  shorthand?: { project?: string };
  group_by?: GroupBy;
  group?: string;
  cursor?: string;
  sort?: { field: string };
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
  board.items.filter(
    (entry) =>
      (body.filter?.conditions ?? []).every((condition) => matches(entry, condition)) &&
      (body.shorthand?.project === undefined || [entry.project_id, entry.key.split('-')[0]].includes(body.shorthand.project)),
  );

/** The groups an item stands in: one, or one per label. */
function keysOf(entry: WorkItem, by: GroupBy): string[] {
  switch (by) {
    case 'category':
      return [CATEGORY[entry.state_id]!];
    case 'priority':
      return [entry.priority];
    case 'parent':
      return [entry.parent_id ?? 'none'];
    case 'assignee':
      return [entry.assignee_id ?? 'none'];
    case 'state':
      return [entry.state_id];
    case 'label':
      return entry.label_ids.length > 0 ? entry.label_ids : ['none'];
    case 'project':
      return [entry.project_id];
    default:
      return ['all'];
  }
}

function groupsOf(body: Body) {
  const found = hits(body);
  const by: GroupBy = body.group_by === 'state' && board.fallBack ? 'category' : body.group_by!;
  const named = body.filter?.conditions.find((condition) => condition.field === 'project')?.value;
  const workflow = named === 'p_app' ? agency : standard;
  const epics = board.items.filter((entry) => entry.type_id === 't_epic' && found.some((hit) => hit.parent_id === entry.id));
  const order =
    by === 'state'
      ? workflow.states.map((state) => state.id)
      : by === 'category'
        ? CATEGORIES
        : by === 'parent'
          ? [...epics.map((epic) => epic.id), 'none']
          : by === 'assignee'
            ? ['u_ida', 'u_lene', 'u_mara', 'none']
            : by === 'label'
              ? [...labels.map((label) => label.id), 'none']
              : by === 'project'
                ? ['p_app', 'p_web']
                : ['urgent', 'high', 'medium', 'low', 'none'];
  return {
    data: {
      group_by: by,
      total: found.length,
      groups: order.map((key) => {
        const epic = by === 'parent' ? board.items.find((entry) => entry.id === key) : undefined;
        return { key, count: found.filter((entry) => keysOf(entry, by).includes(key)).length, ...(by === 'parent' && { item: epic ? epicRef(epic) : null }) };
      }),
    },
  };
}

function query(body: Body) {
  if (board.failing.has(body.cursor === undefined ? String(body.group) : 'more')) return { status: 503, body: { reason: 'unavailable', detail: 'Wartung.' } };
  const found = hits(body)
    .filter((entry) => body.group === undefined || keysOf(entry, body.group_by!).includes(body.group))
    .sort((a, b) => (a.rank < b.rank ? -1 : a.rank > b.rank ? 1 : a.id < b.id ? -1 : 1));
  const from = Number(body.cursor ?? 0);
  const next = from + board.pageSize < found.length ? String(from + board.pageSize) : null;
  return { body: { ...list(found.slice(from, from + board.pageSize), found.length), meta: { next_cursor: next, total: found.length } } };
}

/** Changes an item of the fake as the server would and answers it. */
function change(id: string, patch: Partial<WorkItem>) {
  const index = board.items.findIndex((entry) => entry.id === id);
  const parent = patch.parent_id === undefined ? {} : { parent: patch.parent_id ? epicRef(board.items.find((entry) => entry.id === patch.parent_id)!) : null };
  board.items[index] = { ...board.items[index]!, ...patch, ...parent };
  return { body: { data: board.items[index] } };
}

/** Gives the items of a project the ranks `Rank::nBetween(null, null, n)` in their order, archived ones included (A448). */
function redistribute(projectId: string) {
  if (board.failRanks) return { status: 503, body: { reason: 'unavailable', detail: 'Wartung.' } };
  const own = board.items.filter((entry) => entry.project_id === projectId).sort((a, b) => (a.rank < b.rank ? -1 : a.rank > b.rank ? 1 : a.id < b.id ? -1 : 1));
  const ranks = generateNKeysBetween(null, null, own.length);
  let changed = 0;
  own.forEach((entry, index) => {
    if (entry.rank === ranks[index]) return;
    changed++;
    change(entry.id, { rank: ranks[index]! });
  });
  return { body: { redistributed: changed } };
}

/** Makes an item as the server would: the next number of its project, the last rank, the start status. */
function create(input: Partial<WorkItem> & { project_id: string }) {
  const own = projects().find((entry) => entry.id === input.project_id)!;
  const number = Math.max(0, ...board.items.filter((entry) => entry.project_id === own.id).map((entry) => entry.number)) + 1;
  const workflow = own.workflow_id === 'wf_agency' ? agency : standard;
  const made = makeWorkItem({
    id: `wi_${own.identifier.toLowerCase()}_${number}`,
    project_id: own.id,
    number,
    key: `${own.identifier}-${number}`,
    type_id: input.type_id ?? own.default_type_id,
    title: input.title,
    state_id: input.state_id ?? workflow.initial_state_id,
    priority: input.priority ?? 'none',
    assignee_id: input.assignee_id ?? null,
    label_ids: input.label_ids ?? [],
    parent_id: input.parent_id ?? null,
    parent: input.parent_id ? epicRef(board.items.find((entry) => entry.id === input.parent_id)!) : null,
    rank: 'z0',
  });
  board.items.push(made);
  return { status: 201, body: { data: made } };
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
    'POST /api/v1/work-items': (body) => create(body as Partial<WorkItem> & { project_id: string }),
    'POST /api/v1/work-items/groups': (body) => ({ body: groupsOf(body as Body) }),
    'POST /api/v1/work-items/query': (body) => query(body as Body),
  };
  if (fixed[key]) return fixed[key];
  const transition = key.match(/^POST \/api\/v1\/work-items\/([^/]+)\/transition$/);
  if (transition) {
    return (body) => {
      if (board.refuseMoves) return { status: 409, body: { reason: 'transition_not_allowed', detail: 'Nicht erlaubt.' } };
      if (board.failMoves) return { status: 503, body: { reason: 'unavailable', detail: 'Wartung.' } };
      const { to_state_id, resolution_id } = body as { to_state_id: string; resolution_id: string | null };
      return change(transition[1]!, { state_id: to_state_id, ...(resolution_id !== null && { resolution_id }) });
    };
  }
  const ranks = key.match(/^POST \/api\/v1\/projects\/([^/]+)\/redistribute-ranks$/);
  if (ranks) return () => redistribute(ranks[1]!);
  const patch = key.match(/^PATCH \/api\/v1\/work-items\/([^/]+)$/);
  if (patch) {
    return (body) => {
      if (board.refuseDates) return { status: 422, body: { reason: 'validation_failed', errors: { due_date: ['Das Due-Date liegt vor dem Start.'] } } };
      return change(patch[1]!, body as Partial<WorkItem>);
    };
  }
  return undefined;
}

/** Puts the fake back to its seed and answers `fetch` from it (in `beforeEach`). */
export function startBoardServer(): void {
  board.items = seed();
  board.roles = { WEB: 'admin', APP: 'admin' };
  board.fallBack = false;
  board.pageSize = 100;
  board.webDefaultType = 't_task';
  board.holdMoves = null;
  board.holdMore = null;
  board.refuseMoves = false;
  board.failMoves = false;
  board.refuseDates = false;
  board.holdRanks = null;
  board.failRanks = false;
  board.failing = new Set();
  board.api = mockApi(new Proxy({}, { get: (_target, key) => (typeof key === 'string' ? route(key) : undefined) }) as Record<string, MockRoute>);
  const answering = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const moving = String(input).includes('/transition') || (init?.method === 'PATCH' && typeof init.body === 'string' && 'rank' in (JSON.parse(init.body) as object));
    if (board.holdMoves && moving) await board.holdMoves;
    if (board.holdRanks && String(input).endsWith('/redistribute-ranks')) await board.holdRanks;
    if (board.holdMore && typeof init?.body === 'string' && (JSON.parse(init.body) as Body).cursor !== undefined) await board.holdMore;
    return answering(input, init);
  };
}

/** Gives `fetch` back (in `afterEach`). */
export function stopBoardServer(): void {
  board.api?.restore();
  board.api = undefined;
}

/**
 * Renders the items screen at a path (`/projects/<identifier>?…` or `/my-items?…`): `go` is the fake Inertia's, so
 * `usePage().url` says the path.
 */
export function renderBoard(path: string, go: (url: string) => void, { palette = false } = {}) {
  go(path);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const screenOf = path.startsWith('/projects/') ? (
    <ItemsScreen preset="project" projectIdentifier={path.slice('/projects/'.length).split('?')[0]} />
  ) : (
    <ItemsScreen preset="my" />
  );
  return render(
    <QueryClientProvider client={client}>
      <TooltipProvider>
        <main id="main">{screenOf}</main>
        {palette && <CommandPalette />}
        <ItemDialogsHost />
      </TooltipProvider>
    </QueryClientProvider>,
  );
}

/* ------------------------------------------------------------------------- reading */

export const column = (name: string) => screen.getByRole('region', { name });
export const cardIn = (columnName: string, key: string) => within(column(columnName)).getByRole('article', { name: new RegExp(`^${key} `) });
export const countOf = (name: string) => column(name).querySelector('header .sr-only')?.textContent;
/** The keys of the cards of a column, in their order. */
export const keysIn = (name: string) => within(column(name)).queryAllByRole('article').map((card) => card.getAttribute('aria-label')!.split(' ')[0]);
/** A key on the focused element, as the shortcut registry hears it. */
export const press = (key: string, init: KeyboardEventInit = {}) =>
  act(() => {
    (document.activeElement ?? document.body).dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }));
  });
export const lastToast = () => currentToasts().at(-1);
export const sent = (method: string, path: string) => (board.api?.calls ?? []).filter((call) => call.method === method && call.url === path).map((call) => call.body);
export const announced = () => screen.getByRole('status', { name: 'Mitteilungen des Boards' }).textContent;
export const stateOf = (id: string) => board.items.find((entry) => entry.id === id)!.state_id;
