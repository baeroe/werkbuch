/*
 * The search of the command palette: items, wiki pages (lean: title and place, no text), projects, people and views in
 * one answer, a few hits per kind. A hit is only what the reader sees at the time of the query (A200).
 */

import type { SearchResults, SearchType } from '@/types';
import { get, one } from './http';

export interface SearchOptions {
  /** Which kinds to look through; all by default. */
  types?: SearchType[];
  /** Hits per kind, 1 to 50. */
  limit?: number;
  include_archived?: boolean;
}

export function search(q: string, options: SearchOptions = {}): Promise<SearchResults> {
  return one(
    get<{ data: SearchResults }>('/search', {
      q,
      types: options.types?.join(','),
      limit: options.limit,
      include_archived: options.include_archived,
    }),
  );
}
