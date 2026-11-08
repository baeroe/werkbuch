/*
 * Sorting (spec 4.11) in the browser. The server orders every list (`ItemOrder`) and decides which items each page
 * holds; the browser orders the rows it has loaded with this on every render (`placeItems`), so an item that changed
 * under the cache (an optimistic edit, a card dropped on a column) stands where the server would put it after the next
 * load and rows do not jump. It therefore follows the server, not the other way round:
 * - text and project identifiers compare naturally with a collator in the language of the page (case and accents do
 *   not count, numbers in them as numbers: "Item 9" before "Item 10", `A2` before `A10`), as the server's
 *   `natural_sort_key()` does (A450; `natural-sort-fixtures.json` holds what both agree on). Where they differ (digits
 *   of other scripts, fractions) the browser keeps its own order of the loaded rows, and a later page may slip rows in
 *   between them (21g-M1)
 * - the number of a key compares as a number (`WEB-9` before `WEB-10`), ranks by character code (`<`), never by locale
 * - items without a value come last in both directions; ties follow the manual order (rank, then id), also descending.
 */

import { intlLocale } from '@/lib/i18n';
import type { ListedItem, Priority, SortSpec, StateCategory } from '@/types';
import { CATEGORY_ORDER } from './workflow';

/** Priorities from the most urgent; ascending priority puts `urgent` first. */
export const PRIORITY_ORDER: readonly Priority[] = ['urgent', 'high', 'medium', 'low', 'none'];

/** The prefix of a property in a field name: `property:effort`. */
const PROPERTY_PREFIX = 'property:';

type SortKey = number | string | null;

interface SortField {
  read(item: ListedItem): SortKey;
  /** Orders two values of the field; `text` is the collator of the page. */
  compare(a: number | string, b: number | string, text: Intl.Collator): number;
}

const compareCodes = (a: string | number, b: string | number) => (a < b ? -1 : a > b ? 1 : 0);

/** Plain order: numbers as numbers, anything else by character code. */
const plain = (a: number | string, b: number | string) => compareCodes(a, b);

/** Text order of a property: numbers before text should a column mix them, numbers as numbers. */
function mixed(a: number | string, b: number | string, text: Intl.Collator): number {
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  if (typeof a === 'string' && typeof b === 'string') return text.compare(a, b);
  return typeof a === 'number' ? -1 : 1;
}

/** `WEB-12`: the identifier naturally, then the number as a number. */
function compareKeys(a: number | string, b: number | string, text: Intl.Collator): number {
  const [left, right] = [String(a), String(b)].map((key) => {
    const cut = key.lastIndexOf('-');
    return { identifier: key.slice(0, cut), number: Number(key.slice(cut + 1)) };
  });
  return text.compare(left.identifier, right.identifier) || left.number - right.number;
}

function sortField(field: string, stateCategory: (stateId: string) => StateCategory): SortField {
  if (field.startsWith(PROPERTY_PREFIX)) {
    const key = field.slice(PROPERTY_PREFIX.length);
    return {
      compare: mixed,
      read: (item) => {
        const value = item.values[key];
        if (typeof value === 'number') return Number.isFinite(value) ? value : null;
        return typeof value === 'string' && value !== '' ? value : null;
      },
    };
  }

  switch (field) {
    case 'priority':
      return { read: (item) => PRIORITY_ORDER.indexOf(item.priority), compare: plain };
    case 'state_category':
      return { read: (item) => CATEGORY_ORDER.indexOf(stateCategory(item.state_id)), compare: plain };
    case 'due_date':
      return { read: (item) => item.due_date, compare: plain };
    case 'start_date':
      return { read: (item) => item.start_date, compare: plain };
    case 'created_at':
      return { read: (item) => item.created_at, compare: plain };
    case 'updated_at':
      return { read: (item) => item.updated_at, compare: plain };
    case 'key':
      return { read: (item) => item.key, compare: compareKeys };
    default:
      return { read: (item) => item.rank, compare: plain };
  }
}

/**
 * A sorted copy of the items.
 * - Fields: rank (the manual order, the default), priority, due_date, start_date, created_at, updated_at, key,
 *   state_category, and `property:<key>` for number, date and text properties. An unknown field sorts by rank.
 * - Ascending priority puts the most urgent first.
 * - Items without a value come last in both directions. Ties follow the manual order (rank, then id).
 */
export function sortItems<T extends ListedItem>(
  items: readonly T[],
  sort: SortSpec,
  ctx: { stateCategory(stateId: string): StateCategory },
): T[] {
  const direction = sort.direction === 'desc' ? -1 : 1;
  const { read, compare } = sortField(sort.field, ctx.stateCategory);
  const text = new Intl.Collator(intlLocale(), { sensitivity: 'base', numeric: true });
  const manual = (a: ListedItem, b: ListedItem) => compareCodes(a.rank, b.rank) || compareCodes(a.id, b.id);

  return [...items].sort((a, b) => {
    const left = read(a);
    const right = read(b);
    if (left === null || right === null) {
      return left === right ? manual(a, b) : left === null ? 1 : -1;
    }
    const result = compare(left, right, text);
    return result !== 0 ? direction * result : manual(a, b);
  });
}
