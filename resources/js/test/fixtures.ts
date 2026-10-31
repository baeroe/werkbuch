/*
 * Fictional records for tests of the data layer, after the people and projects of the clickdummy's seed (Feldwerk).
 * Mara is org admin, Ida admin of WEB, Theo admin of APP and viewer in WEB, Lene member of WEB and APP; OPS is private.
 * The catalogs (workflows, types, properties, labels, relation types, resolutions) are those of the clickdummy's seed.
 */

import type { Label, Organization, Project, ProjectRole, Property, RelationType, Resolution, User, Workflow, WorkItemType } from '@/types';

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
