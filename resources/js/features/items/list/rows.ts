/*
 * The rows of the list layout (and of the table): per group its heading, then (unless it is collapsed) its loaded
 * items with their children indented, then one row for what is still to come: a placeholder while the first page
 * loads, a row that loads the next page, or one that offers to try again after a page failed (the items loaded so far
 * stay, 13c). Groups without items are left out; without grouping there is no heading.
 */

import type { ListedItem } from '@/types';
import { nestRows } from '../display/groupLabels';
import type { GroupData } from '../layouts';

export type ListRow =
  | { kind: 'group'; group: GroupData }
  | { kind: 'item'; item: ListedItem; depth: number; group: GroupData }
  | { kind: 'more'; group: GroupData }
  | { kind: 'error'; group: GroupData }
  | { kind: 'pending'; group: GroupData };

/** What follows the loaded items of a group. */
function tail(group: GroupData): ListRow[] {
  if (group.moreError !== null || (group.status === 'error' && group.items.length === 0)) return [{ kind: 'error', group }];
  if (group.items.length === 0 && group.status !== 'success') return [{ kind: 'pending', group }];
  return group.hasMore ? [{ kind: 'more', group }] : [];
}

export function listRows(groups: readonly GroupData[], grouped: boolean, collapsed: ReadonlySet<string>): ListRow[] {
  return groups
    .filter((group) => group.count > 0 || group.items.length > 0)
    .flatMap((group): ListRow[] => {
      const heading: ListRow[] = grouped ? [{ kind: 'group', group }] : [];
      if (grouped && collapsed.has(group.key)) return heading;
      const items = nestRows(group.items).map((row): ListRow => ({ kind: 'item', item: row.item, depth: row.depth, group }));
      return [...heading, ...items, ...tail(group)];
    });
}

/** A key of the row that stays while rows come and go (an item with two labels has a row in each label group). */
export function rowKey(row: ListRow): string {
  return row.kind === 'item' ? `${row.group.key}:${row.item.id}` : `${row.kind}:${row.group.key}`;
}
