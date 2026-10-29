/*
 * Parents and children (spec 4.8; correction round 2026-10-29): two levels. Only epics have child items, and epics have
 * no parent themselves. An epic is an item whose type carries the Epic mark (`is_epic`, spec 4.6), never a type of that
 * name. One rule for the fake API (create, update, bulk edits, template runs, type changes, the type settings) and the
 * screens (the children section, the parent pickers and ⇧P, the create dialog, the board grouped by parent).
 */

import type { WorkItemType } from '@/types';

type TypeMark = Pick<WorkItemType, 'is_epic'> | null | undefined;

/** Whether items of the type may have child items: epics only. */
export function canHaveChildren(type: TypeMark): boolean {
  return type?.is_epic === true;
}

/** Whether items of the type may have a parent: every type but an epic, which stands at the top. */
export function canHaveParent(type: TypeMark): boolean {
  return !canHaveChildren(type);
}
