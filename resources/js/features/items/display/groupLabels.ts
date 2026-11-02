/*
 * Names of the groups of the item layouts (spec 4.11), ported from the clickdummy's `display/grouping.ts`, and the
 * rows of a list or table, where children follow their parent indented (`nestRows`). The server delivers the groups
 * in their order with their counts (`/groups`, P14); what is left to the browser is to name them from the catalogs it
 * holds. A project, account or label the reader does not know (an id in a view's filter, an account of a project the
 * reader does not see) gets a name that says so instead of its id (P21); the name of a parent group comes with the
 * group from the server, which only names a parent the reader sees.
 */

import { priorityName } from '@/components/ui/PriorityIcon';
import { ALL_KEY, NONE_KEY } from '@/domain/grouping';
import { t, type TranslationKey } from '@/lib/i18n';
import type { GroupBy, GroupCount, Label, ListedItem, Priority, Project, StateCategory, User, Workflow, WorkItemType } from '@/types';

/** The categories by name, as the spec writes them (4.5). */
export const CATEGORY_LABEL_KEYS = {
  backlog: 'catalog.category.backlog',
  unstarted: 'catalog.category.unstarted',
  started: 'catalog.category.started',
  completed: 'catalog.category.completed',
  canceled: 'catalog.category.canceled',
} as const satisfies Record<StateCategory, TranslationKey>;

/** The groupings by name, as the display menu offers them. */
export const GROUP_LABEL_KEYS = {
  state: 'items.group.by.state',
  category: 'items.group.by.category',
  assignee: 'items.group.by.assignee',
  priority: 'items.group.by.priority',
  type: 'items.group.by.type',
  label: 'items.group.by.label',
  project: 'items.group.by.project',
  parent: 'items.group.by.parent',
  none: 'items.group.by.none',
} as const satisfies Record<GroupBy, TranslationKey>;

/** What the names of the groups come from (the catalogs the browser holds; empty while they load). */
export interface GroupCatalogs {
  workflows: readonly Workflow[];
  projects: readonly Project[];
  types: readonly WorkItemType[];
  labels: readonly Label[];
  users: readonly User[];
}

/** The name of a group: `key` as `/groups` answered it, `item` the parent the server named for a parent group. */
export function groupLabel(groupBy: GroupBy, key: string, catalogs: GroupCatalogs, item?: GroupCount['item']): string {
  if (groupBy === 'none' || key === ALL_KEY) return t('items.group.all');
  switch (groupBy) {
    case 'state':
      return catalogs.workflows.flatMap((workflow) => workflow.states).find((state) => state.id === key)?.name ?? t('items.group.unknown.state');
    case 'category':
      return key in CATEGORY_LABEL_KEYS ? t(CATEGORY_LABEL_KEYS[key as StateCategory]) : key;
    case 'priority':
      return priorityName(key as Priority);
    case 'type':
      return catalogs.types.find((type) => type.id === key)?.name ?? t('items.group.unknown.type');
    case 'project':
      return catalogs.projects.find((project) => project.id === key)?.name ?? t('items.group.hidden.project');
    case 'assignee':
      return key === NONE_KEY ? t('items.group.none.assignee') : (catalogs.users.find((user) => user.id === key)?.name ?? t('items.group.unknown.person'));
    case 'label':
      return key === NONE_KEY ? t('items.group.none.label') : (catalogs.labels.find((label) => label.id === key)?.name ?? t('items.group.unknown.label'));
    case 'parent':
      if (key === NONE_KEY) return t('items.group.none.parent');
      return item ? `${item.key} ${item.title}` : t('items.group.hidden.parent');
  }
}

/** One row of a list or table: the item and how far it is indented. */
export interface Row {
  item: ListedItem;
  depth: number;
}

/**
 * The rows of one group in their order: an item, then its children that are in the same group (indented, in the
 * group's order), and so on down. A child whose parent is not in the group stands at the top level. A parent loop
 * (which the API prevents) cannot hang the list: every item shows exactly once.
 */
export function nestRows(items: readonly ListedItem[]): Row[] {
  const inGroup = new Set(items.map((item) => item.id));
  const hangs = (item: ListedItem) => item.parent_id !== null && item.parent_id !== item.id && inGroup.has(item.parent_id);
  const children = new Map<string, ListedItem[]>();
  for (const item of items) {
    if (hangs(item)) children.set(item.parent_id!, [...(children.get(item.parent_id!) ?? []), item]);
  }

  const rows: Row[] = [];
  const placed = new Set<string>();
  const visit = (item: ListedItem, depth: number) => {
    if (placed.has(item.id)) return;
    placed.add(item.id);
    rows.push({ item, depth });
    for (const child of children.get(item.id) ?? []) visit(child, depth + 1);
  };
  for (const item of items) if (!hangs(item)) visit(item, 0);
  // what is left hangs in a loop: shown at the top level
  for (const item of items) visit(item, 0);
  return rows;
}
