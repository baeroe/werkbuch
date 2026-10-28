/*
 * The catalogs of the organisation: labels, relation types and resolutions (spec 4.7, 4.9). Only org admins change
 * them. Resolutions that items carry are archived instead of deleted.
 */

import type { Label, RelationType, Resolution } from '@/types';
import { requireOrgAdmin } from './access';
import { conflict, FieldErrors, newId, notFound, paginate, read, write, type Page } from './client';
import { TONES } from './workItemTypes';

type SaveInput<T extends { id: string }> = Omit<T, 'id'> & { id?: string };

const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/* ----------------------------------------------------------------------- labels */

export function listLabels(): Promise<Page<Label>> {
  return read(({ db }) => paginate(db.labels));
}

export function saveLabel(input: SaveInput<Label>): Promise<Label> {
  return write(({ db, me }) => {
    requireOrgAdmin(me, 'Labels ändern nur Org-Admins.');
    const existing = input.id ? db.labels.find((label) => label.id === input.id) : undefined;
    const errors = new FieldErrors();
    if (input.name.trim() === '') errors.add('name', 'Der Name darf nicht leer sein.');
    else if (db.labels.some((label) => label.id !== existing?.id && sameName(label.name, input.name))) errors.add('name', 'Diesen Namen gibt es schon.');
    if (!TONES.includes(input.color)) errors.add('color', 'Diese Farbe gibt es nicht.');
    errors.throwIfAny();

    const label: Label = { id: existing?.id ?? newId('lb'), name: input.name.trim(), color: input.color };
    if (existing) db.labels[db.labels.indexOf(existing)] = label;
    else db.labels.push(label);
    return label;
  });
}

/** Deletes a label and takes it off all items. Answers how many items had it. */
export function deleteLabel(id: string): Promise<{ affected_items: number }> {
  return write(({ db, me }) => {
    requireOrgAdmin(me, 'Labels löschen nur Org-Admins.');
    if (!db.labels.some((label) => label.id === id)) throw notFound('Das Label');
    let affected = 0;
    for (const item of db.items) {
      if (item.label_ids.includes(id)) {
        item.label_ids = item.label_ids.filter((labelId) => labelId !== id);
        affected += 1;
      }
    }
    db.templates.forEach((template) => (template.payload.label_ids = template.payload.label_ids.filter((labelId) => labelId !== id)));
    db.labels = db.labels.filter((label) => label.id !== id);
    return { affected_items: affected };
  });
}

/* --------------------------------------------------------------- relation types */

export function listRelationTypes(): Promise<Page<RelationType>> {
  return read(({ db }) => paginate(db.relation_types));
}

export function saveRelationType(input: SaveInput<RelationType>): Promise<RelationType> {
  return write(({ db, me }) => {
    requireOrgAdmin(me, 'Relationstypen ändern nur Org-Admins.');
    const existing = input.id ? db.relation_types.find((type) => type.id === input.id) : undefined;
    const errors = new FieldErrors();
    if (input.name.trim() === '') errors.add('name', 'Der Name darf nicht leer sein.');
    else if (db.relation_types.some((type) => type.id !== existing?.id && sameName(type.name, input.name))) errors.add('name', 'Diesen Namen gibt es schon.');
    if (input.outward_label.trim() === '') errors.add('outward_label', 'Beschrifte die Richtung.');
    if (input.inward_label !== null && input.inward_label.trim() === '') errors.add('inward_label', 'Beschrifte die Gegenrichtung oder lasse die Relation symmetrisch.');
    errors.throwIfAny();

    const type: RelationType = {
      id: existing?.id ?? newId('rt'),
      name: input.name.trim(),
      outward_label: input.outward_label.trim(),
      inward_label: input.inward_label === null ? null : input.inward_label.trim(),
      built_in: existing?.built_in ?? null,
    };
    if (existing) db.relation_types[db.relation_types.indexOf(existing)] = type;
    else db.relation_types.push(type);
    return type;
  });
}

/** Deletes a relation type of your own (the three built-in ones stay) together with its relations. */
export function deleteRelationType(id: string): Promise<{ affected_relations: number }> {
  return write(({ db, me }) => {
    requireOrgAdmin(me, 'Relationstypen löschen nur Org-Admins.');
    const type = db.relation_types.find((entry) => entry.id === id);
    if (!type) throw notFound('Der Relationstyp');
    if (type.built_in !== null) throw conflict('built_in', `„${type.name}“ ist mitgeliefert und lässt sich nicht löschen.`);
    const affected = db.relations.filter((relation) => relation.type_id === id).length;
    db.relations = db.relations.filter((relation) => relation.type_id !== id);
    db.relation_types = db.relation_types.filter((entry) => entry.id !== id);
    return { affected_relations: affected };
  });
}

/* ------------------------------------------------------------------ resolutions */

export function listResolutions(): Promise<Page<Resolution>> {
  return read(({ db }) => paginate([...db.resolutions].sort((a, b) => a.position - b.position)));
}

export function saveResolution(input: SaveInput<Resolution>): Promise<Resolution> {
  return write(({ db, me, stamp }) => {
    requireOrgAdmin(me, 'Resolutions ändern nur Org-Admins.');
    const existing = input.id ? db.resolutions.find((resolution) => resolution.id === input.id) : undefined;
    const errors = new FieldErrors();
    if (input.label.trim() === '') errors.add('label', 'Das Label darf nicht leer sein.');
    else if (db.resolutions.some((resolution) => resolution.id !== existing?.id && sameName(resolution.label, input.label))) errors.add('label', 'Diesen Namen gibt es schon.');
    if (input.default_for !== null && input.archived_at) errors.add('archived_at', 'Ein Standard lässt sich nicht archivieren.');
    errors.throwIfAny();

    const resolution: Resolution = {
      id: existing?.id ?? newId('res'),
      label: input.label.trim(),
      default_for: input.default_for,
      position: existing?.position ?? db.resolutions.length,
      archived_at: input.archived_at ? (existing?.archived_at ?? stamp) : null,
    };
    // only one default per category
    if (resolution.default_for !== null) {
      for (const other of db.resolutions) if (other.id !== resolution.id && other.default_for === resolution.default_for) other.default_for = null;
    }
    if (existing) db.resolutions[db.resolutions.indexOf(existing)] = resolution;
    else db.resolutions.push(resolution);
    return resolution;
  });
}

/** Deletes an unused resolution; one that items carry is archived. A default cannot go. */
export function deleteResolution(id: string): Promise<{ outcome: 'deleted' | 'archived' }> {
  return write(({ db, me, stamp }) => {
    requireOrgAdmin(me, 'Resolutions löschen nur Org-Admins.');
    const resolution = db.resolutions.find((entry) => entry.id === id);
    if (!resolution) throw notFound('Die Resolution');
    if (resolution.default_for !== null) throw conflict('is_default', `„${resolution.label}“ ist der Standard für ${resolution.default_for === 'completed' ? 'Completed' : 'Canceled'}. Bestimme zuerst einen anderen.`);

    if (db.items.some((item) => item.resolution_id === id)) {
      resolution.archived_at = resolution.archived_at ?? stamp;
      return { outcome: 'archived' as const };
    }
    db.resolutions = db.resolutions.filter((entry) => entry.id !== id);
    return { outcome: 'deleted' as const };
  });
}
