/*
 * Favorites (spec 4.11): projects in the sidebar of one person. Views come with Phase 5.
 */

import type { Favorite } from '@/types';
import type { Page } from './client';
import { getPage, post } from './http';

/** Puts a view or project into the sidebar of the signed-in person, or takes it out. Answers the new state. */
export function toggleFavorite({ kind, id }: { kind: Favorite['kind']; id: string }): Promise<{ kind: Favorite['kind']; id: string; favorite: boolean }> {
  return post<{ kind: Favorite['kind']; id: string; favorite: boolean }>('/favorites/toggle', { kind, id });
}

/** The favorites of the signed-in person, in the order of the sidebar. */
export function listFavorites(): Promise<Page<Favorite>> {
  return getPage<Favorite>('/favorites');
}
