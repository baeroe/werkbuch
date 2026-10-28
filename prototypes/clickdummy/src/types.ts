/*
 * Shared domain types. They mirror the resources of the later REST API (spec 6.1, data model 7.4):
 * snake_case fields, all IDs are strings, dates are 'YYYY-MM-DD' and instants are ISO strings (UTC).
 * Pure types only; the domain logic that works on them lives in `src/domain/`.
 */

import type { JSONContent } from '@tiptap/react';

/* ------------------------------------------------------------------ base types */

/** Status category: decides the colour of a status (DESIGN.md: colour = category, shape = status). */
export type StateCategory = 'backlog' | 'unstarted' | 'started' | 'completed' | 'canceled';

/** Shape of a status icon, from a fixed set. */
export type StateIcon = 'dashed' | 'circle' | 'half' | 'three-quarter' | 'pause' | 'check' | 'cross';

export type Priority = 'urgent' | 'high' | 'medium' | 'low' | 'none';

/** Muted tones for type tabs, labels and dropdown options (light and dark variants in tokens.css). */
export type TypeTone = 'sky' | 'ochre' | 'moss' | 'plum' | 'sand' | 'slate';

export type FieldType = 'text' | 'number' | 'dropdown' | 'boolean' | 'date' | 'member' | 'rich_text' | 'url';

/** A Tiptap document (JSON), the stored form of every rich text. */
export type RichText = JSONContent;

/** Language of the UI and of mails. */
export type Locale = 'de' | 'en';

/** Weekday as in `Date#getDay()`: 0 = Sunday … 6 = Saturday. `Organization.week_start` uses the same numbers. */
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

/* ------------------------------------------------------------ accounts and projects */

export interface Organization {
  id: string;
  name: string;
  locale: Locale;
  /** IANA name, e.g. 'Europe/Berlin'. Schedules and daily jobs run in this zone. */
  timezone: string;
  /** First day of the week for filters like "this week": 0 = Sunday, 1 = Monday. */
  week_start: 0 | 1;
  logo_url: string | null;
}

export type OrgRole = 'admin' | 'member';

export interface User {
  id: string;
  type: 'person' | 'bot';
  name: string;
  handle: string;
  /** Bots have no e-mail address. */
  email: string | null;
  org_role: OrgRole;
  /** The one built-in bot that automations and template schedules act as. */
  is_default_bot: boolean;
  /** Bots: the responsible person. */
  owner_id: string | null;
  /** Bots: what the bot is for (spec 4.2). */
  description?: string;
  disabled_at: string | null;
  avatar_url: string | null;
  locale: Locale;
  timezone: string;
}

export type ProjectRole = 'admin' | 'member' | 'viewer';

export interface Project {
  id: string;
  /** 2-10 capital letters or digits, starts with a letter. Prefix of the item keys (`WEB-123`). */
  identifier: string;
  name: string;
  description: string;
  image_url: string | null;
  lead_id: string;
  visibility: 'public' | 'private';
  workflow_id: string;
  enabled_type_ids: string[];
  default_type_id: string;
  archived_at: string | null;
}

export interface ProjectMember {
  project_id: string;
  user_id: string;
  role: ProjectRole;
}

/* ------------------------------------------------------------------- workflows */

export interface State {
  id: string;
  name: string;
  icon: StateIcon;
  category: StateCategory;
  position: number;
}

/** An allowed move from one status to another. */
export type Transition = [from: string, to: string];

export interface Workflow {
  id: string;
  name: string;
  description: string;
  is_default: boolean;
  /** Free: every transition is allowed and `transitions` is not consulted. */
  is_free: boolean;
  initial_state_id: string;
  states: State[];
  transitions: Transition[];
}

/* ------------------------------------------------------------- types and properties */

export interface WorkItemType {
  id: string;
  name: string;
  /** Lucide icon name. */
  icon: string;
  tone: TypeTone;
  description: string;
  /** Items of epic types appear on the timeline. */
  is_epic: boolean;
  properties: { property_id: string; required: boolean; position: number }[];
  archived_at: string | null;
}

export interface PropertyOption {
  id: string;
  label: string;
  color: TypeTone;
  position: number;
  archived_at: string | null;
}

/** The stored value of a property. Dropdown and member values are option or user IDs. */
export type PropertyValue = string | number | boolean | string[] | RichText | null;

export interface Property {
  id: string;
  /** snake_case, unique and immutable. Item values are keyed by it (`WorkItem.values`). */
  key: string;
  label: string;
  field_type: FieldType;
  help: string;
  default_value: PropertyValue;
  settings: { multiple?: boolean; decimals?: number };
  options: PropertyOption[];
}

/* -------------------------------------------------------------------- catalogs */

export interface Label {
  id: string;
  name: string;
  color: TypeTone;
}

export interface RelationType {
  id: string;
  name: string;
  outward_label: string;
  /** Null: the relation is symmetric. */
  inward_label: string | null;
  /** The three built-in types cannot be deleted. */
  built_in: 'blocks' | 'duplicates' | 'relates' | null;
}

export interface Resolution {
  id: string;
  label: string;
  /** Set when a transition into this category gives no explicit choice. */
  default_for: 'completed' | 'canceled' | null;
  position: number;
  archived_at: string | null;
}

/* ------------------------------------------------------------------ work items */

export interface WorkItem {
  id: string;
  project_id: string;
  /** Counts up per project and is never reused. */
  number: number;
  /** `WEB-123`. */
  key: string;
  type_id: string;
  title: string;
  description: RichText | null;
  /** Counts up on every change of the description (conflict detection). */
  description_version: number;
  state_id: string;
  resolution_id: string | null;
  assignee_id: string | null;
  priority: Priority;
  label_ids: string[];
  start_date: string | null;
  due_date: string | null;
  parent_id: string | null;
  /** Fractional-indexing key for the manual order. */
  rank: string;
  /** Property values, keyed by `Property.key`. */
  values: Record<string, PropertyValue>;
  created_by: string;
  created_at: string;
  updated_at: string;
  /** First time the item entered a Started status. */
  started_at: string | null;
  /** Entry into a Completed or Canceled status; cleared on reopening. */
  closed_at: string | null;
  archived_at: string | null;
  template_id: string | null;
  subscriber_ids: string[];
}

export interface Relation {
  id: string;
  type_id: string;
  source_id: string;
  target_id: string;
}

export interface Comment {
  id: string;
  work_item_id: string;
  author_id: string;
  body: RichText;
  created_at: string;
  edited_at: string | null;
  reactions: { emoji: string; user_ids: string[] }[];
}

export interface Attachment {
  id: string;
  project_id: string;
  /** Null: uploaded for an item that is not saved yet. */
  owner: { type: 'work_item' | 'comment' | 'page' | 'template'; id: string } | null;
  /** `inline`: from the editor. `file`: from the file list of the item. */
  kind: 'inline' | 'file';
  filename: string;
  mime: string;
  size: number;
  url: string;
}

/** One entry of the event log: the source of the history and, in the real app, the outbox. */
export interface ItemEvent {
  id: string;
  /** e.g. `work_item.state_changed`. */
  type: string;
  actor_id: string;
  subject: { type: string; id: string };
  project_id: string | null;
  changes: Record<string, { old: unknown; new: unknown }>;
  /** Why an automation acted, e.g. "Automatisierung: Auto-Archiv". */
  reason: string | null;
  occurred_at: string;
}

/* ----------------------------------------------------------------------- views */

export type ConditionOp =
  | 'is'
  | 'is_not'
  | 'in'
  | 'not_in'
  | 'is_empty'
  | 'is_not_empty'
  | 'before'
  | 'after'
  | 'between'
  | 'contains'
  | 'gt'
  | 'lt'
  | 'overdue';

/** One filter condition. The fields, operators and value shapes are documented in `domain/filter.ts`. */
export interface Condition {
  field: string;
  op: ConditionOp;
  value?: unknown;
}

/** The filter JSON, the same format in the UI, the REST API and MCP. Conditions are joined with AND. */
export interface Filter {
  version: 1;
  conditions: Condition[];
}

export interface SortSpec {
  field: string;
  direction: 'asc' | 'desc';
}

export type GroupBy = 'state' | 'category' | 'assignee' | 'priority' | 'type' | 'label' | 'project' | 'parent' | 'none';

export interface Display {
  layout: 'list' | 'board' | 'table' | 'timeline';
  group_by: GroupBy;
  sort: SortSpec;
  fields: string[];
  show_sub_items: boolean;
}

export interface View {
  id: string;
  name: string;
  /** Lucide icon name or an emoji. */
  icon: string;
  filter: Filter;
  display: Display;
  created_by: string;
  created_at: string;
}

/** Everything the filter engine needs to know besides the item itself. */
export interface FilterContext {
  /** ID of the signed-in account; stands behind the value `'me'`. */
  me: string;
  /** Today in the organisation's time zone, 'YYYY-MM-DD'. */
  today: string;
  /**
   * IANA name of the organisation's time zone, e.g. 'Europe/Berlin'. It belongs together with `today`: the days of
   * the timestamps `created_at`, `updated_at` and `closed_at` are read in this zone. Without it they count by their
   * UTC day.
   */
  time_zone?: string;
  week_start: 0 | 1;
  stateCategory(stateId: string): StateCategory;
  typeHasProperty(typeId: string, key: string): boolean;
  hasChildren(itemId: string): boolean;
  /** Another item that is still open blocks this one (spec 4.9). */
  isBlocked(itemId: string): boolean;
  /** This item is still open and blocks at least one other item (spec 4.9). */
  isBlocking(itemId: string): boolean;
}

/** One bucket of a grouped item list: a board column or a list section. */
export interface Group {
  key: string;
  label: string;
  items: WorkItem[];
}

/* ------------------------------------------------------------------- templates */

export type ScheduleEnd = { type: 'never' } | { type: 'on'; date: string } | { type: 'count'; count: number };

/**
 * A recurring schedule (spec 4.12). Times are wall-clock times in the organisation's time zone.
 * Weeks start on Monday when `interval` counts weeks.
 */
export interface Schedule {
  frequency: 'daily' | 'weekly' | 'monthly' | 'yearly';
  /** Every N days, weeks, months or years, counted from `starts_on`. */
  interval: number;
  /** Weekly: the days of the week. Defaults to the weekday of `starts_on`. */
  weekdays?: Weekday[];
  /** Monthly: day of the month. Above the month's length it falls back to the last day. */
  month_day?: number | 'last';
  /** Monthly: the n-th weekday of the month; `n: -1` is the last one. Wins over `month_day`. */
  nth_weekday?: { n: 1 | 2 | 3 | 4 | -1; weekday: Weekday };
  /** Yearly: 'MM-DD'. Defaults to the month and day of `starts_on`. */
  yearly_date?: string;
  /** 'HH:MM'. */
  time: string;
  /** First day the schedule may run, 'YYYY-MM-DD'. */
  starts_on: string;
  ends: ScheduleEnd;
  paused: boolean;
}

export interface TemplatePayload {
  type_id: string;
  /** May contain placeholders such as `{week}` or `{month_name}`. */
  title: string;
  description: RichText | null;
  priority: Priority;
  assignee_id: string | null;
  label_ids: string[];
  values: Record<string, PropertyValue>;
  parent_id: string | null;
  start_offset_days: number | null;
  due_offset_days: number | null;
}

export interface Template {
  id: string;
  project_id: string;
  name: string;
  payload: TemplatePayload;
  schedule: Schedule | null;
  run_count: number;
  last_run_at: string | null;
  next_run_at: string | null;
  created_by: string;
}

export interface TemplateRun {
  id: string;
  template_id: string;
  /** The planned instant; unique per template. */
  scheduled_for: string;
  work_item_id: string | null;
  status: 'created' | 'failed';
  error: string | null;
}

/* ------------------------------------------------------------ further resources */

export type AutomationKey = 'auto_archive' | 'auto_close' | 'close_parent' | 'assign_on_start';

/** Parameters of an automation; which ones apply depends on its key. */
export interface AutomationSettings {
  /** `auto_archive`, `auto_close`: after how many days. */
  days?: number;
  /** `auto_close`: the Canceled status the item moves to. */
  state_id?: string;
}

/** One switchable automation of a project (spec 4.13). */
export interface Automation {
  id: string;
  project_id: string;
  key: AutomationKey;
  enabled: boolean;
  settings: AutomationSettings;
}

/** A wiki page (spec 4.15). Its place in the tree is `parent_id` plus `rank`. */
export interface Page {
  id: string;
  project_id: string;
  parent_id: string | null;
  rank: string;
  title: string;
  emoji: string | null;
  content: RichText | null;
  /** Counts up on every save; a save with an outdated base version is a conflict. */
  version: number;
  created_by: string;
  created_at: string;
  updated_by: string;
  updated_at: string;
  /** Clickdummy only: the next save reports a conflict once, so the banner can be shown. */
  simulate_conflict_once?: boolean;
}

/** A saved state of a page, kept after 10 minutes of pause and before a foreign version is overwritten. */
export interface PageVersion {
  id: string;
  page_id: string;
  version: number;
  title: string;
  content: RichText | null;
  author_id: string;
  created_at: string;
}

export type NotificationEvent =
  | 'assigned'
  | 'mentioned'
  | 'comment'
  | 'state_changed'
  | 'item_changed'
  | 'due'
  | 'item_created'
  | 'template_run_failed'
  | 'webhook_disabled';

export type NotificationChannel = 'inbox' | 'mail';

/** Details for rendering a notification; which ones are set depends on its event. */
export interface NotificationData {
  /** `mentioned`, `comment`: the text around the mention or the comment. */
  excerpt?: string;
  comment_id?: string;
  /** `state_changed`. */
  from_state_id?: string;
  to_state_id?: string;
  /** `item_changed`: the fields that changed. */
  fields?: string[];
  /** `due`. */
  due_date?: string;
  /** `template_run_failed`. */
  template_id?: string;
  error?: string;
  /** `webhook_disabled`. */
  webhook_id?: string;
}

export interface Notification {
  id: string;
  user_id: string;
  /** The event that caused it; null for reminders that no event stands behind. */
  event_id: string | null;
  event: NotificationEvent;
  project_id: string | null;
  work_item_id: string | null;
  actor_id: string | null;
  data: NotificationData;
  read_at: string | null;
  mailed_at: string | null;
  created_at: string;
}

/** Whether a person wants a kind of event on a channel. */
export interface NotificationPreference {
  user_id: string;
  event: NotificationEvent;
  channel: NotificationChannel;
  enabled: boolean;
}

export interface Webhook {
  id: string;
  name: string;
  url: string;
  /** Null: the whole organisation. */
  project_id: string | null;
  /** Event names; `work_item.*` stands for a whole group. */
  events: string[];
  /** Only fire for events of this bot. */
  bot_id: string | null;
  active: boolean;
  /** Set when the webhook failed for 24 hours and was switched off. */
  disabled_at: string | null;
  created_at: string;
}

/** The log entry of one delivery attempt. */
export interface WebhookDelivery {
  id: string;
  webhook_id: string;
  event: string;
  attempt: number;
  /** Null: no response (timeout, connection error). */
  status_code: number | null;
  duration_ms: number;
  /** The response, cut to 2 KB. */
  response_excerpt: string | null;
  error: string | null;
  created_at: string;
}

export type TokenAbility = 'read' | 'write' | 'mcp';

/** An API token. The plain text is shown once on creation and is not part of this record. */
export interface Token {
  id: string;
  user_id: string;
  name: string;
  abilities: TokenAbility[];
  expires_at: string | null;
  last_used_at: string | null;
  created_at: string;
}

export interface FailedJob {
  id: string;
  queue: string;
  job: string;
  error: string;
  failed_at: string;
}

export interface SystemStatus {
  version: string;
  queued_jobs: number;
  failed_jobs: FailedJob[];
  /** Meilisearch. */
  search: 'ok' | 'down';
  mail_configured: boolean;
}

/* --------------------------------------------------------------- API shapes (fake API) */

/** One end of a relation, seen from a work item. */
export interface RelationEntry {
  relation: Relation;
  /** The item at the other end; null when the reader may not see it (shown as "verborgenes Item", without title). */
  other: WorkItem | null;
  /** `outward`: this item is the source ("blockiert"); `inward`: it is the target ("wird blockiert von"). */
  direction: 'outward' | 'inward';
  hidden: boolean;
}

/** What `getWorkItem` returns: the item with everything the detail view shows besides the activity. */
export interface WorkItemDetail {
  item: WorkItem;
  type: WorkItemType;
  state: State;
  workflow: Workflow;
  children: WorkItem[];
  relations: RelationEntry[];
  attachments: Attachment[];
  /** Whether the signed-in account watches the item. */
  subscribed: boolean;
}

/**
 * Facts about all items the signed-in account may see, for cards and rows: the progress of items with children, and
 * the items that are blocked or block others (a blocker counts while it is open).
 */
export interface WorkItemMeta {
  /** Item id → closed and all children, for items that have children. */
  progress: Record<string, { done: number; total: number }>;
  blocked: string[];
  blocking: string[];
}

/** One line of an item's activity: a comment or an event of the history, in chronological order. */
export type ActivityEntry =
  | { kind: 'comment'; id: string; at: string; comment: Comment }
  | { kind: 'event'; id: string; at: string; event: ItemEvent };

/** The result of a bulk edit: what changed, and what an item's own rules refused (e.g. `transition_not_allowed`). */
export interface BulkResult {
  updated: string[];
  rejected: { id: string; reason: string }[];
}

/** A view or project in the sidebar of one person. */
export interface Favorite {
  user_id: string;
  kind: 'view' | 'project';
  id: string;
  position: number;
}

export interface Invitation {
  id: string;
  email: string;
  org_role: OrgRole;
  /** Projects to join on acceptance. */
  projects: { project_id: string; role: ProjectRole }[];
  link: string;
  created_by: string;
  created_at: string;
  /** Seven days after creation; a new invitation replaces the old one. */
  expires_at: string;
}

export interface SearchResults {
  items: WorkItem[];
  pages: Page[];
  projects: Project[];
  people: User[];
  views: View[];
}

/** A wiki page in the tree of a project: no content, but its children. */
export type PageNode = Omit<Page, 'content' | 'simulate_conflict_once'> & { children: PageNode[] };

/** What saving a webhook returns: the secret in plain text only on creating and on renewing it. */
export interface WebhookSaved {
  webhook: Webhook;
  secret: string | null;
}
