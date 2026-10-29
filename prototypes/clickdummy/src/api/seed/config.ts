/*
 * Seed: the configuration of the organisation: workflows (from the shared fixtures, same ids), types, properties,
 * labels, relation types, resolutions and the automations of the three projects.
 */

import { agency, resolutions as fixtureResolutions, standard } from '@/domain/fixtures';
import type { Automation, Label, Property, PropertyOption, RelationType, Resolution, TypeTone, Workflow, WorkItemType } from '@/types';

/** Copies, so that changing the stored data never touches the fixtures other code reads. */
export const workflows: Workflow[] = [structuredClone(standard), structuredClone(agency)];
export const resolutions: Resolution[] = structuredClone(fixtureResolutions);

/* -------------------------------------------------------------------------- types */

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
      { property_id: 'pr_browser', required: false, position: 3 },
      { property_id: 'pr_steps', required: false, position: 4 },
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
    properties: [
      { property_id: 'pr_target_quarter', required: false, position: 0 },
      { property_id: 'pr_customer', required: false, position: 1 },
    ],
    archived_at: null,
  },
  {
    id: 't_wish',
    name: 'Kundenwunsch',
    icon: 'message-square-heart',
    tone: 'plum',
    description: 'Ein Wunsch einer Kundin oder eines Kunden, der vor der Umsetzung freigegeben wird.',
    is_epic: false,
    properties: [
      { property_id: 'pr_customer', required: true, position: 0 },
      { property_id: 'pr_ticket_url', required: false, position: 1 },
      { property_id: 'pr_approved', required: false, position: 2 },
      { property_id: 'pr_reviewer', required: false, position: 3 },
    ],
    archived_at: null,
  },
];

/* ---------------------------------------------------------------------- properties */

const option = (id: string, label: string, color: TypeTone, position: number): PropertyOption => ({
  id,
  label,
  color,
  position,
  archived_at: null,
});

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
      option('opt_nordlicht', 'Studio Nordlicht', 'sky', 0),
      option('opt_hafenkontor', 'Hafenkontor', 'ochre', 1),
      option('opt_moos', 'Gärtnerei Moos', 'moss', 2),
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
    options: [option('opt_env_prod', 'Produktion', 'plum', 0), option('opt_env_staging', 'Staging', 'ochre', 1), option('opt_env_local', 'Lokal', 'slate', 2)],
  },
  {
    id: 'pr_browser',
    key: 'browser',
    label: 'Browser',
    field_type: 'text',
    help: 'Browser und Version, z. B. „Safari 18 auf iOS“.',
    default_value: null,
    settings: {},
    options: [],
  },
  {
    id: 'pr_ticket_url',
    key: 'ticket_url',
    label: 'Ticket beim Kunden',
    field_type: 'url',
    help: 'Link auf das Ticket im System des Kunden.',
    default_value: null,
    settings: {},
    options: [],
  },
  {
    id: 'pr_approved',
    key: 'approved',
    label: 'Abgenommen',
    field_type: 'boolean',
    help: 'Der Kunde hat die Umsetzung abgenommen.',
    default_value: false,
    settings: {},
    options: [],
  },
  {
    id: 'pr_reviewer',
    key: 'reviewer',
    label: 'Reviewer',
    field_type: 'member',
    help: 'Wer das Ergebnis prüft.',
    default_value: null,
    settings: {},
    options: [],
  },
  {
    id: 'pr_steps',
    key: 'steps',
    label: 'Schritte zum Nachstellen',
    field_type: 'rich_text',
    help: 'So lässt sich der Fehler reproduzieren.',
    default_value: null,
    settings: {},
    options: [],
  },
  {
    id: 'pr_target_quarter',
    key: 'target_quarter',
    label: 'Zielquartal',
    field_type: 'dropdown',
    help: 'Bis wann das Vorhaben fertig sein soll.',
    default_value: null,
    settings: {},
    options: [option('opt_q4_2026', 'Q4 2026', 'sky', 0), option('opt_q1_2027', 'Q1 2027', 'moss', 1), option('opt_q2_2027', 'Q2 2027', 'sand', 2)],
  },
];

/* --------------------------------------------------------------------- catalogs */

export const labels: Label[] = [
  { id: 'lb_ux', name: 'UX', color: 'sky' },
  { id: 'lb_forms', name: 'Formulare', color: 'ochre' },
  { id: 'lb_production', name: 'Produktion', color: 'plum' },
  { id: 'lb_performance', name: 'Performance', color: 'moss' },
  { id: 'lb_seo', name: 'SEO', color: 'sand' },
  { id: 'lb_a11y', name: 'Barrierefreiheit', color: 'slate' },
  { id: 'lb_backend', name: 'Backend', color: 'sky' },
  { id: 'lb_design', name: 'Design', color: 'plum' },
];

export const relationTypes: RelationType[] = [
  { id: 'rt_blocks', name: 'blockiert', outward_label: 'blockiert', inward_label: 'wird blockiert von', built_in: 'blocks' },
  { id: 'rt_duplicates', name: 'Duplikat', outward_label: 'ist Duplikat von', inward_label: 'hat Duplikat', built_in: 'duplicates' },
  { id: 'rt_relates', name: 'verwandt', outward_label: 'verwandt mit', inward_label: null, built_in: 'relates' },
  { id: 'rt_tests', name: 'testet', outward_label: 'testet', inward_label: 'wird getestet von', built_in: null },
];

/* ------------------------------------------------------------------ automations */

function automations(projectId: string, short: string, enabled: Partial<Record<Automation['key'], boolean>>, canceledStateId: string): Automation[] {
  return [
    { id: `au_${short}_auto_archive`, project_id: projectId, key: 'auto_archive', enabled: enabled.auto_archive ?? false, settings: { days: 30 } },
    { id: `au_${short}_auto_close`, project_id: projectId, key: 'auto_close', enabled: enabled.auto_close ?? false, settings: { days: 90, state_id: canceledStateId } },
    { id: `au_${short}_close_parent`, project_id: projectId, key: 'close_parent', enabled: enabled.close_parent ?? false, settings: {} },
    { id: `au_${short}_assign_on_start`, project_id: projectId, key: 'assign_on_start', enabled: enabled.assign_on_start ?? false, settings: {} },
  ];
}

/** WEB: auto-archive after 30 days and assignee on start. APP: auto-close after 90 days (Cancelled) and close the parent. OPS: all off. */
export const projectAutomations: Automation[] = [
  ...automations('p_web', 'web', { auto_archive: true, assign_on_start: true }, 'std_cancelled'),
  ...automations('p_app', 'app', { auto_close: true, close_parent: true }, 'app_cancelled'),
  ...automations('p_ops', 'ops', {}, 'std_cancelled'),
];
