import { useQueryClient, type Query, type QueryClient, type QueryKey } from '@tanstack/react-query';
import { useEffect, useSyncExternalStore } from 'react';
import { isLiveConnected, subscribeLive, subscribeLiveStatus, watchItem, type LiveEvent } from '@/api/live';
import { subscribeUndoPending, undoPending } from '@/lib/undo';
import { useUiStore } from '@/store/ui';
import { qk } from './keys';

/** How long the messages have to pause before the screens load again: a burst loads once. */
export const LIVE_BURST_MS = 300;

/** How long a steady stream of messages waits at most before the screens load anyway. */
export const LIVE_MAX_WAIT_MS = 2_000;

/** How many event ids the tab remembers to drop a message it has seen (the original and the redispatch, P10). */
const SEEN_MAX = 1000;

/** How many deleted projects and items the tab remembers to leave their queries alone (the oldest go first). */
const GONE_MAX = 200;

/** Everything a live message can make stale: what a screen shows again after the connection was gone. */
const EVERYTHING: readonly QueryKey[] = [qk.workItems.all, qk.activity.all, qk.comments.all, qk.projects.all, qk.members.all, qk.notifications.all];

/**
 * The caches a message makes stale. Items and their history on `work_item.*` (also watching, on the person's own
 * channel), comments and the history on `comment.*`, projects and members on `project.*`, the projects on a new org
 * role (K14: the channels follow the list), the inbox on `notifications.changed`; everything after the connection was
 * back (`live.reconnected`). A refused channel (`live.refused`) loads everything as well (A281: access lost; what the
 * person may not see any more answers 404 or leaves the lists, as the screen should show it), unless the project or
 * item it is about was deleted: that is decided when the burst loads, so a delete and a refusal that come together
 * give the same whichever comes first.
 */
function keysOf(event: LiveEvent): readonly QueryKey[] {
  const group = event.type.split('.')[0];
  if (event.type === 'live.reconnected') return EVERYTHING;
  // decided when the burst loads (`refusalKeys`): a refused channel of something deleted loads nothing
  if (event.type === 'live.refused') return [];
  if (event.type === 'notifications.changed') return [qk.notifications.all];
  if (event.type === 'user.role_changed') return [qk.projects.all];
  if (group === 'work_item') return [qk.workItems.all, qk.activity.all];
  if (group === 'comment') return [qk.comments.all, qk.activity.all];
  if (group === 'project') return [qk.projects.all, qk.members.all];
  return [];
}

/**
 * What a message says is deleted: a project or an item. Its own queries would answer 404 now (which the browser
 * reports as an error): live leaves them alone, the screen keeps what it shows until it is left (see `LiveRefresh`).
 * A refused channel (access lost, A281) is not gone: its queries load again and show that the person may not see it.
 */
function goneOf(event: LiveEvent): string | null {
  if (event.type === 'project.deleted') return event.project_id;
  if (event.type === 'work_item.deleted') return event.item_id;
  return null;
}

/** The id a cached answer is about: a project or an item (`id`), or the item of a detail (`item.id`). */
function dataId(data: unknown): unknown {
  if (typeof data !== 'object' || data === null) return undefined;
  const record = data as { id?: unknown; item?: { id?: unknown } | null };
  return record.id ?? record.item?.id;
}

/** Whether live updates arrive: false while the banner says they are paused. */
export function useLiveConnected(): boolean {
  return useSyncExternalStore(subscribeLiveStatus, isLiveConnected, isLiveConnected);
}

/**
 * Loads again what live messages made stale, without ever throwing away a fetch on its way (K12, review T14 I1/I2):
 * - While a change of this tab is not stored yet (a mutation runs, or an undo toast still offers to take a change
 *   back, `undoPending`), the caches are only marked stale, so no answer replaces what the screen shows; once nothing
 *   is pending any more, what is still stale (or was being fetched when the message came) loads. What the change
 *   loaded itself after it settled is fresh and stays.
 * - A query that is being fetched when it gets stale is not cancelled and started anew: once its answer is there
 *   (which may be older than the message), it loads once more. A stream of messages thus never keeps a slow list from
 *   arriving.
 */
class LiveRefresh {
  /** Keys made stale while something was pending. */
  private readonly deferred = new Map<string, QueryKey>();
  /** Queries to load again once their running fetch ends (and nothing is pending). */
  private readonly afterFetch = new Set<string>();
  /** Deleted projects and items (the last `GONE_MAX`): their queries are not loaded again (they would answer 404). */
  private readonly gone = new Set<string>();

  constructor(
    private readonly client: QueryClient,
    private readonly pending: () => boolean,
  ) {}

  /** Whether `id` is known to be deleted. */
  isGone(id: string): boolean {
    return this.gone.has(id);
  }

  /** `id` was deleted: it never comes back. */
  markGone(id: string): void {
    this.gone.delete(id);
    this.gone.add(id);
    if (this.gone.size > GONE_MAX) this.gone.delete(this.gone.values().next().value!);
  }

  apply(keys: readonly QueryKey[]): void {
    const pending = this.pending();
    for (const queryKey of keys) {
      if (pending) this.deferred.set(JSON.stringify(queryKey), queryKey);
      for (const query of this.client.getQueryCache().findAll({ queryKey })) {
        // not even stale: a screen that mounts another view of it would fetch it and get 404
        if (this.aboutGone(query)) continue;
        query.invalidate();
        if (query.state.fetchStatus === 'fetching') this.afterFetch.add(query.queryHash);
        else if (!pending) this.load(query);
      }
    }
  }

  /** Something pending may have settled: load what is left once nothing is. */
  settle(): void {
    if (this.pending()) return;
    const keys = [...this.deferred.values()];
    this.deferred.clear();
    const cache = this.client.getQueryCache();
    const stale = keys.flatMap((queryKey) => cache.findAll({ queryKey }).filter((query) => query.state.isInvalidated));
    const waiting = [...this.afterFetch].flatMap((hash) => {
      const query = cache.get(hash);
      // a query that left the cache meanwhile is fetched by whoever shows it again
      if (query === undefined) this.afterFetch.delete(hash);
      return query ?? [];
    });
    for (const query of new Set([...stale, ...waiting])) this.load(query);
  }

  /** A query of the cache finished a fetch: load it again when a message came during that fetch. */
  fetched(query: Query): void {
    if (!this.afterFetch.has(query.queryHash) || query.state.fetchStatus === 'fetching' || this.pending()) return;
    this.load(query);
  }

  /** Whether a query is about something gone: its key names it, or its answer is it. */
  private aboutGone(query: Query): boolean {
    for (const id of this.gone) {
      if (query.queryHash.includes(id) || dataId(query.state.data) === id) return true;
    }
    return false;
  }

  /**
   * Loads a query now, or after the fetch on its way; one nobody shows stays stale until it is shown again. One about
   * something gone is not loaded (it would answer 404).
   */
  private load(query: Query): void {
    if (this.aboutGone(query)) {
      this.afterFetch.delete(query.queryHash);
      return;
    }
    if (query.state.fetchStatus === 'fetching') {
      this.afterFetch.add(query.queryHash);
      return;
    }
    this.afterFetch.delete(query.queryHash);
    if (!query.isActive()) return;
    void this.client.refetchQueries({ predicate: (candidate) => candidate === query }, { cancelRefetch: false });
  }
}

/**
 * Mount once in the shell (`LiveHost`): a live message (somebody else changed something) makes the screens that show
 * it load again and lights the changed item up for two seconds (`flash`). A message seen before (by its event) is
 * dropped; messages are collected until they pause for 300 ms (at most two seconds), then every cache they touch is
 * made stale once and loads again (`LiveRefresh`).
 */
export function useLiveSync(): void {
  const queryClient = useQueryClient();
  useEffect(() => {
    const seen = new Set<string>();
    const order: string[] = [];
    const burst = new Map<string, QueryKey>();
    /** What the refused channels of the burst were about: a project or an item, `null` for the person's own channel. */
    const refusals: (string | null)[] = [];
    const flashes = new Set<string>();
    const refresh = new LiveRefresh(queryClient, () => queryClient.isMutating() > 0 || undoPending());
    let quiet: ReturnType<typeof setTimeout> | null = null;
    let longest: ReturnType<typeof setTimeout> | null = null;
    let alive = true;

    const flush = () => {
      if (quiet !== null) clearTimeout(quiet);
      if (longest !== null) clearTimeout(longest);
      quiet = null;
      longest = null;
      // a refusal is lost access (A281), unless what it is about was deleted: then the delete decides, whichever came first
      const lost = refusals.splice(0).some((id) => id === null || !refresh.isGone(id));
      const keys = lost ? EVERYTHING : [...burst.values()];
      burst.clear();
      refresh.apply(keys);
      flashes.forEach((id) => useUiStore.getState().flash(id));
      flashes.clear();
    };
    // a toast that runs out closes before its action starts: look once the closing is over
    const settle = () =>
      queueMicrotask(() => {
        if (alive) refresh.settle();
      });

    const stopMutations = queryClient.getMutationCache().subscribe(settle);
    const stopUndo = subscribeUndoPending(settle);
    const stopQueries = queryClient.getQueryCache().subscribe((event) => {
      if (event.type === 'updated' && (event.action.type === 'success' || event.action.type === 'error')) refresh.fetched(event.query);
    });
    const stopLive = subscribeLive((event) => {
      if (event.event_id !== null) {
        if (seen.has(event.event_id)) return;
        seen.add(event.event_id);
        order.push(event.event_id);
        if (order.length > SEEN_MAX) seen.delete(order.shift()!);
      }
      const gone = goneOf(event);
      if (gone !== null) refresh.markGone(gone);
      if (event.type === 'live.refused') refusals.push(event.project_id ?? event.item_id);
      for (const queryKey of keysOf(event)) burst.set(JSON.stringify(queryKey), queryKey);
      if (event.item_id) flashes.add(event.item_id);
      if (quiet !== null) clearTimeout(quiet);
      quiet = setTimeout(flush, LIVE_BURST_MS);
      longest ??= setTimeout(flush, LIVE_MAX_WAIT_MS);
    });

    return () => {
      alive = false;
      stopLive();
      stopMutations();
      stopUndo();
      stopQueries();
      if (quiet !== null) clearTimeout(quiet);
      if (longest !== null) clearTimeout(longest);
    };
  }, [queryClient]);
}

/** Holds the live channel of the item while a detail (page or preview) shows it: its comments arrive there (A227). */
export function useLiveItem(itemId: string | null): void {
  useEffect(() => (itemId === null ? undefined : watchItem(itemId)), [itemId]);
}
