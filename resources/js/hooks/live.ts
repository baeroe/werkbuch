import { useQueryClient, type QueryClient, type QueryKey } from '@tanstack/react-query';
import { useEffect, useSyncExternalStore } from 'react';
import { isLiveConnected, subscribeLive, subscribeLiveStatus, watchItem, type LiveEvent } from '@/api/live';
import { useUiStore } from '@/store/ui';
import { qk } from './keys';

/** How long a burst of live messages is collected before the screens load again, once. */
export const LIVE_BURST_MS = 300;

/** How many event ids the tab remembers to drop a message it has seen (the original and the redispatch, P10). */
const SEEN_MAX = 1000;

/** Everything a live message can make stale: what a screen shows again after the connection was gone. */
const EVERYTHING: readonly QueryKey[] = [qk.workItems.all, qk.activity.all, qk.comments.all, qk.projects.all, qk.members.all, qk.notifications.all];

/**
 * The caches a message makes stale. Items and their history on `work_item.*` (also watching, on the person's own
 * channel), comments and the history on `comment.*`, projects and members on `project.*`, the projects on a new org
 * role (K14: the channels follow the list), the inbox on `notifications.changed`; everything after the connection was
 * back (`live.reconnected`); projects and items after a refused channel (A281: access lost).
 */
function keysOf(event: LiveEvent): readonly QueryKey[] {
  const group = event.type.split('.')[0];
  if (event.type === 'live.reconnected') return EVERYTHING;
  if (event.type === 'live.refused') return [qk.projects.all, qk.workItems.all];
  if (event.type === 'notifications.changed') return [qk.notifications.all];
  if (event.type === 'user.role_changed') return [qk.projects.all];
  if (group === 'work_item') return [qk.workItems.all, qk.activity.all];
  if (group === 'comment') return [qk.comments.all, qk.activity.all];
  if (group === 'project') return [qk.projects.all, qk.members.all];
  return [];
}

/** Whether live updates arrive: false while the banner says they are paused. */
export function useLiveConnected(): boolean {
  return useSyncExternalStore(subscribeLiveStatus, isLiveConnected, isLiveConnected);
}

/**
 * What arrived while a mutation of this tab ran (A282, K12): the caches were only marked stale, so no answer replaces
 * the optimistic state; once no mutation runs any more, what is still stale (or was being fetched when the message
 * came, so its answer may be older) is fetched. What the mutation fetched itself after it settled is fresh and stays.
 */
class Deferred {
  private readonly keys = new Map<string, QueryKey>();
  private readonly inFlight = new Set<string>();

  constructor(private readonly client: QueryClient) {}

  mark(queryKey: QueryKey): void {
    this.keys.set(JSON.stringify(queryKey), queryKey);
    this.client
      .getQueryCache()
      .findAll({ queryKey, fetchStatus: 'fetching' })
      .forEach((query) => this.inFlight.add(query.queryHash));
    void this.client.invalidateQueries({ queryKey, refetchType: 'none' });
  }

  /** Called on every change of the mutations: once none runs, fetches what is left. */
  settle(): void {
    if (this.keys.size === 0 || this.client.isMutating() > 0) return;
    const keys = [...this.keys.values()];
    const inFlight = new Set(this.inFlight);
    this.keys.clear();
    this.inFlight.clear();
    for (const queryKey of keys) {
      void this.client.invalidateQueries(
        { queryKey, refetchType: 'active', predicate: (query) => query.state.isInvalidated || inFlight.has(query.queryHash) },
        { cancelRefetch: false },
      );
    }
  }
}

/**
 * Mount once in the shell (`LiveHost`): a live message (somebody else changed something) makes the screens that show
 * it load again and lights the changed item up for two seconds (`flash`). A message seen before (by its event) is
 * dropped; messages are collected for 300 ms, then every cache they touch is made stale once.
 */
export function useLiveSync(): void {
  const queryClient = useQueryClient();
  useEffect(() => {
    const seen = new Set<string>();
    const order: string[] = [];
    const burst = new Map<string, QueryKey>();
    const deferred = new Deferred(queryClient);
    let timer: ReturnType<typeof setTimeout> | null = null;

    const flush = () => {
      timer = null;
      const keys = [...burst.values()];
      burst.clear();
      for (const queryKey of keys) {
        if (queryClient.isMutating() > 0) deferred.mark(queryKey);
        else void queryClient.invalidateQueries({ queryKey });
      }
    };

    const stopMutations = queryClient.getMutationCache().subscribe(() => deferred.settle());
    const stopLive = subscribeLive((event) => {
      if (event.event_id !== null) {
        if (seen.has(event.event_id)) return;
        seen.add(event.event_id);
        order.push(event.event_id);
        if (order.length > SEEN_MAX) seen.delete(order.shift()!);
      }
      for (const queryKey of keysOf(event)) burst.set(JSON.stringify(queryKey), queryKey);
      if (event.item_id) useUiStore.getState().flash(event.item_id);
      timer ??= setTimeout(flush, LIVE_BURST_MS);
    });

    return () => {
      stopLive();
      stopMutations();
      if (timer !== null) clearTimeout(timer);
    };
  }, [queryClient]);
}

/** Holds the live channel of the item while a detail (page or preview) shows it: its comments arrive there (A227). */
export function useLiveItem(itemId: string | null): void {
  useEffect(() => (itemId === null ? undefined : watchItem(itemId)), [itemId]);
}
