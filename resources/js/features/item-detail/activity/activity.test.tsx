/*
 * The activity of an item against a fake REST API (`mockApi`): the grouping of the timeline, every field change as old
 * and new, names of what is gone since, a hidden related item, the reason of a bot, the time in the organisation's
 * zone, the filter, all pages with "Mehr laden" and the retry of a failed load. The clock stands still in every test:
 * "heute", "gestern" and the year depend on it.
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { preloadEditor } from '@/editor/RichTextEditor';
import { initI18n } from '@/lib/i18n';
import { mockApi, type MockApi, type MockRoute } from '@/test/api';
import { ida, itemEvent, labels, lene, list, makeComment, makeWorkItem, mara, organization, person, project, properties, resolutions, standard, types, web48 } from '@/test/fixtures';
import type { ActivityEntry, Comment, ItemEvent, Organization, Property, RichText, User, WorkItem, WorkItemDetail } from '@/types';
import en from '../../../../../lang/en.json';
import { ItemDetailProvider } from '../ItemBody';
import type { DetailSurface } from '../shared';
import { Activity, SHOWN_LINES } from './Activity';
import { buildTimeline, GROUP_WINDOW_MS, type ActivityFilter } from './timeline';
import { formatWhen } from './when';

let url = '/items/WEB-48';
let org: Organization = organization;
const replace = vi.fn();

vi.mock('@inertiajs/react', () => ({
  usePage: () => ({ props: { auth: { user: lene, permissions: [] }, organization: org }, url }),
  router: { visit: vi.fn(), replace: (...args: unknown[]) => replace(...args), on: () => () => {} },
  Link: ({ href, children, ...rest }: { href: string; children?: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

/* -------------------------------------------------------------------------- data */

const automation: User = { ...person('u_automation', 'Automation', 'automation', 'admin'), type: 'bot' };
/** A rich text property, to show that its change reads without the text. */
const brief: Property = { ...properties[0]!, id: 'pr_brief', key: 'brief', label: 'Briefing', field_type: 'rich_text', options: [], settings: {} };
/** A person property, whose values read as names. */
const reviewers: Property = { ...properties[0]!, id: 'pr_reviewers', key: 'reviewers', label: 'Review', field_type: 'member', options: [], settings: { multiple: true } };

const doc = (text: string): RichText => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] });
const at = (minutes: number) => new Date(Date.parse('2026-10-31T00:00:00.000Z') + minutes * 60_000).toISOString();
const entry = (event: ItemEvent): ActivityEntry => ({ kind: 'event', id: event.id, at: event.occurred_at, event });
const comment = (id: string, minutes: number): ActivityEntry =>
  ({ kind: 'comment', id, at: at(minutes), comment: { id } }) as unknown as ActivityEntry;

/** One event of WEB-48; each test gives it its own id and minute. */
const event = (id: string, minutes: number, overrides: Partial<ItemEvent> = {}) =>
  itemEvent({ id, type: 'work_item.updated', subject: { type: 'work_item', id: 'wi_web_48' }, occurred_at: at(minutes), ...overrides });

const detailOf = (item: WorkItem): WorkItemDetail => ({
  item,
  type: types[0]!,
  state: standard.states.find((state) => state.id === item.state_id)!,
  workflow: standard,
  children: [],
  relations: [],
  attachments: [],
  subscribed: false,
});

/** WEB-31, a former parent of WEB-48 (its detail loads), and WEB-29, a parent deleted since (404). */
const web31 = makeWorkItem({ id: 'wi_web_31', number: 31, key: 'WEB-31', type_id: 't_epic', title: 'Relaunch Phase 0' });

/* ------------------------------------------------------------------------ render */

let api: MockApi | undefined;

const historyPage = (events: ItemEvent[], next: string | null = null) => ({ body: { data: events, links: {}, meta: { next_cursor: next, total: events.length } } });

function renderActivity(history: MockRoute, { surface = 'peek', routes = {} }: { surface?: DetailSurface; routes?: Record<string, MockRoute> } = {}) {
  api = mockApi({
    'GET /api/v1/organization': () => ({ body: { data: org } }),
    'GET /api/v1/projects': () => ({ body: list([project('WEB', 'member', { name: 'Website-Relaunch' })]) }),
    'GET /api/v1/users': () => ({ body: list([mara, ida, lene, automation]) }),
    'GET /api/v1/labels': () => ({ body: list(labels) }),
    'GET /api/v1/resolutions': () => ({ body: list(resolutions) }),
    'GET /api/v1/work-item-types': () => ({ body: list(types) }),
    'GET /api/v1/properties': () => ({ body: list([...properties, brief, reviewers]) }),
    'GET /api/v1/work-items/wi_web_48/history': history,
    'GET /api/v1/work-items/wi_web_31': () => ({ body: { data: { ...web31, children: [], relations: [], type: types[2], workflow: standard, attachments: [] } } }),
    'GET /api/v1/work-items/wi_web_29': () => ({ status: 404, body: { type: 'about:blank', title: 'not_found', status: 404, reason: 'not_found' } }),
    ...routes,
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ItemDetailProvider surface={surface}>
        <Activity detail={detailOf(web48)} />
      </ItemDetailProvider>
    </QueryClientProvider>,
  );
}

/** The text of a line (without the initials of the avatar), its reason after " | ". */
const textOf = (line: HTMLElement) => Array.from(line.querySelectorAll('p'), (paragraph) => paragraph.textContent).join(' | ');

/** The lines of the timeline as text, once the names have loaded. */
async function linesOf(): Promise<string[]> {
  const timeline = await screen.findByRole('list', { name: 'Verlauf' });
  await waitFor(() => expect(timeline.textContent).not.toContain('Unbekannt hat'));
  return within(timeline).getAllByRole('listitem').map(textOf);
}

beforeAll(async () => {
  // jsdom has no layout; the editor (the cards' text, an earlier version) measures the selection
  const empty = () => ({ x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, toJSON: () => ({}) }) as DOMRect;
  Range.prototype.getBoundingClientRect = empty;
  Range.prototype.getClientRects = () => ({ length: 0, item: () => null, [Symbol.iterator]: [][Symbol.iterator] }) as unknown as DOMRectList;
  document.elementFromPoint = () => null;
  await preloadEditor();
});

beforeEach(() => {
  // 21:00 in Berlin, 16:00 in New York; minute 0 of `at` is 01:00 in Berlin, the same day
  vi.setSystemTime(new Date('2026-10-31T20:00:00.000Z'));
});

afterEach(() => {
  api?.restore();
  api = undefined;
  url = '/items/WEB-48';
  org = organization;
  replace.mockReset();
  vi.useRealTimers();
});

/* ---------------------------------------------------------------------- timeline */

describe('buildTimeline', () => {
  const lineEvents = (entries: ActivityEntry[], filter: ActivityFilter = 'all') =>
    buildTimeline(entries, filter).map((line) => (line.kind === 'comment' ? `comment ${line.comment.id}` : line.events.map((item) => item.id)));

  it('puts changes of one account within five minutes into one line', () => {
    expect(GROUP_WINDOW_MS).toBe(5 * 60_000);
    // measured from the first change of the line: the third change is more than five minutes after the first
    expect(lineEvents([entry(event('a', 0)), entry(event('b', 2)), entry(event('c', 5)), entry(event('d', 6))])).toEqual([['a', 'b', 'c'], ['d']]);
  });

  it('starts a new line after five minutes, for another person, another way or another reason', () => {
    expect(lineEvents([entry(event('a', 0)), entry(event('b', 6))])).toEqual([['a'], ['b']]);
    expect(lineEvents([entry(event('a', 0)), entry(event('b', 1, { actor_id: 'u_ida' }))])).toEqual([['a'], ['b']]);
    expect(lineEvents([entry(event('a', 0)), entry(event('b', 1, { via: 'api' }))])).toEqual([['a'], ['b']]);
    expect(lineEvents([entry(event('a', 0)), entry(event('b', 1, { reason: 'workflow_changed' }))])).toEqual([['a'], ['b']]);
    expect(lineEvents([entry(event('a', 0, { via: null })), entry(event('b', 1, { via: null }))])).toEqual([['a', 'b']]);
  });

  it('lets a comment end the line where comments show, not under the changes', () => {
    const entries = [entry(event('a', 0)), comment('c1', 1), entry(event('b', 2))];
    expect(lineEvents(entries, 'all')).toEqual([['a'], 'comment c1', ['b']]);
    expect(lineEvents(entries, 'changes')).toEqual([['a', 'b']]);
    // the comments alone: no change at all
    expect(lineEvents(entries, 'comments')).toEqual(['comment c1']);
  });

  it('takes another window', () => {
    expect(buildTimeline([entry(event('a', 0)), entry(event('b', 2))], 'all', 60_000)).toHaveLength(2);
  });
});

/* ----------------------------------------------------------------------- phrases */

describe('phrases', () => {
  /** One event per line: ten minutes apart, from minute `from` on. */
  const apart = (changes: ItemEvent['changes'][], from = 0) => changes.map((value, index) => event(`ev_${index}`, from + index * 10, { changes: value }));

  it('says every field change as old and new', async () => {
    const history = [
      event('ev_created', 0, { type: 'work_item.created', changes: { title: { old: null, new: 'Kontaktformular' } } }),
      ...apart([
        { title: { old: 'Kontaktformular', new: 'Formular sendet doppelt' } },
        { priority: { old: 'high', new: 'urgent' } },
        { assignee_id: { old: null, new: 'u_ida' } },
        { assignee_id: { old: 'u_ida', new: 'u_lene' } },
        { assignee_id: { old: 'u_lene', new: null } },
        { label_ids: { old: [], new: ['lb_ux'] } },
        { label_ids: { old: ['lb_ux'], new: ['lb_forms', 'lb_production'] } },
        { label_ids: { old: ['lb_ux'], new: ['lb_ux'] } },
        { start_date: { old: null, new: '2026-11-02' } },
        { start_date: { old: '2026-11-02', new: '2026-11-03' } },
        { start_date: { old: '2026-11-03', new: null } },
        { due_date: { old: null, new: '2026-11-06' } },
        { due_date: { old: '2026-11-06', new: '2026-11-09' } },
        { due_date: { old: '2026-11-09', new: null } },
        { parent_id: { old: null, new: 'wi_web_30' } },
        { parent_id: { old: 'wi_web_31', new: 'wi_web_30' } },
        { parent_id: { old: 'wi_web_29', new: null } },
        { type_id: { old: 't_task', new: 't_bug' }, 'values.environment': { old: null, new: 'opt_env_prod' } },
        { 'values.customer': { old: 'opt_nordlicht', new: 'opt_moos' }, 'values.effort': { old: 3, new: null } },
        { 'values.brief': { old: null, new: { type: 'doc' } }, 'values.reviewers': { old: ['u_ida'], new: ['u_ida', 'u_lene'] } },
        { description: { old: null, new: { type: 'doc' } } },
        { rank: { old: 'a0', new: 'a1' }, resolution_id: { old: null, new: 'res_done' } },
        { resolution_id: { old: 'res_done', new: 'res_duplicate' } },
        { resolution_id: { old: 'res_duplicate', new: null } },
        { archived_at: { old: null, new: '2026-10-31T07:00:00.000Z' } },
        { archived_at: { old: '2026-10-31T07:00:00.000Z', new: null } },
        { rank: { old: 'a1', new: 'a2' } },
      ], 10),
      event('ev_moved', 300, {
        type: 'work_item.state_changed',
        changes: { state_id: { old: 'std_todo', new: 'std_done' }, resolution_id: { old: null, new: 'res_done' } },
        states: { old: { id: 'std_todo', name: 'Todo', category: 'unstarted' }, new: { id: 'std_done', name: 'Done', category: 'completed' } },
      }),
      event('ev_archived', 310, { type: 'work_item.archived', changes: { archived_at: { old: null, new: '2026-10-31T10:10:00.000Z' } } }),
      event('ev_restored', 320, { type: 'work_item.restored', changes: { archived_at: { old: '2026-10-31T10:10:00.000Z', new: null } } }),
    ];
    renderActivity(() => historyPage(history));

    const timeline = await screen.findByRole('list', { name: 'Verlauf' });
    // the former parent loads its detail
    await waitFor(() => expect(timeline.textContent).toContain('WEB-31'));
    expect(await linesOf()).toEqual([
      'Mara Lindqvist hat das Item angelegt. heute 01:00',
      'Mara Lindqvist hat den Titel von „Kontaktformular“ in „Formular sendet doppelt“ geändert. heute 01:10',
      'Mara Lindqvist hat die Priorität von High auf Urgent geändert. heute 01:20',
      'Mara Lindqvist hat Ida Brenner als Assignee gesetzt. heute 01:30',
      'Mara Lindqvist hat die Zuweisung von Ida Brenner auf Lene Vogt geändert. heute 01:40',
      'Mara Lindqvist hat die Zuweisung an Lene Vogt entfernt. heute 01:50',
      'Mara Lindqvist hat das Label UX hinzugefügt. heute 02:00',
      'Mara Lindqvist hat die Labels Formulare und Produktion hinzugefügt und das Label UX entfernt. heute 02:10',
      // the same labels in another order are no change: the event reads as a change of the item
      'Mara Lindqvist hat das Item geändert. heute 02:20',
      'Mara Lindqvist hat das Start-Date auf 02.11.2026 gesetzt. heute 02:30',
      'Mara Lindqvist hat das Start-Date von 02.11.2026 auf 03.11.2026 verschoben. heute 02:40',
      'Mara Lindqvist hat das Start-Date entfernt. heute 02:50',
      'Mara Lindqvist hat das Due-Date auf 06.11.2026 gesetzt. heute 03:00',
      'Mara Lindqvist hat das Due-Date von 06.11.2026 auf 09.11.2026 verschoben. heute 03:10',
      'Mara Lindqvist hat das Due-Date entfernt. heute 03:20',
      // the current parent from the item, a former one from its detail, a deleted one as such
      'Mara Lindqvist hat das Eltern-Item WEB-30 gesetzt. heute 03:30',
      'Mara Lindqvist hat das Eltern-Item von WEB-31 auf WEB-30 geändert. heute 03:40',
      'Mara Lindqvist hat das Eltern-Item ein gelöschtes Item entfernt. heute 03:50',
      'Mara Lindqvist hat den Typ von Task auf Bug geändert und Umgebung auf Produktion gesetzt. heute 04:00',
      'Mara Lindqvist hat Kunde von Studio Nordlicht auf Gärtnerei Moos geändert und Aufwand (h) geleert. heute 04:10',
      'Mara Lindqvist hat Briefing geändert und Review von Ida Brenner auf Ida Brenner, Lene Vogt geändert. heute 04:20',
      'Mara Lindqvist hat die Beschreibung geändert. heute 04:30',
      // the manual order is no history: only the resolution reads
      'Mara Lindqvist hat die Resolution Done gesetzt. heute 04:40',
      'Mara Lindqvist hat die Resolution von Done auf Duplicate geändert. heute 04:50',
      'Mara Lindqvist hat die Resolution Duplicate entfernt. heute 05:00',
      'Mara Lindqvist hat das Item archiviert. heute 05:10',
      'Mara Lindqvist hat das Item wiederhergestellt. heute 05:20',
      'Mara Lindqvist hat das Item geändert. heute 05:30',
      'Mara Lindqvist hat den Status von Todo auf Done gesetzt und die Resolution Done gesetzt. heute 06:00',
      'Mara Lindqvist hat das Item archiviert. heute 06:10',
      'Mara Lindqvist hat das Item wiederhergestellt. heute 06:20',
    ]);
  });

  it('names a deleted property by its key and what is gone since as such', async () => {
    renderActivity(() =>
      historyPage(
        apart([
          { 'values.budget': { old: 1200, new: 1500 }, 'values.tags': { old: null, new: ['a', 'b'] } },
          { label_ids: { old: ['lb_gone'], new: [] }, type_id: { old: 't_gone', new: 't_task' } },
          { resolution_id: { old: null, new: 'res_gone' }, priority: { old: 'none', new: 'mystery' } },
          { 'values.customer': { old: null, new: 'opt_gone' } },
          // a dropdown or people property deleted since: its ids say nothing
          { 'values.owner': { old: null, new: '01jbz8v6w2k7c0m9x4r5t3n8qa' }, 'values.team': { old: ['01jbz8v6w2k7c0m9x4r5t3n8qa', '01JBZ8V6W2K7C0M9X4R5T3N8QB'], new: ['01jbz8v6w2k7c0m9x4r5t3n8qa'] } },
        ]),
      ),
    );

    expect(await linesOf()).toEqual([
      'Mara Lindqvist hat budget von 1200 auf 1500 geändert und tags auf a, b gesetzt. heute 01:00',
      'Mara Lindqvist hat das Label ein gelöschtes Label entfernt und den Typ von einen früheren Typ auf Task geändert. heute 01:10',
      'Mara Lindqvist hat die Resolution eine frühere Resolution gesetzt und die Priorität von None auf mystery geändert. heute 01:20',
      'Mara Lindqvist hat Kunde auf Unbekannte Option gesetzt. heute 01:30',
      'Mara Lindqvist hat owner auf 1 Wert gesetzt und team von 2 Werte auf 1 Wert geändert. heute 01:40',
    ]);
  });

  it('names states from the snapshot of the move, older moves from the workflow', async () => {
    renderActivity(() =>
      historyPage([
        // the state was renamed since and removed: the snapshot keeps its name
        event('ev_1', 0, {
          type: 'work_item.state_changed',
          changes: { state_id: { old: 'st_review', new: 'std_progress' } },
          states: { old: { id: 'st_review', name: 'Review', category: 'started' }, new: { id: 'std_progress', name: 'Doing', category: 'started' } },
        }),
        // recorded before the snapshot: the workflow names what it still has
        event('ev_2', 30, { type: 'work_item.state_changed', changes: { state_id: { old: 'st_gone', new: 'std_todo' } }, states: null }),
      ]),
    );

    expect(await linesOf()).toEqual([
      'Mara Lindqvist hat den Status von Review auf Doing gesetzt. heute 01:00',
      'Mara Lindqvist hat den Status von einen früheren Status auf Todo gesetzt. heute 01:30',
    ]);
  });

  it('shows a hidden related item without key', async () => {
    renderActivity(() =>
      historyPage([
        event('ev_1', 0, { type: 'work_item.relation_added', changes: { relation: { old: null, new: { label: 'blockiert', item_id: 'wi_web_12', key: 'WEB-12' } } } }),
        event('ev_2', 10, { type: 'work_item.relation_added', changes: { relation: { old: null, new: { label: 'wird blockiert von', hidden: true } } } }),
        event('ev_3', 20, { type: 'work_item.relation_removed', changes: { relation: { old: { label: 'blockiert', item_id: 'wi_web_12', key: 'WEB-12' }, new: null } } }),
        event('ev_4', 30, { type: 'work_item.relation_removed', changes: null }),
      ]),
    );

    const lines = await linesOf();
    expect(lines).toEqual([
      'Mara Lindqvist hat die Relation „blockiert“ zu WEB-12 hinzugefügt. heute 01:00',
      'Mara Lindqvist hat die Relation „wird blockiert von“ zu verborgenes Item hinzugefügt. heute 01:10',
      'Mara Lindqvist hat die Relation „blockiert“ zu WEB-12 entfernt. heute 01:20',
      'Mara Lindqvist hat die Relation „verknüpft mit“ zu verborgenes Item entfernt. heute 01:30',
    ]);
    // nothing of the hidden item: no key, no id
    expect(lines[1]).not.toMatch(/[A-Z]+-\d+|wi_/);
  });

  it('shows why the default bot acted, and a reason without text as it came', async () => {
    const bot = { actor_id: 'u_automation', via: 'automation', reason: 'assign_on_start' };
    renderActivity(() =>
      historyPage([
        // the change, the assignment and the move of one edit, written at once: one line
        event('ev_1', 0, { ...bot, changes: { priority: { old: 'none', new: 'high' } } }),
        event('ev_2', 0, { ...bot, type: 'work_item.assigned', changes: { assignee_id: { old: null, new: 'u_ida' } } }),
        event('ev_3', 0, { ...bot, type: 'work_item.state_changed', changes: { state_id: { old: 'std_todo', new: 'std_progress' } } }),
        event('ev_4', 10, { reason: 'workflow_changed', changes: { state_id: { old: 'std_todo', new: 'std_backlog' } } }),
        event('ev_5', 20, { reason: 'parent_deleted', changes: { parent_id: { old: 'wi_web_29', new: null } } }),
        event('ev_6', 30, { reason: 'state_removed', changes: { state_id: { old: 'std_todo', new: 'std_backlog' } } }),
        event('ev_7', 40, { actor_id: 'u_gone', reason: 'nightly_cleanup', changes: { priority: { old: 'high', new: 'low' } } }),
      ]),
    );

    const timeline = await screen.findByRole('list', { name: 'Verlauf' });
    await waitFor(() => expect(timeline.textContent).toContain('Automation Bot hat'));
    await waitFor(() => expect(timeline.textContent).toContain('ein gelöschtes Item'));
    expect(within(timeline).getAllByRole('listitem').map(textOf)).toEqual([
      'Automation Bot hat die Priorität von None auf High geändert, Ida Brenner als Assignee gesetzt und den Status von Todo auf In Progress gesetzt. heute 01:00 | Automatisierung: Assignee beim Start',
      'Mara Lindqvist hat den Status von Todo auf Backlog gesetzt. heute 01:10 | Workflow gewechselt',
      'Mara Lindqvist hat das Eltern-Item ein gelöschtes Item entfernt. heute 01:20 | Eltern-Item gelöscht',
      'Mara Lindqvist hat den Status von Todo auf Backlog gesetzt. heute 01:30 | Status gelöscht',
      // an account the list does not know, and a code without text
      'Unbekannt hat die Priorität von High auf Low geändert. heute 01:40 | nightly_cleanup',
    ]);
  });

  it('names a parent that could not be loaded "ein Item" instead of waiting for good', async () => {
    renderActivity(() => historyPage([event('ev_1', 0, { changes: { parent_id: { old: null, new: 'wi_web_28' } } })]), {
      routes: { 'GET /api/v1/work-items/wi_web_28': () => ({ status: 503, body: { type: 'about:blank', title: 'unavailable', status: 503, reason: 'service_unavailable' } }) },
    });

    const timeline = await screen.findByRole('list', { name: 'Verlauf' });
    await waitFor(() => expect(within(timeline).getAllByRole('listitem').map(textOf)).toEqual(['Mara Lindqvist hat das Eltern-Item ein Item gesetzt. heute 01:00']));
  });

  it('reads an edit with its earlier version and a deletion', async () => {
    const user = userEvent.setup();
    const comment = { comment_id: 'c_1', comment_author_id: 'u_lene' };
    renderActivity(() =>
      historyPage([
        event('ev_1', 0, { ...comment, type: 'comment.updated', actor_id: 'u_lene', changes: { body: { old: doc('Erste Fassung.'), new: doc('Zweite Fassung.') } } }),
        // a comment deleted since: its versions are gone from the history (K15), only the edit stays
        event('ev_2', 10, { type: 'comment.updated', actor_id: 'u_lene', comment_id: 'c_2', comment_author_id: 'u_lene', changes: null }),
        event('ev_3', 20, { type: 'comment.deleted', comment_id: 'c_2', comment_author_id: 'u_lene', changes: null }),
        event('ev_4', 30, { type: 'comment.deleted', actor_id: 'u_ida', comment_id: 'c_3', comment_author_id: 'u_ida', changes: null }),
        event('ev_5', 40, { type: 'comment.deleted', comment_id: 'c_4', comment_author_id: 'u_gone', changes: null }),
      ]),
    );

    const lines = await linesOf();
    expect(lines).toEqual([
      'Lene Vogt hat einen Kommentar bearbeitet. heute 01:00',
      'Lene Vogt hat einen Kommentar bearbeitet. heute 01:10',
      'Mara Lindqvist hat einen Kommentar von Lene Vogt gelöscht. heute 01:20',
      'Ida Brenner hat einen eigenen Kommentar gelöscht. heute 01:30',
      'Mara Lindqvist hat einen Kommentar von Unbekannt gelöscht. heute 01:40',
    ]);
    // only the edit whose comment is still there shows its earlier version, on demand
    const timeline = screen.getByRole('list', { name: 'Verlauf' });
    const earlier = within(timeline).getAllByRole('button', { name: 'Frühere Fassung anzeigen' });
    expect(earlier).toHaveLength(1);
    expect(earlier[0]!.getAttribute('aria-expanded')).toBe('false');
    expect(timeline.textContent).not.toContain('Erste Fassung.');
    await user.click(earlier[0]!);
    expect(earlier[0]!.getAttribute('aria-expanded')).toBe('true');
    await within(timeline).findByText('Erste Fassung.');
    await user.click(earlier[0]!);
    expect(timeline.textContent).not.toContain('Erste Fassung.');
  });

  it('reads an added and a removed file', async () => {
    renderActivity(() =>
      historyPage([
        event('ev_1', 0, { changes: { attachments: { old: null, new: { id: 'att_1', filename: 'screenshot.png' } } } }),
        event('ev_2', 10, { changes: { attachments: { old: { id: 'att_1', filename: 'screenshot.png' }, new: null } } }),
        // a file added beside another change reads after it
        event('ev_3', 20, { changes: { attachments: { old: null, new: { id: 'att_2', filename: 'angebot.pdf' } }, description: { old: null, new: doc('Text') } } }),
      ]),
    );

    expect(await linesOf()).toEqual([
      'Mara Lindqvist hat die Datei „screenshot.png“ angehängt. heute 01:00',
      'Mara Lindqvist hat die Datei „screenshot.png“ entfernt. heute 01:10',
      'Mara Lindqvist hat die Beschreibung geändert und die Datei „angebot.pdf“ angehängt. heute 01:20',
    ]);
  });

  it('reads in English', async () => {
    initI18n({ locale: 'en', translations: en });
    renderActivity(() =>
      historyPage([
        event('ev_1', 0, { changes: { title: { old: 'A', new: 'B' }, priority: { old: 'high', new: 'urgent' }, label_ids: { old: [], new: ['lb_ux', 'lb_forms', 'lb_production'] } } }),
      ]),
    );

    const timeline = await screen.findByRole('list', { name: 'History' });
    await waitFor(() =>
      expect(textOf(within(timeline).getByRole('listitem'))).toBe(
        'Mara Lindqvist changed the title from “A” to “B”, changed the priority from High to Urgent and added the labels UX, Formulare and Produktion. today 01:00',
      ),
    );
  });
});

/* -------------------------------------------------------------------------- time */

describe('time', () => {
  it('shows the time in the time zone of the organisation', async () => {
    org = { ...organization, timezone: 'America/New_York' };
    // 01:30 in Berlin on 31 October is 20:30 the evening before in New York
    renderActivity(() => historyPage([event('ev_1', 0, { occurred_at: '2026-10-31T00:30:00.000Z' })]));

    const [line] = await linesOf();
    expect(line).toMatch(/gestern 20:30$/);
    const time = screen.getByText('gestern 20:30');
    expect(time.getAttribute('datetime')).toBe('2026-10-31T00:30:00.000Z');
    expect(time.getAttribute('title')).toBe('Freitag, 30. Oktober 2026 um 20:30');
  });

  it('reads today, yesterday, earlier this year and in earlier years', () => {
    const zone = 'Europe/Berlin';
    expect(formatWhen('2026-10-31T08:12:00.000Z', '2026-10-31', zone)).toBe('heute 09:12');
    expect(formatWhen('2026-10-30T13:05:00.000Z', '2026-10-31', zone)).toBe('gestern 14:05');
    expect(formatWhen('2026-10-20T09:30:00.000Z', '2026-10-31', zone)).toBe('20.10. 11:30');
    expect(formatWhen('2025-10-20T09:30:00.000Z', '2026-10-31', zone)).toBe('20.10.2025');
    // the day counts in the zone: 23:30 UTC is already tomorrow in Berlin
    expect(formatWhen('2026-10-30T23:30:00.000Z', '2026-10-31', zone)).toBe('heute 00:30');
  });
});

/* ------------------------------------------------------------------------ section */

describe('Activity', () => {
  it('loads more and retries after an error', async () => {
    // more lines than the timeline shows at first, over two pages: the newest stand on the second
    const events = Array.from({ length: SHOWN_LINES + 12 }, (_, index) =>
      event(`ev_${String(index).padStart(3, '0')}`, index * 10, { changes: { title: { old: `T${index}`, new: `T${index + 1}` } } }),
    );
    let failSecond = true;
    renderActivity((_body, request) => {
      if (request.searchParams.get('cursor') !== 'second') return historyPage(events.slice(0, 40), 'second');
      if (failSecond) return { status: 500, body: { type: 'about:blank', title: 'server_error', status: 500, reason: 'server_error', detail: 'Kaputt.' } };
      return historyPage(events.slice(40));
    });
    const user = userEvent.setup();

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Die Aktivität ließ sich nicht laden: Kaputt.');
    failSecond = false;
    await user.click(within(alert).getByRole('button', { name: 'Erneut versuchen' }));

    // the newest lines first: the last of the second page is there, the oldest wait for "Mehr laden"
    const timeline = await screen.findByRole('list', { name: 'Verlauf' });
    expect(screen.queryByRole('alert')).toBeNull();
    expect(within(timeline).getAllByRole('listitem')).toHaveLength(SHOWN_LINES);
    expect(timeline.textContent).toContain(`„T${SHOWN_LINES + 11}“ in „T${SHOWN_LINES + 12}“`);
    expect(timeline.textContent).not.toContain('„T0“');
    screen.getByText('noch 12 frühere Zeilen');

    const more = screen.getByRole('button', { name: 'Mehr laden' });
    await user.click(more);
    expect(within(timeline).getAllByRole('listitem')).toHaveLength(SHOWN_LINES + 12);
    expect(within(timeline).getAllByRole('listitem')[0].textContent).toContain('„T0“ in „T1“');
    // nothing earlier is left: the button goes and the focus moves on to the timeline
    expect(screen.queryByRole('button', { name: 'Mehr laden' })).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(timeline));
  });

  it('shows comments and changes in order and filters them', async () => {
    const user = userEvent.setup();
    const comments: Comment[] = [
      makeComment({ id: 'c_1', work_item_id: 'wi_web_48', author_id: 'u_ida', body_json: doc('Sieht gut aus.'), created_at: at(1) }),
      makeComment({ id: 'c_2', work_item_id: 'wi_web_48', author_id: 'u_lene', body_json: doc('Ist live.'), created_at: at(20) }),
    ];
    renderActivity(
      () =>
        historyPage([
          event('ev_1', 0, { changes: { title: { old: 'A', new: 'B' } } }),
          event('ev_2', 2, { changes: { priority: { old: 'none', new: 'high' } } }),
        ]),
      { routes: { 'GET /api/v1/work-items/wi_web_48/comments': () => ({ body: list(comments) }) } },
    );
    /** A line as text; a comment card as "Kommentar von <Name>: <Text>". */
    const shown = async () => {
      const timeline = await screen.findByRole('list', { name: 'Verlauf' });
      await waitFor(() => expect(timeline.textContent).not.toContain('Unbekannt'));
      return within(timeline)
        .getAllByRole('listitem')
        .map((line) => {
          const card = within(line).queryByRole('article');
          return card ? `${card.getAttribute('aria-label')}: ${card.querySelector('.rt')?.textContent}` : textOf(line);
        });
    };

    // a comment between two changes of one person ends their line
    await waitFor(async () =>
      expect(await shown()).toEqual([
        'Mara Lindqvist hat den Titel von „A“ in „B“ geändert. heute 01:00',
        'Kommentar von Ida Brenner: Sieht gut aus.',
        'Mara Lindqvist hat die Priorität von None auf High geändert. heute 01:02',
        'Kommentar von Lene Vogt: Ist live.',
      ]),
    );
    // the composer stands at the end of the activity
    const section = screen.getByRole('region', { name: 'Aktivität' });
    expect(within(section).getByRole('button', { name: /Kommentar schreiben/ })).toBeTruthy();

    const filter = screen.getByRole('group', { name: 'Aktivität filtern' });
    await user.click(within(filter).getByRole('button', { name: 'Kommentare' }));
    expect(await shown()).toEqual(['Kommentar von Ida Brenner: Sieht gut aus.', 'Kommentar von Lene Vogt: Ist live.']);
    await user.click(within(filter).getByRole('button', { name: 'Änderungen' }));
    expect(await shown()).toEqual(['Mara Lindqvist hat den Titel von „A“ in „B“ geändert und die Priorität von None auf High geändert. heute 01:00']);
  });

  it('says when there are no comments yet', async () => {
    const user = userEvent.setup();
    renderActivity(() => historyPage([event('ev_1', 0)]));
    await linesOf();
    await user.click(within(screen.getByRole('group', { name: 'Aktivität filtern' })).getByRole('button', { name: 'Kommentare' }));
    await screen.findByText('Noch keine Kommentare.');
  });

  it('counts one earlier line', async () => {
    renderActivity(() => historyPage(Array.from({ length: SHOWN_LINES + 1 }, (_, index) => event(`ev_${index}`, index * 10))));

    await screen.findByText('noch 1 frühere Zeile');
  });

  it('shows a skeleton while loading and says when there is nothing yet', async () => {
    renderActivity(() => historyPage([]));

    // the first render waits for the answer
    expect(screen.getByRole('status').textContent).toContain('Aktivität wird geladen …');
    await screen.findByText('Noch keine Aktivität.');
  });

  it('filters the changes in the preview by itself', async () => {
    renderActivity(() => historyPage([]));
    const user = userEvent.setup();

    await screen.findByText('Noch keine Aktivität.');
    const filter = screen.getByRole('group', { name: 'Aktivität filtern' });
    await user.click(within(filter).getByRole('button', { name: 'Änderungen' }));
    await screen.findByText('Noch keine Änderungen.');
    expect(replace).not.toHaveBeenCalled();
  });

  it('keeps the filter in the address on the page', async () => {
    url = '/items/WEB-48?activity=changes&tab=1';
    renderActivity(() => historyPage([]), { surface: 'page' });
    const user = userEvent.setup();

    await screen.findByText('Noch keine Änderungen.');
    const filter = screen.getByRole('group', { name: 'Aktivität filtern' });
    expect(within(filter).getByRole('button', { name: 'Änderungen' }).getAttribute('aria-pressed')).toBe('true');

    await user.click(within(filter).getByRole('button', { name: 'Alles' }));
    expect(replace).toHaveBeenLastCalledWith({ url: '/items/WEB-48?tab=1', preserveState: true, preserveScroll: true });
    url = '/items/WEB-48';
  });

  it('chooses the changes in the address and reads an unknown filter as everything', async () => {
    url = '/items/WEB-48?activity=other';
    renderActivity(() => historyPage([]), { surface: 'page' });
    const user = userEvent.setup();

    await screen.findByText('Noch keine Aktivität.');
    await user.click(within(screen.getByRole('group', { name: 'Aktivität filtern' })).getByRole('button', { name: 'Änderungen' }));
    expect(replace).toHaveBeenLastCalledWith({ url: '/items/WEB-48?activity=changes', preserveState: true, preserveScroll: true });
  });
});
