/*
 * What a filter condition can say (spec 4.11): the fields with their German names, the operators each kind of field
 * offers, and how values read. Pure data and functions; `ConditionEditor` shows them, `domain/filter.ts` evaluates.
 *
 * Kinds of fields:
 * - enum: one value per item (project, type, status, category, people, priority, parent, single-choice properties).
 *   Operators "ist", "ist nicht" (with several values "ist eines von", "ist keines von") and, where an item can have
 *   no value, "ist leer" / "ist nicht leer". One value is stored as `is`/`is_not`, several as `in`/`not_in`.
 * - list: several values per item (labels, multi-choice properties); the same operators, meaning "hat eines von".
 * - date: "ist", "vor", "nach", "zwischen", "ist leer", "ist nicht leer", and "ist überfällig" for the due date. Values:
 *   a day, `today`, `this_week`, `this_month` or `{ relative: '+7d' }` (days or weeks from today).
 * - flag: yes or no (`is` with true or false).
 * - text: "enthält", "ist", "ist leer", "ist nicht leer" (the title only "enthält").
 * - number: "ist", "größer als", "kleiner als", "zwischen", "ist leer", "ist nicht leer".
 * - rich: rich text, "enthält", "ist leer", "ist nicht leer".
 */

import { formatDay } from '@/components/fields/format';
import type { Condition, ConditionOp, Property } from '@/types';

export type FieldKind = 'enum' | 'list' | 'date' | 'flag' | 'text' | 'number' | 'rich';

/** Where the options of an enum or list field come from. */
export type OptionSource = 'project' | 'type' | 'state' | 'category' | 'person' | 'priority' | 'label' | 'parent' | 'option' | 'member';

export interface FieldDef {
  /** As the filter names it: `state`, `property:customer`. */
  field: string;
  label: string;
  kind: FieldKind;
  source?: OptionSource;
  /** An item can have no value: "ist leer" and "ist nicht leer" make sense. */
  nullable: boolean;
  property?: Property;
}

const core = (field: string, label: string, kind: FieldKind, nullable: boolean, source?: OptionSource): FieldDef => ({ field, label, kind, nullable, source });

/** The fields of every item, in the order the "Filter" menu lists them. */
export const CORE_FIELD_DEFS: FieldDef[] = [
  core('state', 'Status', 'enum', false, 'state'),
  core('state_category', 'Kategorie', 'enum', false, 'category'),
  core('assignee', 'Assignee', 'enum', true, 'person'),
  core('priority', 'Priorität', 'enum', false, 'priority'),
  core('label', 'Label', 'list', true, 'label'),
  core('type', 'Typ', 'enum', false, 'type'),
  core('project', 'Projekt', 'enum', false, 'project'),
  core('due_date', 'Due-Date', 'date', true),
  core('start_date', 'Start-Date', 'date', true),
  core('created_by', 'Ersteller', 'enum', false, 'person'),
  core('created_at', 'Angelegt', 'date', false),
  core('updated_at', 'Geändert', 'date', false),
  core('closed_at', 'Geschlossen', 'date', true),
  core('parent', 'Eltern-Item', 'enum', true, 'parent'),
  core('has_children', 'Hat Kind-Items', 'flag', false),
  core('blocked', 'Blockiert', 'flag', false),
  core('blocking', 'Blockiert andere', 'flag', false),
  core('archived', 'Archiviert', 'flag', false),
  core('title', 'Titel', 'text', false),
];

export const PROPERTY_PREFIX = 'property:';

/** The condition field of a property and how it is filtered. */
export function propertyFieldDef(property: Property): FieldDef {
  const field = `${PROPERTY_PREFIX}${property.key}`;
  const base = { field, label: property.label, nullable: true, property };
  switch (property.field_type) {
    case 'dropdown':
      return { ...base, kind: property.settings.multiple ? 'list' : 'enum', source: 'option' };
    case 'member':
      return { ...base, kind: property.settings.multiple ? 'list' : 'enum', source: 'member' };
    case 'date':
      return { ...base, kind: 'date' };
    case 'boolean':
      return { ...base, kind: 'flag', nullable: false };
    case 'number':
      return { ...base, kind: 'number' };
    case 'rich_text':
      return { ...base, kind: 'rich' };
    case 'text':
    case 'url':
      return { ...base, kind: 'text' };
  }
}

/** The definition behind a condition's field; null for a field the filter bar does not know. */
export function fieldDef(field: string, properties: readonly Property[]): FieldDef | null {
  const known = CORE_FIELD_DEFS.find((def) => def.field === field);
  if (known) return known;
  if (!field.startsWith(PROPERTY_PREFIX)) return null;
  const property = properties.find((entry) => `${PROPERTY_PREFIX}${entry.key}` === field);
  return property ? propertyFieldDef(property) : null;
}

/* --------------------------------------------------------------------------- operators */

const POSITIVE = new Set<ConditionOp>(['is', 'in']);
const NEGATIVE = new Set<ConditionOp>(['is_not', 'not_in']);
/** Operators without a value. */
export const VALUELESS = new Set<ConditionOp>(['is_empty', 'is_not_empty', 'overdue']);

/** The operators a field offers, in the order of the operator menu. `in` stands for "ist" (one or several values). */
export function operatorsFor(def: FieldDef): ConditionOp[] {
  const empties: ConditionOp[] = def.nullable ? ['is_empty', 'is_not_empty'] : [];
  switch (def.kind) {
    case 'enum':
    case 'list':
      return ['in', 'not_in', ...empties];
    case 'date':
      return ['is', 'before', 'after', 'between', ...empties, ...(def.field === 'due_date' ? (['overdue'] as ConditionOp[]) : [])];
    case 'flag':
      return ['is'];
    case 'text':
      return def.field === 'title' ? ['contains'] : ['contains', 'is', ...empties];
    case 'number':
      return ['is', 'gt', 'lt', 'between', ...empties];
    case 'rich':
      return ['contains', ...empties];
  }
}

/** The operator as the condition reads it; "ist eines von" once there are several values. */
export function operatorLabel(op: ConditionOp, count = 1): string {
  switch (op) {
    case 'is':
      return 'ist';
    case 'in':
      return count > 1 ? 'ist eines von' : 'ist';
    case 'is_not':
      return 'ist nicht';
    case 'not_in':
      return count > 1 ? 'ist keines von' : 'ist nicht';
    case 'is_empty':
      return 'ist leer';
    case 'is_not_empty':
      return 'ist nicht leer';
    case 'before':
      return 'vor';
    case 'after':
      return 'nach';
    case 'between':
      return 'zwischen';
    case 'contains':
      return 'enthält';
    case 'gt':
      return 'größer als';
    case 'lt':
      return 'kleiner als';
    case 'overdue':
      return 'ist überfällig';
  }
}

/** The same operator for the menu: positive or negative, whatever the number of values. */
export function operatorFamily(op: ConditionOp): ConditionOp {
  if (POSITIVE.has(op)) return 'in';
  if (NEGATIVE.has(op)) return 'not_in';
  return op;
}

/* ------------------------------------------------------------------------------ values */

/** The values of an enum or list condition, always as a list. */
export function valuesOf(condition: Condition): unknown[] {
  const { value } = condition;
  if (Array.isArray(value)) return value;
  return value === undefined || value === null ? [] : [value];
}

/** An enum or list condition with other values: one is stored as `is`/`is_not`, several as `in`/`not_in`. */
export function withValues(condition: Condition, values: unknown[]): Condition {
  const negative = NEGATIVE.has(condition.op);
  if (values.length === 1) return { field: condition.field, op: negative ? 'is_not' : 'is', value: values[0] };
  return { field: condition.field, op: negative ? 'not_in' : 'in', value: values };
}

/** The pair of a `between`, from a single value or a pair. */
const pairOf = (value: unknown): [unknown, unknown] => (Array.isArray(value) ? [value[0] ?? null, value[1] ?? null] : [value ?? null, value ?? null]);

/** The condition with another operator; the value stays where it still fits. */
export function withOperator(condition: Condition, op: ConditionOp, def: FieldDef): Condition {
  const { field, value } = condition;
  if (VALUELESS.has(op)) return { field, op };
  if (def.kind === 'enum' || def.kind === 'list') {
    const values = VALUELESS.has(condition.op) ? [] : valuesOf(condition);
    return withValues({ field, op: op === 'in' ? 'is' : 'is_not' }, values);
  }
  if (def.kind === 'flag') return { field, op: 'is', value: typeof value === 'boolean' ? value : true };
  if (VALUELESS.has(condition.op)) return { field, op, value: op === 'between' ? [null, null] : undefined };
  if (op === 'between') return { field, op, value: pairOf(value) };
  return { field, op, value: Array.isArray(value) ? value[0] : value };
}

/** A new condition for a field, as the "Filter" menu adds it: a flag is complete at once, the rest waits for a value. */
export function newCondition(def: FieldDef): Condition {
  switch (def.kind) {
    case 'flag':
      return { field: def.field, op: 'is', value: true };
    case 'enum':
    case 'list':
      return { field: def.field, op: 'in', value: [] };
    case 'text':
    case 'rich':
      return { field: def.field, op: 'contains', value: '' };
    case 'date':
    case 'number':
      return { field: def.field, op: 'is' };
  }
}

const present = (value: unknown) => value !== undefined && value !== null && value !== '';

/** Whether the condition says something: it has the value(s) its operator needs. */
export function isComplete(condition: Condition): boolean {
  if (VALUELESS.has(condition.op)) return true;
  if (POSITIVE.has(condition.op) || NEGATIVE.has(condition.op)) {
    // a flag's `is false` is a value too
    return typeof condition.value === 'boolean' || valuesOf(condition).length > 0;
  }
  if (condition.op === 'between') return Array.isArray(condition.value) && condition.value.length === 2 && condition.value.every(present);
  if (condition.op === 'contains') return typeof condition.value === 'string' && condition.value.trim() !== '';
  return present(condition.value);
}

/* ----------------------------------------------------------------------- dynamic dates */

const RELATIVE = /^([+-]?)(\d{1,5})([dw])$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** `{ relative: '+7d' }` split up: +7 days. Null for anything else. */
export function readRelative(value: unknown): { amount: number; unit: 'd' | 'w' } | null {
  if (typeof value !== 'object' || value === null || !('relative' in value) || typeof value.relative !== 'string') return null;
  const match = RELATIVE.exec(value.relative);
  if (!match) return null;
  return { amount: Number(match[2]) * (match[1] === '-' ? -1 : 1), unit: match[3] as 'd' | 'w' };
}

/** +7 days as a value: `{ relative: '+7d' }`. */
export const relativeValue = (amount: number, unit: 'd' | 'w') => ({ relative: `${amount < 0 ? '-' : '+'}${Math.abs(Math.trunc(amount))}${unit}` });

/** A date value in words: "heute", "diese Woche", "heute + 7 Tage", "31.10.2026". */
export function dateValueLabel(value: unknown): string {
  if (value === 'today') return 'heute';
  if (value === 'this_week') return 'diese Woche';
  if (value === 'this_month') return 'dieser Monat';
  if (typeof value === 'string' && DAY.test(value)) return formatDay(value);
  const relative = readRelative(value);
  if (relative) {
    if (relative.amount === 0) return 'heute';
    const count = Math.abs(relative.amount);
    const unit = relative.unit === 'd' ? (count === 1 ? 'Tag' : 'Tage') : count === 1 ? 'Woche' : 'Wochen';
    return `heute ${relative.amount > 0 ? '+' : '−'} ${count} ${unit}`;
  }
  return 'Datum wählen …';
}

/** A number in German, as typed: "3,5", "-2", "1.500" (a point groups thousands). Null when it is no number. */
export function parseGermanNumber(text: string): number | null {
  const trimmed = text.trim();
  const match = /^(-?)(\d{1,3}(?:\.\d{3})+|\d+)(?:,(\d+))?$/.exec(trimmed);
  if (!match) return null;
  const [, sign, whole, fraction] = match;
  return Number(`${sign}${whole.replaceAll('.', '')}.${fraction ?? '0'}`);
}
