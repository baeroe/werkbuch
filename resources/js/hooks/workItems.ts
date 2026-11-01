/*
 * Work items. Reading hooks follow the API; the mutations that change an item (update, transition, bulk edit,
 * archive, restore, watching) are optimistic (`useItemMutation`): the change shows in every cached list and in the
 * detail at once, an error brings the old state back and says why. Creating, deleting and the type change wait for the
 * server: only it knows the key, the children that lose their parent, and the values of the new type.
 */

import { useQuery } from '@tanstack/react-query';
import {
  archiveWorkItem,
  bulkUpdateWorkItems,
  changeWorkItemType,
  createWorkItem,
  deleteWorkItem,
  getWorkItem,
  listActivity,
  listStateUsage,
  listWorkItems,
  restoreWorkItem,
  setSubscribed,
  transitionWorkItem,
  updateWorkItem,
  type BulkPatch,
  type ListWorkItemsArgs,
  type WorkItemPatch,
} from '@/api/workItems';
import type { PropertyValue, WorkItem } from '@/types';
import { qk, type HookOptions } from './keys';
import { allPages } from './pages';
import { useApiMutation, useItemMutation } from './mutation';

/* ------------------------------------------------------------------------ read */

/** Items the signed-in account sees, in manual order; `project_id`, `parent_id` and `q` narrow them. */
export function useWorkItems(args: ListWorkItemsArgs = {}, options: HookOptions = {}) {
  return useQuery({ queryKey: qk.workItems.list(args), queryFn: () => listWorkItems(args), enabled: options.enabled !== false });
}

/** One item with type, state, workflow, children and relations; takes a key (also a former one) or an id. */
export function useWorkItem(keyOrId: string | null | undefined, options: HookOptions = {}) {
  return useQuery({
    queryKey: qk.workItems.detail(keyOrId ?? ''),
    queryFn: () => getWorkItem(keyOrId!),
    enabled: !!keyOrId && options.enabled !== false,
  });
}

/**
 * The whole history of an item, oldest first: every page (`next_cursor` followed to the end). The server pages from the
 * oldest entry on, so a history that stopped at the first hundred would hide the newest changes.
 */
export function useActivity(itemId: string | null | undefined) {
  return useQuery({
    queryKey: qk.activity.list({ item: itemId, pages: 'all' }),
    queryFn: () => allPages((cursor) => listActivity(itemId!, { cursor })),
    enabled: !!itemId,
  });
}

/** How many items stand in each state of a project (`project`) or of the projects of a workflow (`workflow`). */
export function useStateUsage(args: { project?: string; workflow?: string }, options: HookOptions = {}) {
  return useQuery({ queryKey: qk.stateUsage.list(args), queryFn: () => listStateUsage(args), enabled: options.enabled !== false });
}

/* ---------------------------------------------------------------------- change */

/** What creating, deleting or retyping an item makes stale. */
const ITEM_KEYS = [qk.workItems.all, qk.activity.all, qk.stateUsage.all] as const;

/** Property values: an empty value removes the property, as on the server. */
function mergeValues(current: Record<string, PropertyValue>, changes: Record<string, PropertyValue>): Record<string, PropertyValue> {
  const merged = { ...current };
  for (const [key, value] of Object.entries(changes)) {
    if (value === null || value === '' || (Array.isArray(value) && value.length === 0)) delete merged[key];
    else merged[key] = value;
  }
  return merged;
}

/**
 * The item as a patch leaves it. What the server derives besides (the Markdown of the description and of rich text
 * values, `closed_at`, the resolution of a move, the flags) is left to its answer and the reload that follows.
 */
function applyPatch(item: WorkItem, patch: WorkItemPatch): WorkItem {
  const { values, description, ...fields } = patch;
  const next: WorkItem = { ...item };
  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined) (next as unknown as Record<string, unknown>)[key] = value;
  }
  if (description !== undefined) {
    next.description_json = description;
    next.description_version = item.description_version + 1;
  }
  if (values) next.values = mergeValues(item.values, values);
  return next;
}

export function useCreateWorkItem() {
  return useApiMutation(createWorkItem, ITEM_KEYS);
}

/**
 * Changes fields of an item; `state_id` in the patch is a move. Variables: `{ id, patch, base_description_version? }`.
 * A changed description is refused with 409 `description_conflict` (`error.current` is the stored item); the caller
 * shows it, there is no toast.
 */
export function useUpdateWorkItem() {
  return useItemMutation({
    mutationFn: ({ id, patch, base_description_version }: { id: string; patch: WorkItemPatch; base_description_version?: number }) =>
      updateWorkItem(id, patch, { base_description_version }),
    ids: ({ id }) => [id],
    apply: (item, { patch }) => applyPatch(item, patch),
    failureTitle: 'items.failed.update',
  });
}

/** Moves an item to a state. Variables: `{ id, to_state_id, resolution_id? }`. */
export function useTransitionWorkItem() {
  return useItemMutation({
    mutationFn: ({ id, to_state_id, resolution_id }: { id: string; to_state_id: string; resolution_id?: string | null }) =>
      transitionWorkItem(id, to_state_id, resolution_id),
    ids: ({ id }) => [id],
    apply: (item, { to_state_id, resolution_id }) => ({ ...item, state_id: to_state_id, ...(resolution_id !== undefined ? { resolution_id } : {}) }),
    failureTitle: 'items.failed.transition',
  });
}

/** Changes many items; answers `{ updated, rejected }`. Variables: `{ ids, patch }`. */
export function useBulkUpdateWorkItems() {
  return useItemMutation({
    mutationFn: ({ ids, patch }: { ids: string[]; patch: BulkPatch }) => bulkUpdateWorkItems(ids, patch),
    ids: ({ ids }) => ids,
    apply: (item, { patch }) => {
      const { archived, add_label_ids, remove_label_ids, ...fields } = patch;
      const next = applyPatch(item, fields);
      if (add_label_ids || remove_label_ids) {
        next.label_ids = [...(fields.label_ids ?? item.label_ids), ...(add_label_ids ?? [])].filter((id) => !(remove_label_ids ?? []).includes(id));
      }
      // the server's answer replaces the stamp: the app has no clock of its own
      if (archived !== undefined) next.archived_at = archived ? new Date().toISOString() : null;
      return next;
    },
    failureTitle: 'items.failed.bulk',
  });
}

/** Not optimistic: the values of the new type are only known on the server. Variables: `{ id, type_id, values? }`. */
export function useChangeWorkItemType() {
  return useApiMutation(
    ({ id, type_id, values }: { id: string; type_id: string; values?: Record<string, PropertyValue> }) => changeWorkItemType(id, type_id, values),
    ITEM_KEYS,
  );
}

/** Archives a closed item (409 `not_closed` otherwise). Variable: the item id. */
export function useArchiveWorkItem() {
  return useItemMutation({
    mutationFn: archiveWorkItem,
    ids: (id: string) => [id],
    apply: (item) => ({ ...item, archived_at: new Date().toISOString() }),
    failureTitle: 'items.failed.archive',
  });
}

/** Restores an archived item (409 `not_archived` otherwise). Variable: the item id. */
export function useRestoreWorkItem() {
  return useItemMutation({
    mutationFn: restoreWorkItem,
    ids: (id: string) => [id],
    apply: (item) => ({ ...item, archived_at: null }),
    failureTitle: 'items.failed.restore',
  });
}

/** Deletes for good; the UI calls this when the undo toast has run out. Variable: the item id. */
export function useDeleteWorkItem() {
  return useApiMutation(deleteWorkItem, ITEM_KEYS);
}

/** Watch or stop watching. Variables: `{ id, on }`. */
export function useSetSubscribed() {
  return useItemMutation({
    mutationFn: ({ id, on }: { id: string; on: boolean }) => setSubscribed(id, on),
    ids: ({ id }) => [id],
    apply: (item, { on }) => ({ ...item, subscribed: on }),
    failureTitle: 'items.failed.subscribe',
  });
}
