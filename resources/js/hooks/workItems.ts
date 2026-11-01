/*
 * Work items. Reading hooks follow the API: one page (`useWorkItems`), the pages of a long list one after the other
 * (`useInfiniteWorkItems`) or of each group of it (`useGroupedWorkItems`), the groups with their counts
 * (`useWorkItemGroups`) and the counts of named filters (`useWorkItemCounts`); the server filters, sorts, groups and
 * counts (P1). The mutations that change an item (update, transition, bulk edit,
 * archive, restore, watching) are optimistic (`useItemMutation`): the change shows in every cached list and in the
 * detail at once, an error brings the old state back and says why. Creating, deleting and the type change wait for the
 * server: only it knows the key, the children that lose their parent, and the values of the new type.
 */

import { hashKey, useQueries, useQuery, useQueryClient, type QueryClient, type UseQueryResult } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Page } from '@/api/client';
import {
  archiveWorkItem,
  bulkUpdateWorkItems,
  changeWorkItemType,
  countWorkItems,
  createWorkItem,
  deleteWorkItem,
  getWorkItem,
  groupWorkItems,
  listActivity,
  listStateUsage,
  listWorkItems,
  restoreWorkItem,
  setSubscribed,
  transitionWorkItem,
  updateWorkItem,
  type BulkPatch,
  type GroupWorkItemsArgs,
  type ListWorkItemsArgs,
  type WorkItemPatch,
} from '@/api/workItems';
import type { Filter, ListedItem, PropertyValue, WorkItem } from '@/types';
import { qk, type HookOptions } from './keys';
import { allPages } from './pages';
import { useApiMutation, useItemMutation } from './mutation';

/* ------------------------------------------------------------------------ read */

/** One page of the items the signed-in account sees, filtered and sorted on the server; `view_id` applies a view. */
export function useWorkItems(args: ListWorkItemsArgs = {}, options: HookOptions = {}) {
  return useQuery({ queryKey: qk.workItems.list(args), queryFn: () => listWorkItems(args), enabled: options.enabled !== false });
}

/** The cache key of one page of a list: the first page is the one `useWorkItems(args)` reads. */
const pageKey = (args: ListWorkItemsArgs, cursor: string | null) => qk.workItems.list(cursor === null ? args : { ...args, cursor });

const pageOf = (args: ListWorkItemsArgs, cursor: string | null) => listWorkItems(cursor === null ? args : { ...args, cursor });

export interface InfiniteWorkItems {
  /** One page of everything loaded so far: the items of all pages, `total` of all matches, the cursor of the next. */
  data: Page<ListedItem> | undefined;
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
  loadAll: () => Promise<ListedItem[]>;
}

/** How many pages each list has loaded in this visit: a list shown again (Back) starts with all of them. */
const loadedPages = new Map<string, number>();

/** The cursors of the first `depth` pages of a list, as far as the cache knows them. */
function cachedCursors(queryClient: QueryClient, args: ListWorkItemsArgs, depth: number): (string | null)[] {
  const cursors: (string | null)[] = [null];
  while (cursors.length < depth) {
    const next = queryClient.getQueryData<Page<ListedItem>>(pageKey(args, cursors.at(-1)!))?.next_cursor;
    if (!next) break;
    cursors.push(next);
  }
  return cursors;
}

/** The items of a list's pages as one `Page`, and how the pages stand. */
function combinePages(results: UseQueryResult<Page<ListedItem>>[]) {
  const [first] = results as [UseQueryResult<Page<ListedItem>>];
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

type Combined = ReturnType<typeof combinePages>;

/** One list of pages: an id of the caller, the arguments of every page, and whether it may load. */
interface PagedList {
  id: string;
  args: ListWorkItemsArgs;
  enabled: boolean;
}

/**
 * Many lists of pages at once (one per group), each in the shape of `useInfiniteWorkItems`. The cursors of the pages to
 * show are kept per list: the first page has none, each further one the cursor its predecessor answered; a list shown
 * again starts with the pages it had (from the cache), so Back finds the place it left.
 *
 * Every page is a list of its own in the cache, in the `Page` shape, so the optimistic item mutations (`patchCached`)
 * and the item commands reach it like any other list. A keyset cursor names the item a page ends with: after a change
 * a page asked for again with its old cursor may miss the item that moved across the border. So a list whose first page
 * was invalidated (while it is shown, or while it was away and now comes back) is rebuilt (K15): the first page loads
 * afresh, then the pages after it follow the `next_cursor` of the new pages up to the depth the list had (or until no
 * page is left), and only then the list switches to the new chain. Meanwhile it keeps showing the pages it had, so
 * position, focus and selection below the first page stay; the old pages are not asked for again with their old
 * cursors and leave the cache afterwards. A disabled list loads nothing and shows what the cache has.
 */
function usePagedLists(lists: readonly PagedList[], all: boolean): Record<string, InfiniteWorkItems> {
  const queryClient = useQueryClient();
  const keyed = lists.map((list) => ({ ...list, argsKey: JSON.stringify(list.args) }));
  const [state, setState] = useState<Record<string, (string | null)[]>>({});
  // the lists being rebuilt after an invalidation, with the depth they had; the ref answers at once (`queryFn`)
  const [rebuild, setRebuild] = useState<Record<string, number>>({});
  const rebuildingNow = useRef(new Set<string>());
  // who waits for the rebuild of a list to end (`loadAll`, ⌘A)
  const waiting = useRef(new Map<string, ((chain: (string | null)[]) => void)[]>());
  let cursorsOf = state;
  let rebuilding = rebuild;
  const missing = keyed.filter((list) => !(list.argsKey in state));
  if (missing.length > 0) {
    // a new list starts with the pages it had in this visit; lists that are gone are forgotten
    cursorsOf = Object.fromEntries(
      keyed.map((list) => [list.argsKey, state[list.argsKey] ?? cachedCursors(queryClient, list.args, loadedPages.get(list.argsKey) ?? 1)]),
    );
    // a list that comes back after a change made its first page stale is rebuilt, not loaded with its old cursors
    const stale = missing.filter((list) => cursorsOf[list.argsKey]!.length > 1 && queryClient.getQueryState(pageKey(list.args, null))?.isInvalidated);
    if (stale.length > 0) {
      rebuilding = { ...rebuild, ...Object.fromEntries(stale.map((list) => [list.argsKey, cursorsOf[list.argsKey]!.length])) };
      stale.forEach((list) => rebuildingNow.current.add(list.argsKey));
      setRebuild(rebuilding);
    }
    setState(cursorsOf);
  }
  const layout = keyed.map((list) => ({ ...list, cursors: cursorsOf[list.argsKey]!, rebuilding: list.argsKey in rebuilding }));
  const layoutKey = JSON.stringify(layout.map((list) => [list.id, list.cursors.length]));

  useEffect(() => {
    for (const list of layout) loadedPages.set(list.argsKey, list.cursors.length);
  });

  const combine = useCallback(
    (results: UseQueryResult<Page<ListedItem>>[]): Record<string, Combined> => {
      const combined: Record<string, Combined> = {};
      let at = 0;
      for (const [id, count] of JSON.parse(layoutKey) as [string, number][]) {
        combined[id] = combinePages(results.slice(at, at + count));
        at += count;
      }
      return combined;
    },
    [layoutKey],
  );

  const combined = useQueries({
    queries: layout.flatMap((list) =>
      list.cursors.map((cursor, index) => ({
        queryKey: pageKey(list.args, cursor),
        // the invalidation asks the old pages of a list being rebuilt again: they keep what they had, no old cursor is sent
        queryFn: () => {
          const had = queryClient.getQueryData<Page<ListedItem>>(pageKey(list.args, cursor));
          return index > 0 && had && rebuildingNow.current.has(list.argsKey) ? Promise.resolve(had) : pageOf(list.args, cursor);
        },
        // while a list is rebuilt, its old pages only show what they had
        enabled: list.enabled && !(list.rebuilding && index > 0),
      })),
    ),
    combine,
  });

  // an invalidated first page starts the rebuild of its list
  const layoutRef = useRef(layout);
  layoutRef.current = layout;
  useEffect(
    () =>
      queryClient.getQueryCache().subscribe((event) => {
        if (event.type !== 'updated' || event.action.type !== 'invalidate') return;
        const list = layoutRef.current.find((entry) => entry.cursors.length > 1 && event.query.queryHash === hashKey(pageKey(entry.args, null)));
        if (!list) return;
        rebuildingNow.current.add(list.argsKey);
        setRebuild((current) => ({ ...current, [list.argsKey]: list.cursors.length }));
      }),
    [queryClient],
  );

  // once the first page has loaded afresh, the new chain follows its cursors to the old depth, then replaces the old one
  const running = useRef(new Set<string>());
  useEffect(() => {
    for (const list of layout) {
      const depth = rebuilding[list.argsKey];
      const first = queryClient.getQueryState<Page<ListedItem>>(pageKey(list.args, null));
      if (depth === undefined || running.current.has(list.argsKey) || first?.status !== 'success' || first.isInvalidated || first.fetchStatus !== 'idle') continue;
      running.current.add(list.argsKey);
      const old = list.cursors;
      const startedAt = first.dataUpdatedAt;
      void (async () => {
        const chain: (string | null)[] = [null];
        let next = first.data!.next_cursor;
        try {
          while (next !== null && chain.length < depth) {
            const cursor = next;
            chain.push(cursor);
            next = (await queryClient.fetchQuery({ queryKey: pageKey(list.args, cursor), queryFn: () => pageOf(list.args, cursor) })).next_cursor;
          }
        } catch {
          // the page that failed stays the last one: it offers "Erneut versuchen"
        }
        running.current.delete(list.argsKey);
        setState((current) => ({ ...current, [list.argsKey]: chain }));
        for (const cursor of old.slice(1)) {
          if (!chain.includes(cursor)) queryClient.removeQueries({ queryKey: pageKey(list.args, cursor), exact: true });
        }
        // a change meanwhile gave the first page another answer (or made it stale): the next round rebuilds anew
        const now = queryClient.getQueryState(pageKey(list.args, null));
        if (now?.isInvalidated || now?.dataUpdatedAt !== startedAt) return;
        rebuildingNow.current.delete(list.argsKey);
        setRebuild(({ [list.argsKey]: _done, ...rest }) => rest);
        waiting.current.get(list.argsKey)?.forEach((resolve) => resolve(chain));
        waiting.current.delete(list.argsKey);
      })();
    }
  });

  const appendCursor = useCallback(
    (argsKey: string, next: string) =>
      setState((current) => {
        const cursors = current[argsKey];
        return !cursors || cursors.includes(next) ? current : { ...current, [argsKey]: [...cursors, next] };
      }),
    [],
  );

  const results = useMemo(() => {
    const answer: Record<string, InfiniteWorkItems> = {};
    for (const list of layout) {
      const { nextCursor, ...pages } = combined[list.id]!;
      const loadMore = () => {
        // a page that failed is asked for again; otherwise the next one
        const failed = list.cursors.slice(1).filter((cursor) => queryClient.getQueryState(pageKey(list.args, cursor))?.status === 'error');
        if (failed.length > 0) {
          failed.forEach((cursor) => void queryClient.refetchQueries({ queryKey: pageKey(list.args, cursor), exact: true }));
          return;
        }
        if (nextCursor) appendCursor(list.argsKey, nextCursor);
      };
      const loadAll = async (): Promise<ListedItem[]> => {
        const fetchPage = (cursor: string | null) => queryClient.fetchQuery({ queryKey: pageKey(list.args, cursor), queryFn: () => pageOf(list.args, cursor) });
        let cursors = [...list.cursors];
        for (;;) {
          // a rebuild (K15) replaces the old cursors, which may miss an item: wait for the new chain and load on from
          // there (the first page first, so one that failed is asked again instead of waited for)
          while (rebuildingNow.current.has(list.argsKey)) {
            await fetchPage(null);
            cursors = await new Promise<(string | null)[]>((resolve) => waiting.current.set(list.argsKey, [...(waiting.current.get(list.argsKey) ?? []), resolve]));
          }
          // the first page as it stands now (a stale one loads afresh): the chain starts there
          await fetchPage(null);
          const firstAt = queryClient.getQueryState(pageKey(list.args, null))?.dataUpdatedAt;
          let page = await fetchPage(cursors.at(-1)!);
          while (page.next_cursor) {
            const cursor = page.next_cursor;
            cursors.push(cursor);
            page = await fetchPage(cursor);
          }
          // a change meanwhile gave the first page another answer (or made it stale): these cursors are old, start over
          const first = queryClient.getQueryState(pageKey(list.args, null));
          if (first !== undefined && first.dataUpdatedAt === firstAt && !first.isInvalidated && !rebuildingNow.current.has(list.argsKey)) break;
          cursors = [null];
        }
        setState((current) => ({ ...current, [list.argsKey]: cursors }));
        const seen = new Set<string>();
        return cursors
          .flatMap((cursor) => queryClient.getQueryData<Page<ListedItem>>(pageKey(list.args, cursor))?.items ?? [])
          .filter((item) => !seen.has(item.id) && seen.add(item.id));
      };
      answer[list.id] = {
        ...pages,
        // a page on its way or one that failed counts as more: what offers it stays (with the focus, and "Erneut versuchen")
        hasMore: nextCursor !== null || pages.loadingMore || pages.moreError !== null,
        loadMore,
        loadAll,
      };
    }
    return answer;
    // `layout` is what `layoutKey` and the cursors spell
  }, [combined, cursorsOf, layoutKey, queryClient, appendCursor]);

  // a list that narrows on the client loads on until it has everything
  useEffect(() => {
    if (!all) return;
    for (const list of layout) {
      const { nextCursor, loadingMore, moreError } = combined[list.id]!;
      // a list being rebuilt loads on along its new chain, never from the old cursors
      if (list.enabled && !list.rebuilding && nextCursor && !loadingMore && !moreError) appendCursor(list.argsKey, nextCursor);
    }
  });

  return results;
}

/**
 * Every matching item, one page of 100 at a time (the keyset cursor of `listWorkItems`), for lists that may be longer;
 * the first page is the one `useWorkItems(args)` reads. A new `args` starts at the first page again. With `all`, the
 * pages load one after the other until none is left (a list whose count is only known in full).
 */
export function useInfiniteWorkItems(args: ListWorkItemsArgs = {}, options: HookOptions & { all?: boolean } = {}): InfiniteWorkItems {
  return usePagedLists([{ id: 'list', args, enabled: options.enabled !== false }], options.all === true)['list']!;
}

/** The key of the one group of an ungrouped list. */
export const ALL_GROUP = 'all';

/**
 * The pages of each group of a list (`group_by` with `group` = the key), one page sequence per key: `keys` are the keys
 * `useWorkItemGroups` answered (null while they are unknown: nothing loads), `enabled` the groups that may load (a
 * collapsed or scrolled-away group waits). Without grouping (`group_by` missing or `none`) the one key is `all` and the
 * pages carry no group. The pages ask for the grouping the server applied (`ItemGroups.group_by`, K17).
 */
export function useGroupedWorkItems(
  args: ListWorkItemsArgs,
  keys: readonly string[] | null,
  enabled: ReadonlySet<string> | 'all',
): Record<string, InfiniteWorkItems> {
  const grouped = args.group_by !== undefined && args.group_by !== 'none';
  const lists = (keys ?? []).map((key) => ({
    id: key,
    args: grouped ? { ...args, group: key } : args,
    enabled: enabled === 'all' || enabled.has(key),
  }));
  return usePagedLists(lists, false);
}

/** The groups of a list with their counts; waits without `args`. Under `qk.workItems`: every item change makes it stale. */
export function useWorkItemGroups(args: GroupWorkItemsArgs | null, options: HookOptions = {}) {
  return useQuery({
    queryKey: qk.workItems.groups(args),
    queryFn: () => groupWorkItems(args!),
    enabled: args !== null && options.enabled !== false,
  });
}

/** How many items each named filter matches (cards, tabs, the sidebar); waits without `filters`. */
export function useWorkItemCounts(filters: Record<string, Filter> | null, options: HookOptions & { include_archived?: boolean } = {}) {
  const { enabled, include_archived } = options;
  return useQuery({
    queryKey: qk.workItems.counts({ filters, include_archived }),
    queryFn: () => countWorkItems(filters!, include_archived === undefined ? {} : { include_archived }),
    enabled: filters !== null && enabled !== false,
  });
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
function applyPatch<T extends ListedItem>(item: T, patch: WorkItemPatch): T {
  const { values, description, ...fields } = patch;
  const next: T = { ...item };
  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined) (next as unknown as Record<string, unknown>)[key] = value;
  }
  if (description !== undefined) {
    // a lean item of a list holds no description; only its version counts on
    if ('description_json' in next) (next as unknown as WorkItem).description_json = description;
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
