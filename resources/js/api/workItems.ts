/*
 * Work items (spec 4.8, REST `/api/v1/work-items`). Every function that takes an item accepts its ULID or its key
 * (`WEB-47`, any case, also with a former identifier); `id` below stands for either. The names and signatures are the
 * clickdummy's, with these deviations: no `getWorkItemMeta` (progress, blocked and blocking come with every item, P7);
 * lists read through `POST /work-items/query` and may be lean (`lean`, P17); the server counts the groups and named
 * filters (`groupWorkItems`, `countWorkItems`, P18). The browser never filters (P1).
 */

import type {
  ActivityEntry,
  Attachment,
  BulkResult,
  Filter,
  GroupBy,
  ItemEvent,
  ItemGroups,
  ListedItem,
  Priority,
  PropertyValue,
  RelationEntry,
  RichText,
  SortSpec,
  StateUsage,
  WorkItem,
  WorkItemDetail,
  WorkItemType,
  Workflow,
} from '@/types';
import type { Page, PageArgs } from './client';
import { del, get, getPage, one, patch as sendPatch, post, postPage, put, readPost } from './http';

/** The path of an item; a key from an address may hold anything, so it is escaped. */
const itemPath = (id: string) => `/work-items/${encodeURIComponent(id)}`;

/* ------------------------------------------------------------------------ read */

export interface ListWorkItemsArgs extends PageArgs {
  /** A saved view: its filter, sort and `show_sub_items` apply; `filter` narrows it, `sort` replaces its sort. */
  view_id?: string;
  /** Conditions in the long form (`{version: 1, conditions}`); left out when it has none. */
  filter?: Filter;
  sort?: SortSpec;
  /** `false` leaves out the items with a parent; by default that of the view, else `true`. */
  show_sub_items?: boolean;
  /** With `group`: only the items of one group (a key `groupWorkItems` answered). */
  group_by?: GroupBy;
  group?: string;
  /** The items of one project: its ULID, identifier or a former identifier (the short form). */
  project_id?: string;
  /** The children of one item: its ULID or key (the short form). */
  parent_id?: string;
  /** Also archived items and the items of archived projects. */
  include_archived?: boolean;
  /** Items without the description and the Markdown of rich text values (`ListedItem`), for rows and cards. */
  lean?: boolean;
}

/** What a body sends: what is there (`null`, the cursor of the first page, is the same as left out on the server). */
const given = (entries: Record<string, unknown>) => Object.fromEntries(Object.entries(entries).filter(([, value]) => value !== undefined && value !== null));

/** The body of a query: the short form under `shorthand`, the rest under its own names; nothing left out is sent. */
function queryBody({ project_id, parent_id, filter, ...rest }: ListWorkItemsArgs): Record<string, unknown> {
  const shorthand = given({ project: project_id, parent: parent_id });
  const body = given(rest);
  if (filter && filter.conditions.length > 0) body.filter = filter;
  if (Object.keys(shorthand).length > 0) body.shorthand = shorthand;
  return body;
}

/**
 * The items the signed-in account sees, filtered and sorted on the server (by default in manual order, rank), one page
 * at a time. `total` counts every match.
 */
export function listWorkItems(args: ListWorkItemsArgs = {}): Promise<Page<ListedItem>> {
  return postPage<ListedItem>('/work-items/query', queryBody(args));
}

/**
 * What the groups of a list are asked for: the list's arguments without page, group and `lean`. The groups take no
 * short form (K8): a project or a parent is a condition of `filter`; the search `q` goes as it is.
 */
export type GroupWorkItemsArgs = Omit<ListWorkItemsArgs, 'group' | 'cursor' | 'per_page' | 'lean' | 'project_id' | 'parent_id'> & {
  group_by: GroupBy;
  /** The key of an item names exactly that item; any other text is a part of the title. */
  q?: string;
};

/** The groups of a list in their order with their counts, and the grouping the server applied (P14). */
export function groupWorkItems(args: GroupWorkItemsArgs): Promise<ItemGroups> {
  const { q, ...rest } = args;
  return one(readPost<{ data: ItemGroups }>('/work-items/groups', { ...queryBody(rest), ...(q === undefined ? {} : { q }) }));
}

/** How many items each named filter matches, in the projects the account sees (at most 50 filters). */
export function countWorkItems(filters: Record<string, Filter>, options: { include_archived?: boolean } = {}): Promise<Record<string, number>> {
  return one(readPost<{ data: Record<string, number> }>('/work-items/counts', { filters, ...options }));
}

/** The answer of `GET /work-items/{id}` with everything `include` embeds. */
interface IncludedItem extends WorkItem {
  attachments: Attachment[];
  children: WorkItem[];
  relations: RelationEntry[];
  type: WorkItemType;
  workflow: Workflow;
}

/** One item with everything the detail view shows besides the activity, in one call; a former key answers the item. */
export async function getWorkItem(keyOrId: string): Promise<WorkItemDetail> {
  const { attachments, children, relations, type, workflow, ...item } = await one(
    get<{ data: IncludedItem }>(itemPath(keyOrId), { include: 'children,relations,type,workflow,attachments' }),
  );

  return {
    item,
    type,
    // the item's state lies in the workflow of its project: the server moves items along when the workflow changes
    state: workflow.states.find((state) => state.id === item.state_id)!,
    workflow,
    children,
    relations,
    attachments,
    subscribed: item.subscribed,
  };
}

/**
 * The history of an item, oldest first. Relation events name the other item only when the reader may see it
 * (`RelationChange`). The comments are a list of their own (`listComments`); `useActivity` mixes both (A247).
 */
export async function listActivity(itemRef: string, args: PageArgs = {}): Promise<Page<ActivityEntry>> {
  const page = await getPage<ItemEvent>(`${itemPath(itemRef)}/history`, { ...args });

  return { ...page, items: page.items.map((event): ActivityEntry => ({ kind: 'event', id: event.id, at: event.occurred_at, event })) };
}

/** How many items stand in each state of a project or of the projects of a workflow; states without items are left out. */
export function listStateUsage(args: { project?: string; workflow?: string }): Promise<StateUsage[]> {
  return one(get<{ data: StateUsage[] }>('/state-usage', { ...args }));
}

/* ---------------------------------------------------------------------- write */

export interface CreateWorkItemInput {
  project_id: string;
  type_id: string;
  title: string;
  description?: RichText | null;
  /** Another state than the start state is only allowed when the workflow allows the move from the start state. */
  state_id?: string;
  assignee_id?: string | null;
  priority?: Priority;
  label_ids?: string[];
  start_date?: string | null;
  due_date?: string | null;
  parent_id?: string | null;
  values?: Record<string, PropertyValue>;
  /** The template of the project the item is made from: the texts get copies of its pictures, the item names it. */
  template_id?: string;
}

export interface WorkItemPatch {
  title?: string;
  description?: RichText | null;
  /** A move to another state; checked against the workflow like `transitionWorkItem`. */
  state_id?: string;
  resolution_id?: string | null;
  assignee_id?: string | null;
  priority?: Priority;
  label_ids?: string[];
  start_date?: string | null;
  due_date?: string | null;
  parent_id?: string | null;
  /** Only the properties named here change; an empty value removes one. */
  values?: Record<string, PropertyValue>;
  /** The manual order (a fractional-indexing key). */
  rank?: string;
}

/** The description goes as a Tiptap document (`description_json`); `description` on the server is Markdown. */
function withDescriptionJson<T extends { description?: RichText | null }>(input: T): Omit<T, 'description'> & { description_json?: RichText | null } {
  const { description, ...rest } = input;

  return description === undefined ? rest : { ...rest, description_json: description };
}

export function createWorkItem(input: CreateWorkItemInput): Promise<WorkItem> {
  return one(post<{ data: WorkItem }>('/work-items', withDescriptionJson(input)));
}

/**
 * Changes fields of an item. `base_description_version` is the version of the description the client edited: when
 * the description has moved on in the meantime the call fails with 409 `description_conflict` and the stored item
 * (`error.current`). A `state_id` in the patch is a move like `transitionWorkItem`.
 */
export function updateWorkItem(id: string, patch: WorkItemPatch, options: { base_description_version?: number } = {}): Promise<WorkItem> {
  return one(sendPatch<{ data: WorkItem }>(itemPath(id), { ...withDescriptionJson(patch), ...options }));
}

/** Moves an item to a state (409 `transition_not_allowed` when the workflow forbids it) and sets the resolution. */
export function transitionWorkItem(id: string, to_state_id: string, resolution_id?: string | null): Promise<WorkItem> {
  return one(post<{ data: WorkItem }>(`${itemPath(id)}/transition`, { to_state_id, resolution_id: resolution_id ?? null }));
}

/** What a bulk edit can change; rich text never (the server refuses `values` and `description` in a bulk patch). */
export type BulkPatch = Pick<WorkItemPatch, 'state_id' | 'resolution_id' | 'assignee_id' | 'priority' | 'label_ids' | 'start_date' | 'due_date'> & {
  add_label_ids?: string[];
  remove_label_ids?: string[];
  /** `true` archives (closed items only), `false` restores. */
  archived?: boolean;
};

/**
 * Applies one change to many items (1 to 100). Each item follows its own rules: what they allow is changed, what they
 * refuse is reported with the reason (e.g. `transition_not_allowed`, `not_closed`). The answer has no `data`.
 */
export function bulkUpdateWorkItems(ids: string[], patch: BulkPatch): Promise<BulkResult> {
  return post<BulkResult>('/work-items/bulk', { ids, patch });
}

/**
 * Gives the item another type. Values of properties the new type lacks are dropped, the required properties of the
 * new type must be filled (422 `values.<key>`), and the two levels hold (422 `type_id`).
 */
export function changeWorkItemType(id: string, type_id: string, values: Record<string, PropertyValue> = {}): Promise<WorkItem> {
  return one(put<{ data: WorkItem }>(`${itemPath(id)}/type`, { type_id, values }));
}

/** Archives a closed item (409 `not_closed` otherwise). */
export function archiveWorkItem(id: string): Promise<WorkItem> {
  return one(post<{ data: WorkItem }>(`${itemPath(id)}/archive`));
}

/** Restores an archived item (409 `not_archived` otherwise). */
export function restoreWorkItem(id: string): Promise<WorkItem> {
  return one(post<{ data: WorkItem }>(`${itemPath(id)}/restore`));
}

/** Deletes an item for good (project admins only); its children lose their parent. The UI calls it after the undo toast. */
export function deleteWorkItem(id: string): Promise<void> {
  return del<void>(itemPath(id));
}

/**
 * Gives the items of a project short ranks in their order (archived ones included, A448): the board calls it where the
 * rank between two neighbours would grow past what the server takes. Answers how many ranks changed.
 */
export function redistributeRanks(projectId: string): Promise<{ redistributed: number }> {
  return post<{ redistributed: number }>(`/projects/${encodeURIComponent(projectId)}/redistribute-ranks`);
}

/** Watch an item or stop watching it; the answer is the item with `subscribed` for the signed-in account. */
export function setSubscribed(id: string, on: boolean): Promise<WorkItem> {
  const path = `${itemPath(id)}/subscription`;

  return one(on ? put<{ data: WorkItem }>(path) : del<{ data: WorkItem }>(path));
}
