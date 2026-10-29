/*
 * Work items. Reading hooks follow the API; the mutations that change an item (update, transition, bulk edit,
 * archive, restore, watching) are optimistic: the change shows in every cached list and in the detail at once, an
 * error brings the old state back and offers "Erneut versuchen".
 */

import { useQueries, useQuery, useQueryClient, type QueryClient, type UseQueryResult } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Page, PageArgs } from '@/api/client';
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
import { now, today } from '@/lib/clock';
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

/** The cache key of one page of a list: the first page is the one `useWorkItems(args)` reads. */
const pageKey = (args: ListWorkItemsArgs, cursor: string | null) => qk.workItems.list(cursor === null ? args : { ...args, cursor });

export interface InfiniteWorkItems {
  /** One page of everything loaded so far: the items of all pages, `total` of all matches, the cursor of the next. */
  data: Page<WorkItem> | undefined;
  /** The first page failed (a later one that fails shows as `moreError`). */
  isError: boolean;
  error: Error | null;
  isFetching: boolean;
  refetch: () => Promise<unknown>;
  /** More pages are there to load. */
  hasMore: boolean;
  /** A further page is on its way. */
  loadingMore: boolean;
  moreError: Error | null;
  /** Loads the next page, or the one that failed again. */
  loadMore: () => void;
  /** Loads every page that is left and answers all items (⌘A selects them). */
  loadAll: () => Promise<WorkItem[]>;
}

/** How many pages each list has loaded in this visit: a list shown again (Back) starts with all of them. */
const loadedPages = new Map<string, number>();

/** The cursors of the first `depth` pages of a list, as far as the cache knows them. */
function cachedCursors(queryClient: QueryClient, args: ListWorkItemsArgs, depth: number): (string | null)[] {
  const cursors: (string | null)[] = [null];
  while (cursors.length < depth) {
    const next = queryClient.getQueryData<Page<WorkItem>>(pageKey(args, cursors.at(-1)!))?.next_cursor;
    if (!next) break;
    cursors.push(next);
  }
  return cursors;
}

/** The items of the pages so far as one `Page`, and how the pages stand; a module function, so its result stays stable. */
function combinePages(results: UseQueryResult<Page<WorkItem>>[]) {
  const [first] = results;
  const last = results.at(-1)!;
  const seen = new Set<string>();
  // a page that moved (an item went away meanwhile) may repeat an item of the page before
  const items = results.flatMap((result) => result.data?.items ?? []).filter((item) => !seen.has(item.id) && seen.add(item.id));
  return {
    data: first.data ? { items, total: first.data.total, next_cursor: last.data?.next_cursor ?? null } : undefined,
    isError: first.isError,
    error: first.error,
    refetch: first.refetch,
    isFetching: results.some((result) => result.isFetching),
    // also while a page that failed is asked for again
    loadingMore: results.slice(1).some((result) => result.data === undefined && (result.isFetching || !result.isError)),
    moreError: results.slice(1).find((result) => result.isError)?.error ?? null,
    nextCursor: last.data?.next_cursor ?? null,
  };
}

/**
 * Every matching item, one page of 100 at a time (the cursor of `listWorkItems`), for lists that may be longer. Each
 * page is a list of its own in the cache, in the `Page` shape, so the optimistic item mutations (`patchCached`) and the
 * item commands reach it like any other list; the first page is the one `useWorkItems(args)` reads. A new `args` starts
 * at the first page again. With `all`, the pages load one after the other until none is left (a list that narrows on
 * the client, so its count is only known in full).
 */
export function useInfiniteWorkItems(args: ListWorkItemsArgs = {}, options: HookOptions & { all?: boolean } = {}): InfiniteWorkItems {
  const queryClient = useQueryClient();
  const enabled = options.enabled !== false;
  const argsKey = JSON.stringify(args);
  // the cursors of the pages to show: the first page has none, each further one the cursor its predecessor answered;
  // a list shown again starts with the pages it had (from the cache), so Back finds the place it left
  const [state, setState] = useState(() => ({ argsKey, cursors: cachedCursors(queryClient, args, loadedPages.get(argsKey) ?? 1) }));
  let cursors = state.cursors;
  if (state.argsKey !== argsKey) {
    cursors = cachedCursors(queryClient, args, loadedPages.get(argsKey) ?? 1);
    setState({ argsKey, cursors });
  }
  useEffect(() => {
    loadedPages.set(argsKey, cursors.length);
  }, [argsKey, cursors.length]);

  const { data, isError, error, refetch, isFetching, loadingMore, moreError, nextCursor } = useQueries({
    queries: cursors.map((cursor) => ({
      queryKey: pageKey(args, cursor),
      queryFn: () => listWorkItems(cursor === null ? args : { ...args, cursor }),
      enabled,
    })),
    combine: combinePages,
  });

  const loadMore = useCallback(() => {
    // a page that failed is asked for again; otherwise the next one
    const failed = cursors.slice(1).filter((cursor) => queryClient.getQueryState(pageKey(args, cursor))?.status === 'error');
    if (failed.length > 0) {
      failed.forEach((cursor) => void queryClient.refetchQueries({ queryKey: pageKey(args, cursor), exact: true }));
      return;
    }
    if (!nextCursor) return;
    setState({ argsKey, cursors: [...cursors, nextCursor] });
    // `args` is what `argsKey` spells
  }, [argsKey, cursors, nextCursor, queryClient]);

  const loadAll = useCallback(async (): Promise<WorkItem[]> => {
    const all = [...cursors];
    let page = await queryClient.fetchQuery({ queryKey: pageKey(args, all.at(-1)!), queryFn: () => listWorkItems(all.at(-1) === null ? args : { ...args, cursor: all.at(-1) }) });
    while (page.next_cursor) {
      const cursor = page.next_cursor;
      all.push(cursor);
      page = await queryClient.fetchQuery({ queryKey: pageKey(args, cursor), queryFn: () => listWorkItems({ ...args, cursor }) });
    }
    setState({ argsKey, cursors: all });
    const seen = new Set<string>();
    return all
      .flatMap((cursor) => queryClient.getQueryData<Page<WorkItem>>(pageKey(args, cursor))?.items ?? [])
      .filter((item) => !seen.has(item.id) && seen.add(item.id));
    // `args` is what `argsKey` spells: a new object of the same args changes nothing
  }, [argsKey, cursors, queryClient]);

  // a list that narrows on the client loads on until it has everything
  useEffect(() => {
    if (options.all && nextCursor && !loadingMore && !moreError) loadMore();
  }, [options.all, nextCursor, loadingMore, moreError, loadMore]);

  return {
    data,
    isError,
    error,
    isFetching,
    refetch,
    // a page on its way or one that failed counts as more: what offers it stays (with the focus, and "Erneut versuchen")
    hasMore: nextCursor !== null || loadingMore || moreError !== null,
    loadingMore,
    moreError,
    loadMore,
    loadAll,
  };
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

/** What a change of items makes stale; the search too, so the palette finds a new item and forgets a deleted one. */
const ITEM_KEYS = [qk.workItems.all, qk.activity.all, qk.search.all] as const;

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
      if (archived !== undefined) next.archived_at = archived ? now().toISOString() : null;
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
    apply: (item) => ({ ...item, archived_at: now().toISOString() }),
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
