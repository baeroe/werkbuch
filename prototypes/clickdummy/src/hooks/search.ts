import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { search } from '@/api/search';
import { qk } from './keys';

/** Items, pages, projects, people and views for the command palette; waits for a query and keeps the last result while typing. */
export function useSearch(q: string) {
  const query = q.trim();
  return useQuery({
    queryKey: qk.search.list({ q: query }),
    queryFn: () => search(query),
    enabled: query !== '',
    placeholderData: keepPreviousData,
  });
}
