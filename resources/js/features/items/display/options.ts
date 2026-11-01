/*
 * What the display of a list can hold (spec 4.11, plan tables "Sortierung" and "Anzeige"), and how the browser reads a
 * display that names something that is gone (P2, as `SortSpec::read` and `DisplaySchema::read` on the server):
 *
 * - Sorting: the core fields of `SortSpec::CORE` and the properties of the types number, date, text and URL. A sort on
 *   anything else (a deleted property, a typo in a link) is the manual order; the server would refuse it (422), so the
 *   list never sends it. Whether a property is there is known once the properties are loaded.
 * - Fields: the chips of a row and the columns of the table (`DisplaySchema::FIELDS`: `ROW_FIELDS` and the title) and
 *   `property:<key>` of every property. Saving drops a field whose property is gone; the server would refuse it.
 */

import { ROW_FIELDS } from '@/components/items/ItemRowBase';
import type { TranslationKey } from '@/lib/i18n';
import type { Display, Property, SortSpec } from '@/types';
import { PROPERTY_PREFIX } from '../filter/fieldOps';

/** The core fields a list sorts by, in the order of the menu (`SortSpec::CORE`). */
export const SORT_FIELDS: readonly { value: string; label: TranslationKey }[] = [
  { value: 'rank', label: 'items.display.sort.rank' },
  { value: 'priority', label: 'items.display.sort.priority' },
  { value: 'due_date', label: 'items.display.sort.due_date' },
  { value: 'start_date', label: 'items.display.sort.start_date' },
  { value: 'created_at', label: 'items.display.sort.created_at' },
  { value: 'updated_at', label: 'items.display.sort.updated_at' },
  { value: 'key', label: 'items.display.sort.key' },
  { value: 'state_category', label: 'items.display.sort.state_category' },
];

/** The property types a list sorts by (`SortSpec::SORTABLE`). */
export const SORTABLE_TYPES: ReadonlySet<Property['field_type']> = new Set(['number', 'date', 'text', 'url']);

/** The manual order: what a sort on something unknown is. */
export const MANUAL_SORT: SortSpec = { field: 'rank', direction: 'asc' };

/** The display fields of a row and of the table besides the properties (`DisplaySchema::FIELDS`). */
export const DISPLAY_FIELDS: readonly string[] = [...Object.keys(ROW_FIELDS), 'title'];

const propertyOf = (field: string, properties: readonly Property[]) =>
  field.startsWith(PROPERTY_PREFIX) ? properties.find((property) => `${PROPERTY_PREFIX}${property.key}` === field) : undefined;

/** Whether a list can be sorted by the field. */
export function isSortable(field: string, properties: readonly Property[]): boolean {
  if (SORT_FIELDS.some((option) => option.value === field)) return true;
  const property = propertyOf(field, properties);
  return property !== undefined && SORTABLE_TYPES.has(property.field_type);
}

/**
 * The sort a list asks the server for: the chosen one, or the manual order for one on something unknown. `null` while
 * the properties it needs are loading; if they failed to load, the chosen one (the server decides).
 */
export function listSort(sort: SortSpec, properties: readonly Property[] | undefined, failed: boolean): SortSpec | null {
  if (properties === undefined) {
    if (!sort.field.startsWith(PROPERTY_PREFIX)) return isSortable(sort.field, []) ? sort : MANUAL_SORT;
    return failed ? sort : null;
  }
  return isSortable(sort.field, properties) ? sort : MANUAL_SORT;
}

/**
 * A display as it can be saved: without fields that are gone (a deleted property, a typo in a link), a sort on something
 * unknown is the manual order. While the properties are not known, every property field and sort stays.
 */
export function savableDisplay(display: Display, properties: readonly Property[] | undefined): Display {
  const known = (field: string) =>
    DISPLAY_FIELDS.includes(field) || (field.startsWith(PROPERTY_PREFIX) && (properties === undefined || propertyOf(field, properties) !== undefined));
  return { ...display, sort: listSort(display.sort, properties, true)!, fields: display.fields.filter(known) };
}
