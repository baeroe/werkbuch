/*
 * Shared domain types. They mirror the resources of the later REST API (spec 6.1, data model 7.4):
 * snake_case fields, all IDs are strings, dates are 'YYYY-MM-DD' and instants are ISO strings (UTC).
 * Pure types only; the domain logic that works on them lives in `src/domain/`.
 */

import type { JSONContent } from '@tiptap/core';

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
  /** The workflow of the project; a project without a choice gets the default workflow. */
  workflow_id: string;
  /** The types the project offers; the default type is one of them. */
  enabled_type_ids: string[];
  default_type_id: string;
  archived_at: string | null;
  /** The role of the signed-in account in the project (org admins: `admin`, a public project of others: `viewer`). */
  my_role: ProjectRole;
  /** Whether the signed-in account is a member: the role alone does not say it (org admins, public projects). */
  is_member: boolean;
  /** Only with `include=members`: the members of the project and their roles. */
  members?: ProjectMember[];
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
  /** The status werkbuch sets in each step of an agent (spec 7.4, WEBU-25); always all four keys, `null` for none. */
  agent_states: Record<Exclude<AgentStep, 'ready' | 'blocked'>, string | null> & { ready?: string | null; blocked?: string | null };
}

/** The steps of an agent's work that set a status (spec 7.4). */
export type AgentStep = 'working' | 'review' | 'correction' | 'merged' | 'ready' | 'blocked';

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
  /** How agents work on items of the type (spec 7.3, layer 3): Markdown in the prompt after the working rules, or none. */
  agent_guidance: string | null;
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

export type PropertyPlacement = 'sidebar' | 'body';

export interface Property {
  id: string;
  /** snake_case, unique and immutable. Item values are keyed by it (`WorkItem.values`). */
  key: string;
  label: string;
  field_type: FieldType;
  help: string;
  /** Where it shows on an item (WEBU-6): the panel of fields or below the description. */
  placement: PropertyPlacement;
  default_value: PropertyValue;
  settings: { multiple?: boolean; decimals?: number };
  options: PropertyOption[];
}

/* -------------------------------------------------------------------- catalogs */

export interface Label {
  id: string;
  name: string;
  color: TypeTone;
  /** A model for agents, `cli:model` (spec 7.7): an item with the label runs its agent on it. Null: a plain label. */
  agent_model: string | null;
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

/** An item named by id, key and title, as a resource embeds it (the parent of a work item). */
export interface ItemRef {
  id: string;
  key: string;
  title: string;
  /** The type of the parent: its icon shows without loading the items of the project. */
  type_id: string;
}

/** The stored fields of a work item as the API sends them. The API answers with `WorkItem`: these and what it computes on read. */
export interface WorkItemRecord {
  id: string;
  project_id: string;
  /** Counts up per project and is never reused. */
  number: number;
  /** `WEB-123`. */
  key: string;
  type_id: string;
  title: string;
  /** The description as Markdown (what REST and MCP read). */
  description: string | null;
  /** The description as a Tiptap document (what the editor reads and sends). */
  description_json: RichText | null;
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
  /** Property values, keyed by `Property.key`; rich text values as Tiptap documents. */
  values: Record<string, PropertyValue>;
  /** The rich text values as Markdown, keyed by `Property.key`. */
  values_markdown: Record<string, string>;
  created_by: string;
  created_at: string;
  updated_at: string;
  /** First time the item entered a Started status. */
  started_at: string | null;
  /** Entry into a Completed or Canceled status; cleared on reopening. */
  closed_at: string | null;
  archived_at: string | null;
  /** The template the item was made from; null once that template is gone. */
  template_id: string | null;
}

/** A work item as the API answers it: the stored fields and what is computed on every read. */
export interface WorkItem extends WorkItemRecord {
  /**
   * The parent beside `parent_id`, so a card names its epic without loading it, also where a filter leaves the epic
   * out; null without a parent. The parent lies in the item's project: whoever sees the item sees it too.
   */
  parent: ItemRef | null;
  /** Closed children out of all children; null for an item without children. */
  children_progress: { done: number; total: number } | null;
  /** Another item that is still open blocks this one (spec 4.9). */
  blocked: boolean;
  /** This item is still open and blocks at least one other item (spec 4.9). */
  blocking: boolean;
  /** Whether the signed-in account watches the item. */
  subscribed: boolean;
}

/**
 * A work item as a list reads it: everything but the description and the Markdown of rich text values, which a lean
 * answer (`lean: true`) leaves out. Every `WorkItem` is one; rows, cards and the field editors take this.
 */
export type ListedItem = Omit<WorkItem, 'description' | 'description_json' | 'values_markdown'>;

export interface Relation {
  id: string;
  type_id: string;
  source_id: string;
  target_id: string;
}

/**
 * A comment as the API sends it (A243): the text as stored Tiptap JSON (`body_json`, what the editor shows) and as
 * Markdown for its reader (`body`, with current handles and keys). Reactions in the order of each emoji's first
 * reaction, the people in the order they reacted.
 */
export interface Comment {
  id: string;
  work_item_id: string;
  author_id: string;
  body: string;
  body_json: RichText;
  created_at: string;
  edited_at: string | null;
  reactions: { emoji: string; user_ids: string[] }[];
  /** The run of an agent whose result the comment is (a review, an answer); `null` for any other. */
  run_id?: string | null;
}

export interface Attachment {
  id: string;
  project_id: string;
  /** Null: uploaded for a text that is not saved yet; saving the text links it (A232). */
  owner: { type: 'work_item' | 'comment' | 'page' | 'template'; id: string } | null;
  /** `inline`: from the editor. `file`: from the file list of the item. */
  kind: 'inline' | 'file';
  filename: string;
  /** Read from the content by the server, never the client's claim. */
  mime: string;
  size: number;
  /** Whether a browser may show it as a picture (PNG, JPEG, GIF, WebP, AVIF); anything else downloads. */
  inline: boolean;
  /** The file (`/attachments/<id>`), for the session's cookie. */
  url: string;
  /** A smaller picture (`/attachments/<id>/preview`) once the queue made one, otherwise null. */
  preview_url: string | null;
  uploaded_by: string;
  created_at: string;
}

/** One entry of the event log: the source of the history and, in the real app, the outbox. */
export interface ItemEvent {
  id: string;
  /** e.g. `work_item.state_changed`. */
  type: string;
  actor_id: string;
  subject: { type: string; id: string };
  project_id: string | null;
  /** The changed fields as `{old, new}`; `null` for events without (`work_item.deleted`). */
  changes: Record<string, { old: unknown; new: unknown }> | null;
  /** A move (`work_item.state_changed`): both states as they were then, so a renamed or removed state keeps its name. */
  states: { old: StateSnapshot; new: StateSnapshot } | null;
  /** Why it happened, e.g. `workflow_changed`, `state_removed` (`RemapStates`) or the reason of an automation. */
  reason: string | null;
  /** How it happened: `ui`, `api`, `mcp`, `automation`, `template`, `system`; `null` for events that recorded none. */
  via: string | null;
  /** A change of a comment (`comment.updated`, `comment.deleted`): which one and whose; null for other events. */
  comment_id: string | null;
  comment_author_id: string | null;
  /** The template an item was made from (`work_item.created`), its name as it was then; null elsewhere. */
  template: { id: string; name: string } | null;
  occurred_at: string;
}

/** A state as an event of the history recorded it. */
export interface StateSnapshot {
  id: string;
  name: string;
  category: StateCategory;
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
  updated_at: string;
}

/** What `saveView` sends: a view without what the server sets; with `id` it replaces that view as a whole. */
export type ViewInput = Omit<View, 'id' | 'created_by' | 'created_at' | 'updated_at'> & { id?: string };

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
  items: ListedItem[];
}

/**
 * One group as the server counts it (`POST /work-items/groups`): its key (a state, account, label … ULID, a category or
 * priority, `none`, or `all` without grouping) and how many items it holds. A parent group names its item.
 */
export interface GroupCount {
  key: string;
  count: number;
  /** Only when grouped by parent: the parent item, `null` for the group `none`. */
  item?: ItemRef | null;
}

/** The groups of a list in their order, with the grouping the server applied (`state` falls back to `category`, P14). */
export interface ItemGroups {
  group_by: GroupBy;
  total: number;
  groups: GroupCount[];
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
  /** The description as Markdown for its reader (a reference the reader may not see reads `[hidden](<kind>:<ulid>)`). */
  description: string | null;
  /** The description as stored Tiptap JSON, with the ids of the template's own pictures. */
  description_json: RichText | null;
  priority: Priority;
  assignee_id: string | null;
  label_ids: string[];
  /** By property key; rich text as Tiptap JSON. */
  values: Record<string, PropertyValue>;
  /** The rich text values by key as Markdown for the reader. */
  values_markdown: Record<string, string>;
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
  created_at: string;
  updated_at: string;
}

/** A template without its texts (`?lean=1`, K24): the palette and the create dialog choose by name, the draft comes from the server. */
export type TemplateSummary = Omit<Template, 'payload'> & { payload: Omit<TemplatePayload, 'description' | 'description_json' | 'values_markdown'> };

/** What a run of a template logs (A338): who pressed „Jetzt ausführen“, or `null` for the scheduler. */
export interface TemplateRun {
  id: string;
  template_id: string;
  /** The planned instant; `null` for a run by hand. */
  scheduled_for: string | null;
  ran_at: string;
  work_item_id: string | null;
  status: 'created' | 'failed';
  error: string | null;
  triggered_by: string | null;
}

/** The fields of an item made from a template now (A335), as the create dialog takes them over. */
export interface TemplateDraft {
  project_id: string;
  template_id: string;
  type_id: string;
  title: string;
  description: string | null;
  description_json: RichText | null;
  priority: Priority;
  assignee_id: string | null;
  label_ids: string[];
  values: Record<string, PropertyValue>;
  parent_id: string | null;
  start_date: string | null;
  due_date: string | null;
}

/** The next terms of a schedule as the scheduler will run them, and a title rendered at the first of them. */
export interface SchedulePreview {
  runs: string[];
  title: string | null;
}

/* ------------------------------------------------------------ further resources */

export type AutomationKey = 'auto_archive' | 'auto_close' | 'close_parent' | 'assign_on_start' | 'link_references';

/** Parameters of an automation; which ones apply depends on its key. */
export interface AutomationSettings {
  /** `auto_archive`, `auto_close`: after how many days. */
  days?: number;
  /** `auto_close`: the Canceled status the item moves to. */
  state_id?: string | null;
}

/** One switchable automation of a project (spec 4.13). */
export interface Automation {
  /** `null` while the key has no row yet: the browser identifies an automation by `project_id` and `key`. */
  id: string | null;
  project_id: string;
  key: AutomationKey;
  enabled: boolean;
  settings: AutomationSettings;
}

/**
 * A wiki page (spec 4.15) as `GET /api/v1/pages/{page}` answers it. Its place in the tree is `parent_id` plus `rank`.
 * The text comes twice (A321): as Markdown for its reader (`content`: a reference the reader may not see reads
 * `[hidden](page:<ulid>)`) and as the stored Tiptap JSON the editor reads (`content_json`), both `null` without text.
 */
export interface Page {
  id: string;
  project_id: string;
  parent_id: string | null;
  rank: string;
  title: string;
  emoji: string | null;
  content: string | null;
  content_json: RichText | null;
  /** Counts up on every save that changes something; a save with an outdated base version is a conflict. */
  version: number;
  created_by: string;
  created_at: string;
  updated_by: string;
  updated_at: string;
}

/** A page without its text (A174): the tree, search hits and references (`[Titel](page:<ulid>)`). */
export type PageSummary = Omit<Page, 'content' | 'content_json'>;

/** A page in the tree of a project: no text, but its children, siblings by `rank` (A315). */
export type PageNode = PageSummary & { children: PageNode[] };

/**
 * A kept state of a page, kept after 10 minutes of pause and before a foreign version is overwritten (A307). The list
 * of versions comes without the text (A315); one version read on its own carries it (`PageVersionDetail`).
 */
export interface PageVersion {
  id: string;
  page_id: string;
  version: number;
  title: string;
  author_id: string;
  created_at: string;
}

/** A version read on its own (`GET /api/v1/pages/{page}/versions/{version}`): with its text as Markdown and JSON. */
export interface PageVersionDetail extends PageVersion {
  content: string | null;
  content_json: RichText | null;
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
  | 'webhook_disabled'
  | 'merge_guard_detected';

export type NotificationChannel = 'inbox' | 'mail';

/**
 * What a notification stores besides its links (table "Benachrichtigungsarten" of phase plan 8); which members are set
 * depends on its event. Texts are never stored: the excerpt of a comment or description comes with the notification,
 * read for its reader when the inbox is read (A272).
 */
export interface NotificationData {
  /** `mentioned`: where the mention stands. */
  source?: 'description' | 'values' | 'comment';
  /** `mentioned` in a comment, `comment`. */
  comment_id?: string | null;
  /** `state_changed`: both states as they were at the move (like `meta.states` of the history). */
  from?: StateSnapshot | null;
  to?: StateSnapshot | null;
  /** `item_changed`: the fields that changed (`title`, `priority`, `values.<key>`, `relation`, `attachment`, …). */
  fields?: string[];
  /** `due`: the due date and whether it was already past on the day of the reminder. */
  due_date?: string;
  overdue?: boolean;
  /** `template_run_failed` (phase 10). */
  template_id?: string;
  error?: string;
  /** `webhook_disabled` (phase 11): the webhook and its name when it was switched off. */
  webhook_id?: string;
  name?: string | null;
  /** `merge_guard_detected` (WEBU-24): the push of the app that no merge of werkbuch explains, and the items of its runs. */
  sha?: string | null;
  branch?: string | null;
  deleted?: boolean;
  item_ids?: string[];
}

/** A notification of the own inbox, as `GET /api/v1/notifications` answers it (`NotificationResource`). */
export interface Notification {
  id: string;
  user_id: string;
  /** The event that caused it; null for reminders that no event stands behind. */
  event_id: string | null;
  event: NotificationEvent;
  /** Null: a notification of the organisation (a switched-off webhook). */
  project_id: string | null;
  work_item_id: string | null;
  actor_id: string | null;
  data: NotificationData;
  /** The current text of the comment or description for the reader (hidden references stay hidden); null without one. */
  excerpt: string | null;
  read_at: string | null;
  /** When its mail went out; null while none did. */
  mailed_at: string | null;
  created_at: string;
  /** The item, lean (P17); null without one. */
  item: ListedItem | null;
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
  /** The first failure since the last success; the 24 hours until the shut-off count from here. */
  failing_since: string | null;
  last_success_at: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}

/** How an attempt came about: the schedule, "send again" or the test ping. */
export type WebhookAttemptKind = 'scheduled' | 'manual' | 'ping';

/** The log entry of one delivery attempt (`id` the attempt, `delivery_id` the delivery with the header `X-Werkbuch-Delivery`). */
export interface WebhookDelivery {
  id: string;
  delivery_id: string;
  webhook_id: string;
  event: string;
  attempt: number;
  kind: WebhookAttemptKind;
  /** Null: no response (timeout, connection error). */
  status_code: number | null;
  duration_ms: number;
  /** The response, cut to 2 KB. */
  response_excerpt: string | null;
  error: string | null;
  created_at: string;
}

/** The own second factor as `/me/two-factor` answers it; `enabled` only once the first code confirmed it. */
export interface TwoFactorStatus {
  enabled: boolean;
  confirmed_at: string | null;
  recovery_codes_left: number;
}

/** The start of the setup: the secret for typing it in, the link and the QR code (an SVG as data URL) for the app. */
export interface TwoFactorSetup {
  secret: string;
  otpauth_url: string;
  qr_svg: string;
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
  /** The UUID of the job, which "Erneut versuchen" names. */
  id: string;
  queue: string;
  /** The class of the job. */
  job: string;
  /** The first line of the error, at most 300 characters. */
  error: string;
  failed_at: string;
}

/** The system page (org admins), as `GET /api/v1/system` answers it. */
export interface SystemStatus {
  version: string;
  /** Jobs waiting in a queue, without the delayed ones. */
  queued_jobs: number;
  delayed_jobs: number;
  /** Every queue of the app with the jobs that are due and not worked yet, and since when the oldest is (null: none). */
  queues: { queue: string; pending: number; oldest_at: string | null }[];
  /** The newest 50. */
  failed_jobs: FailedJob[];
  failed_jobs_total: number;
  /** Meilisearch. */
  search: 'ok' | 'down';
  /** The tasks of Meilisearch; null while it is down. */
  search_tasks: { enqueued: number; processing: number; failed_last_day: number } | null;
  mail_configured: boolean;
  /** Reverb: `off` when live updates are not set up. */
  live: 'ok' | 'down' | 'off';
  /** Gotenberg, the PDF of wiki pages (WEBU-4); off without GOTENBERG_URL. */
  pdf: 'ok' | 'down' | 'off';
}

/* --------------------------------------------------------------------- API shapes */

/** One end of a relation, seen from a work item. */
export interface RelationEntry {
  /**
   * The relation. When the reader may not see the other end, that end's id is blanked (`''`): nothing of an unseen item
   * leaves the server, neither title nor key nor id (P19). The relation's own `id` and `type_id` stay.
   */
  relation: Relation;
  /** The item at the other end; null when the reader may not see it (shown as "verborgenes Item", without title). */
  other: WorkItem | null;
  /** `outward`: this item is the source ("blockiert"); `inward`: it is the target ("wird blockiert von"). */
  direction: 'outward' | 'inward';
  hidden: boolean;
}

/** What `getWorkItem` returns: the item with everything the detail view shows besides the activity (one call, `include`). */
export interface WorkItemDetail {
  item: WorkItem;
  type: WorkItemType;
  state: State;
  workflow: Workflow;
  children: WorkItem[];
  relations: RelationEntry[];
  /** The files of the item's file list (`kind: file`), oldest first. */
  attachments: Attachment[];
  /** Whether the signed-in account watches the item: `item.subscribed`. */
  subscribed: boolean;
  /** The pull requests linked to it (spec 12). */
  links?: WorkItemLink[];
  /** What an agent does at it; `null` when the server did not say. */
  agent?: ItemAgentState | null;
}

/** How many items stand in a state (`/state-usage`), for the mapping of states; states without items are left out. */
export interface StateUsage {
  state_id: string;
  items: number;
}

/** What deleting a type or a resolution did: a type or resolution that items use is archived instead. */
export interface CatalogDeleteOutcome {
  outcome: 'deleted' | 'archived';
}

/** One line of an item's activity: a comment or an event of the history, in chronological order. */
export type ActivityEntry =
  | { kind: 'comment'; id: string; at: string; comment: Comment }
  | { kind: 'event'; id: string; at: string; event: ItemEvent };

/**
 * What `changes.relation` of a `work_item.relation_added` / `work_item.relation_removed` event holds (`old` or `new`,
 * the other one is null) when `listActivity` returns it. The event stores the id of the other item; the reader gets
 * its current key if they may see it, and otherwise only `hidden`: the UI shows "verborgenes Item", without key or id.
 */
export interface RelationChange {
  /** The relation as seen from this item, e.g. "wird blockiert von". */
  label: string;
  item_id?: string;
  /** The current key of the other item. */
  key?: string;
  hidden?: true;
}

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
  /** `null` for a read-only token (whoever holds the link can create an account). */
  link: string | null;
  /** Whether the link works: `closed` after the inviter lost the admin role or an account with the address exists. */
  state: 'open' | 'closed';
  created_by: string;
  created_at: string;
  /** Seven days after creation; a new invitation replaces the old one. */
  expires_at: string;
}

/** What `GET /api/v1/search` can look through. */
export type SearchType = 'items' | 'pages' | 'projects' | 'people' | 'views';

/** Hits per kind; pages without their text. */
export interface SearchResults {
  items: ListedItem[];
  pages: PageSummary[];
  projects: Project[];
  people: User[];
  views: View[];
  /** The id of the item a typed key names, also over a former identifier (`OLD-12`). */
  key_match: string | null;
}

/** What saving a webhook returns: the secret in plain text only on creating and on renewing it. */
export interface WebhookSaved {
  webhook: Webhook;
  secret: string | null;
}

/* --------------------------------------------------------------- runners and agents */

/** The CLIs an agent runs with (spec 7.7). */
export type AgentCli = 'claude' | 'codex';

/** The kinds of run (spec 6.4). */
export type RunType = 'task' | 'correction' | 'conflict' | 'review' | 'comment';

export type RunStatus = 'queued' | 'waiting' | 'running' | 'canceling' | 'succeeded' | 'failed' | 'canceled' | 'timed_out' | 'lost';

/** The places of a runner, as set in werkbuch (spec 9): code runs in all and per repo, light runs in a pot of their own. */
export interface RunnerSlots {
  total: number;
  per_repo: number;
  light: number;
}

/** A machine that runs agents (spec 6.2, 8.6, 8.8, 10.1); org admins only. A revoked one is not listed. */
export interface Runner {
  id: string;
  name: string;
  os: 'darwin' | 'linux';
  arch: 'arm64' | 'amd64';
  version: string;
  protocol: number;
  /** A contact within the last minute. */
  online: boolean;
  last_seen_at: string | null;
  slots: RunnerSlots;
  /** What runs now: code runs in all, of the busiest repo, light runs. */
  slots_used: RunnerSlots;
  /** The last load the runner sent: percent, sizes in GB; `null` before its first report. */
  load: { cpu: number; gpu: number | null; ram_used: number; ram_total: number; disk_free: number; disk_total: number; measured_at: string | null } | null;
  clis: { cli: AgentCli; installed: boolean; version: string | null; logged_in: boolean; path: string | null }[];
  /** What the harness of the machine offers, as the runner reports it; `null` before its first report. */
  equipment: { mcp_servers: string[]; skills: string[]; plugins: string[]; werkbuch_access: string[] } | null;
  created_by: string;
  created_at: string | null;
  updated_at: string | null;
}

/** A one-time code to connect a runner (spec 6.2): `code` and `command` only in the answer of making it. */
export interface RunnerPairing {
  id: string;
  code?: string;
  command?: string;
  expires_at: string;
  redeemed_at: string | null;
  runner_id: string | null;
}

/** How a bot works as an agent (spec 10.4). A bot without a saved one answers the defaults, `updated_at` null. */
export interface AgentConfig {
  bot_id: string;
  enabled: boolean;
  /** The runner pool; empty is every runner of the organization. */
  runner_ids: string[];
  cli: AgentCli;
  model: string;
  /** A model per kind of run (WEBU-32 edits them; sent back as they are). */
  models: Partial<Record<RunType, string>>;
  updated_at: string | null;
}

/** The working rules of the organization for a kind of run (spec 7.3, 10.5). */
export interface AgentRule {
  type: RunType;
  /** Markdown: the own text, else the standard in the language of the organization. */
  body: string;
  /** Whether the text is the standard (a new standard of a release reaches it). */
  standard: boolean;
  /** The contract of the kind, fixed in code and first in every prompt (English); read only. */
  contract: string;
  /** The standard of werkbuch for the kind, what restoring it gives (A620). */
  standard_body: string;
}

export type MergeMethod = 'squash' | 'merge' | 'rebase';

/** A bot of a project as the agent settings show it (A621). */
export interface ProjectAgentBot {
  bot_id: string;
  /** Whether it works as an agent. */
  enabled: boolean;
  /** Whether it is a member of the project: only a member takes items; an org admin bot may review without. */
  member: boolean;
  /** Whether it may be the review agent here: a responsible person, active, may edit items. */
  reviews: boolean;
  cli: AgentCli;
  model: string;
  models: Partial<Record<RunType, string>>;
}

/** How agents work in a project (spec 10.3); the defaults while none are saved (`updated_at` null). */
export interface ProjectAgents {
  project_id: string;
  review_bot_id: string | null;
  /** Markdown for every run of the project. */
  instructions: string | null;
  /** A model per kind of run, `cli:model`. */
  models: Partial<Record<RunType, string>>;
  max_corrections: number;
  max_conflicts: number;
  review_person_prs: boolean;
  comment_on_pr: boolean;
  merge_method: MergeMethod;
  setup_command: string | null;
  teardown_command: string | null;
  bots: ProjectAgentBot[];
  /** Whether the workflow of the project names every step of the agents. */
  steps_complete: boolean;
  updated_at: string | null;
}

/** Why a run waits (spec 7.5): its agent is off, the guard holds its project, GitHub gave no token, no CLI, runner offline. */
export type RunWaitingReason = 'agent_off' | 'merge_guard' | 'github_unavailable' | 'no_cli' | 'runner_offline';

/** Where the model of a run came from (spec 7.7). */
export type ModelSource = 'label' | 'project' | 'bot' | 'default';

/** A run of an agent (spec 7.5, 10.6). */
export interface AgentRun {
  id: string;
  type: RunType;
  status: RunStatus;
  waiting_reason: RunWaitingReason | null;
  bot_id: string;
  cli: AgentCli;
  model: string;
  model_source?: ModelSource | null;
  model_label_id?: string | null;
  runner_id: string | null;
  runner_name: string | null;
  runner_online: boolean;
  /** The last contact of its runner; `null` without a runner or before its first. */
  runner_last_seen_at?: string | null;
  project_id: string;
  work_item_id: string | null;
  thread_id?: string | null;
  head_sha?: string | null;
  attempt?: number;
  started_at: string | null;
  deadline_at?: string | null;
  finished_at: string | null;
  /** What came of it: `summary`, `commit`, `verdict` (`approve`, `changes`), as the runner reported it. */
  result?: { summary?: string | null; commit?: string | null; verdict?: 'approve' | 'changes' | null; [key: string]: unknown } | null;
  /** Tokens, when the runner reported them. */
  usage?: { input?: number; output?: number; [key: string]: unknown } | null;
  error?: string | null;
  canceled_by?: string | null;
  /** Lines of its log that went past the limits (2 000 lines, 1 MB), oldest first. */
  events_dropped?: number;
  created_at: string | null;
  updated_at?: string | null;
}

/** A line of the log of a run (spec 6.4): what the runner read from the CLI. */
export interface RunEvent {
  id: string;
  attempt: number;
  kind: 'system' | 'text' | 'tool' | 'result' | 'error';
  text: string;
  at: string;
}

/** A check of the head commit of a linked pull request. */
export interface LinkCheck {
  name: string;
  app: string | null;
  status: string;
  conclusion: string | null;
  url: string | null;
}

/** A pull request linked to an item (spec 12), as GitHub told it last. */
export interface WorkItemLink {
  id: string;
  work_item_id: string;
  kind: 'pull_request';
  repository: string;
  number: number;
  title: string;
  url: string;
  state: 'open' | 'merged' | 'closed';
  draft: boolean;
  head_branch: string;
  base_branch: string;
  head_sha: string;
  closes: boolean;
  /** The GitHub login that opened it. */
  author: string;
  /** The strand of an agent that opened it. */
  thread_id: string | null;
  review: 'approve' | 'changes' | null;
  ci: 'none' | 'pending' | 'success' | 'failure';
  checks: LinkCheck[];
  merged_at: string | null;
  created_at: string | null;
  updated_at: string | null;
}

/** Why a bot cannot work on items of a project as an agent (`AgentFlow::refusal`). */
export type AgentRefusal = 'agent_off' | 'default_bot' | 'disabled' | 'no_owner' | 'archived' | 'no_steps' | 'not_member';

/** Why a strand pauses (spec 7.2, 11.3). */
export type PauseReason = 'brake' | 'no_change' | 'needs_person' | 'reassigned' | 'canceled' | 'guard' | 'github';

/** What an agent does at an item (`include=agent`): its strand, why the assigned bot is no agent here, brakes, repo, guard. */
export interface ItemAgentState {
  thread: {
    id: string;
    bot_id: string;
    status: 'open' | 'paused';
    pause_reason: PauseReason | null;
    corrections: number;
    conflicts: number;
    pr_number: number | null;
    branch: string | null;
    runner_id: string | null;
  } | null;
  refusal: AgentRefusal | null;
  /** The state the item must reach before its agent begins it (`ready` step), else null. */
  ready_state?: string | null;
  /** Keys of the open items that block this one; the agent begins when they are done. */
  blocked_by?: string[];
  brakes: { max_corrections: number; max_conflicts: number };
  repository: boolean;
  guard: { branch: string | null; sha: string | null; here: boolean } | null;
  /** How many runs the item has: only then does the browser ask for them. */
  runs?: number;
}

/* ----------------------------------------------------------------------------- GitHub */

/** A GitHub app of the instance, one per GitHub account (spec 10.2, A680); never its private key or webhook secret. */
export interface GitHubApp {
  id: string;
  app_id: number;
  slug: string;
  name: string;
  owner_login: string;
  owner_type: GitHubOwnerType;
  html_url: string;
  install_url: string;
  /** Permission → `read` or `write`. */
  permissions: Record<string, string>;
  events: string[];
  created_at: string | null;
  installations: GitHubInstallation[];
}

/** The kind of a GitHub account: the own account of a person or an organization. */
export type GitHubOwnerType = 'User' | 'Organization';

export interface GitHubInstallation {
  id: string;
  installation_id: number;
  account_login: string;
  account_type: string;
  repository_selection: string;
  suspended_at: string | null;
  removed_at: string | null;
}

export interface GitHubRepository {
  id: string;
  installation_id: string;
  full_name: string;
  private: boolean;
  default_branch: string;
  html_url: string;
  removed_at: string | null;
  /** Whether a project has it (`project` names it only when the reader sees that project). */
  taken: boolean;
  project: { id: string; identifier: string; name: string; base_branch: string; protected: boolean | null; guarded: boolean } | null;
}

/** The GitHub connection: the apps (by the login of their account) with their installations, and the repos they reach. */
export interface GitHubStatus {
  apps: GitHubApp[];
  repositories: GitHubRepository[];
}

/** What the browser posts to GitHub to register the app (the manifest flow). */
export interface GitHubManifestStart {
  url: string;
  manifest: Record<string, unknown>;
  state: string;
}

/** A push of the app to the base branch no merge of werkbuch explains (spec 11.3). */
export interface MergeGuard {
  detected_at: string | null;
  sha: string | null;
  branch: string | null;
  runs: { run_id: string; item_id: string | null; bot_id: string | null }[];
}

/** The repo of a project (spec 10.3). */
export interface ProjectRepository {
  project_id: string;
  repository: { id: string; full_name: string; private: boolean; default_branch: string; html_url: string; removed_at: string | null };
  base_branch: string;
  /** Whether a ruleset keeps a direct push off the base branch (a hint only); `null`: GitHub did not say. */
  protected: boolean | null;
  protected_checked_at: string | null;
  guard: MergeGuard | null;
  updated_at: string | null;
}
