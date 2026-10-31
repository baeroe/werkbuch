/*
 * The mutation hooks of the data layer.
 *
 * `useApiMutation`: calls the API, then marks what it changed as stale so that the screens load again. The mutation
 * stays pending until that has happened, so the trigger shows its pending state until the new data are there.
 *
 * `useSettle`: callbacks for one call of a mutation that every call keeps, also when another call starts meanwhile.
 *
 * The optimistic `useItemMutation` of the clickdummy comes with the work items (Phase 4).
 */

import { useMutation, useQueryClient, type QueryClient, type QueryKey, type UseMutationResult } from '@tanstack/react-query';
import { useCallback, useEffect, useRef } from 'react';

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
