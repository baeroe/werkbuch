/*
 * The columns of the table layout, ported from the clickdummy's `table/cells.tsx`: one per display field, in the order
 * of the display (the display menu chooses them, Task 17), properties included. The key and the title live in the
 * first column, which stays in place; the fields scroll beside it. Project, created and changed only show.
 */

import type { ListedItem, Property, WorkItemType } from '@/types';
import { fieldLabel } from '../display/DisplayMenu';
import { PROPERTY_PREFIX } from '../filter/fieldOps';
import { ROW_FIELDS } from '@/components/items/ItemRowBase';

export interface Column {
  /** The display field: `state`, `property:customer`. */
  field: string;
  label: string;
  /** In rem. */
  width: number;
  /** Enter edits it; otherwise it only shows (and says so). */
  editable: boolean;
  /** Numbers stand on the right. */
  numeric: boolean;
  property?: Property;
}

/** The width of a column of a core field, in rem. */
export const WIDTHS: Record<string, number> = { state: 10, assignee: 11, priority: 8, labels: 13, start_date: 8.5, due_date: 10, project: 8, created_at: 7, updated_at: 7 };

/** The width of a property column by its field type, in rem. */
export const PROPERTY_WIDTHS: Record<Property['field_type'], number> = { dropdown: 10, member: 11, date: 9, boolean: 6.5, number: 7.5, text: 12, url: 13, rich_text: 14 };

/** The core fields a table shows but nobody changes there. */
export const READ_ONLY: ReadonlySet<string> = new Set(['project', 'created_at', 'updated_at']);

/** The columns for the display fields, in their order; a property that is gone has none. */
export function tableColumns(fields: readonly string[], properties: readonly Property[]): Column[] {
  return fields.flatMap((field): Column[] => {
    if (field === 'key' || field === 'title') return [];
    if (field.startsWith(PROPERTY_PREFIX)) {
      const property = properties.find((entry) => `${PROPERTY_PREFIX}${entry.key}` === field);
      if (!property) return [];
      return [{ field, label: property.label, width: PROPERTY_WIDTHS[property.field_type], editable: true, numeric: property.field_type === 'number', property }];
    }
    if (!(field in ROW_FIELDS)) return [];
    return [{ field, label: fieldLabel(field, properties), width: WIDTHS[field]!, editable: !READ_ONLY.has(field), numeric: false }];
  });
}

/** Whether the item's type has the property; without it the cell is a dash and nothing to edit. */
export function typeHasProperty(types: readonly WorkItemType[] | undefined, item: Pick<ListedItem, 'type_id'>, property: Pick<Property, 'id'>): boolean {
  return types?.find((type) => type.id === item.type_id)?.properties.some((entry) => entry.property_id === property.id) ?? false;
}
