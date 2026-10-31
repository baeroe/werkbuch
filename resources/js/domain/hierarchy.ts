/*
 * Parents and children (spec 4.8): two levels. Only epics have child items, and epics have no parent themselves. An
 * epic is an item whose type carries the Epic mark (`is_epic`, spec 4.6), never a type of that name. The same rule as
 * the server's (`App\Domain\WorkItems\Hierarchy`), for the screens: the children section, the parent pickers, the type
 * change, the create dialog. A new child takes a type that may have a parent (`childTypeId`), also where the project's
 * default type is an epic. The sentences are keys: `items.hierarchy.<refusal>` (with `:key`) and
 * `items.hierarchy.no_child_type`.
 */

import type { Project, WorkItemType } from '@/types';

type TypeMark = Pick<WorkItemType, 'is_epic'> | null | undefined;

/** Why a type change would break the two levels; the server answers the same codes (`HierarchyRefusal`). */
export type HierarchyRefusal = 'has_children' | 'has_parent';

/** Whether items of the type may have child items: epics only. */
export function canHaveChildren(type: TypeMark): boolean {
  return type?.is_epic === true;
}

/** Whether items of the type may have a parent: every type but an epic, which stands at the top. */
export function canHaveParent(type: TypeMark): boolean {
  return !canHaveChildren(type);
}

/** Why an item cannot take the type `target` without breaking the two levels; null when it can. */
export function typeChangeRefusal(hasChildren: boolean, hasParent: boolean, target: TypeMark): HierarchyRefusal | null {
  if (hasChildren && !canHaveChildren(target)) return 'has_children';
  if (hasParent && !canHaveParent(target)) return 'has_parent';
  return null;
}

/**
 * The type a new child item of the project takes: the project's default type when it may have a parent, else the first
 * enabled one that may (in the order of the organisation's types); null when the project enables none
 * (`items.hierarchy.no_child_type`).
 */
export function childTypeId(project: Pick<Project, 'default_type_id' | 'enabled_type_ids'>, types: readonly WorkItemType[]): string | null {
  const enabled = types.filter((type) => type.archived_at === null && project.enabled_type_ids.includes(type.id));
  const standard = enabled.find((type) => type.id === project.default_type_id);
  return (standard && canHaveParent(standard) ? standard : enabled.find((type) => canHaveParent(type)))?.id ?? null;
}
