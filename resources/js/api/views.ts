/*
 * Views and favorites (spec 4.11). A view belongs to the whole team and spans projects; every account may create one,
 * only its creator and org admins change or delete it. Saving replaces a view as a whole (`PUT`). Favorites are per
 * person: views and projects in the sidebar; deleting a view takes it out of every sidebar.
 */

import type { Favorite, View, ViewInput } from '@/types';
import type { Page, PageArgs } from './client';
import { del, get, getPage, one, post, saveOne } from './http';

/** The team views, by name, one page at a time. */
export function listViews(args: PageArgs = {}): Promise<Page<View>> {
  return getPage<View>('/views', { ...args });
}

export function getView(id: string): Promise<View> {
  return one(get<{ data: View }>(`/views/${encodeURIComponent(id)}`));
}

/** Creates a view (no `id`) or replaces one (the creator or an org admin). Answers the saved view. */
export function saveView({ id, ...input }: ViewInput): Promise<View> {
  return saveOne<View>('/views', id, input);
}

/** Deletes a view for everybody, with the favorites that name it. */
export function deleteView(id: string): Promise<void> {
  return del<void>(`/views/${encodeURIComponent(id)}`);
}

/** Puts a view or project into the sidebar of the signed-in person, or takes it out. Answers the new state. */
export function toggleFavorite({ kind, id }: { kind: Favorite['kind']; id: string }): Promise<{ kind: Favorite['kind']; id: string; favorite: boolean }> {
  return post<{ kind: Favorite['kind']; id: string; favorite: boolean }>('/favorites/toggle', { kind, id });
}

/** The favorites of the signed-in person, in the order of the sidebar. */
export function listFavorites(): Promise<Page<Favorite>> {
  return getPage<Favorite>('/favorites');
}
