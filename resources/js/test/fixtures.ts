/*
 * Fictional records for tests of the data layer, after the people and projects of the clickdummy's seed (Feldwerk).
 * Mara is org admin, Ida admin of WEB, Theo admin of APP and viewer in WEB, Lene member of WEB and APP; OPS is private.
 * The catalogs (workflows, types, properties, labels, relation types, resolutions) are those of the clickdummy's seed,
 * the work items, relations and history a few of its items (WEB-47, WEB-30, WEB-48, OPS-12), the inbox Mara's (seed
 * inbox.ts, as the NotificationsSeeder writes it).
 */

import { queried } from './api';
import type {
  Attachment,
  Comment,
  Display,
  Filter,
  ItemEvent,
  ItemGroups,
  Label,
  ListedItem,
  Notification,
  NotificationData,
  NotificationEvent,
  Organization,
  Project,
  ProjectRole,
  Property,
  RelationEntry,
  RelationType,
  SearchResults,
  Resolution,
  SystemStatus,
  User,
  View,
  Workflow,
  WorkItem,
  WorkItemType,
} from '@/types';

export const organization: Organization = {
  id: 'org_feldwerk',
  name: 'Feldwerk',
  locale: 'de',
  timezone: 'Europe/Berlin',
  week_start: 1,
  logo_url: null,
};

export function person(id: string, name: string, handle: string, org_role: User['org_role'] = 'member'): User {
  return {
    id,
    type: 'person',
    name,
    handle,
    email: `${handle}@feldwerk.example.com`,
    org_role,
    is_default_bot: false,
    owner_id: null,
    disabled_at: null,
    avatar_url: null,
    locale: 'de',
    timezone: 'Europe/Berlin',
  };
}

export const mara = person('u_mara', 'Mara Lindqvist', 'mara', 'admin');
export const ida = person('u_ida', 'Ida Brenner', 'ida');
export const theo = person('u_theo', 'Theo Okafor', 'theo');
export const lene = person('u_lene', 'Lene Vogt', 'lene');

export function project(identifier: string, my_role: ProjectRole, changes: Partial<Project> = {}): Project {
  return {
    id: `p_${identifier.toLowerCase()}`,
    identifier,
    name: identifier,
    description: '',
    image_url: null,
    lead_id: 'u_ida',
    visibility: 'public',
    workflow_id: 'wf_standard',
    enabled_type_ids: ['t_task', 't_bug', 't_epic'],
    default_type_id: 't_task',
    archived_at: null,
    my_role,
    is_member: true,
    ...changes,
  };
}

/** A list answer of the REST API. */
export function list<T>(data: T[], total = data.length) {
  return { data, links: {}, meta: { next_cursor: null, total } };
}

/* ------------------------------------------------------------------- workflows */

/** The default workflow: free, so every transition is allowed. */
export const standard: Workflow = {
  id: 'wf_standard',
  name: 'Standard',
  description: 'Der Standard-Workflow: Jeder Status ist von überall erreichbar.',
  is_default: true,
  is_free: true,
  initial_state_id: 'std_backlog',
  states: [
    { id: 'std_backlog', name: 'Backlog', icon: 'dashed', category: 'backlog', position: 0 },
    { id: 'std_todo', name: 'Todo', icon: 'circle', category: 'unstarted', position: 1 },
    { id: 'std_progress', name: 'In Progress', icon: 'half', category: 'started', position: 2 },
    { id: 'std_pending', name: 'Pending', icon: 'pause', category: 'started', position: 3 },
    { id: 'std_done', name: 'Done', icon: 'check', category: 'completed', position: 4 },
    { id: 'std_cancelled', name: 'Cancelled', icon: 'cross', category: 'canceled', position: 5 },
  ],
  transitions: [],
};

/** An agency workflow with an internal review and a customer approval; only listed transitions are allowed. */
export const agency: Workflow = {
  id: 'wf_agency',
  name: 'Agentur-Freigabe',
  description: 'Mit interner Prüfung und Kundenfreigabe vor dem Abschluss.',
  is_default: false,
  is_free: false,
  initial_state_id: 'app_backlog',
  states: [
    { id: 'app_backlog', name: 'Backlog', icon: 'dashed', category: 'backlog', position: 0 },
    { id: 'app_todo', name: 'Todo', icon: 'circle', category: 'unstarted', position: 1 },
    { id: 'app_progress', name: 'In Progress', icon: 'half', category: 'started', position: 2 },
    { id: 'app_review', name: 'Review', icon: 'three-quarter', category: 'started', position: 3 },
    { id: 'app_approval', name: 'Kundenfreigabe', icon: 'pause', category: 'started', position: 4 },
    { id: 'app_done', name: 'Done', icon: 'check', category: 'completed', position: 5 },
    { id: 'app_cancelled', name: 'Cancelled', icon: 'cross', category: 'canceled', position: 6 },
  ],
  transitions: [
    ['app_backlog', 'app_todo'],
    ['app_todo', 'app_progress'],
    ['app_progress', 'app_review'],
    ['app_review', 'app_progress'],
    ['app_review', 'app_approval'],
    ['app_approval', 'app_done'],
    ['app_approval', 'app_progress'],
    // every open status can be cancelled
    ['app_backlog', 'app_cancelled'],
    ['app_todo', 'app_cancelled'],
    ['app_progress', 'app_cancelled'],
    ['app_review', 'app_cancelled'],
    ['app_approval', 'app_cancelled'],
    // reopening
    ['app_done', 'app_todo'],
    ['app_cancelled', 'app_backlog'],
  ],
};

/* ------------------------------------------------------- types, properties, catalogs */

export const resolutions: Resolution[] = [
  { id: 'res_done', label: 'Done', default_for: 'completed', position: 0, archived_at: null },
  { id: 'res_wontdo', label: "Won't do", default_for: 'canceled', position: 1, archived_at: null },
  { id: 'res_duplicate', label: 'Duplicate', default_for: null, position: 2, archived_at: null },
  { id: 'res_cannot', label: 'Cannot reproduce', default_for: null, position: 3, archived_at: null },
];

export const types: WorkItemType[] = [
  {
    id: 't_task',
    name: 'Task',
    icon: 'square-check',
    tone: 'sky',
    description: 'Eine Aufgabe, die jemand erledigt.',
    is_epic: false,
    properties: [
      { property_id: 'pr_customer', required: false, position: 0 },
      { property_id: 'pr_effort', required: false, position: 1 },
    ],
    archived_at: null,
  },
  {
    id: 't_bug',
    name: 'Bug',
    icon: 'bug',
    tone: 'ochre',
    description: 'Ein Fehler, der behoben werden muss. Die Umgebung, in der er auftritt, ist Pflicht.',
    is_epic: false,
    properties: [
      { property_id: 'pr_customer', required: false, position: 0 },
      { property_id: 'pr_effort', required: false, position: 1 },
      { property_id: 'pr_environment', required: true, position: 2 },
    ],
    archived_at: null,
  },
  {
    id: 't_epic',
    name: 'Epic',
    icon: 'zap',
    tone: 'moss',
    description: 'Ein größeres Vorhaben, das in Items zerfällt. Erscheint in der Timeline.',
    is_epic: true,
    properties: [{ property_id: 'pr_customer', required: false, position: 0 }],
    archived_at: null,
  },
  {
    id: 't_wish',
    name: 'Kundenwunsch',
    icon: 'message-square-heart',
    tone: 'plum',
    description: 'Ein Wunsch einer Kundin oder eines Kunden, der vor der Umsetzung freigegeben wird.',
    is_epic: false,
    properties: [{ property_id: 'pr_customer', required: true, position: 0 }],
    archived_at: null,
  },
];

export const properties: Property[] = [
  {
    id: 'pr_customer',
    key: 'customer',
    label: 'Kunde',
    field_type: 'dropdown',
    help: 'Für wen das Item gemacht wird.',
    default_value: null,
    settings: {},
    options: [
      { id: 'opt_nordlicht', label: 'Studio Nordlicht', color: 'sky', position: 0, archived_at: null },
      { id: 'opt_hafenkontor', label: 'Hafenkontor', color: 'ochre', position: 1, archived_at: null },
      { id: 'opt_moos', label: 'Gärtnerei Moos', color: 'moss', position: 2, archived_at: null },
    ],
  },
  {
    id: 'pr_effort',
    key: 'effort',
    label: 'Aufwand (h)',
    field_type: 'number',
    help: 'Geschätzte Stunden, auf eine Nachkommastelle.',
    default_value: null,
    settings: { decimals: 1 },
    options: [],
  },
  {
    id: 'pr_environment',
    key: 'environment',
    label: 'Umgebung',
    field_type: 'dropdown',
    help: 'Wo der Fehler aufgetreten ist.',
    default_value: null,
    settings: {},
    options: [
      { id: 'opt_env_prod', label: 'Produktion', color: 'plum', position: 0, archived_at: null },
      { id: 'opt_env_staging', label: 'Staging', color: 'ochre', position: 1, archived_at: null },
      { id: 'opt_env_local', label: 'Lokal', color: 'slate', position: 2, archived_at: null },
    ],
  },
];

export const labels: Label[] = [
  { id: 'lb_ux', name: 'UX', color: 'sky' },
  { id: 'lb_forms', name: 'Formulare', color: 'ochre' },
  { id: 'lb_production', name: 'Produktion', color: 'plum' },
  { id: 'lb_performance', name: 'Performance', color: 'moss' },
];

export const relationTypes: RelationType[] = [
  { id: 'rt_blocks', name: 'blockiert', outward_label: 'blockiert', inward_label: 'wird blockiert von', built_in: 'blocks' },
  { id: 'rt_duplicates', name: 'Duplikat', outward_label: 'ist Duplikat von', inward_label: 'hat Duplikat', built_in: 'duplicates' },
  { id: 'rt_relates', name: 'verwandt', outward_label: 'verwandt mit', inward_label: null, built_in: 'relates' },
  { id: 'rt_tests', name: 'testet', outward_label: 'testet', inward_label: 'wird getestet von', built_in: null },
];

/* ----------------------------------------------------------------- work items */

/** A work item as the API answers it, with sensible defaults; override what the test is about. */
export function makeWorkItem(overrides: Partial<WorkItem> = {}): WorkItem {
  return {
    id: 'wi_1',
    project_id: 'p_web',
    number: 1,
    key: 'WEB-1',
    type_id: 't_task',
    title: 'Beispielaufgabe',
    description: null,
    description_json: null,
    description_version: 1,
    state_id: 'std_todo',
    resolution_id: null,
    assignee_id: null,
    priority: 'none',
    label_ids: [],
    start_date: null,
    due_date: null,
    parent_id: null,
    parent: null,
    rank: 'a0',
    values: {},
    values_markdown: {},
    created_by: 'u_mara',
    created_at: '2026-10-01T08:00:00.000Z',
    updated_at: '2026-10-01T08:00:00.000Z',
    started_at: null,
    closed_at: null,
    archived_at: null,
    template_id: null,
    children_progress: null,
    blocked: false,
    blocking: false,
    subscribed: false,
    ...overrides,
  };
}

/** WEB-30: an epic in progress with one child, WEB-48. */
export const web30: WorkItem = makeWorkItem({
  id: 'wi_web_30',
  number: 30,
  key: 'WEB-30',
  type_id: 't_epic',
  title: 'Relaunch Phase 1',
  state_id: 'std_progress',
  start_date: '2026-10-01',
  due_date: '2026-11-15',
  rank: 'a4',
  started_at: '2026-10-01T08:00:00.000Z',
  children_progress: { done: 0, total: 1 },
});

/** WEB-48: a task under the epic WEB-30. */
export const web48: WorkItem = makeWorkItem({
  id: 'wi_web_48',
  number: 48,
  key: 'WEB-48',
  title: 'Startseite umbauen',
  parent_id: 'wi_web_30',
  parent: { id: 'wi_web_30', key: 'WEB-30', title: 'Relaunch Phase 1', type_id: 't_epic' },
  rank: 'a5',
});

/** WEB-47: a started bug, urgent, blocked by OPS-12, with a description and the subscription of the reader. */
export const web47: WorkItem = makeWorkItem({
  id: 'wi_web_47',
  number: 47,
  key: 'WEB-47',
  type_id: 't_bug',
  title: 'Kontaktformular sendet doppelt',
  description: 'Beim Absenden kommt die Mail **zweimal** an.',
  description_json: {
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: 'Beim Absenden kommt die Mail ' },
          { type: 'text', text: 'zweimal', marks: [{ type: 'bold' }] },
          { type: 'text', text: ' an.' },
        ],
      },
    ],
  },
  description_version: 3,
  state_id: 'std_progress',
  assignee_id: 'u_ida',
  priority: 'urgent',
  label_ids: ['lb_forms', 'lb_production'],
  start_date: '2026-10-27',
  due_date: '2026-10-31',
  values: { customer: 'opt_nordlicht', effort: 3.5, environment: 'opt_env_prod' },
  rank: 'a3',
  created_at: '2026-10-20T09:30:00.000Z',
  updated_at: '2026-10-27T08:15:00.000Z',
  started_at: '2026-10-27T08:15:00.000Z',
  blocked: true,
  subscribed: true,
});

/** OPS-12 (private project OPS): holds up WEB-47; open itself. */
export const ops12: WorkItem = makeWorkItem({
  id: 'wi_ops_12',
  project_id: 'p_ops',
  number: 12,
  key: 'OPS-12',
  title: 'Mail-Limits am Server erhöhen',
  state_id: 'std_progress',
  priority: 'high',
  rank: 'a5',
  started_at: '2026-10-26T09:00:00.000Z',
  blocking: true,
});

/** The relations of WEB-47 as a reader of OPS sees them: OPS-12 blocks it, and an item they may not see tests it. */
export const web47Relations: RelationEntry[] = [
  { relation: { id: 'rel_1', type_id: 'rt_blocks', source_id: 'wi_ops_12', target_id: 'wi_web_47' }, other: ops12, direction: 'inward', hidden: false },
  { relation: { id: 'rel_2', type_id: 'rt_tests', source_id: '', target_id: 'wi_web_47' }, other: null, direction: 'inward', hidden: true },
];

/** An entry of the history of WEB-47; override what the test is about. */
export function itemEvent(overrides: Partial<ItemEvent> = {}): ItemEvent {
  return {
    id: 'ev_1',
    type: 'work_item.created',
    actor_id: 'u_mara',
    subject: { type: 'work_item', id: 'wi_web_47' },
    project_id: 'p_web',
    changes: {},
    states: null,
    reason: null,
    via: 'ui',
    comment_id: null,
    comment_author_id: null,
    occurred_at: '2026-10-20T09:30:00.000Z',
    ...overrides,
  };
}

/** The history of WEB-47: created, moved to In Progress, and OPS-12 named as its blocker. */
export const web47History: ItemEvent[] = [
  itemEvent(),
  itemEvent({
    id: 'ev_2',
    type: 'work_item.state_changed',
    actor_id: 'u_ida',
    changes: { state_id: { old: 'std_todo', new: 'std_progress' } },
    states: { old: { id: 'std_todo', name: 'Todo', category: 'unstarted' }, new: { id: 'std_progress', name: 'In Progress', category: 'started' } },
    occurred_at: '2026-10-27T08:15:00.000Z',
  }),
  itemEvent({
    id: 'ev_3',
    type: 'work_item.relation_added',
    changes: { relation: { old: null, new: { label: 'wird blockiert von', item_id: 'wi_ops_12', key: 'OPS-12' } } },
    occurred_at: '2026-10-27T09:00:00.000Z',
  }),
];

/** A comment on WEB-47 by Mara; override what the test is about. `body` is the Markdown of `body_json`. */
export function makeComment(overrides: Partial<Comment> = {}): Comment {
  return {
    id: 'c_1',
    work_item_id: 'wi_web_47',
    author_id: 'u_mara',
    body: 'Kann ich reproduzieren, nur unter iOS 18.',
    body_json: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Kann ich reproduzieren, nur unter iOS 18.' }] }] },
    created_at: '2026-10-27T13:42:00.000Z',
    edited_at: null,
    reactions: [],
    ...overrides,
  };
}

/** The comments of WEB-47 (the clickdummy's seed): Mara's with two thumbs up, then Ida mentioning Mara. */
export const web47Comments: Comment[] = [
  makeComment({ id: 'c_web47_1', reactions: [{ emoji: '👍', user_ids: ['u_ida', 'u_theo'] }] }),
  makeComment({
    id: 'c_web47_2',
    author_id: 'u_ida',
    body: 'Ich schaue mir den Submit-Handler an. @mara magst du gegenlesen?',
    body_json: {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'Ich schaue mir den Submit-Handler an. ' },
            { type: 'mention', attrs: { id: 'u_mara', label: 'mara', mentionSuggestionChar: '@' } },
            { type: 'text', text: ' magst du gegenlesen?' },
          ],
        },
      ],
    },
    created_at: '2026-10-28T07:50:00.000Z',
  }),
];

/** A picture Mara uploaded into a text of WEB that nobody saved yet; override what the test is about. */
export function makeAttachment(overrides: Partial<Attachment> = {}): Attachment {
  const id = overrides.id ?? 'att_1';
  return {
    id,
    project_id: 'p_web',
    owner: null,
    kind: 'inline',
    filename: 'screenshot.png',
    mime: 'image/png',
    size: 48_213,
    inline: true,
    url: `/attachments/${id}`,
    preview_url: null,
    uploaded_by: 'u_mara',
    created_at: '2026-10-28T09:00:00.000Z',
    ...overrides,
  };
}

/* ------------------------------------------------------------------- item lists */

/**
 * The items a fake `POST /api/v1/work-items/query` answers out of `items`: those of the named project (ULID or
 * identifier), the children of the named parent, only epics (`t_epic`) when a condition asks, and for `q` the item of
 * that key or the items whose title holds it, as the server reads them.
 */
export function queryItems(items: readonly WorkItem[], body: unknown): WorkItem[] {
  const { project, parent, q, epic } = queried(body);
  const exact = q === undefined ? undefined : items.find((item) => item.key === q.toUpperCase());
  return items.filter(
    (item) =>
      (project === undefined || item.project_id === project || item.key.startsWith(`${project}-`)) &&
      (parent === undefined || item.parent_id === parent || item.parent?.key === parent) &&
      (!epic || item.type_id === 't_epic') &&
      (q === undefined || (exact ? item === exact : item.title.toLowerCase().includes(q.toLowerCase()))),
  );
}

/* ------------------------------------------------------------------------ views */

const conditions = (...entries: Filter['conditions']): Filter => ({ version: 1, conditions: entries });

const FIELDS = ['key', 'title', 'state', 'assignee', 'priority', 'due_date'];

/** A view as the API answers it, after the clickdummy's "Fällig diese Woche"; override what the test is about. */
export function makeView(overrides: Partial<View> = {}): View {
  const display: Display = { layout: 'list', group_by: 'project', sort: { field: 'due_date', direction: 'asc' }, fields: [...FIELDS], show_sub_items: false };
  return {
    id: 'v_due_week',
    name: 'Fällig diese Woche',
    icon: 'calendar-clock',
    filter: conditions({ field: 'state_category', op: 'in', value: ['backlog', 'unstarted', 'started'] }, { field: 'due_date', op: 'is', value: 'this_week' }),
    display,
    created_by: 'u_mara',
    created_at: '2026-09-14T08:00:00.000Z',
    updated_at: '2026-09-14T08:00:00.000Z',
    ...overrides,
  };
}

/** "Produktions-Bugs" of the clickdummy: the bugs of OPS as a board by state. */
export const prodBugs: View = makeView({
  id: 'v_prod_bugs',
  name: 'Produktions-Bugs',
  icon: 'bug',
  filter: conditions({ field: 'project', op: 'is', value: 'p_ops' }, { field: 'type', op: 'is', value: 't_bug' }),
  display: { layout: 'board', group_by: 'state', sort: { field: 'priority', direction: 'asc' }, fields: [...FIELDS], show_sub_items: true },
  created_by: 'u_ida',
});

/** The groups of WEB by state as `POST /work-items/groups` answers them: every state of the standard workflow. */
export const webStateGroups: ItemGroups = {
  group_by: 'state',
  total: 3,
  groups: [
    { key: 'std_backlog', count: 0 },
    { key: 'std_todo', count: 1 },
    { key: 'std_progress', count: 2 },
    { key: 'std_pending', count: 0 },
    { key: 'std_done', count: 0 },
    { key: 'std_cancelled', count: 0 },
  ],
};

/** No hits, as `GET /api/v1/search` answers a query that finds nothing. */
export const emptySearch: SearchResults = { items: [], projects: [], people: [], views: [], key_match: null };

export function searchResults(partial: Partial<SearchResults> = {}): SearchResults {
  return { ...emptySearch, ...partial };
}

/* -------------------------------------------------------------- notifications */

/** A notification of Mara's inbox as `GET /api/v1/notifications` answers it, unread; override what the test is about. */
export function makeNotification(overrides: Partial<Notification> = {}): Notification {
  return {
    id: 'n_1',
    user_id: 'u_mara',
    event_id: 'ev_1',
    event: 'assigned',
    project_id: 'p_web',
    work_item_id: web47.id,
    actor_id: 'u_ida',
    data: {},
    excerpt: null,
    read_at: null,
    mailed_at: null,
    created_at: '2026-10-28T07:40:00.000Z',
    item: web47,
    ...overrides,
  };
}

/** The items of Mara's inbox that the fixtures above do not have yet, lean as the inbox lists them. */
const inboxItems = {
  web42: makeWorkItem({ id: 'wi_web_42', number: 42, key: 'WEB-42', title: 'Startseite: Hero und Teaser bauen', state_id: 'std_progress', assignee_id: 'u_ida' }),
  web40: makeWorkItem({ id: 'wi_web_40', number: 40, key: 'WEB-40', type_id: 't_bug', title: 'Favicon fehlt im Safari', state_id: 'std_done', priority: 'low' }),
  app15: makeWorkItem({ id: 'wi_app_15', project_id: 'p_app', number: 15, key: 'APP-15', type_id: 't_wish', title: 'Bestellhistorie als PDF exportieren', state_id: 'app_approval' }),
  app18: makeWorkItem({ id: 'wi_app_18', project_id: 'p_app', number: 18, key: 'APP-18', title: 'TestFlight-Gruppe für Kunden einrichten', state_id: 'app_review', assignee_id: 'u_mara', priority: 'medium', due_date: '2026-10-28' }),
  app24: makeWorkItem({ id: 'wi_app_24', project_id: 'p_app', number: 24, key: 'APP-24', title: 'Feedback der Beta-Tester sammeln', state_id: 'app_backlog', assignee_id: 'u_mara', priority: 'medium' }),
  ops3: makeWorkItem({ id: 'wi_ops_3', project_id: 'p_ops', number: 3, key: 'OPS-3', type_id: 't_epic', title: 'Server-Migration', state_id: 'std_progress' }),
  ops11: makeWorkItem({ id: 'wi_ops_11', project_id: 'p_ops', number: 11, key: 'OPS-11', title: 'DNS-Einträge umstellen', state_id: 'std_done', assignee_id: 'u_mara', priority: 'high' }),
};

const snapshot = (id: string, name: string, category: 'unstarted' | 'started' | 'completed') => ({ id, name, category });
const todo = snapshot('std_todo', 'Todo', 'unstarted');
const progress = snapshot('std_progress', 'In Progress', 'started');
const done = snapshot('std_done', 'Done', 'completed');

function inboxRow(
  id: string,
  event: NotificationEvent,
  item: WorkItem | null,
  actor: string | null,
  created: string,
  read: string | null,
  extra: { data?: NotificationData; excerpt?: string; project_id?: string | null } = {},
): Notification {
  return makeNotification({
    id,
    event_id: null,
    event,
    project_id: extra.project_id !== undefined ? extra.project_id : (item?.project_id ?? null),
    work_item_id: item?.id ?? null,
    actor_id: actor,
    data: extra.data ?? {},
    excerpt: extra.excerpt ?? null,
    read_at: read,
    created_at: created,
    item: item && lean(item),
  });
}

/** An item as a lean answer of the API carries it (P17): without the description and the Markdown of the values (T13-M2). */
function lean(item: ListedItem): ListedItem {
  const { description: _description, description_json: _json, values_markdown: _markdown, ...listed } = item as WorkItem;
  return listed;
}

/**
 * Mara's inbox as the NotificationsSeeder writes it from the clickdummy's seed (14 rows, newest first, the first three
 * unread are n_01, n_03, n_04), with the `data` the app stores and the excerpts the API reads. Times in UTC.
 */
export const maraInbox: Notification[] = [
  inboxRow('n_01', 'mentioned', inboxItems.web42, 'u_ida', '2026-10-28T07:40:00.000Z', null, {
    data: { source: 'comment', comment_id: 'c_web42_1' },
    excerpt: 'Hero-Entwurf ist drin, die Teaser kommen heute Nachmittag. @Mara Lindqvist kannst du die Texte kurz gegenlesen?',
  }),
  inboxRow('n_02', 'due', inboxItems.app18, null, '2026-10-28T07:00:00.000Z', '2026-10-28T07:10:00.000Z', { data: { due_date: '2026-10-28', overdue: false } }),
  inboxRow('n_04', 'assigned', inboxItems.app24, 'u_theo', '2026-10-27T15:05:00.000Z', null),
  inboxRow('n_03', 'comment', inboxItems.app15, 'u_theo', '2026-10-27T14:10:00.000Z', null, {
    data: { comment_id: 'c_app15_1' },
    excerpt: 'Hafenkontor möchte das bis Ende November. Wir brauchen noch das PDF-Layout vom Kunden.',
  }),
  inboxRow('n_05', 'state_changed', inboxItems.ops11, 'u_jonas', '2026-10-27T13:00:00.000Z', '2026-10-27T15:00:00.000Z', { data: { from: progress, to: done } }),
  inboxRow('n_06', 'item_changed', web47, 'u_ida', '2026-10-27T09:20:00.000Z', '2026-10-27T11:00:00.000Z', { data: { fields: ['priority'] } }),
  inboxRow('n_07', 'state_changed', web47, 'u_jonas', '2026-10-27T08:15:00.000Z', '2026-10-27T11:00:00.000Z', { data: { from: todo, to: progress } }),
  inboxRow('n_09', 'mentioned', inboxItems.ops3, 'u_jonas', '2026-10-26T16:00:00.000Z', '2026-10-27T07:30:00.000Z', {
    data: { source: 'comment', comment_id: 'c_ops3_1' },
    excerpt: 'Fehlt nur noch das Mail-Limit (OPS-12). @Mara Lindqvist das Wartungsfenster für die alten Server brauche ich noch von dir.',
  }),
  inboxRow('n_08', 'comment', ops12, 'u_jonas', '2026-10-26T15:30:00.000Z', '2026-10-27T07:30:00.000Z', {
    data: { comment_id: 'c_ops12_2' },
    excerpt: 'Setze ich um, sobald das Wartungsfenster steht.',
  }),
  inboxRow('n_11', 'state_changed', inboxItems.web40, 'u_lene', '2026-10-23T12:10:00.000Z', '2026-10-23T14:00:00.000Z', { data: { from: todo, to: done } }),
  // the webhook "Altes CRM" (phase 11): a notification of the organisation, without project and webhook
  inboxRow('n_10', 'webhook_disabled', null, null, '2026-10-22T08:00:00.000Z', '2026-10-23T07:00:00.000Z', { project_id: null }),
  inboxRow('n_12', 'assigned', inboxItems.app18, 'u_theo', '2026-10-21T09:00:00.000Z', '2026-10-21T11:00:00.000Z'),
  inboxRow('n_13', 'mentioned', web47, 'u_ida', '2026-10-20T09:30:00.000Z', '2026-10-20T13:00:00.000Z', {
    data: { source: 'description' },
    excerpt: 'Beim Absenden kommt die Mail zweimal an.',
  }),
  // the template "Zertifikate prüfen" (phase 10), without the template
  inboxRow('n_14', 'template_run_failed', null, null, '2026-10-01T05:00:05.000Z', '2026-10-02T07:00:00.000Z', {
    project_id: 'p_ops',
    data: { error: 'Pflicht-Property Umgebung fehlt' },
  }),
];

/* --------------------------------------------------------------------- system */

/** The system page as `GET /api/v1/system` answers it, after the clickdummy's seed; override what the test is about. */
export function makeSystemStatus(overrides: Partial<SystemStatus> = {}): SystemStatus {
  return {
    version: '0.1.0-dev',
    queued_jobs: 3,
    delayed_jobs: 1,
    queues: [
      { queue: 'default', pending: 2, oldest_at: '2026-10-28T07:59:00.000Z' },
      { queue: 'live', pending: 0, oldest_at: null },
      { queue: 'notifications', pending: 1, oldest_at: '2026-10-28T07:58:30.000Z' },
      { queue: 'webhooks', pending: 0, oldest_at: null },
      { queue: 'search', pending: 0, oldest_at: null },
      { queue: 'media', pending: 0, oldest_at: null },
      { queue: 'bulk', pending: 0, oldest_at: null },
    ],
    failed_jobs: [
      {
        id: '9b3e6a52-1c0f-4f1e-9a57-2d6f3e8c1a01',
        queue: 'notifications',
        job: 'App\\Jobs\\SendNotificationMailJob',
        error: 'Connection to mail-1.feldwerk.example.com:587 refused',
        failed_at: '2026-10-26T12:05:00.000Z',
      },
    ],
    failed_jobs_total: 1,
    search: 'ok',
    search_tasks: { enqueued: 0, processing: 0, failed_last_day: 0 },
    mail_configured: true,
    live: 'ok',
    ...overrides,
  };
}
