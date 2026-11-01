/*
 * The mutation hooks of the data layer.
 *
 * `useApiMutation`: calls the API, then marks what it changed as stale so that the screens load again. The mutation
 * stays pending until that has happened, so the trigger shows its pending state until the new data are there.
 *
 * `useSettle`: callbacks for one call of a mutation that every call keeps, also when another call starts meanwhile.
 *
 * `useItemMutation` (work items): optimistic. The change shows at once in every cached list and detail; when the call
 * fails the old state comes back and an error toast names the cause (`notifyError`, Ruling R12): "Erneut versuchen"
 * only with errors worth repeating (5xx, no answer), not with a refusal (409, 422), which would be refused again. A
 * conflict that carries the stored state (409 with `current`, e.g. `description_conflict`) is left to the caller.
 * Nothing stays pending: `isPending` is false as soon as the call is over. The parent an item names (`parent`) follows
 * the change as the server would compute it: a new `parent_id` names its item, a changed parent its new title.
 */

import { useMutation, useQueryClient, type QueryClient, type QueryKey, type UseMutationResult } from '@tanstack/react-query';
import { useCallback, useEffect, useRef } from 'react';
import type { Page } from '@/api/client';
import { parseKey } from '@/domain/keys';
import { notifyError } from '@/lib/errors';
import { t, type TranslationKey } from '@/lib/i18n';
import type { ItemRef, ListedItem, WorkItemDetail } from '@/types';
import { qk } from './keys';

type Keys = readonly QueryKey[];

/** What a successful call makes stale: keys to invalidate, `'all'` for everything, or a function of the result. */
export type Invalidate<TData, TVars> = Keys | 'all' | ((data: TData, vars: TVars) => Keys | 'all');

function invalidateAll(queryClient: QueryClient, what: Keys | 'all'): Promise<unknown> {
  if (what === 'all') return queryClient.invalidateQueries();
  return Promise.all(what.map((queryKey) => queryClient.invalidateQueries({ queryKey })));
}

export interface ApiMutationOptions<TVars, TData> {
  /** Runs with the answer before the reload, e.g. to put what the answer holds into the cache. */
  onSuccess?: (data: TData, vars: TVars, queryClient: QueryClient) => void;
  /**
   * How long the finished call stays in the mutation cache once nothing observes it. 0 for answers that hold a secret
   * shown once (a token, recovery codes): it is dropped as soon as its dialog lets go of it.
   */
  gcTime?: number;
}

export function useApiMutation<TVars, TData>(
  mutationFn: (vars: TVars) => Promise<TData>,
  invalidate: Invalidate<TData, TVars>,
  options: ApiMutationOptions<TVars, TData> = {},
): UseMutationResult<TData, Error, TVars> {
  const queryClient = useQueryClient();
  return useMutation<TData, Error, TVars>({
    mutationFn,
    gcTime: options.gcTime,
    onSuccess: (data, vars) => {
      options.onSuccess?.(data, vars, queryClient);
      return invalidateAll(queryClient, typeof invalidate === 'function' ? invalidate(data, vars) : invalidate);
    },
  });
}

/* ------------------------------------------------------------------- one call's answer */

/** What one call of a mutation does with its answer; `error` is what `mutateAsync` rejects with. */
export interface CallCallbacks<TData> {
  onSuccess?: (data: TData) => void;
  onError?: (error: Error) => void;
  /** After either of them. */
  onSettled?: () => void;
}

export type Settle = <TData>(call: Promise<TData>, callbacks?: CallCallbacks<TData>) => void;

/**
 * Callbacks for one call of a mutation, in place of `mutate(vars, { onSuccess, onError, onSettled })`. TanStack keeps
 * one observer per hook and hands such callbacks to the newest call only: an earlier call that is still running loses
 * them (of two uploads at once, the first kept its progress line for good). `settle` hangs them on the call's own
 * promise, so every call gets its answer:
 *
 *   const settle = useSettle();
 *   settle(upload.mutateAsync(vars), { onSuccess: () => toast(…), onSettled: () => dropLine(entry) });
 *
 * As TanStack's own callbacks do, they stay quiet once the component is gone (a list that was left must not change the
 * address any more). A failure without `onError` is left to the hook, which reports it if it reports at all; nothing
 * is left unhandled.
 */
export function useSettle(): Settle {
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  return useCallback<Settle>((call, { onSuccess, onError, onSettled } = {}) => {
    void call.then(
      (data) => {
        if (!mounted.current) return;
        onSuccess?.(data);
        onSettled?.();
      },
      (error: Error) => {
        if (!mounted.current) return;
        onError?.(error);
        onSettled?.();
      },
    );
  }, []);
}

/* ------------------------------------------------------------------ optimistic items */

interface Snapshot {
  snapshot: [QueryKey, unknown][];
}

const isPage = (data: unknown): data is Page<ListedItem> => typeof data === 'object' && data !== null && Array.isArray((data as Page<ListedItem>).items);
const isDetail = (data: unknown): data is WorkItemDetail => typeof data === 'object' && data !== null && 'item' in data && 'workflow' in data;

/** A reference as the server reads it: a key in any case is the same key (`web-47` = `WEB-47`), anything else stays. */
function normalRef(ref: string): string {
  const key = parseKey(ref);
  return key ? `${key.identifier}-${key.number}` : ref;
}

/**
 * Which items a list of references names. The API takes an id or a key (`WEB-47`), and a mutation hook is called with
 * what the caller has, so both must find the item in the cache; a key matches in any case, as it does on the server. A
 * detail loaded under a reference names its item as well: the page of a former key (`OLD-1`) holds the item `NEW-1`,
 * and a change sent with the address's key must show there too.
 */
function referencing(refs: readonly string[], cached: readonly [QueryKey, unknown][]): (item: ListedItem) => boolean {
  const named = new Set(refs.map(normalRef));
  const ids = new Set<string>();
  for (const [key, data] of cached) {
    if (key[1] === 'detail' && isDetail(data) && named.has(normalRef(String(key[2])))) ids.add(data.item.id);
  }
  return (item) => ids.has(item.id) || named.has(item.id) || named.has(item.key);
}

/** How a change leaves an item: a lean one of a list stays lean, the full one of a detail stays full. */
type ItemChange = <T extends ListedItem>(item: T) => T;

/**
 * Lists and details in the cache with every item passed through `change`; an item it leaves alone stays as it is. Each
 * page of a list is a `Page` of its own (also the pages of every group, `useGroupedWorkItems`); groups and counts are
 * not, and are left to the reload that follows.
 */
function patchCached(data: unknown, change: ItemChange): unknown {
  if (isPage(data)) {
    return { ...data, items: data.items.map(change) };
  }
  if (isDetail(data)) {
    const item = change(data.item);
    const children = data.children.map(change);
    if (item === data.item && children.every((child, index) => child === data.children[index])) return data;
    return {
      ...data,
      item,
      children,
      state: data.workflow.states.find((state) => state.id === item.state_id) ?? data.state,
      subscribed: item.subscribed,
    };
  }
  return data;
}

/** The parent as an item resource names it. */
const refOf = (item: ListedItem): ItemRef => ({ id: item.id, key: item.key, title: item.title, type_id: item.type_id });
const sameRef = (a: ItemRef, b: ItemRef) => a.id === b.id && a.key === b.key && a.title === b.title && a.type_id === b.type_id;

/** Every item in the cache by id, in the copy that loaded last (lists and details may hold older copies). */
function cachedItems(queryClient: QueryClient): Map<string, ListedItem> {
  const queries = queryClient
    .getQueryCache()
    .findAll({ queryKey: qk.workItems.all })
    .sort((a, b) => b.state.dataUpdatedAt - a.state.dataUpdatedAt);
  const found = new Map<string, ListedItem>();
  for (const { state } of queries) {
    const items = isPage(state.data) ? state.data.items : isDetail(state.data) ? [state.data.item, ...state.data.children] : [];
    for (const item of items) if (!found.has(item.id)) found.set(item.id, item);
  }
  return found;
}

export interface ItemMutationOptions<TVars, TData> {
  mutationFn: (vars: TVars) => Promise<TData>;
  /** The items the change is about, by id or key (what the API function takes). */
  ids: (vars: TVars) => string[];
  /** The item as the change leaves it (a lean item of a list or the full one of a detail, `ItemChange`). */
  apply: <T extends ListedItem>(item: T, vars: TVars) => T;
  /** Title of the toast when the change fails. */
  failureTitle: TranslationKey;
  /**
   * The caller reports a failure and loads the lists again itself, e.g. a change in blocks that tells in one toast what
   * every block did (`useBulkChange`): no toast and no reload of its own. A failure still puts the cache back.
   */
  quiet?: boolean;
}

/** Loads again what follows every change of an item: its lists and details, the history and the count per state. */
export function invalidateItems(queryClient: QueryClient): Promise<unknown> {
  return Promise.all([qk.workItems.all, qk.activity.all, qk.stateUsage.all].map((queryKey) => queryClient.invalidateQueries({ queryKey })));
}

export function useItemMutation<TVars, TData>(options: ItemMutationOptions<TVars, TData>): UseMutationResult<TData, Error, TVars, Snapshot> {
  const queryClient = useQueryClient();

  const mutation: UseMutationResult<TData, Error, TVars, Snapshot> = useMutation<TData, Error, TVars, Snapshot>({
    mutationFn: options.mutationFn,
    onMutate: async (vars) => {
      // a running reload must not overwrite the change with the old state
      await queryClient.cancelQueries({ queryKey: qk.workItems.all });
      const snapshot = queryClient.getQueriesData<unknown>({ queryKey: qk.workItems.all });
      const named = referencing(options.ids(vars), snapshot);
      const known = cachedItems(queryClient);
      // the changed items as the change leaves them: their children name them as parent
      const changed = new Map([...known.values()].filter(named).map((item) => [item.id, options.apply(item, vars)]));
      // a new parent the cache does not know is named by nobody until the server answers: never by the old one
      const parentOf = (id: string | null): ItemRef | null => {
        const parent = id === null ? undefined : (changed.get(id) ?? known.get(id));
        return parent ? refOf(parent) : null;
      };
      const change: ItemChange = (item) => {
        if (named(item)) {
          const next = options.apply(item, vars);
          return next.parent_id === item.parent_id ? next : { ...next, parent: parentOf(next.parent_id) };
        }
        // a child of a changed item names it as its parent: with the title the change gives it
        if (!item.parent) return item;
        const parent = changed.get(item.parent.id);
        if (!parent || item.parent_id !== parent.id || sameRef(item.parent, refOf(parent))) return item;
        return { ...item, parent: refOf(parent) };
      };
      for (const [key, data] of snapshot) queryClient.setQueryData(key, patchCached(data, change));
      return { snapshot };
    },
    onError: (error, vars, context) => {
      context?.snapshot.forEach(([key, data]) => queryClient.setQueryData(key, data));
      if (!options.quiet) notifyError(t(options.failureTitle), error, () => mutation.mutate(vars));
    },
    // the history and the count per state follow every change of an item
    onSettled: () => (options.quiet ? undefined : invalidateItems(queryClient)),
  });
  return mutation;
}
