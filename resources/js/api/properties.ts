/*
 * Properties (spec 4.6): the custom fields of work items. Only org admins change them.
 */

import type { Property, PropertyOption } from '@/types';
import type { Page, PageArgs } from './client';
import { del, getPage, saveOne } from './http';

export type PropertyInput = Omit<Property, 'id' | 'options'> & {
  id?: string;
  options: (Omit<PropertyOption, 'id' | 'archived_at'> & { id?: string; archived_at?: string | null })[];
};

export function listProperties(args: PageArgs = {}): Promise<Page<Property>> {
  return getPage<Property>('/properties', { ...args });
}

/** Creates (without `id`) or replaces a property as a whole; options without an id are new. */
export function saveProperty(input: PropertyInput): Promise<Property> {
  const { id, ...body } = input;

  return saveOne<Property>('/properties', id, body);
}

/** The answer is `{ affected_items }` without `data`: how many items lost their value. */
export function deleteProperty(id: string): Promise<{ affected_items: number }> {
  return del<{ affected_items: number }>(`/properties/${encodeURIComponent(id)}`);
}
