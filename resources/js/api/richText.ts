/*
 * What the editor of rich text reads (spec 4.16): who can be mentioned with `@` in a project, and the items and wiki
 * pages behind the references a stored text names. A reference stores only the id of what it names (A229): the reader
 * resolves it here and gets only what they see. Finding an item or a page for `#` goes through the search
 * (`api/search.ts`, A230).
 */

import type { ListedItem, PageSummary, User } from '@/types';
import { get } from './http';

/**
 * The accounts who can be mentioned in a project (ULID or identifier): active members and org admins as people, bots
 * that are members; those whose name or handle begins with `q` first. The server sends 20 without a `limit` (at most 50).
 */
export async function listMentionables(project: string, q: string, limit?: number): Promise<User[]> {
  return (await get<{ data: User[] }>('/mentions', { project, q, limit })).data;
}

export interface ReferenceIds {
  items?: readonly string[];
  pages?: readonly string[];
}

export interface ResolvedReferences {
  items: ListedItem[];
  pages: PageSummary[];
}

/**
 * The items and pages of these ids the reader sees (both lean, at most 100 ids over both kinds); an id that is not
 * answered is hidden or gone. A kind without ids is left out of the request.
 */
export async function resolveReferences({ items = [], pages = [] }: ReferenceIds): Promise<ResolvedReferences> {
  const query = { items: items.length > 0 ? items.join(',') : undefined, pages: pages.length > 0 ? pages.join(',') : undefined };

  return (await get<{ data: ResolvedReferences }>('/references', query)).data;
}
