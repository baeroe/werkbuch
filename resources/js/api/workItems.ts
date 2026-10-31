/*
 * Work items (spec 4.8, REST `/api/v1/work-items`). Every function that takes an item accepts its ULID or its key
 * (`WEB-47`, any case, also with a former identifier); `id` below stands for either. The names and signatures are the
 * clickdummy's, with two deviations: no `getWorkItemMeta` (progress, blocked and blocking come with every item, P7) and
 * a narrow `ListWorkItemsArgs` until views come (Phase 5, P8).
 */

import type {
  ActivityEntry,
  BulkResult,
  ItemEvent,
  Priority,
  PropertyValue,
  RelationEntry,
  RichText,
  StateUsage,
  WorkItem,
  WorkItemDetail,
  WorkItemType,
  Workflow,
} from '@/types';
import type { Page, PageArgs } from './client';
import { del, get, getPage, one, patch as sendPatch, post, put } from './http';

/** The path of an item; a key from an address may hold anything, so it is escaped. */
const itemPath = (id: string) => `/work-items/${encodeURIComponent(id)}`;

/* ------------------------------------------------------------------------ read */

export interface ListWorkItemsArgs extends PageArgs {
  /** The items of one project: its ULID, identifier or a former identifier. */
  project_id?: string;
  /** The children of one item: its ULID or key. */
  parent_id?: string;
  /** The key of an item names exactly that item; any other text is a part of the title. */
  q?: string;
  /** Also archived items and the items of archived projects. */
  include_archived?: boolean;
}

/** The items the signed-in account sees, in manual order (rank). */
export function listWorkItems(args: ListWorkItemsArgs = {}): Promise<Page<WorkItem>> {
  const { project_id, parent_id, q, ...rest } = args;

  return getPage<WorkItem>('/work-items', { ...rest, filter: { project: project_id, parent: parent_id, q } });
}

/** The answer of `GET /work-items/{id}` with everything `include` embeds. */
interface IncludedItem extends WorkItem {
  children: WorkItem[];
  relations: RelationEntry[];
  type: WorkItemType;
  workflow: Workflow;
}

/** One item with everything the detail view shows besides the activity, in one call; a former key answers the item. */
export async function getWorkItem(keyOrId: string): Promise<WorkItemDetail> {
  const { children, relations, type, workflow, ...item } = await one(get<{ data: IncludedItem }>(itemPath(keyOrId), { include: 'children,relations,type,workflow' }));

  return {
    item,
    type,
    // the item's state lies in the workflow of its project: the server moves items along when the workflow changes
    state: workflow.states.find((state) => state.id === item.state_id)!,
    workflow,
    children,
    relations,
    attachments: [],
    subscribed: item.subscribed,
  };
}

/**
 * The history of an item, oldest first. Relation events name the other item only when the reader may see it
 * (`RelationChange`); comments come with Phase 7.
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

/** Watch an item or stop watching it; the answer is the item with `subscribed` for the signed-in account. */
export function setSubscribed(id: string, on: boolean): Promise<WorkItem> {
  const path = `${itemPath(id)}/subscription`;

  return one(on ? put<{ data: WorkItem }>(path) : del<{ data: WorkItem }>(path));
}
