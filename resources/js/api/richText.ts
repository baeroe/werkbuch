/*
 * What the editor of rich text reads (spec 4.16): who can be mentioned with `@` in a project, and the items behind the
 * references a stored text names. A reference stores only the id of its item (A229): the reader resolves it here and
 * gets only what they see. Finding an item for `#` goes through the search (`api/search.ts`, A230).
 */

import type { ListedItem, User } from '@/types';
import { get } from './http';

/**
 * The accounts who can be mentioned in a project (ULID or identifier): active members and org admins as people, bots
 * that are members; those whose name or handle begins with `q` first. The server sends 20 without a `limit` (at most 50).
 */
export async function listMentionables(project: string, q: string, limit?: number): Promise<User[]> {
  return (await get<{ data: User[] }>('/mentions', { project, q, limit })).data;
}

/** The items of these ids the reader sees (lean, at most 100 ids); an id that is not answered is hidden or gone. */
export async function resolveReferences(ids: readonly string[]): Promise<ListedItem[]> {
  return (await get<{ data: { items: ListedItem[] } }>('/references', { items: ids.join(',') })).data.items;
}
