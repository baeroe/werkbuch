/*
 * Work items. Reading hooks follow the API; the mutations that change an item (update, transition, bulk edit,
 * archive, restore, watching) are optimistic: the change shows in every cached list and in the detail at once, an
 * error brings the old state back and offers "Erneut versuchen".
 */

import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import type { PageArgs } from '@/api/client';
import {
  archiveWorkItem,
  bulkUpdateWorkItems,
  changeWorkItemType,
  createWorkItem,
  deleteWorkItem,
  getWorkItem,
  getWorkItemMeta,
  listActivity,
  listWorkItems,
  restoreWorkItem,
  setSubscribed,
  transitionWorkItem,
  updateWorkItem,
  type BulkPatch,
  type ListWorkItemsArgs,
  type WorkItemPatch,
} from '@/api/workItems';
import { today } from '@/lib/clock';
import { useSession } from '@/store/session';
import type { FilterContext, PropertyValue, WorkItem } from '@/types';
import { qk, type HookOptions } from './keys';
import { useApiMutation, useItemMutation } from './mutation';
import { useOrganization } from './organization';
import { useProperties } from './properties';
import { useWorkflows } from './workflows';
import { useWorkItemTypes } from './workItemTypes';

/* ------------------------------------------------------------------------ read */

/** Items the signed-in account sees, filtered and sorted on the server; `view_id` applies a saved view. */
export function useWorkItems(args: ListWorkItemsArgs = {}, options: HookOptions = {}) {
  return useQuery({ queryKey: qk.workItems.list(args), queryFn: () => listWorkItems(args), enabled: options.enabled !== false });
}

/** One item with type, state, workflow, children, relations and attachments; takes a key (also a former one) or an id. */
export function useWorkItem(keyOrId: string | null | undefined, options: HookOptions = {}) {
  return useQuery({
    queryKey: qk.workItems.detail(keyOrId ?? ''),
    queryFn: () => getWorkItem(keyOrId!),
    enabled: !!keyOrId && options.enabled !== false,
  });
}

/** Progress of items with children and the blocked / blocking items, for cards and rows. */
export function useWorkItemMeta() {
  return useQuery({ queryKey: qk.workItems.meta(), queryFn: getWorkItemMeta });
}

/** Comments and history of an item, oldest first. */
export function useActivity(itemId: string | null | undefined, args: PageArgs = {}) {
  return useQuery({
    queryKey: qk.activity.list({ item: itemId, ...args }),
    queryFn: () => listActivity(itemId!, args),
    enabled: !!itemId,
  });
}

/**
 * What the filter engine and the grouping need (`FilterContext`): who is signed in, today in the organisation's
 * time zone, the category of a state, the properties of a type, and which items have children or are blocked. It is
 * undefined until all of that has loaded.
 */
export function useFilterContext(): FilterContext | undefined {
  const me = useSession((state) => state.userId);
  const organization = useOrganization().data;
  const workflows = useWorkflows().data?.items;
  const types = useWorkItemTypes().data?.items;
  const properties = useProperties().data?.items;
  const meta = useWorkItemMeta().data;

  return useMemo(() => {
    if (!organization || !workflows || !types || !properties || !meta) return undefined;
    const categories = new Map(workflows.flatMap((workflow) => workflow.states.map((state) => [state.id, state.category] as const)));
    const keyOf = new Map(properties.map((property) => [property.id, property.key]));
    const typeKeys = new Map(types.map((type) => [type.id, new Set(type.properties.map((entry) => keyOf.get(entry.property_id)))]));
    const blocked = new Set(meta.blocked);
    const blocking = new Set(meta.blocking);

    return {
      me,
      today: today(organization.timezone),
      time_zone: organization.timezone,
      week_start: organization.week_start,
      stateCategory: (stateId) => {
        const category = categories.get(stateId);
        if (!category) throw new Error(`Unknown state ${stateId}`);
        return category;
      },
      typeHasProperty: (typeId, key) => typeKeys.get(typeId)?.has(key) ?? false,
      hasChildren: (itemId) => itemId in meta.progress,
      isBlocked: (itemId) => blocked.has(itemId),
      isBlocking: (itemId) => blocking.has(itemId),
    } satisfies FilterContext;
  }, [me, organization, workflows, types, properties, meta]);
}

/* ---------------------------------------------------------------------- change */

const ITEM_KEYS = [qk.workItems.all, qk.activity.all] as const;

/** Property values: an empty value removes the property, as on the server. */
function mergeValues(current: Record<string, PropertyValue>, changes: Record<string, PropertyValue>): Record<string, PropertyValue> {
  const merged = { ...current };
  for (const [key, value] of Object.entries(changes)) {
    if (value === null || value === '' || (Array.isArray(value) && value.length === 0)) delete merged[key];
    else merged[key] = value;
  }
  return merged;
}

/** The item as a patch leaves it (what the server would also derive is left to the reload that follows). */
function applyPatch(item: WorkItem, patch: WorkItemPatch): WorkItem {
  const { values, description, ...fields } = patch;
  const next: WorkItem = { ...item };
  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined) (next as unknown as Record<string, unknown>)[key] = value;
  }
  if (description !== undefined) {
    next.description = description;
    next.description_version = item.description_version + 1;
  }
  if (values) next.values = mergeValues(item.values, values);
  return next;
}

export function useCreateWorkItem() {
  return useApiMutation(createWorkItem, [...ITEM_KEYS, qk.notifications.all]);
}

/**
 * Changes fields of an item; `state_id` in the patch is a move. Variables: `{ id, patch, base_description_version? }`.
 * A changed description is refused with 409 `description_conflict` (`error.current` is the stored item).
 */
export function useUpdateWorkItem() {
  return useItemMutation({
    mutationFn: ({ id, patch, base_description_version }: { id: string; patch: WorkItemPatch; base_description_version?: number }) =>
      updateWorkItem(id, patch, { base_description_version }),
    ids: ({ id }) => [id],
    apply: (item, { patch }) => applyPatch(item, patch),
    failureTitle: 'Änderung nicht gespeichert',
  });
}

/** Moves an item to a state. Variables: `{ id, to_state_id, resolution_id? }`. */
export function useTransitionWorkItem() {
  return useItemMutation({
    mutationFn: ({ id, to_state_id, resolution_id }: { id: string; to_state_id: string; resolution_id?: string | null }) =>
      transitionWorkItem(id, to_state_id, resolution_id),
    ids: ({ id }) => [id],
    apply: (item, { to_state_id, resolution_id }) => ({ ...item, state_id: to_state_id, ...(resolution_id !== undefined ? { resolution_id } : {}) }),
    failureTitle: 'Statuswechsel nicht gespeichert',
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
      if (archived !== undefined) next.archived_at = archived ? new Date().toISOString() : null;
      return next;
    },
    failureTitle: 'Mehrfachbearbeitung nicht gespeichert',
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
    failureTitle: 'Archivieren nicht gespeichert',
  });
}

export function useRestoreWorkItem() {
  return useItemMutation({
    mutationFn: restoreWorkItem,
    ids: (id: string) => [id],
    apply: (item) => ({ ...item, archived_at: null }),
    failureTitle: 'Wiederherstellen nicht gespeichert',
  });
}

/** Deletes for good; the UI calls this when the undo toast has run out. Variable: the item id. */
export function useDeleteWorkItem() {
  return useApiMutation(deleteWorkItem, [...ITEM_KEYS, qk.notifications.all]);
}

/** Watch or stop watching. Variables: `{ id, on }`. */
export function useSetSubscribed() {
  return useItemMutation({
    mutationFn: ({ id, on }: { id: string; on: boolean }) => setSubscribed(id, on),
    ids: ({ id }) => [id],
    apply: (item, { on }) => {
      const me = useSession.getState().userId;
      const others = item.subscriber_ids.filter((id) => id !== me);
      return { ...item, subscriber_ids: on ? [...others, me] : others };
    },
    failureTitle: 'Beobachten nicht geändert',
  });
}
