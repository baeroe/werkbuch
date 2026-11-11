/*
 * Grouping (spec 4.11): the sections of a list and the columns of a board. The server groups and counts (`/groups`,
 * P14, P24); this places the items already loaded: `groupItems` for the screens, `placeItems` after an optimistic
 * change, so a card stands in the column it belongs to now and the count of the server is corrected by the difference.
 */

import type { Group, GroupBy, ListedItem, SortSpec, StateCategory } from '@/types';
import { sortItems } from './sort';

/** The key of the group for items without a value (no assignee, no label, no parent). */
export const NONE_KEY = 'none';

/** The key of the one group when nothing is grouped. */
export const ALL_KEY = 'all';

/** What grouping needs to know besides the item: the category of a status. */
export interface KeyContext {
  stateCategory(stateId: string): StateCategory;
}

/** What `groupItems` needs besides that: how to name a group, and in which order to list them. */
export type GroupContext = KeyContext & {
  /** The display name of a group, e.g. the state name for `('state', 'std_todo')`. */
  labelFor(groupBy: GroupBy, key: string): string;
  /** The group keys in display order, e.g. all states of the workflow. */
  orderFor(groupBy: GroupBy): string[];
};

/**
 * A grouping by status only works when all items share one workflow; otherwise it becomes a grouping by category.
 * (The server decides for a whole list, `ItemGroups.group_by`; this is for items the browser already holds.)
 */
export function effectiveGroupBy(
  groupBy: GroupBy,
  items: readonly ListedItem[],
  workflowOf: (item: ListedItem) => string,
): GroupBy {
  if (groupBy !== 'state') return groupBy;
  const workflows = new Set(items.map(workflowOf));
  return workflows.size > 1 ? 'category' : 'state';
}

/** The keys of the groups an item belongs to: one, except for labels, where it is one per label. */
export function keysOf(item: ListedItem, groupBy: GroupBy, ctx: KeyContext): string[] {
  switch (groupBy) {
    case 'state':
      return [item.state_id];
    case 'category':
      return [ctx.stateCategory(item.state_id)];
    case 'assignee':
      return [item.assignee_id ?? NONE_KEY];
    case 'priority':
      return [item.priority];
    case 'type':
      return [item.type_id];
    case 'label':
      return item.label_ids.length > 0 ? [...new Set(item.label_ids)] : [NONE_KEY];
    case 'project':
      return [item.project_id];
    case 'parent':
      return [item.parent_id ?? NONE_KEY];
    case 'none':
      return [ALL_KEY];
  }
}

/**
 * Sorts items into groups. The groups come in the order of `ctx.orderFor(groupBy)`, and every key listed there gets
 * a group even when it is empty (a board needs its empty columns). Keys the order does not list follow, in the order
 * they first appear. An item keeps its position within its group, so sort the items first. Without grouping there is
 * exactly one group, `all`.
 */
export function groupItems(items: readonly ListedItem[], groupBy: GroupBy, ctx: GroupContext): Group[] {
  const order = groupBy === 'none' ? [ALL_KEY] : ctx.orderFor(groupBy);
  const buckets = new Map<string, ListedItem[]>(order.map((key) => [key, []]));

  for (const item of items) {
    for (const key of keysOf(item, groupBy, ctx)) {
      const bucket = buckets.get(key);
      if (bucket) bucket.push(item);
      else buckets.set(key, [item]);
    }
  }

  return [...buckets].map(([key, bucketItems]) => ({ key, label: ctx.labelFor(groupBy, key), items: bucketItems }));
}

/** A group as the server delivered it: its key and the items loaded so far. */
export interface ServedGroup {
  key: string;
  items: readonly ListedItem[];
}

/** Where the loaded items stand now, and by how much each group differs from what the server delivered. */
export interface Placement {
  items: Map<string, ListedItem[]>;
  /** Items now in the group minus items delivered in it: add it to the count of the server (P24). */
  delta: Map<string, number>;
}

/**
 * Puts every loaded item into the groups it belongs to now. An item that appears more than once (it stands in several
 * label groups, or a page was loaded twice) counts once: its later entry in `served` wins. Each group is sorted again;
 * the groups the server delivered stay, even when they are empty now.
 */
export function placeItems(served: readonly ServedGroup[], groupBy: GroupBy, sort: SortSpec, ctx: KeyContext): Placement {
  // the later entry of an item in `served` wins
  const latest = new Map<string, ListedItem>();
  for (const group of served) for (const item of group.items) latest.set(item.id, item);

  const placed = new Map<string, ListedItem[]>(served.map((group) => [group.key, []]));
  for (const item of latest.values()) {
    for (const key of keysOf(item, groupBy, ctx)) {
      const bucket = placed.get(key);
      if (bucket) bucket.push(item);
      else placed.set(key, [item]);
    }
  }

  const delivered = new Map<string, Set<string>>();
  for (const group of served) {
    const ids = delivered.get(group.key) ?? new Set<string>();
    for (const item of group.items) ids.add(item.id);
    delivered.set(group.key, ids);
  }
  const items = new Map<string, ListedItem[]>();
  const delta = new Map<string, number>();
  for (const [key, bucket] of placed) {
    items.set(key, sortItems(bucket, sort, ctx));
    delta.set(key, bucket.length - (delivered.get(key)?.size ?? 0));
  }
  return { items, delta };
}
