/*
 * Finding things in the database, and the filter context the domain engine needs.
 */

import { parseKey } from '@/domain/keys';
import { isClosedCategory } from '@/domain/workflow';
import type {
  FilterContext,
  Project,
  Property,
  StateCategory,
  State,
  User,
  Workflow,
  WorkItem,
  WorkItemRecord,
  WorkItemType,
} from '@/types';
import { today } from '@/lib/clock';
import type { Db } from './db';

/* ---------------------------------------------------------------------- projects */

/** A project by id, identifier or a former identifier (case does not matter for identifiers). */
export function findProject(db: Db, ref: string): Project | undefined {
  const byId = db.projects.find((project) => project.id === ref);
  if (byId) return byId;
  const identifier = ref.toUpperCase();
  const current = db.projects.find((project) => project.identifier === identifier);
  if (current) return current;
  const alias = db.project_aliases.find((entry) => entry.identifier === identifier);
  return alias ? db.projects.find((project) => project.id === alias.project_id) : undefined;
}

export function projectOf(db: Db, item: WorkItemRecord): Project {
  const project = db.projects.find((entry) => entry.id === item.project_id);
  if (!project) throw new Error(`Item ${item.key} lost its project`);
  return project;
}

export function workflowOf(db: Db, project: Project): Workflow {
  const workflow = db.workflows.find((entry) => entry.id === project.workflow_id);
  if (!workflow) throw new Error(`Project ${project.identifier} lost its workflow`);
  return workflow;
}

/* -------------------------------------------------------------------------- items */

/** An item by id or key (`WEB-47`); a former project identifier resolves to the project's current one. */
export function findItem(db: Db, ref: string): WorkItemRecord | undefined {
  const byId = db.items.find((item) => item.id === ref);
  if (byId) return byId;
  const key = parseKey(ref);
  if (!key) return undefined;
  const project = findProject(db, key.identifier);
  return project ? db.items.find((item) => item.project_id === project.id && item.number === key.number) : undefined;
}

/**
 * An item as the API answers it: the stored fields and what is computed on every read. `parent` names the parent by
 * id, key and title (its current key and title). The parent lies in the item's project, so whoever may see the item
 * may see it too.
 */
export function itemResource(db: Pick<Db, 'items'>, item: WorkItemRecord): WorkItem {
  const parent = item.parent_id === null ? undefined : db.items.find((entry) => entry.id === item.parent_id);
  return { ...item, parent: parent ? { id: parent.id, key: parent.key, title: parent.title } : null };
}

export function stateOf(workflow: Workflow, stateId: string): State | undefined {
  return workflow.states.find((state) => state.id === stateId);
}

export function categoryOfItem(db: Db, item: WorkItemRecord): StateCategory {
  return workflowCategory(workflowOf(db, projectOf(db, item)), item.state_id);
}

export function workflowCategory(workflow: Workflow, stateId: string): StateCategory {
  const state = stateOf(workflow, stateId);
  if (!state) throw new Error(`Unknown state ${stateId} in workflow ${workflow.name}`);
  return state.category;
}

export function isItemClosed(db: Db, item: WorkItemRecord): boolean {
  return isClosedCategory(categoryOfItem(db, item));
}

/* ---------------------------------------------------------------- types and users */

export function propertiesOfType(db: Db, type: WorkItemType): { property: Property; required: boolean }[] {
  return [...type.properties]
    .sort((a, b) => a.position - b.position)
    .flatMap(({ property_id, required }) => {
      const property = db.properties.find((entry) => entry.id === property_id);
      return property ? [{ property, required }] : [];
    });
}

export function userName(db: Db, id: string | null | undefined): string {
  return db.users.find((user) => user.id === id)?.name ?? 'Unbekannt';
}

/* ------------------------------------------------------------------ relations */

/** The id sets behind `blocked` and `blocking`: only open items count, on both ends. */
export function blockingSets(db: Db): { blocked: Set<string>; blocking: Set<string> } {
  const blockedIds = new Set<string>();
  const blockingIds = new Set<string>();
  const blocksType = db.relation_types.find((type) => type.built_in === 'blocks');
  if (!blocksType) return { blocked: blockedIds, blocking: blockingIds };

  const byId = new Map(db.items.map((item) => [item.id, item]));
  const open = (item: WorkItemRecord | undefined): item is WorkItemRecord => item !== undefined && !isItemClosed(db, item);
  for (const relation of db.relations) {
    if (relation.type_id !== blocksType.id) continue;
    const blocker = byId.get(relation.source_id);
    const target = byId.get(relation.target_id);
    if (open(blocker) && open(target)) {
      blockingIds.add(blocker.id);
      blockedIds.add(target.id);
    }
  }
  return { blocked: blockedIds, blocking: blockingIds };
}

/** The ids of items that are the parent of at least one item. */
export function parentIds(db: Db): Set<string> {
  return new Set(db.items.flatMap((item) => (item.parent_id ? [item.parent_id] : [])));
}

/* ------------------------------------------------------------------ the filter */

/** What `matchesFilter`, `sortItems` and `groupItems` need, in the organisation's time zone and for one account. */
export function filterContext(db: Db, me: User): FilterContext {
  const timeZone = db.organization.timezone;
  const categories = new Map(db.workflows.flatMap((workflow) => workflow.states.map((state) => [state.id, state.category] as const)));
  const typeKeys = new Map(db.types.map((type) => [type.id, new Set(propertiesOfType(db, type).map(({ property }) => property.key))]));
  const parents = parentIds(db);
  const { blocked, blocking } = blockingSets(db);

  return {
    me: me.id,
    today: today(timeZone),
    time_zone: timeZone,
    week_start: db.organization.week_start,
    stateCategory: (stateId) => {
      const category = categories.get(stateId);
      if (!category) throw new Error(`Unknown state ${stateId}`);
      return category;
    },
    typeHasProperty: (typeId, key) => typeKeys.get(typeId)?.has(key) ?? false,
    hasChildren: (itemId) => parents.has(itemId),
    isBlocked: (itemId) => blocked.has(itemId),
    isBlocking: (itemId) => blocking.has(itemId),
  };
}
