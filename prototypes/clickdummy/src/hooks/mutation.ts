/*
 * The two kinds of mutation hooks of the data layer.
 *
 * `useApiMutation`: calls the API, then marks what it changed as stale so that the screens load again. The mutation
 * stays pending until that has happened, so the trigger shows its pending state until the new data are there.
 *
 * `useItemMutation` (work items): optimistic. The change shows at once in every cached list and detail; when the call
 * fails the old state comes back and an error toast offers "Erneut versuchen" (Review Focus 5). Nothing stays
 * pending: `isPending` is false as soon as the call is over. The toast names the cause; the retry button only comes
 * with errors worth repeating (the server did not answer), not with a refusal (409, 422), which would be refused
 * again. A conflict that carries the stored state is left to the caller.
 */

import { useMutation, useQueryClient, type QueryClient, type QueryKey, type UseMutationResult } from '@tanstack/react-query';
import { useCallback, useEffect, useRef } from 'react';
import { parseKey } from '@/domain/keys';
import { notifyError } from '@/lib/errors';
import { useSession } from '@/store/session';
import type { WorkItem, WorkItemDetail } from '@/types';
import type { Page } from '@/api/client';
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
   * shown once (a token, a webhook secret): it is dropped as soon as its dialog lets go of it.
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

const isPage = (data: unknown): data is Page<WorkItem> => typeof data === 'object' && data !== null && Array.isArray((data as Page<WorkItem>).items);
const isDetail = (data: unknown): data is WorkItemDetail => typeof data === 'object' && data !== null && 'item' in data && 'workflow' in data;

/**
 * Which items a list of references names. The API takes an id or a key (`WEB-47`), and a mutation hook is called with
 * what the caller has, so both must find the item in the cache; a key matches in any case, as it does on the server.
 */
function referencing(refs: readonly string[]): (item: WorkItem) => boolean {
  const ids = new Set(refs);
  const keys = new Set(
    refs.flatMap((ref) => {
      const key = parseKey(ref);
      return key ? [`${key.identifier}-${key.number}`] : [];
    }),
  );
  return (item) => ids.has(item.id) || keys.has(item.key);
}

/** Lists and details in the cache with the changed items replaced; anything else stays as it is. */
function patchCached(data: unknown, named: (item: WorkItem) => boolean, change: (item: WorkItem) => WorkItem): unknown {
  if (isPage(data)) {
    return { ...data, items: data.items.map((item) => (named(item) ? change(item) : item)) };
  }
  if (isDetail(data) && named(data.item)) {
    const item = change(data.item);
    return {
      ...data,
      item,
      state: data.workflow.states.find((state) => state.id === item.state_id) ?? data.state,
      subscribed: item.subscriber_ids.includes(useSession.getState().userId),
    };
  }
  return data;
}

interface ItemMutation<TVars, TData> {
  mutationFn: (vars: TVars) => Promise<TData>;
  /** The items the change is about, by id or key (what the API function takes). */
  ids: (vars: TVars) => string[];
  /** The item as the change leaves it. */
  apply: (item: WorkItem, vars: TVars) => WorkItem;
  /** Title of the toast when the change fails. */
  failureTitle: string;
}

export function useItemMutation<TVars, TData>(config: ItemMutation<TVars, TData>): UseMutationResult<TData, Error, TVars, Snapshot> {
  const queryClient = useQueryClient();

  const mutation: UseMutationResult<TData, Error, TVars, Snapshot> = useMutation<TData, Error, TVars, Snapshot>({
    mutationFn: config.mutationFn,
    onMutate: async (vars) => {
      // a running reload must not overwrite the change with the old state
      await queryClient.cancelQueries({ queryKey: qk.workItems.all });
      const snapshot = queryClient.getQueriesData<unknown>({ queryKey: qk.workItems.all });
      const named = referencing(config.ids(vars));
      for (const [key, data] of snapshot) queryClient.setQueryData(key, patchCached(data, named, (item) => config.apply(item, vars)));
      return { snapshot };
    },
    onError: (error, vars, context) => {
      context?.snapshot.forEach(([key, data]) => queryClient.setQueryData(key, data));
      // a conflict that carries the stored state (`error.current`) gets no toast: the caller shows its conflict banner
      notifyError(config.failureTitle, error, () => mutation.mutate(vars));
    },
    // the search as well: the palette would otherwise list an old title, status or key until its stale time ends
    onSettled: () =>
      Promise.all([qk.workItems.all, qk.activity.all, qk.notifications.all, qk.search.all].map((queryKey) => queryClient.invalidateQueries({ queryKey }))),
  });
  return mutation;
}
