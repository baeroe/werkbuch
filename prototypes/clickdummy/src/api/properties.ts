/*
 * Properties (spec 4.7). They live in the organisation and are assigned to types. The key and the field type are
 * fixed once saved (only single → multiple choice may change); options that items use are archived, not deleted.
 */

import type { Property, PropertyOption } from '@/types';
import { requireOrgAdmin } from './access';
import { clone, FieldErrors, newId, notFound, paginate, read, write, type Page } from './client';
import type { Db } from './db';

const KEY_PATTERN = /^[a-z][a-z0-9_]{0,39}$/;
/** Names the core fields of a work item go by: a property key must not look like one of them. */
const CORE_KEYS = new Set([
  'id', 'key', 'project', 'type', 'title', 'description', 'state', 'state_category', 'resolution', 'assignee', 'priority',
  'label', 'labels', 'start_date', 'due_date', 'parent', 'created_by', 'created_at', 'updated_at', 'started_at', 'closed_at',
  'archived', 'archived_at', 'rank',
]);

export type PropertyInput = Omit<Property, 'id' | 'options'> & {
  id?: string;
  options: (Omit<PropertyOption, 'id' | 'archived_at'> & { id?: string; archived_at?: string | null })[];
};

export function listProperties(): Promise<Page<Property>> {
  return read(({ db }) => paginate(db.properties));
}

function optionInUse(db: Db, key: string, optionId: string): boolean {
  return db.items.some((item) => {
    const value = item.values[key];
    return value === optionId || (Array.isArray(value) && value.includes(optionId));
  });
}

export function saveProperty(input: PropertyInput): Promise<Property> {
  return write(({ db, me, stamp }) => {
    requireOrgAdmin(me, 'Properties ändern nur Org-Admins.');
    const existing = input.id ? db.properties.find((property) => property.id === input.id) : undefined;
    const errors = new FieldErrors();

    if (input.label.trim() === '') errors.add('label', 'Das Label darf nicht leer sein.');
    if (existing) {
      if (input.key !== existing.key) errors.add('key', 'Der Schlüssel lässt sich nicht mehr ändern.');
      if (input.field_type !== existing.field_type) errors.add('field_type', 'Der Feldtyp lässt sich nicht mehr ändern.');
      if (existing.settings.multiple && !input.settings.multiple) errors.add('settings', 'Von Mehrfach- auf Einfachauswahl lässt sich nicht zurückwechseln.');
    } else {
      if (!KEY_PATTERN.test(input.key)) errors.add('key', 'Der Schlüssel besteht aus Kleinbuchstaben, Ziffern und _ und beginnt mit einem Buchstaben.');
      else if (CORE_KEYS.has(input.key)) errors.add('key', 'Der Schlüssel gehört einem Kernfeld.');
      else if (db.properties.some((property) => property.key === input.key)) errors.add('key', 'Diesen Schlüssel gibt es schon.');
    }
    if (input.field_type === 'number' && input.settings.decimals !== undefined && !(Number.isInteger(input.settings.decimals) && input.settings.decimals >= 0 && input.settings.decimals <= 4)) {
      errors.add('settings', 'Nachkommastellen: 0 bis 4.');
    }
    if (input.field_type === 'dropdown' && input.options.filter((option) => !option.archived_at).length === 0) {
      errors.add('options', 'Ein Dropdown braucht mindestens eine Option.');
    }
    if (input.options.some((option) => option.label.trim() === '')) errors.add('options', 'Jede Option braucht ein Label.');
    errors.throwIfAny();

    const key = existing?.key ?? input.key;
    const options: PropertyOption[] = input.options.map((option, position) => ({
      id: option.id ?? newId('opt'),
      label: option.label.trim(),
      color: option.color,
      position,
      archived_at: option.archived_at ?? null,
    }));
    // options a client leaves out: used ones are archived, unused ones vanish
    for (const old of existing?.options ?? []) {
      if (!options.some((option) => option.id === old.id) && optionInUse(db, key, old.id)) {
        options.push({ ...old, position: options.length, archived_at: old.archived_at ?? stamp });
      }
    }

    const property: Property = {
      id: existing?.id ?? `pr_${key}`,
      key,
      label: input.label.trim(),
      field_type: existing?.field_type ?? input.field_type,
      help: input.help,
      default_value: clone(input.default_value),
      settings: clone(input.settings),
      options,
    };
    if (existing) db.properties[db.properties.indexOf(existing)] = property;
    else db.properties.push(property);
    return property;
  });
}

/** Deletes a property: its values vanish from the items (the history keeps them). Answers how many items had one. */
export function deleteProperty(id: string): Promise<{ affected_items: number }> {
  return write(({ db, me }) => {
    requireOrgAdmin(me, 'Properties löschen nur Org-Admins.');
    const property = db.properties.find((entry) => entry.id === id);
    if (!property) throw notFound('Die Property');

    let affected = 0;
    for (const item of db.items) {
      if (property.key in item.values) {
        delete item.values[property.key];
        affected += 1;
      }
    }
    db.types.forEach((type) => (type.properties = type.properties.filter((entry) => entry.property_id !== id)));
    db.templates.forEach((template) => delete template.payload.values[property.key]);
    db.views.forEach((view) => {
      const field = `property:${property.key}`;
      view.filter.conditions = view.filter.conditions.filter((condition) => condition.field !== field);
      view.display.fields = view.display.fields.filter((entry) => entry !== field);
      if (view.display.sort.field === field) view.display.sort = { field: 'rank', direction: 'asc' };
    });
    db.properties = db.properties.filter((entry) => entry.id !== id);
    return { affected_items: affected };
  });
}
