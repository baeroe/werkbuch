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
  /**
   * The status the agents set in each step (spec 7.4): part of the workflow, so every project with it works the same
   * way. Agents work only when all four are set.
   */
  agent_states: Record<AgentStep, string | null>;
}

/* ------------------------------------------------------------- types and properties */

export interface WorkItemType {
  id: string;
  name: string;
  /** Lucide icon name. */
  icon: string;
  tone: TypeTone;
  description: string;
  /**
   * How agents go about items of this type (spec 7.3, the layer after the working rules of the kind of run), e.g.
   * "start with a failing test" for a bug. Empty: nothing of its own.
   */
  agent_guidance: string;
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
  /**
   * The model an agent takes for an item with this label (WEBU-18, spec 7.7), e.g. `haiku`; null or missing: an
   * ordinary label. werkbuch reads the field, never the name.
   */
  agent_model?: string | null;
  /** The CLI the model belongs to: the label counts only for agents with this CLI. */
  agent_cli?: AgentCli | null;
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
}

/** A work item as the fake API stores it. The API answers with `WorkItem`: these fields and what it computes on read. */
export interface WorkItemRecord {
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

/** A work item as the API answers it: the stored fields and what is computed on every read. */
export interface WorkItem extends WorkItemRecord {
  /**
   * The parent beside `parent_id`, so a card names its epic without loading it, also where a filter leaves the epic
   * out; null without a parent. The parent lies in the item's project: whoever sees the item sees it too.
   */
  parent: ItemRef | null;
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
  /** A bot's answer to a run (`review`, `comment`, a failed run): the run it came from (WEBU-18). */
  run_id?: string;
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
  /**
   * The relation. When the reader may not see the other end, that end's id is blanked (`''`): item ids spell the key
   * (`wi_ops_12`), so neither may leave the server. The relation's own `id` and `type_id` stay.
   */
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

/* ------------------------------------------------------------- runner and agents (WEBU-18) */

/**
 * Spec `2026-11-23-runner-design.md`. A runner is a machine with the daemon `werkbuch-runner`, bound to the
 * organisation. It polls for runs; online means it called in during the last minute.
 */
export interface Runner {
  id: string;
  /** The host name at pairing; can be renamed. */
  name: string;
  os: 'darwin' | 'linux';
  arch: 'arm64' | 'amd64';
  version: string;
  /** When it last called in; the fake API keeps it close to the clock while the runner is online. */
  last_seen_at: string;
  online: boolean;
  /**
   * Slots, set in werkbuch (spec 8.4, 9): code runs in all and per repo, and the pot of light runs (`review`,
   * `comment`). The runner gets them with every answer; a change holds without a restart.
   */
  slots: RunnerSlots;
  /** What runs now in each pot; `per_repo` is the busiest repo. */
  slots_used: RunnerSlots;
  /** The last load the runner sent (spec 8.6); of an offline runner, from its last contact. */
  load: RunnerLoad;
  /**
   * What the harness of the machine offers an agent, as the runner reports it (spec 8.7): set up on the machine, by
   * hand or with a tool of the person's choice, never in werkbuch. werkbuch adds only its own server with the token of the run.
   */
  equipment: RunnerEquipment;
  /** The CLIs the runner found on the machine (spec 8.8): a run goes only to a runner with its agent's CLI logged in. */
  clis: RunnerCli[];
  /** The last self-update failed: why; the old version keeps running. */
  update_error: string | null;
  created_at: string;
  /** What runs on it now or waits for it, with the item. */
  active_runs: { id: string; type: RunType; status: RunStatus; item_id: string; item_key: string; item_title: string; started_at: string | null }[];
}

/** A CLI on a runner's machine, as the runner reports it. */
export interface RunnerCli {
  cli: AgentCli;
  installed: boolean;
  version: string | null;
  logged_in: boolean;
}

export interface RunnerSlots {
  total: number;
  per_repo: number;
  light: number;
}

/** The load of a runner's machine (spec 8.6): percent, and sizes in GB. */
export interface RunnerLoad {
  cpu: number;
  /** Null where the system gives no GPU load without root. */
  gpu: number | null;
  ram_used: number;
  ram_total: number;
  disk_free: number;
  disk_total: number;
  measured_at: string;
}

/** A one-time code to pair a runner: valid for ten minutes, redeemed once. */
export interface RunnerPairing {
  code: string;
  /** `curl -fsSL <APP_URL>/runner/install.sh | sh -s -- --code <CODE>`. */
  command: string;
  expires_at: string;
  /** Set once a runner redeemed the code: the new runner. */
  runner_id: string | null;
}

export type AgentCli = 'claude' | 'codex';

/** The kinds of run (spec 7.1). */
export type RunType = 'task' | 'correction' | 'conflict' | 'review' | 'comment';

/** The agent configuration of a bot (spec 10.4); a bot without one, or with `enabled` false, stays a plain API bot. */
export interface AgentConfig {
  bot_id: string;
  enabled: boolean;
  /** The runners it may run on; the first free one that has the project takes a run. */
  runner_ids: string[];
  cli: AgentCli;
  /** One of the models the CLI knows (`KNOWN_MODELS`). */
  model: string;
  /** Overrides per kind of run; missing ones take `model`. */
  models: Partial<Record<RunType, string>>;
}

/** The steps of the flow that set a status (spec 7.4). */
export type AgentStep = 'working' | 'review' | 'correction' | 'merged';

export type MergeMethod = 'squash' | 'merge' | 'rebase';

/** The agent settings of a project (spec 10.3). */
/** The equipment of a runner's harness: MCP servers, skills and plugins, and ways to werkbuch besides the run's. */
export interface RunnerEquipment {
  mcp_servers: string[];
  skills: string[];
  plugins: string[];
  /** MCP servers of the machine that reach werkbuch with a personal token: the agent would have a second way in. */
  werkbuch_access: string[];
}

/** A model of a CLI (spec 7.7). */
export interface ModelRef {
  cli: AgentCli;
  model: string;
}

export interface ProjectAgents {
  project_id: string;
  /** `owner/name` of a repo both apps are installed on; null: the project has no repo (runs end with a summary). */
  repo: string | null;
  base_branch: string;
  merge_method: MergeMethod;
  /**
   * Shell commands the runner runs after it set up a worktree and before it removes one (spec 8.4), e.g. a DDEV
   * project per worktree; `$WORKTREE` is its name. Empty: none.
   */
  setup_command: string;
  teardown_command: string;
  /** The bot that reviews PRs of the repo, of agents and of people. */
  review_bot_id: string | null;
  max_corrections: number;
  max_conflicts: number;
  review_human_prs: boolean;
  comment_on_pr: boolean;
  /** A model per kind of run, with its CLI: it counts only for agents with that CLI (spec 7.7). */
  models: Partial<Record<RunType, ModelRef>>;
  /**
   * What agents should know about the project and how they work in it, for every kind of run (spec 7.3, the layer
   * after the item type and before CLAUDE.md in the repo). Markdown; empty: nothing of its own.
   */
  info: string;
  /** Only in answers: whether the project has saved its settings once; before that agents are off there. */
  configured?: boolean;
}

/**
 * The working rules of the organization per kind of run (spec 7.3, the layer after the contract): Markdown, null takes
 * the standard werkbuch ships.
 */
export type AgentRules = Record<RunType, string | null>;

/** The two GitHub apps of the instance (spec 11.3). */
export interface GithubApp {
  /** "Feldwerk werkbuch", "Feldwerk werkbuch review": global names at GitHub. */
  name: string;
  slug: string;
  /** What the app may do, in words. */
  permissions: string[];
  webhooks: boolean;
  installed: boolean;
  created_at: string;
}

export interface GithubRepo {
  full_name: string;
  private: boolean;
  default_branch: string;
  agent_app: boolean;
  review_app: boolean;
}

export interface GithubConnection {
  agent_app: GithubApp | null;
  review_app: GithubApp | null;
  repos: GithubRepo[];
}

export type RunStatus = 'queued' | 'waiting' | 'running' | 'canceling' | 'succeeded' | 'failed' | 'canceled' | 'timed_out' | 'lost';

export type ModelSource = 'label' | 'project' | 'bot';

export interface RunLogLine {
  /** Seconds after the start of the run. */
  offset: number;
  kind: 'system' | 'text' | 'tool' | 'result' | 'error';
  text: string;
}

/** A run of an agent on a runner (`agent_runs`, spec 7.5). */
export interface AgentRun {
  id: string;
  type: RunType;
  status: RunStatus;
  bot_id: string;
  runner_id: string | null;
  item_id: string;
  thread_id: string | null;
  model: string;
  model_source: ModelSource;
  /** With `model_source` label: the label that chose it. */
  model_label_id: string | null;
  attempt: number;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  /** `review`: the verdict; `task`/`correction`/`conflict`: the commit it pushed; a short summary. */
  result: { verdict?: 'approve' | 'changes'; commit?: string; summary?: string } | null;
  error: string | null;
  /** Tokens, when the CLI reports them. */
  usage: { input: number; output: number } | null;
  /** The log of the CLI as far as it has come; only lines up to now. */
  log: RunLogLine[];
  /** Who canceled it. */
  canceled_by: string | null;
  /** Why a waiting run waits when it is not its runner being offline: no runner of the pool has the agent's CLI. */
  waiting_reason: string | null;
  /** The runner as the reader may know it (only org admins list runners). */
  runner_name: string | null;
  runner_online: boolean;
  /** When the runner last called in; while it is offline, the time a waiting run counts from. */
  runner_last_seen_at: string | null;
}

/** The work on one item or epic: runner, branch, worktree, session, PR (`agent_threads`). */
export interface AgentThread {
  id: string;
  item_id: string;
  bot_id: string;
  runner_id: string;
  branch: string;
  status: 'open' | 'paused' | 'merged' | 'closed';
  corrections: number;
  conflicts: number;
  pr_number: number | null;
  /** Why a strand paused, when it was not a person or the brake: GitHub was disconnected. */
  pause_reason?: 'github';
}

export interface PullRequestCheck {
  name: string;
  status: 'queued' | 'in_progress' | 'completed';
  /** GitHub's conclusions; `neutral` and `skipped` do not hold a PR back, all other ends than `success` are red. */
  conclusion: 'success' | 'failure' | 'cancelled' | 'skipped' | 'neutral' | 'timed_out' | 'action_required' | 'stale' | null;
}

/** A PR at an item (`work_item_links`, spec 12). */
export interface PullRequestLink {
  id: string;
  item_id: string;
  repo: string;
  number: number;
  title: string;
  url: string;
  state: 'open' | 'merged' | 'closed';
  draft: boolean;
  head_branch: string;
  base_branch: string;
  head_sha: string;
  /** `Fixes KEY` in the PR: closes the item on merge; otherwise only linked. */
  closes: boolean;
  /** Who opened it: an agent (bot id) or a person (GitHub login). */
  author: { kind: 'agent'; bot_id: string } | { kind: 'person'; login: string };
  review: 'approve' | 'changes' | null;
  checks: PullRequestCheck[];
  updated_at: string;
}

/** What the item detail shows about agents: the open thread, the runs, the PRs, and why no agent works here. */
export interface ItemAgentState {
  thread: AgentThread | null;
  runs: AgentRun[];
  pull_requests: PullRequestLink[];
  /** The assignee is a bot that does not work as an agent here: why (null otherwise). */
  not_an_agent: string | null;
}
