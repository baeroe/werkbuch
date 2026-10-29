/*
 * Parents and children (spec 4.8; correction round 2026-10-29): two levels. Only epics have child items, and epics have
 * no parent themselves. An epic is an item whose type carries the Epic mark (`is_epic`, spec 4.6), never a type of that
 * name. One rule for the fake API (create, update, bulk edits, template runs, type changes, the type settings) and the
 * screens (the children section, the parent pickers and ⇧P, the create dialog, the board grouped by parent). A new
 * child takes a type that may have a parent (`childTypeId`), also where the project's default type is an epic.
 */

import type { Project, WorkItemType } from '@/types';

type TypeMark = Pick<WorkItemType, 'is_epic'> | null | undefined;

/** Whether items of the type may have child items: epics only. */
export function canHaveChildren(type: TypeMark): boolean {
  return type?.is_epic === true;
}

/** Whether items of the type may have a parent: every type but an epic, which stands at the top. */
export function canHaveParent(type: TypeMark): boolean {
  return !canHaveChildren(type);
}

/** Why a project takes no child item: none of its types may have a parent. */
export const NO_CHILD_TYPE = 'Im Projekt ist kein Typ aktiviert, der Kind-Item sein kann.';

/**
 * The type a new child item of the project takes: the project's default type when it may have a parent, else the first
 * enabled one that may (in the order of the organisation's types); null when the project enables none (`NO_CHILD_TYPE`).
 */
export function childTypeId(project: Pick<Project, 'default_type_id' | 'enabled_type_ids'>, types: readonly WorkItemType[]): string | null {
  const enabled = types.filter((type) => type.archived_at === null && project.enabled_type_ids.includes(type.id));
  const standard = enabled.find((type) => type.id === project.default_type_id);
  return (standard && canHaveParent(standard) ? standard : enabled.find((type) => canHaveParent(type)))?.id ?? null;
}
