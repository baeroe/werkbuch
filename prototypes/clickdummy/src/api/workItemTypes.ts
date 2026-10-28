/*
 * Work item types (spec 4.6). They live in the organisation, projects enable a selection. A type that has items is
 * archived instead of deleted: no new items of it can be created.
 */

import type { TypeTone, WorkItemType } from '@/types';
import { requireOrgAdmin } from './access';
import { conflict, FieldErrors, newId, notFound, paginate, read, write, type Page } from './client';

export const TONES: readonly TypeTone[] = ['sky', 'ochre', 'moss', 'plum', 'sand', 'slate'];

export type WorkItemTypeInput = Omit<WorkItemType, 'id' | 'archived_at'> & { id?: string; archived_at?: string | null };

export function listWorkItemTypes(): Promise<Page<WorkItemType>> {
  return read(({ db }) => paginate(db.types));
}

export function saveWorkItemType(input: WorkItemTypeInput): Promise<WorkItemType> {
  return write(({ db, me, stamp }) => {
    requireOrgAdmin(me, 'Typen ändern nur Org-Admins.');
    const existing = input.id ? db.types.find((type) => type.id === input.id) : undefined;
    const errors = new FieldErrors();

    const name = input.name.trim();
    if (name === '') errors.add('name', 'Der Name darf nicht leer sein.');
    else if (db.types.some((type) => type.id !== existing?.id && type.name.toLowerCase() === name.toLowerCase())) errors.add('name', 'Diesen Namen gibt es schon.');
    if (input.icon.trim() === '') errors.add('icon', 'Wähle ein Icon.');
    if (!TONES.includes(input.tone)) errors.add('tone', 'Diese Farbe gibt es nicht.');
    const ids = input.properties.map((entry) => entry.property_id);
    if (!ids.every((id) => db.properties.some((property) => property.id === id))) errors.add('properties', 'Mindestens eine Property gibt es nicht.');
    if (new Set(ids).size !== ids.length) errors.add('properties', 'Eine Property ist doppelt zugeordnet.');
    errors.throwIfAny();

    const type: WorkItemType = {
      id: existing?.id ?? newId('t'),
      name,
      icon: input.icon.trim(),
      tone: input.tone,
      description: input.description,
      is_epic: input.is_epic,
      properties: input.properties.map((entry, position) => ({ property_id: entry.property_id, required: entry.required, position })),
      archived_at: input.archived_at === undefined ? (existing?.archived_at ?? null) : input.archived_at === null ? null : (existing?.archived_at ?? stamp),
    };
    if (existing) db.types[db.types.indexOf(existing)] = type;
    else db.types.push(type);
    return type;
  });
}

/** Deletes a type nobody uses; a type with items is archived (`outcome: 'archived'`). */
export function deleteWorkItemType(id: string): Promise<{ outcome: 'deleted' | 'archived' }> {
  return write(({ db, me, stamp }) => {
    requireOrgAdmin(me, 'Typen löschen nur Org-Admins.');
    const type = db.types.find((entry) => entry.id === id);
    if (!type) throw notFound('Der Typ');

    if (db.items.some((item) => item.type_id === id)) {
      type.archived_at = type.archived_at ?? stamp;
      return { outcome: 'archived' as const };
    }
    const asDefault = db.projects.filter((project) => project.default_type_id === id);
    if (asDefault.length > 0) {
      throw conflict('default_type', `Der Typ ist Standardtyp von ${asDefault.map((project) => project.identifier).join(', ')}. Wähle dort zuerst einen anderen.`);
    }
    db.types = db.types.filter((entry) => entry.id !== id);
    db.projects.forEach((project) => (project.enabled_type_ids = project.enabled_type_ids.filter((typeId) => typeId !== id)));
    return { outcome: 'deleted' as const };
  });
}
