/*
 * Property values (spec 4.7): checks what a client sends for the properties of a work item type, field by field, and
 * answers the values to store. Errors are collected as `values.<key>`, so the UI can mark the field.
 */

import { parseDate } from '@/domain/tz';
import { isBlankDoc } from '@/lib/richtext';
import type { Project, Property, PropertyValue, RichText, WorkItemType } from '@/types';
import { canBeAssigned } from './access';
import { clone, FieldErrors } from './client';
import type { Db } from './db';
import { propertiesOfType } from './lookup';

export function isEmptyValue(value: PropertyValue | undefined): boolean {
  if (value === undefined || value === null) return true;
  if (typeof value === 'string') return value.trim() === '';
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === 'object') return isBlankDoc(value as RichText);
  return false; // numbers and booleans are never empty
}

const MAX_TEXT = 255;

type Normalized = { value: PropertyValue } | { error: string };

const ok = (value: PropertyValue): Normalized => ({ value });
const fail = (error: string): Normalized => ({ error });

/** The value to store for one property, or an error message in German. */
function normalize(db: Db, project: Project, property: Property, value: PropertyValue, current: PropertyValue | undefined): Normalized {
  const label = `„${property.label}“`;

  switch (property.field_type) {
    case 'text':
      if (typeof value !== 'string') return fail(`${label} erwartet einen Text.`);
      return value.trim().length > MAX_TEXT ? fail(`${label} darf höchstens ${MAX_TEXT} Zeichen haben.`) : ok(value.trim());

    case 'number': {
      const parsed = typeof value === 'string' ? Number(value.replace(',', '.')) : value;
      if (typeof parsed !== 'number' || !Number.isFinite(parsed)) return fail(`${label} erwartet eine Zahl.`);
      const factor = 10 ** (property.settings.decimals ?? 0);
      return ok(Math.round(parsed * factor) / factor);
    }

    case 'dropdown': {
      const ids = Array.isArray(value) ? value : [value];
      const known = new Set(property.options.filter((option) => option.archived_at === null).map((option) => option.id));
      const kept = new Set(Array.isArray(current) ? current : [current]);
      if (!ids.every((id) => typeof id === 'string' && (known.has(id) || kept.has(id)))) return fail(`${label}: Diese Auswahl gibt es nicht.`);
      if (property.settings.multiple) return ok([...(ids as string[])]);
      return Array.isArray(value) ? fail(`${label} erlaubt genau eine Auswahl.`) : ok(value);
    }

    case 'boolean':
      return typeof value === 'boolean' ? ok(value) : fail(`${label} erwartet Ja oder Nein.`);

    case 'date':
      return typeof value === 'string' && parseDate(value) ? ok(value) : fail(`${label} erwartet ein Datum (JJJJ-MM-TT).`);

    case 'member': {
      const ids = Array.isArray(value) ? value : [value];
      const kept = new Set(Array.isArray(current) ? current : [current]);
      const fine = ids.every((id) => {
        if (typeof id !== 'string') return false;
        const user = db.users.find((entry) => entry.id === id);
        return kept.has(id) ? user !== undefined : canBeAssigned(db, user, project);
      });
      if (!fine) return fail(`${label}: Diese Person hat keinen Zugriff auf das Projekt.`);
      return property.settings.multiple ? ok([...(ids as string[])]) : Array.isArray(value) ? fail(`${label} erlaubt genau eine Person.`) : ok(value);
    }

    case 'rich_text':
      return typeof value === 'object' && value !== null && !Array.isArray(value) ? ok(clone(value)) : fail(`${label} erwartet einen Text.`);

    case 'url': {
      if (typeof value !== 'string') return fail(`${label} erwartet eine Adresse.`);
      try {
        const url = new URL(value.trim());
        return url.protocol === 'http:' || url.protocol === 'https:' ? ok(value.trim()) : fail(`${label} muss mit http:// oder https:// beginnen.`);
      } catch {
        return fail(`${label} ist keine gültige Adresse.`);
      }
    }
  }
}

/**
 * Merges the values a client sends into the existing ones and checks them against the type.
 * - Empty values remove the property; a required property cannot be emptied, and when creating it must be filled.
 * - A property the type does not have is refused.
 * Throws a 422 with an entry `values.<key>` per problem.
 */
export function checkValues(
  db: Db,
  project: Project,
  type: WorkItemType,
  input: Record<string, PropertyValue>,
  existing: Record<string, PropertyValue>,
  mode: 'create' | 'update',
): Record<string, PropertyValue> {
  const errors = new FieldErrors();
  const properties = new Map(propertiesOfType(db, type).map(({ property, required }) => [property.key, { property, required }]));
  const values: Record<string, PropertyValue> = { ...existing };

  for (const [key, raw] of Object.entries(input)) {
    const entry = properties.get(key);
    if (!entry) {
      errors.add(`values.${key}`, `„${key}“ gehört nicht zum Typ ${type.name}.`);
      continue;
    }
    if (isEmptyValue(raw)) {
      if (entry.required && (mode === 'create' || !isEmptyValue(existing[key]))) {
        errors.add(`values.${key}`, `„${entry.property.label}“ ist ein Pflichtfeld.`);
      } else {
        delete values[key];
      }
      continue;
    }
    const result = normalize(db, project, entry.property, raw, existing[key]);
    if ('error' in result) errors.add(`values.${key}`, result.error);
    else values[key] = result.value;
  }

  if (mode === 'create') {
    for (const [key, { property, required }] of properties) {
      if (required && isEmptyValue(values[key]) && !errors.has(`values.${key}`)) {
        errors.add(`values.${key}`, `„${property.label}“ ist ein Pflichtfeld.`);
      }
    }
  }
  errors.throwIfAny();
  return values;
}
