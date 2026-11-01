/*
 * What a filter condition can say (spec 4.11, plan table "Filter-Schema"), ported from the clickdummy's `fieldOps.ts`:
 * the fields with their names, the operators each field offers, and how values read. Pure data and functions; the
 * chips (`ConditionChip`) show them, the server evaluates them (P1).
 *
 * The kinds are those of the server (`App\Domain\Filter\FieldKind`), and so are the operators: `operatorsFor` answers
 * the list `Field::ops()` answers for the same field, and both are held against `operators.json` (K33). The menu of a
 * chip offers them in families: "ist" stands for `is`, `in` (and `contains` of a list), "ist nicht" for `is_not` and
 * `not_in`; one value is stored as `is`/`is_not`, several as `in`/`not_in`.
 *
 * Values: ULIDs (and `me` where the field takes the reader), words (category, priority), days (`YYYY-MM-DD`, `today`,
 * `this_week`, `this_month`, `{ relative: '+7d' }`), yes or no, text and numbers.
 */

import { formatDay } from '@/components/fields/format';
import { t, tn, type TranslationKey } from '@/lib/i18n';
import type { Condition, ConditionOp, Property } from '@/types';

export type FieldKind = 'id' | 'enum' | 'list' | 'date' | 'stamp' | 'flag' | 'text' | 'number' | 'rich';

/** Where the options of an id, enum or list field come from. */
export type OptionSource = 'project' | 'type' | 'state' | 'category' | 'person' | 'priority' | 'label' | 'parent' | 'option' | 'member';

export interface FieldDef {
  /** As the filter names it: `state`, `property:customer`. */
  field: string;
  /** The name of a core field; a property has its own label. */
  labelKey?: TranslationKey;
  kind: FieldKind;
  source?: OptionSource;
  /** An item can have no value: "ist leer" and "ist nicht leer" mean something. */
  nullable: boolean;
  /** The field takes `me`, the reader ("Ich"). */
  acceptsMe: boolean;
  property?: Property;
}

const core = (field: string, labelKey: TranslationKey, kind: FieldKind, nullable: boolean, source?: OptionSource): FieldDef => ({
  field,
  labelKey,
  kind,
  nullable,
  acceptsMe: field === 'assignee' || field === 'created_by',
  ...(source && { source }),
});

/** The fields of every item, in the order the "Filter" menu lists them. */
export const CORE_FIELD_DEFS: readonly FieldDef[] = [
  core('state', 'items.filter.field.state', 'id', false, 'state'),
  core('state_category', 'items.filter.field.state_category', 'enum', false, 'category'),
  core('assignee', 'items.filter.field.assignee', 'id', true, 'person'),
  core('priority', 'items.filter.field.priority', 'enum', false, 'priority'),
  core('label', 'items.filter.field.label', 'list', true, 'label'),
  core('type', 'items.filter.field.type', 'id', false, 'type'),
  core('project', 'items.filter.field.project', 'id', false, 'project'),
  core('due_date', 'items.filter.field.due_date', 'date', true),
  core('start_date', 'items.filter.field.start_date', 'date', true),
  core('created_by', 'items.filter.field.created_by', 'id', false, 'person'),
  core('created_at', 'items.filter.field.created_at', 'stamp', false),
  core('updated_at', 'items.filter.field.updated_at', 'stamp', false),
  core('closed_at', 'items.filter.field.closed_at', 'stamp', true),
  core('parent', 'items.filter.field.parent', 'id', true, 'parent'),
  core('has_children', 'items.filter.field.has_children', 'flag', false),
  core('blocked', 'items.filter.field.blocked', 'flag', false),
  core('blocking', 'items.filter.field.blocking', 'flag', false),
  core('archived', 'items.filter.field.archived', 'flag', false),
  core('epic', 'items.filter.field.epic', 'flag', false),
  core('subscribed', 'items.filter.field.subscribed', 'flag', false),
  core('title', 'items.filter.field.title', 'text', false),
];

export const PROPERTY_PREFIX = 'property:';

/** The condition field of a property and how it is filtered; every property but yes or no can be empty. */
export function propertyFieldDef(property: Property): FieldDef {
  const base = { field: `${PROPERTY_PREFIX}${property.key}`, nullable: true, acceptsMe: false, property };
  const multiple = property.settings.multiple === true;
  switch (property.field_type) {
    case 'dropdown':
      return { ...base, kind: multiple ? 'list' : 'id', source: 'option' };
    case 'member':
      return { ...base, kind: multiple ? 'list' : 'id', source: 'member', acceptsMe: true };
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

/** The definition behind a condition's field; null for a field the filter bar does not know (a property that is gone). */
export function fieldDef(field: string, properties: readonly Property[]): FieldDef | null {
  const known = CORE_FIELD_DEFS.find((def) => def.field === field);
  if (known) return known;
  if (!field.startsWith(PROPERTY_PREFIX)) return null;
  const property = properties.find((entry) => `${PROPERTY_PREFIX}${entry.key}` === field);
  return property ? propertyFieldDef(property) : null;
}

/** The name of a field: "Status", or the label of a property. */
export const fieldLabel = (def: FieldDef): string => def.property?.label ?? t(def.labelKey!);

/* --------------------------------------------------------------------------- operators */

const NEGATIVE = new Set<ConditionOp>(['is_not', 'not_in']);
/** Operators without a value. */
export const VALUELESS = new Set<ConditionOp>(['is_empty', 'is_not_empty', 'overdue']);

/** Fields with values to choose from a list: one, a word, or several. */
export const isChoice = (kind: FieldKind): boolean => kind === 'id' || kind === 'enum' || kind === 'list';

const CHOICES: ConditionOp[] = ['is', 'is_not', 'in', 'not_in'];
const EMPTIES: ConditionOp[] = ['is_empty', 'is_not_empty'];
const DAYS: ConditionOp[] = ['is', 'before', 'after', 'between'];

/** Every operator of a kind, as `FieldKind::ops()` lists them. */
const KIND_OPS: Record<FieldKind, ConditionOp[]> = {
  id: [...CHOICES, ...EMPTIES],
  enum: CHOICES,
  list: [...CHOICES, ...EMPTIES, 'contains'],
  date: [...DAYS, ...EMPTIES, 'overdue'],
  stamp: [...DAYS, ...EMPTIES],
  flag: ['is'],
  text: ['contains', 'is', ...EMPTIES],
  number: ['is', 'gt', 'lt', 'between', ...EMPTIES],
  rich: ['contains', ...EMPTIES],
};

/**
 * The operators the server takes for a field, as `Field::ops()` narrows those of its kind: the empty checks only where
 * an item can have no value, "ist überfällig" only for the due date, the title only "enthält".
 */
export function operatorsFor(def: FieldDef): ConditionOp[] {
  return KIND_OPS[def.kind].filter((op) => {
    if (def.field === 'title') return op === 'contains';
    if (op === 'overdue') return def.field === 'due_date';
    if (VALUELESS.has(op)) return def.nullable;
    return true;
  });
}

/** The operator as the menu offers it: "ist" or "ist nicht" for a choice, whatever the number of values. */
export function operatorFamily(op: ConditionOp, kind: FieldKind): ConditionOp {
  if (!isChoice(kind)) return op;
  if (NEGATIVE.has(op)) return 'not_in';
  return VALUELESS.has(op) ? op : 'in';
}

/** The entries of a chip's operator menu, in the order of `operatorsFor`. */
export function menuOperators(def: FieldDef): ConditionOp[] {
  return [...new Set(operatorsFor(def).map((op) => operatorFamily(op, def.kind)))];
}

const OPERATOR_KEYS: Record<ConditionOp, TranslationKey> = {
  is: 'items.filter.op.is',
  in: 'items.filter.op.is',
  is_not: 'items.filter.op.is_not',
  not_in: 'items.filter.op.is_not',
  is_empty: 'items.filter.op.is_empty',
  is_not_empty: 'items.filter.op.is_not_empty',
  before: 'items.filter.op.before',
  after: 'items.filter.op.after',
  between: 'items.filter.op.between',
  contains: 'items.filter.op.contains',
  gt: 'items.filter.op.gt',
  lt: 'items.filter.op.lt',
  overdue: 'items.filter.op.overdue',
};

/** The key of the operator's words; "ist eines von" and "ist keines von" once there are several values. */
export function operatorLabelKey(op: ConditionOp, count = 1): TranslationKey {
  if (count > 1 && (op === 'in' || op === 'contains')) return 'items.filter.op.in';
  if (count > 1 && op === 'not_in') return 'items.filter.op.not_in';
  return OPERATOR_KEYS[op];
}

/* ------------------------------------------------------------------------------ values */

/** The values of a choice, always as a list. */
export function valuesOf(condition: Condition): unknown[] {
  const { value } = condition;
  if (Array.isArray(value)) return value;
  return value === undefined || value === null ? [] : [value];
}

/** A choice with other values: one is stored as `is`/`is_not`, several (or none yet) as `in`/`not_in`. */
export function withValues(condition: Condition, values: unknown[]): Condition {
  const negative = NEGATIVE.has(condition.op);
  if (values.length === 1) return { field: condition.field, op: negative ? 'is_not' : 'is', value: values[0] };
  return { field: condition.field, op: negative ? 'not_in' : 'in', value: values };
}

/** The pair of a `between`, from a single value or a pair. */
const pairOf = (value: unknown): [unknown, unknown] => (Array.isArray(value) ? [value[0] ?? null, value[1] ?? null] : [value ?? null, value ?? null]);

/** The condition with another operator (as the menu names it); the value stays where it still fits. */
export function withOperator(condition: Condition, op: ConditionOp, def: FieldDef): Condition {
  const { field, value } = condition;
  if (VALUELESS.has(op)) return { field, op };
  if (isChoice(def.kind)) {
    const values = VALUELESS.has(condition.op) ? [] : valuesOf(condition);
    return withValues({ field, op: op === 'not_in' || op === 'is_not' ? 'is_not' : 'is' }, values);
  }
  if (def.kind === 'flag') return { field, op: 'is', value: typeof value === 'boolean' ? value : true };
  if (VALUELESS.has(condition.op)) return op === 'between' ? { field, op, value: [null, null] } : { field, op };
  if (op === 'between') return { field, op, value: pairOf(value) };
  const single = Array.isArray(value) ? value[0] : value;
  return single === undefined || single === null ? { field, op } : { field, op, value: single };
}

/** A new condition for a field, as the "Filter" menu adds it: a flag is complete at once, the rest waits for a value. */
export function newCondition(def: FieldDef): Condition {
  switch (def.kind) {
    case 'flag':
      return { field: def.field, op: 'is', value: true };
    case 'id':
    case 'enum':
    case 'list':
      return { field: def.field, op: 'in', value: [] };
    case 'text':
    case 'rich':
      return { field: def.field, op: 'contains', value: '' };
    case 'date':
    case 'stamp':
    case 'number':
      return { field: def.field, op: 'is' };
  }
}

/** A value at all: not missing, and no text of blanks only (the server takes no empty text). */
const present = (value: unknown) => value !== undefined && value !== null && !(typeof value === 'string' && value.trim() === '');

/** Whether the condition says something: it has the value(s) its operator needs. Only those go to the server. */
export function isComplete(condition: Condition): boolean {
  const { op, value } = condition;
  if (VALUELESS.has(op)) return true;
  // a flag's `is false` is a value too
  if (typeof value === 'boolean') return true;
  if (op === 'between') return Array.isArray(value) && value.length === 2 && value.every(present);
  // a choice ("ist eines von", "hat eines von"), a day, a number, a text
  return valuesOf(condition).filter(present).length > 0;
}

/* ----------------------------------------------------------------------- dynamic dates */

const RELATIVE = /^([+-]?)(\d{1,5})([dw])$/;
export const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** `{ relative: '+7d' }` split up: +7 days. Null for anything else. */
export function readRelative(value: unknown): { amount: number; unit: 'd' | 'w' } | null {
  if (typeof value !== 'object' || value === null || !('relative' in value) || typeof value.relative !== 'string') return null;
  const match = RELATIVE.exec(value.relative);
  if (!match) return null;
  return { amount: Number(match[2]) * (match[1] === '-' ? -1 : 1), unit: match[3] as 'd' | 'w' };
}

/** +7 days as a value: `{ relative: '+7d' }`. */
export const relativeValue = (amount: number, unit: 'd' | 'w') => ({ relative: `${amount < 0 ? '-' : '+'}${Math.abs(Math.trunc(amount))}${unit}` });

/** A date value in words: "heute", "diese Woche", "heute + 7 Tage", "31.10.2026"; "Datum wählen …" without one. */
export function dateValueLabel(value: unknown): string {
  if (value === 'today') return t('items.filter.date.today');
  if (value === 'this_week') return t('items.filter.date.this_week');
  if (value === 'this_month') return t('items.filter.date.this_month');
  if (typeof value === 'string' && DAY.test(value)) return formatDay(value);
  const relative = readRelative(value);
  if (relative) {
    if (relative.amount === 0) return t('items.filter.date.today');
    const count = Math.abs(relative.amount);
    const later = relative.amount > 0;
    if (relative.unit === 'd') return tn(later ? 'items.filter.date.later_days' : 'items.filter.date.earlier_days', count);
    return tn(later ? 'items.filter.date.later_weeks' : 'items.filter.date.earlier_weeks', count);
  }
  return t('items.filter.date.choose');
}
