/*
 * Groups and rows of the item layouts (spec 4.11). `groupItems` (src/domain) sorts items into groups; what it needs
 * from the screen is here: the name of a group and the order of the groups (`groupContext`), and the rows of a list
 * or table, where children follow their parent indented (`nestRows`).
 *
 * The order lists every key a board needs as a column, also empty ones: all states of the workflow, all categories,
 * all priorities, the types of the project. Keys that only exist through items (people, labels, parents, projects)
 * come in a fixed order: people by name, labels by name, parents by key; "Nicht zugewiesen", "Ohne Label" and
 * "Ohne Eltern-Item" last. Only epics are parents (two levels, `domain/hierarchy`): the order names no other parent,
 * so a quick add in a parent's column always makes a child the API takes. Lists leave empty groups out.
 */

import { PRIORITY_LABELS } from '@/components/ui/PriorityIcon';
import { PRIORITY_ORDER } from '@/domain/filter';
import { ALL_KEY, effectiveGroupBy, NONE_KEY, type GroupContext } from '@/domain/grouping';
import { canHaveChildren } from '@/domain/hierarchy';
import { CATEGORY_ORDER, statesInOrder } from '@/domain/workflow';
import type { FilterContext, GroupBy, Label, Project, StateCategory, User, Workflow, WorkItem, WorkItemType } from '@/types';

/** The categories by name, as the spec writes them (4.5). */
export const CATEGORY_LABELS: Record<StateCategory, string> = {
  backlog: 'Backlog',
  unstarted: 'Unstarted',
  started: 'Started',
  completed: 'Completed',
  canceled: 'Canceled',
};

/** The groupings by name, as the display menu offers them. */
export const GROUP_LABELS: Record<GroupBy, string> = {
  state: 'Status',
  category: 'Kategorie',
  assignee: 'Assignee',
  priority: 'Priorität',
  type: 'Typ',
  label: 'Label',
  project: 'Projekt',
  parent: 'Eltern-Item',
  none: 'Keine',
};

/** What the names and the order of the groups come from. */
export interface GroupCatalogs {
  workflows: readonly Workflow[];
  projects: readonly Project[];
  types: readonly WorkItemType[];
  labels: readonly Label[];
  users: readonly User[];
  /** Items that may be parents, so a parent group has a name even when the parent itself is filtered out. */
  parents: readonly WorkItem[];
}

const COLLATOR = new Intl.Collator('de-DE', { numeric: true, sensitivity: 'base' });

/** The workflow of an item, through its project. */
export function workflowIdOf(projects: readonly Project[], item: Pick<WorkItem, 'project_id'>): string {
  return projects.find((project) => project.id === item.project_id)?.workflow_id ?? '';
}

/** The grouping that applies: by status only while all items share one workflow, otherwise by category (spec 4.11). */
export function effectiveGrouping(groupBy: GroupBy, items: readonly WorkItem[], projects: readonly Project[]): GroupBy {
  return effectiveGroupBy(groupBy, items, (item) => workflowIdOf(projects, item));
}

/** People first, then bots, each by name. */
const byPersonThenName = (a: User, b: User) => (a.type === b.type ? COLLATOR.compare(a.name, b.name) : a.type === 'person' ? -1 : 1);

/**
 * Names and order of the groups. `items` are the items on screen; `project` is the project of a project list, whose
 * workflow and types give the columns of an empty board too.
 */
export function groupContext(ctx: FilterContext, catalogs: GroupCatalogs, { items, project }: { items: readonly WorkItem[]; project?: Project }): GroupContext {
  const { workflows, projects, types, labels, users, parents } = catalogs;
  const present = <T>(read: (item: WorkItem) => T[]) => new Set(items.flatMap(read));

  function stateWorkflow(): Workflow | undefined {
    const ids = new Set(items.map((item) => workflowIdOf(projects, item)));
    const id = ids.size === 1 ? [...ids][0] : ids.size === 0 ? project?.workflow_id : undefined;
    return workflows.find((workflow) => workflow.id === id);
  }

  function orderFor(groupBy: GroupBy): string[] {
    switch (groupBy) {
      case 'state': {
        const workflow = stateWorkflow();
        return workflow ? statesInOrder(workflow).map((state) => state.id) : [];
      }
      case 'category':
        return [...CATEGORY_ORDER];
      case 'priority':
        return [...PRIORITY_ORDER];
      case 'type': {
        const enabled = project ? new Set(project.enabled_type_ids) : null;
        return types.filter((type) => (enabled ? enabled.has(type.id) : type.archived_at === null)).map((type) => type.id);
      }
      case 'project': {
        const shown = present((item) => [item.project_id]);
        if (project) shown.add(project.id);
        return [...projects].filter((entry) => shown.has(entry.id)).sort((a, b) => COLLATOR.compare(a.name, b.name)).map((entry) => entry.id);
      }
      case 'assignee': {
        const shown = present((item) => (item.assignee_id ? [item.assignee_id] : []));
        return [...users.filter((user) => shown.has(user.id)).sort(byPersonThenName).map((user) => user.id), NONE_KEY];
      }
      case 'label': {
        const shown = present((item) => item.label_ids);
        return [...labels.filter((label) => shown.has(label.id)).sort((a, b) => COLLATOR.compare(a.name, b.name)).map((label) => label.id), NONE_KEY];
      }
      case 'parent': {
        const shown = present((item) => (item.parent_id ? [item.parent_id] : []));
        // a parent that has not loaded keeps its column: the API lets nothing but an epic have children
        const epics = [...shown].filter((id) => {
          const parent = parentOf(id);
          return !parent || canHaveChildren(types.find((type) => type.id === parent.type_id));
        });
        const named = epics.map((id) => ({ id, key: parentOf(id)?.key ?? id }));
        return [...named.sort((a, b) => COLLATOR.compare(a.key, b.key)).map((entry) => entry.id), NONE_KEY];
      }
      case 'none':
        return [ALL_KEY];
    }
  }

  const parentOf = (id: string) => parents.find((item) => item.id === id) ?? items.find((item) => item.id === id);

  function labelFor(groupBy: GroupBy, key: string): string {
    if (key === ALL_KEY) return 'Alle Items';
    switch (groupBy) {
      case 'state':
        return workflows.flatMap((workflow) => workflow.states).find((state) => state.id === key)?.name ?? key;
      case 'category':
        return CATEGORY_LABELS[key as StateCategory] ?? key;
      case 'priority':
        return PRIORITY_LABELS[key as keyof typeof PRIORITY_LABELS] ?? key;
      case 'type':
        return types.find((type) => type.id === key)?.name ?? 'Unbekannter Typ';
      case 'project':
        return projects.find((entry) => entry.id === key)?.name ?? 'Unbekanntes Projekt';
      case 'assignee':
        return key === NONE_KEY ? 'Nicht zugewiesen' : (users.find((user) => user.id === key)?.name ?? 'Unbekannte Person');
      case 'label':
        return key === NONE_KEY ? 'Ohne Label' : (labels.find((label) => label.id === key)?.name ?? 'Unbekanntes Label');
      case 'parent': {
        if (key === NONE_KEY) return 'Ohne Eltern-Item';
        const parent = parentOf(key);
        return parent ? `${parent.key} ${parent.title}` : 'Verborgenes Eltern-Item';
      }
      case 'none':
        return 'Alle Items';
    }
  }

  return { ...ctx, labelFor, orderFor };
}

/** One row of a list or table: the item and how far it is indented. */
export interface Row {
  item: WorkItem;
  depth: number;
}

/**
 * The rows of one group in their order: an item, then its children that are in the same group (indented, in the
 * group's order), and so on down. A child whose parent is not in the group stands at the top level. A parent loop
 * (which the API prevents) cannot hang the list: every item shows exactly once.
 */
export function nestRows(items: readonly WorkItem[]): Row[] {
  const inGroup = new Set(items.map((item) => item.id));
  const hangs = (item: WorkItem) => item.parent_id !== null && item.parent_id !== item.id && inGroup.has(item.parent_id);
  const children = new Map<string, WorkItem[]>();
  for (const item of items) {
    if (hangs(item)) children.set(item.parent_id!, [...(children.get(item.parent_id!) ?? []), item]);
  }

  const rows: Row[] = [];
  const placed = new Set<string>();
  const visit = (item: WorkItem, depth: number) => {
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
