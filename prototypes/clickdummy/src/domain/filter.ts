/*
 * The filter engine (spec 4.11): decides whether a work item matches a filter, and sorts items.
 *
 * A filter is a list of conditions joined with AND. A condition is `{ field, op, value? }`.
 *
 * Fields (`CORE_FILTER_FIELDS`), all named like the work item:
 * - ids and enums: project, type, state, state_category, assignee, created_by, priority, parent
 * - label: the item's labels, so the operators work on a list (`in` means "has one of")
 * - dates: start_date, due_date
 * - timestamps: created_at, updated_at, closed_at; compared by their calendar day in the organisation's time zone
 *   (`ctx.time_zone`; the UTC day when the context has none), so that "created today" agrees with `ctx.today`.
 *   A timestamp that cannot be read counts as missing.
 * - flags: has_children, blocked (another open item blocks it), blocking (it blocks another item), archived;
 *   use `{ op: 'is', value: true }` or `false`
 * - title: text
 * - `property:<key>`: the value of a property, keyed like `WorkItem.values`. Items whose type does not have the
 *   property never match, whatever the operator (`is_empty` and `is_not` included).
 * A field the engine does not know never matches. Archived items are not hidden here; whether to show them is up to
 * the caller, because `archived` is a field like any other.
 *
 * Operators and their values:
 * - is, is_not: one value. in, not_in: a list. For a list-valued field (label, multi-select) "is" and "in" mean
 *   "has one of". A missing value is never equal to anything, so `is_not` and `not_in` match items without a value.
 * - is_empty, is_not_empty: no value. Empty is: missing, a blank text, an empty list, a rich text without content.
 *   Numbers and booleans are never empty.
 * - before, after: one value; strict, so an item due on the bound is neither before nor after it. lt and gt are the
 *   same for numbers.
 * - between: `[from, to]`, both ends included.
 * - contains: text without regard to case; for a list-valued field, membership.
 * - overdue: no value; a date before today on an item that is not closed.
 *
 * Dynamic values, usable wherever an id or a date is expected:
 * - `'me'`: the signed-in account
 * - `'today'`, `'this_week'` (first day of the week from the organisation), `'this_month'`
 * - `{ relative: '+7d' }`, `'-2w'`, `'0d'`: days or weeks from today
 * A day range like this_week means "is": inside the range, "before": before its first day, "after": after its last.
 */

import type { Condition, Filter, FilterContext, Priority, RichText, SortSpec, WorkItemRecord } from '@/types';
import { addDays, cachedZone, endOfMonth, startOfMonth, startOfWeek } from './tz';
import { CATEGORY_ORDER, isClosedCategory } from './workflow';

export type { FilterContext } from '@/types';

/** The order of the priorities, most urgent first. */
export const PRIORITY_ORDER: readonly Priority[] = ['urgent', 'high', 'medium', 'low', 'none'];

/**
 * The calendar day of an ISO timestamp in the time zone of the context (UTC without one), 'YYYY-MM-DD'. Null when
 * there is no timestamp or it cannot be read. Throws `RangeError` for a time zone name Intl does not know.
 */
function dayOf(timestamp: string | null, ctx: FilterContext): string | null {
  if (timestamp === null) return null;
  const at = new Date(timestamp);
  if (Number.isNaN(at.getTime())) return null;
  return cachedZone(ctx.time_zone || 'UTC').date(at);
}

const CORE_FIELDS = {
  project: (item) => item.project_id,
  type: (item) => item.type_id,
  state: (item) => item.state_id,
  state_category: (item, ctx) => ctx.stateCategory(item.state_id),
  assignee: (item) => item.assignee_id,
  created_by: (item) => item.created_by,
  priority: (item) => item.priority,
  label: (item) => item.label_ids,
  parent: (item) => item.parent_id,
  start_date: (item) => item.start_date,
  due_date: (item) => item.due_date,
  created_at: (item, ctx) => dayOf(item.created_at, ctx),
  updated_at: (item, ctx) => dayOf(item.updated_at, ctx),
  closed_at: (item, ctx) => dayOf(item.closed_at, ctx),
  has_children: (item, ctx) => ctx.hasChildren(item.id),
  blocked: (item, ctx) => ctx.isBlocked(item.id),
  blocking: (item, ctx) => ctx.isBlocking(item.id),
  archived: (item) => item.archived_at !== null,
  title: (item) => item.title,
} satisfies Record<string, (item: WorkItemRecord, ctx: FilterContext) => unknown>;

export type CoreFilterField = keyof typeof CORE_FIELDS;

/** The fields besides `property:<key>` a condition can name. */
export const CORE_FILTER_FIELDS = Object.keys(CORE_FIELDS) as CoreFilterField[];

const PROPERTY_PREFIX = 'property:';

/** What the engine compares against: a value, or a range of days. */
type Operand = { kind: 'range'; from: string; to: string } | { kind: 'value'; value: string | number | boolean };

const RELATIVE = /^([+-]?)(\d{1,5})([dw])$/;

/** `'+7d'` and the like, as the day that many days or weeks from today; null for anything else. */
function relativeDay(relative: string, today: string): string | null {
  const match = RELATIVE.exec(relative);
  if (!match) return null;
  const days = Number(match[2]) * (match[3] === 'w' ? 7 : 1) * (match[1] === '-' ? -1 : 1);
  return addDays(today, days);
}

function dayRange(from: string, to = from): Operand {
  return { kind: 'range', from, to };
}

/** Turns a value of a condition into something comparable, resolving `me`, `today`, ranges and relative days. */
function toOperand(raw: unknown, ctx: FilterContext): Operand | null {
  if (typeof raw === 'number' || typeof raw === 'boolean') return { kind: 'value', value: raw };

  if (typeof raw === 'string') {
    switch (raw) {
      case 'me':
        return { kind: 'value', value: ctx.me };
      case 'today':
        return dayRange(ctx.today);
      case 'this_week': {
        const first = startOfWeek(ctx.today, ctx.week_start);
        return dayRange(first, addDays(first, 6));
      }
      case 'this_month':
        return dayRange(startOfMonth(ctx.today), endOfMonth(ctx.today));
      default:
        return { kind: 'value', value: raw };
    }
  }

  if (typeof raw === 'object' && raw !== null && 'relative' in raw && typeof raw.relative === 'string') {
    const target = relativeDay(raw.relative, ctx.today);
    return target === null ? null : dayRange(target);
  }
  return null;
}

/** The operands of a condition value; a single value counts as a list of one. */
function toOperands(value: unknown, ctx: FilterContext): Operand[] {
  const list = Array.isArray(value) ? value : value === undefined || value === null ? [] : [value];
  return list.map((entry) => toOperand(entry, ctx)).filter((operand): operand is Operand => operand !== null);
}

function equalsOperand(actual: unknown, operand: Operand): boolean {
  if (operand.kind === 'range') return typeof actual === 'string' && actual >= operand.from && actual <= operand.to;
  // an unset checkbox reads as "no"
  if (typeof operand.value === 'boolean') return (actual ?? false) === operand.value;
  return actual === operand.value;
}

/** Whether the field's value, or any of its values for a list, equals one of the operands. */
function matchesAny(actual: unknown, operands: Operand[]): boolean {
  const actuals = Array.isArray(actual) ? actual : [actual];
  return operands.some((operand) => actuals.some((value) => equalsOperand(value, operand)));
}

/** The order of two values of the same kind: negative, zero or positive; null when they cannot be compared. */
function order(actual: unknown, bound: string | number): number | null {
  if (typeof actual === 'number' && typeof bound === 'number') return actual - bound;
  if (typeof actual === 'string' && typeof bound === 'string') return actual < bound ? -1 : actual > bound ? 1 : 0;
  return null;
}

/** The edge of an operand to compare against: for a range its first or last day. */
function edge(operand: Operand | null, side: 'low' | 'high'): string | number | null {
  if (operand === null) return null;
  if (operand.kind === 'range') return side === 'low' ? operand.from : operand.to;
  return typeof operand.value === 'boolean' ? null : operand.value;
}

/** Whether the value lies strictly before (`low`) or after (`high`) the operand. */
function isBeyond(actual: unknown, value: unknown, side: 'low' | 'high', ctx: FilterContext): boolean {
  const bound = edge(toOperand(value, ctx), side);
  const result = bound === null ? null : order(actual, bound);
  if (result === null) return false;
  return side === 'low' ? result < 0 : result > 0;
}

function isBetween(actual: unknown, value: unknown, ctx: FilterContext): boolean {
  if (!Array.isArray(value) || value.length !== 2) return false;
  const lower = edge(toOperand(value[0], ctx), 'low');
  const upper = edge(toOperand(value[1], ctx), 'high');
  if (lower === null || upper === null) return false;
  const aboveLower = order(actual, lower);
  const belowUpper = order(actual, upper);
  return aboveLower !== null && belowUpper !== null && aboveLower >= 0 && belowUpper <= 0;
}

/* -------------------------------------------------------------------- rich text */

/** The text of a Tiptap document; blocks are separated by a space. */
function plainText(node: RichText): string {
  if (typeof node.text === 'string') return node.text;
  if (node.type === 'hardBreak') return ' ';
  const children: RichText[] = node.content ?? [];
  const inline = children.every((child) => typeof child.text === 'string' || child.type === 'hardBreak');
  return children.map(plainText).join(inline ? '' : ' ');
}

/** Nodes that hold no content of their own: a document with only these (and blank text) is empty. */
const BLANK_NODES = new Set(['doc', 'paragraph', 'text', 'hardBreak']);

function isBlankDocument(node: RichText): boolean {
  if (typeof node.text === 'string' && node.text.trim() !== '') return false;
  const children: RichText[] = node.content ?? [];
  if (children.length === 0) return node.type === undefined || BLANK_NODES.has(node.type);
  return children.every(isBlankDocument);
}

function isEmpty(actual: unknown): boolean {
  if (actual === null || actual === undefined) return true;
  if (typeof actual === 'string') return actual.trim() === '';
  if (Array.isArray(actual)) return actual.length === 0;
  if (typeof actual === 'object') return isBlankDocument(actual as RichText);
  return false;
}

function contains(actual: unknown, value: unknown, ctx: FilterContext): boolean {
  // a list-valued field "contains" a value when it has it
  if (Array.isArray(actual)) return matchesAny(actual, toOperands(value, ctx));
  if (typeof value !== 'string') return false;

  let haystack: string | null = null;
  if (typeof actual === 'string') haystack = actual;
  else if (typeof actual === 'object' && actual !== null) haystack = plainText(actual as RichText);
  return haystack !== null && haystack.toLowerCase().includes(value.toLowerCase());
}

/* ----------------------------------------------------------------------- filter */

/** The value of a field, or `undefined` when it does not apply: an unknown field, or a property the type lacks. */
function readField(item: WorkItemRecord, field: string, ctx: FilterContext): { value: unknown } | undefined {
  if (Object.hasOwn(CORE_FIELDS, field)) return { value: CORE_FIELDS[field as CoreFilterField](item, ctx) };

  if (field.startsWith(PROPERTY_PREFIX)) {
    const key = field.slice(PROPERTY_PREFIX.length);
    if (!ctx.typeHasProperty(item.type_id, key)) return undefined;
    return { value: item.values[key] };
  }
  return undefined;
}

function matchesCondition(item: WorkItemRecord, condition: Condition, ctx: FilterContext): boolean {
  const field = readField(item, condition.field, ctx);
  if (field === undefined) return false;

  const actual = field.value;
  switch (condition.op) {
    case 'is':
    case 'in':
      return matchesAny(actual, toOperands(condition.value, ctx));
    case 'is_not':
    case 'not_in':
      return !matchesAny(actual, toOperands(condition.value, ctx));
    case 'is_empty':
      return isEmpty(actual);
    case 'is_not_empty':
      return !isEmpty(actual);
    case 'before':
    case 'lt':
      return isBeyond(actual, condition.value, 'low', ctx);
    case 'after':
    case 'gt':
      return isBeyond(actual, condition.value, 'high', ctx);
    case 'between':
      return isBetween(actual, condition.value, ctx);
    case 'contains':
      return contains(actual, condition.value, ctx);
    case 'overdue':
      return typeof actual === 'string' && actual < ctx.today && !isClosedCategory(ctx.stateCategory(item.state_id));
    default:
      return false;
  }
}

/** Whether the item satisfies every condition of the filter. An empty filter matches everything. */
export function matchesFilter(item: WorkItemRecord, filter: Filter, ctx: FilterContext): boolean {
  return filter.conditions.every((condition) => matchesCondition(item, condition, ctx));
}

/* ------------------------------------------------------------------------ sort */

type SortKey = number | string | null;

interface SortField {
  read(item: WorkItemRecord): SortKey;
  /** Compare text with a collator (case, accents and numbers in the text); otherwise by plain character codes. */
  collate: boolean;
}

function sortField(field: string, ctx: Pick<FilterContext, 'stateCategory'>): SortField {
  if (field.startsWith(PROPERTY_PREFIX)) {
    const key = field.slice(PROPERTY_PREFIX.length);
    return {
      collate: true,
      read: (item) => {
        const value = item.values[key];
        if (typeof value === 'number') return Number.isFinite(value) ? value : null;
        return typeof value === 'string' && value !== '' ? value : null;
      },
    };
  }

  switch (field) {
    case 'priority':
      return { read: (item) => PRIORITY_ORDER.indexOf(item.priority), collate: false };
    case 'state_category':
      return { read: (item) => CATEGORY_ORDER.indexOf(ctx.stateCategory(item.state_id)), collate: false };
    case 'due_date':
      return { read: (item) => item.due_date, collate: false };
    case 'start_date':
      return { read: (item) => item.start_date, collate: false };
    case 'created_at':
      return { read: (item) => item.created_at, collate: false };
    case 'updated_at':
      return { read: (item) => item.updated_at, collate: false };
    case 'key':
      return { read: (item) => item.key, collate: true };
    default:
      return { read: (item) => item.rank, collate: false };
  }
}

const compareCodes = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * A sorted copy of the items.
 * - Fields: rank (the manual order, the default), priority, due_date, start_date, created_at, updated_at, key,
 *   state_category, and `property:<key>` for number, date and text properties. An unknown field sorts by rank.
 * - Ascending priority puts the most urgent first; ascending key sorts `WEB-9` before `WEB-10`.
 * - Items without a value come last in both directions. Ties follow the manual order (rank, then id), also when
 *   descending.
 * Ranks are compared by character code on purpose: that is what fractional indexing relies on.
 */
export function sortItems<T extends WorkItemRecord>(
  items: readonly T[],
  sort: SortSpec,
  ctx: Pick<FilterContext, 'stateCategory'>,
): T[] {
  const direction = sort.direction === 'desc' ? -1 : 1;
  const { read, collate } = sortField(sort.field, ctx);
  const collator = new Intl.Collator('de', { numeric: true, sensitivity: 'base' });
  const manual = (a: WorkItemRecord, b: WorkItemRecord) => compareCodes(a.rank, b.rank) || compareCodes(a.id, b.id);

  const compareKeys = (a: number | string, b: number | string): number => {
    if (typeof a === 'number' && typeof b === 'number') return a - b;
    if (typeof a === 'string' && typeof b === 'string') return collate ? collator.compare(a, b) : compareCodes(a, b);
    return typeof a === 'number' ? -1 : 1; // numbers before text, should a column mix them
  };

  return [...items].sort((a, b) => {
    const left = read(a);
    const right = read(b);
    if (left === null || right === null) {
      return left === right ? manual(a, b) : left === null ? 1 : -1;
    }
    const result = compareKeys(left, right);
    return result !== 0 ? direction * result : manual(a, b);
  });
}
