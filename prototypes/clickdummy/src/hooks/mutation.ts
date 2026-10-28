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
import { ApiError } from '@/api/client';
import { toast } from '@/components/ui/toast';
import { parseKey } from '@/domain/keys';
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

export function useApiMutation<TVars, TData>(
  mutationFn: (vars: TVars) => Promise<TData>,
  invalidate: Invalidate<TData, TVars>,
): UseMutationResult<TData, Error, TVars> {
  const queryClient = useQueryClient();
  return useMutation<TData, Error, TVars>({
    mutationFn,
    onSuccess: (data, vars) => invalidateAll(queryClient, typeof invalidate === 'function' ? invalidate(data, vars) : invalidate),
  });
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

/** A failed call is worth repeating when the server could not answer; a refusal (4xx) would only be refused again. */
const isTransient = (error: unknown) => !(error instanceof ApiError) || error.status >= 500;

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
      // a conflict carries the stored state (`error.current`): the caller shows it, e.g. as the conflict banner
      if (error instanceof ApiError && error.current !== undefined) return;
      toast({
        title: config.failureTitle,
        description: error.message,
        tone: 'error',
        action: isTransient(error) ? { label: 'Erneut versuchen', onClick: () => mutation.mutate(vars) } : undefined,
      });
    },
    onSettled: () =>
      Promise.all([qk.workItems.all, qk.activity.all, qk.notifications.all].map((queryKey) => queryClient.invalidateQueries({ queryKey }))),
  });
  return mutation;
}
