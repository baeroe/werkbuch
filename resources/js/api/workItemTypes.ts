/*
 * Work item types (spec 4.6): name, icon, tone and the properties a type carries. Only org admins change them.
 */

import type { WorkItemType } from '@/types';
import type { Page, PageArgs } from './client';
import { del, getPage, saveOne } from './http';

export type WorkItemTypeInput = Omit<WorkItemType, 'id' | 'archived_at'> & { id?: string; archived_at?: string | null };

/** All types, archived ones included (items of an archived type still show it). */
export function listWorkItemTypes(args: PageArgs = {}): Promise<Page<WorkItemType>> {
  return getPage<WorkItemType>('/work-item-types', { ...args });
}

/** Creates (without `id`) or replaces a type as a whole. */
export function saveWorkItemType(input: WorkItemTypeInput): Promise<WorkItemType> {
  const { id, ...body } = input;

  return saveOne<WorkItemType>('/work-item-types', id, body);
}

/** The answer is `{ outcome }` without `data`: a type that items use is archived instead of deleted. */
export function deleteWorkItemType(id: string): Promise<{ outcome: 'deleted' | 'archived' }> {
  return del<{ outcome: 'deleted' | 'archived' }>(`/work-item-types/${encodeURIComponent(id)}`);
}
