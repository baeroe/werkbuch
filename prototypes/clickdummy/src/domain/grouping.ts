/*
 * Grouping (spec 4.11): the sections of a list and the columns of a board.
 */

import type { FilterContext, Group, GroupBy, WorkItem } from '@/types';

/** The key of the group for items without a value (no assignee, no label, no parent). */
export const NONE_KEY = 'none';

/** The key of the one group when nothing is grouped. */
export const ALL_KEY = 'all';

/** What `groupItems` needs besides the filter context: how to name a group, and in which order to list them. */
export type GroupContext = FilterContext & {
  /** The display name of a group, e.g. the state name for `('state', 'std_todo')`. */
  labelFor(groupBy: GroupBy, key: string): string;
  /** The group keys in display order, e.g. all states of the workflow. */
  orderFor(groupBy: GroupBy): string[];
};

/**
 * A grouping by status only works when all items share one workflow; otherwise it becomes a grouping by category.
 */
export function effectiveGroupBy(
  groupBy: GroupBy,
  items: readonly WorkItem[],
  workflowOf: (item: WorkItem) => string,
): GroupBy {
  if (groupBy !== 'state') return groupBy;
  const workflows = new Set(items.map(workflowOf));
  return workflows.size > 1 ? 'category' : 'state';
}

/** The keys of the groups an item belongs to: one, except for labels, where it is one per label. */
function keysOf(item: WorkItem, groupBy: GroupBy, ctx: FilterContext): string[] {
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
export function groupItems(items: readonly WorkItem[], groupBy: GroupBy, ctx: GroupContext): Group[] {
  const order = groupBy === 'none' ? [ALL_KEY] : ctx.orderFor(groupBy);
  const buckets = new Map<string, WorkItem[]>(order.map((key) => [key, []]));

  for (const item of items) {
    for (const key of keysOf(item, groupBy, ctx)) {
      const bucket = buckets.get(key);
      if (bucket) bucket.push(item);
      else buckets.set(key, [item]);
    }
  }

  return [...buckets].map(([key, bucketItems]) => ({ key, label: ctx.labelFor(groupBy, key), items: bucketItems }));
}
