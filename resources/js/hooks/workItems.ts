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
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
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
  redistributeRanks,
  restoreWorkItem,
  setSubscribed,
  transitionWorkItem,
  updateWorkItem,
  type BulkPatch,
  type GroupWorkItemsArgs,
  type ListWorkItemsArgs,
  type WorkItemPatch,
} from '@/api/workItems';
import type { ActivityEntry, BulkResult, Filter, ListedItem, PropertyValue, WorkItem } from '@/types';
import { useComments } from './comments';
import { qk, type HookOptions } from './keys';
import { allPages } from './pages';
import { invalidateItems, useApiMutation, useItemMutation } from './mutation';

/* ------------------------------------------------------------------------ read */

/** One page of the items the signed-in account sees, filtered and sorted on the server; `view_id` applies a view. */
export function useWorkItems(args: ListWorkItemsArgs = {}, options: HookOptions = {}) {
  return useQuery({ queryKey: qk.workItems.list(args), queryFn: () => listWorkItems(args), enabled: options.enabled !== false });
}

/**
 * The epics the reader sees, lean and every page: of one project (the same list as `useProjectItems` of the parent
 * picker, under the same key) or of all projects. The parent options of the filter bar; loaded only while `enabled`.
 */
export function useEpics(projectId: string | undefined, enabled: boolean) {
  const filter: Filter = {
    version: 1,
    conditions: [...(projectId ? [{ field: 'project', op: 'is' as const, value: projectId }] : []), { field: 'epic', op: 'is', value: true }],
  };
  const args = { filter, lean: true };
  return useQuery({
    queryKey: qk.workItems.list({ ...args, pages: 'all' }),
    queryFn: () => allPages((cursor) => listWorkItems({ ...args, cursor })),
    enabled,
  });
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
  /**
   * Loads every page that is left and answers all items (⌘A selects them). Rejects with `ListGoneError` when the list
   * goes away while it waits for a rebuild (its arguments changed, the hook unmounted).
   */
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

/** Who waits for the rebuild of a list to end (`loadAll`). */
interface Waiter {
  resolve(chain: (string | null)[]): void;
  reject(error: Error): void;
}

/**
 * `loadAll` of a list that went away while it waited for a rebuild (its arguments changed, the screen unmounted): its
 * items are of no use any more, the caller drops them.
 */
export class ListGoneError extends Error {
  constructor() {
    super('The list changed while its items loaded.');
    this.name = 'ListGoneError';
  }
}

/**
 * The rebuild of a list after its first page was invalidated (K15). It is kept at the list (the query hash of its first
 * page, per query client), not at the component that shows it: a list that unmounts while its rebuild runs and mounts
 * again (Back, a layout switch) shows its old pages again and takes the chain the running rebuild follows, instead of
 * starting a second one whose old pages the first clears from the cache when it ends.
 */
interface Rebuild {
  /** How many pages the list had: the new chain follows the new cursors that far. */
  depth: number;
  /** The cursors of the pages the list showed before: shown as they were until the new chain stands. */
  old: (string | null)[];
  /** A round follows the new chain now. */
  running: boolean;
}

/** Told when a round of a rebuild ends: the chain it followed, and whether the rebuild is done (or starts once more). */
type RebuildListener = (chain: (string | null)[], done: boolean) => void;

const rebuildsByClient = new WeakMap<QueryClient, Map<string, Rebuild>>();
const listenersByClient = new WeakMap<QueryClient, Map<string, Set<RebuildListener>>>();

/**
 * The lists of a query client being rebuilt, by the query hash of their first page. A rebuild goes with its first page
 * (T15-M2): the cache cleared at sign-out, or the first page left the cache; the list then starts anew.
 */
function rebuildsOf(queryClient: QueryClient): Map<string, Rebuild> {
  let rebuilds = rebuildsByClient.get(queryClient);
  if (!rebuilds) {
    const created = new Map<string, Rebuild>();
    rebuildsByClient.set(queryClient, (rebuilds = created));
    queryClient.getQueryCache().subscribe((event) => {
      if (event.type === 'removed') created.delete(event.query.queryHash);
    });
  }
  return rebuilds;
}

/** Who shows each list of a query client, by the query hash of its first page. */
function listenersOf(queryClient: QueryClient): Map<string, Set<RebuildListener>> {
  let listeners = listenersByClient.get(queryClient);
  if (!listeners) listenersByClient.set(queryClient, (listeners = new Map()));
  return listeners;
}

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
 * cursors and leave the cache afterwards. The rebuild belongs to the list, not to the component (`Rebuild`): shown
 * again while it runs, the list takes it over. A disabled list loads nothing and shows what the cache has.
 */
function usePagedLists(lists: readonly PagedList[], all: boolean): Record<string, InfiniteWorkItems> {
  const queryClient = useQueryClient();
  const keyed = lists.map((list) => ({ ...list, argsKey: JSON.stringify(list.args), hash: hashKey(pageKey(list.args, null)) }));
  const [state, setState] = useState<Record<string, (string | null)[]>>({});
  // the lists being rebuilt after an invalidation (at the list, not here): a change there renders anew
  const rebuilds = rebuildsOf(queryClient);
  const [, rerender] = useReducer((count: number) => count + 1, 0);
  // who waits for the rebuild of a list to end (`loadAll`, ⌘A)
  const waiting = useRef(new Map<string, Waiter[]>());
  let cursorsOf = state;
  /** The old pages a list took over from a running rebuild when it mounted, by its arguments (T15-M1). */
  const adopted = useRef(new Map<string, (string | null)[]>());
  const missing = keyed.filter((list) => !(list.argsKey in state));
  if (missing.length > 0) {
    for (const list of missing) {
      const old = rebuilds.get(list.hash)?.old;
      if (old && !state[list.argsKey]) adopted.current.set(list.argsKey, old);
    }
    // a new list starts with the pages it had in this visit (the old ones while its rebuild runs); lists that are gone
    // are forgotten
    cursorsOf = Object.fromEntries(
      keyed.map((list) => [
        list.argsKey,
        state[list.argsKey] ?? rebuilds.get(list.hash)?.old ?? cachedCursors(queryClient, list.args, loadedPages.get(list.argsKey) ?? 1),
      ]),
    );
    // a list that comes back after a change made its first page stale is rebuilt, not loaded with its old cursors
    for (const list of missing) {
      const cursors = cursorsOf[list.argsKey]!;
      if (!rebuilds.has(list.hash) && cursors.length > 1 && queryClient.getQueryState(pageKey(list.args, null))?.isInvalidated) {
        rebuilds.set(list.hash, { depth: cursors.length, old: cursors, running: false });
      }
    }
    setState(cursorsOf);
  }
  const layout = keyed.map((list) => ({ ...list, cursors: cursorsOf[list.argsKey]!, rebuilding: rebuilds.has(list.hash) }));

  // a list that is gone (other arguments, or the hook unmounts) is rebuilt no more: ⌘A waiting for it gives up
  const giveUp = useCallback((keep: ReadonlySet<string>) => {
    for (const [argsKey, waiters] of waiting.current) {
      if (keep.has(argsKey)) continue;
      waiting.current.delete(argsKey);
      waiters.forEach((waiter) => waiter.reject(new ListGoneError()));
    }
  }, []);
  const mounted = useRef(true);
  useEffect(() => giveUp(new Set(keyed.map((list) => list.argsKey))));
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      giveUp(new Set());
    };
  }, [giveUp]);
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
          return index > 0 && had && rebuilds.has(list.hash) ? Promise.resolve(had) : pageOf(list.args, cursor);
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

  /** The new chain of a list once its rebuild ends; gives up at once for a list that is gone already. */
  const waitForRebuild = useCallback((argsKey: string) => {
    const chain = new Promise<(string | null)[]>((resolve, reject) => {
      if (!mounted.current || !layoutRef.current.some((list) => list.argsKey === argsKey)) reject(new ListGoneError());
      else waiting.current.set(argsKey, [...(waiting.current.get(argsKey) ?? []), { resolve, reject }]);
    });
    // a first page that fails ends `loadAll` before it awaits this: no unhandled rejection when the list goes later
    chain.catch(() => {});
    return chain;
  }, []);
  useEffect(
    () =>
      queryClient.getQueryCache().subscribe((event) => {
        if (event.type !== 'updated' || event.action.type !== 'invalidate') return;
        const list = layoutRef.current.find((entry) => entry.cursors.length > 1 && event.query.queryHash === entry.hash);
        if (!list) return;
        const rebuild = rebuildsOf(queryClient).get(list.hash);
        if (rebuild) rebuild.depth = list.cursors.length;
        else rebuildsOf(queryClient).set(list.hash, { depth: list.cursors.length, old: list.cursors, running: false });
        rerender();
      }),
    [queryClient],
  );

  // the end of a round of a rebuild reaches every component that shows the list, also one that took it over
  const listsKey = JSON.stringify(keyed.map((list) => [list.argsKey, list.hash]));
  useEffect(() => {
    const listeners = listenersOf(queryClient);
    const offs = (JSON.parse(listsKey) as [string, string][]).map(([argsKey, hash]) => {
      const tell: RebuildListener = (chain, done) => {
        setState((current) => (argsKey in current ? { ...current, [argsKey]: chain } : current));
        if (done) {
          waiting.current.get(argsKey)?.forEach((waiter) => waiter.resolve(chain));
          waiting.current.delete(argsKey);
        }
        rerender();
      };
      const shown = listeners.get(hash) ?? new Set();
      listeners.set(hash, shown.add(tell));
      // the round may have ended between the render that took its old pages over and this registration: then the list
      // would show and ask those pages with their old cursors; it takes what the rebuild left instead (T15-M1)
      const took = adopted.current.get(argsKey);
      adopted.current.delete(argsKey);
      const rebuild = rebuildsOf(queryClient).get(hash);
      /* istanbul ignore next -- the window between a commit and its passive effects; Vitest flushes both in one act() */
      if (took && rebuild?.old !== took) {
        const args = (JSON.parse(argsKey) as ListWorkItemsArgs);
        const now = rebuild?.old ?? cachedCursors(queryClient, args, loadedPages.get(argsKey) ?? 1);
        setState((current) => (current[argsKey] === took ? { ...current, [argsKey]: now } : current));
      }
      return () => {
        shown.delete(tell);
        if (shown.size === 0) listeners.delete(hash);
      };
    });
    return () => offs.forEach((off) => off());
  }, [queryClient, listsKey]);

  // once the first page has loaded afresh, the new chain follows its cursors to the old depth, then replaces the old one;
  // the round runs on when the component that started it unmounts, and tells whoever shows the list then
  useEffect(() => {
    for (const list of layout) {
      const rebuild = rebuilds.get(list.hash);
      const first = queryClient.getQueryState<Page<ListedItem>>(pageKey(list.args, null));
      if (!rebuild || rebuild.running || first?.status !== 'success' || first.isInvalidated || first.fetchStatus !== 'idle') continue;
      rebuild.running = true;
      const { depth, old } = rebuild;
      const startedAt = first.dataUpdatedAt;
      void (async () => {
        const chain: (string | null)[] = [null];
        let next = first.data!.next_cursor;
        // forgotten meanwhile (the cache was cleared at sign-out, the first page left it): the round ends without a trace
        const forgotten = () => rebuilds.get(list.hash) !== rebuild;
        try {
          while (next !== null && chain.length < depth && !forgotten()) {
            const cursor = next;
            chain.push(cursor);
            next = (await queryClient.fetchQuery({ queryKey: pageKey(list.args, cursor), queryFn: () => pageOf(list.args, cursor) })).next_cursor;
          }
        } catch {
          // the page that failed stays the last one: it offers "Erneut versuchen"
        }
        rebuild.running = false;
        if (forgotten()) {
          chain.slice(1).forEach((cursor) => queryClient.removeQueries({ queryKey: pageKey(list.args, cursor), exact: true }));
          return;
        }
        for (const cursor of old.slice(1)) {
          if (!chain.includes(cursor)) queryClient.removeQueries({ queryKey: pageKey(list.args, cursor), exact: true });
        }
        // shown again later, the list starts with the new chain (its pages are in the cache)
        loadedPages.set(list.argsKey, chain.length);
        // a change meanwhile gave the first page another answer (or made it stale): the next round rebuilds anew
        const now = queryClient.getQueryState(pageKey(list.args, null));
        const done = !now?.isInvalidated && now?.dataUpdatedAt === startedAt;
        if (!done) rebuild.old = chain;
        else if (rebuilds.get(list.hash) === rebuild) rebuilds.delete(list.hash);
        for (const tell of [...(listenersOf(queryClient).get(list.hash) ?? [])]) tell(chain, done);
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
          while (rebuilds.has(list.hash)) {
            // waiting from now on, so a rebuild that ends (or a list that goes) while the first page loads is not missed
            const chain = waitForRebuild(list.argsKey);
            await fetchPage(null);
            cursors = [...(await chain)];
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
          if (first !== undefined && first.dataUpdatedAt === firstAt && !first.isInvalidated && !rebuilds.has(list.hash)) break;
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
  }, [combined, cursorsOf, layoutKey, queryClient, rebuilds, appendCursor, waitForRebuild]);

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
 * pages carry no group. The pages ask for the grouping the server applied (`ItemGroups.group_by`, K17). With `all` each
 * enabled group loads its pages one after the other until none is left (the timeline shows every epic).
 */
export function useGroupedWorkItems(
  args: ListWorkItemsArgs,
  keys: readonly string[] | null,
  enabled: ReadonlySet<string> | 'all',
  all = false,
): Record<string, InfiniteWorkItems> {
  const grouped = args.group_by !== undefined && args.group_by !== 'none';
  const lists = (keys ?? []).map((key) => ({
    id: key,
    args: grouped ? { ...args, group: key } : args,
    enabled: enabled === 'all' || enabled.has(key),
  }));
  return usePagedLists(lists, all);
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

/** What `useActivity` answers: the entries once both sources answered, and how loading them goes. */
export interface ActivityQuery {
  data: ActivityEntry[] | undefined;
  /** A source failed without data: there is nothing to show. A failed reload keeps what was shown. */
  isError: boolean;
  error: Error | null;
  isSuccess: boolean;
  isFetching: boolean;
  fetchStatus: 'fetching' | 'idle';
  /** Loads both sources again. */
  refetch: () => Promise<unknown>;
}

/** The moment of an entry; comments and events both carry microseconds, of which a `Date` keeps the milliseconds. */
const atOf = (entry: ActivityEntry) => Date.parse(entry.at);

/**
 * The whole activity of an item, oldest first: every page of its history and of its comments (the browser mixes the
 * two, A247; the server pages both from the oldest entry on, so stopping at the first hundred would hide the newest).
 * In order of time; a comment and an event of the very same moment read event first (a comment answers what happened).
 */
export function useActivity(itemId: string | null | undefined): ActivityQuery {
  const history = useQuery({
    queryKey: qk.activity.list({ item: itemId, pages: 'all' }),
    queryFn: () => allPages((cursor) => listActivity(itemId!, { cursor })),
    enabled: !!itemId,
  });
  const comments = useComments(itemId);
  const events = history.data?.items;
  const said = comments.data?.items;

  const data = useMemo(() => {
    if (!events || !said) return undefined;
    const entries: ActivityEntry[] = [...events, ...said.map((comment): ActivityEntry => ({ kind: 'comment', id: comment.id, at: comment.created_at, comment }))];
    // a stable sort: both sources come oldest first
    return entries.sort((a, b) => atOf(a) - atOf(b) || (a.kind === b.kind ? 0 : a.kind === 'event' ? -1 : 1));
  }, [events, said]);

  const failed = [history, comments].find((query) => query.isError && !query.data);
  const { refetch: refetchHistory } = history;
  const { refetch: refetchComments } = comments;
  const refetch = useCallback(() => Promise.all([refetchHistory(), refetchComments()]), [refetchHistory, refetchComments]);

  const isFetching = history.isFetching || comments.isFetching;

  return {
    data,
    isError: failed !== undefined,
    error: failed?.error ?? null,
    isSuccess: data !== undefined,
    isFetching,
    fetchStatus: isFetching ? 'fetching' : 'idle',
    refetch,
  };
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

/** A bulk patch as it leaves an item: the fields, the labels added and removed, the archive stamp. */
function applyBulk<T extends ListedItem>(item: T, patch: BulkPatch): T {
  const { archived, add_label_ids, remove_label_ids, ...fields } = patch;
  const next = applyPatch(item, fields);
  if (add_label_ids || remove_label_ids) {
    next.label_ids = [...(fields.label_ids ?? item.label_ids), ...(add_label_ids ?? [])].filter((id) => !(remove_label_ids ?? []).includes(id));
  }
  // the server's answer replaces the stamp: the app has no clock of its own
  if (archived !== undefined) next.archived_at = archived ? new Date().toISOString() : null;
  return next;
}

/** Changes many items; answers `{ updated, rejected }`. Variables: `{ ids, patch }`. */
export function useBulkUpdateWorkItems() {
  return useItemMutation({
    mutationFn: ({ ids, patch }: { ids: string[]; patch: BulkPatch }) => bulkUpdateWorkItems(ids, patch),
    ids: ({ ids }) => ids,
    apply: (item, { patch }) => applyBulk(item, patch),
    failureTitle: 'items.failed.bulk',
  });
}

/** How many ids one bulk call takes (`BulkUpdateWorkItems::MAX_IDS`, K25). */
export const BULK_MAX = 100;

/** What a change of many items did: changed, refused by an item's rules, and not saved (a block failed, `error`). */
export interface BulkOutcome extends BulkResult {
  unsaved: string[];
  error: Error | null;
}

/**
 * One change to many items (`run(ids, patch)`), in blocks of 100 one after the other, each optimistic. A block that
 * fails is put back and stops the rest: the ids of it and of every later block are `unsaved`, with the `error`. The
 * answer tells everything in one (`BulkOutcome`): no toast of its own, and the lists load again once, at the end, so
 * the items of later blocks do not come back between the blocks. It runs on after the screen that asked is gone.
 */
export function useBulkChange() {
  const queryClient = useQueryClient();
  const bulk = useItemMutation({
    mutationFn: ({ ids, patch }: { ids: string[]; patch: BulkPatch }) => bulkUpdateWorkItems(ids, patch),
    ids: ({ ids }) => ids,
    apply: (item, { patch }) => applyBulk(item, patch),
    failureTitle: 'items.failed.bulk',
    quiet: true,
  });
  const { mutateAsync, isPending } = bulk;
  const run = useCallback(
    async (ids: readonly string[], patch: BulkPatch): Promise<BulkOutcome> => {
      const outcome: BulkOutcome = { updated: [], rejected: [], unsaved: [], error: null };
      try {
        for (let from = 0; from < ids.length; from += BULK_MAX) {
          try {
            const block = await mutateAsync({ ids: ids.slice(from, from + BULK_MAX), patch });
            outcome.updated.push(...block.updated);
            outcome.rejected.push(...block.rejected);
          } catch (error) {
            outcome.unsaved = ids.slice(from);
            outcome.error = error as Error;
            break;
          }
        }
      } finally {
        void invalidateItems(queryClient);
      }
      return outcome;
    },
    [mutateAsync, queryClient],
  );
  return { run, isPending };
}

/**
 * Gives the items of a project short ranks (A448). Variable: the project's ULID. Settles once the shown lists have
 * loaded again (`invalidateQueries` with `refetchType: 'active'`), so the caller reads the new ranks after it.
 */
export function useRedistributeRanks() {
  return useApiMutation(redistributeRanks, [qk.workItems.all]);
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

/** How many deletes of a selection are on their way at once. */
export const DELETE_PARALLEL = 4;

/** What deleting many items did: deleted, and failed with the first error. */
export interface DeleteOutcome {
  deleted: string[];
  failed: string[];
  error: unknown;
}

/**
 * Deletes many items for good (there is no bulk delete): `DELETE_PARALLEL` at once, and the lists load again once, at
 * the end, so the items still waiting are not brought back by the reload of an earlier one. No toast of its own.
 */
export function useDeleteWorkItems() {
  const queryClient = useQueryClient();
  return useCallback(
    async (ids: readonly string[]): Promise<DeleteOutcome> => {
      const outcome: DeleteOutcome = { deleted: [], failed: [], error: null };
      // a reload on its way would bring back what is gone from the lists
      await queryClient.cancelQueries({ queryKey: qk.workItems.all });
      let next = 0;
      const worker = async () => {
        while (next < ids.length) {
          const id = ids[next++]!;
          try {
            await deleteWorkItem(id);
            outcome.deleted.push(id);
          } catch (error) {
            outcome.failed.push(id);
            outcome.error ??= error;
          }
        }
      };
      await Promise.all(Array.from({ length: Math.min(DELETE_PARALLEL, ids.length) }, worker));
      // in the order asked for
      outcome.failed = ids.filter((id) => outcome.failed.includes(id));
      void invalidateItems(queryClient);
      return outcome;
    },
    [queryClient],
  );
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
