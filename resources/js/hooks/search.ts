import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { search, type SearchOptions } from '@/api/search';
import { qk, type HookOptions } from './keys';

/**
 * The hits for what the palette holds. Nothing for an empty query. The last hits stay while the next query is on its
 * way. Always stale, so every opening of the palette asks again: the index follows an edit asynchronously, and no
 * mutation invalidates `qk.search` (P14).
 */
export function useSearch(q: string, options: SearchOptions = {}, hook: HookOptions = {}) {
  const text = q.trim();

  return useQuery({
    queryKey: qk.search.list({ q: text, ...options }),
    queryFn: () => search(text, options),
    enabled: text !== '' && (hook.enabled ?? true),
    placeholderData: keepPreviousData,
    staleTime: 0,
    gcTime: 30_000,
  });
}
