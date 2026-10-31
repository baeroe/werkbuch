/*
 * Relations between work items (spec 4.9). The other end of a relation the reader may not see stays hidden
 * (`RelationEntry`); the detail of an item brings its relations along (`getWorkItem`).
 */

import type { Relation, RelationEntry } from '@/types';
import { del, one, post } from './http';

/** The source "blockiert" the target; both by ULID or key. A duplicate, the item itself or an unseen target is a 422 at `target_id`. */
export async function addRelation(source_id: string, type_id: string, target_id: string): Promise<Relation> {
  const entry = await one(post<{ data: RelationEntry }>(`/work-items/${encodeURIComponent(source_id)}/relations`, { type_id, target_id }));

  return entry.relation;
}

/** Removes a relation from either end the signed-in account may change. */
export function removeRelation(id: string): Promise<void> {
  return del<void>(`/relations/${encodeURIComponent(id)}`);
}
