/*
 * What a board lets a card do (spec 4.5, 4.11), as pure functions the board, its keyboard and its quick add share:
 * - a card dropped on another column changes the grouped field: the status (only where the workflow allows the
 *   transition), the priority or the assignee; on a category column it takes the first status of that category the
 *   item's workflow allows (`dropTargetState`); a move into Completed or Canceled asks for the resolution
 * - a board grouped by label does not move cards at all (an item stands in the column of each of its labels); by
 *   type, project or parent a card only changes its place within its column
 * - the reason of a refusal is one German sentence, for the toast and the column under the dragged card
 * - the order within a column is the rank (`rankBetween`), quick add starts in the column's status only where the
 *   workflow allows the move from the start status, like the API (`createItem`).
 */

import type { CreateWorkItemInput } from '@/api/workItems';
import { dropTargetState } from '@/domain/board';
import { NONE_KEY } from '@/domain/grouping';
import { childTypeId, NO_CHILD_TYPE } from '@/domain/hierarchy';
import { canTakeWork } from '@/domain/people';
import { rankBetween } from '@/domain/rank';
import { canTransition, isClosedCategory } from '@/domain/workflow';
import type { GroupBy, Priority, Project, ProjectMember, State, StateCategory, User, Workflow, WorkItem, WorkItemType } from '@/types';

/** What the rules need to know about the board besides the item. */
export interface BoardRules {
  groupBy: GroupBy;
  /** The workflow of an item, through its project. */
  workflowOf: (item: WorkItem) => Workflow | undefined;
  /** The name of a column, as its heading says it. */
  columnLabel: (key: string) => string;
  /** Why the person cannot change the item (a missing right, archived), or null. */
  editReason?: (item: WorkItem) => string | null;
  /** Why a person cannot take the item, or null (assignee boards). */
  assignReason?: (userId: string, item: WorkItem) => string | null;
}

/** The fields a move changes. */
export interface MovePatch {
  state_id?: string;
  priority?: Priority;
  assignee_id?: string | null;
}

export type MoveCheck =
  | {
      ok: true;
      patch: MovePatch;
      /** The Completed or Canceled status the card moves into: the move asks for the resolution first. */
      closing: State | null;
    }
  | { ok: false; reason: string };

/** Moves that only change the place of a card within its column, and how the field is changed instead. */
const STAYS_IN_COLUMN: Partial<Record<GroupBy, string>> = {
  type: 'Nach Typ gruppiert bleiben Karten in ihrer Spalte. Den Typ änderst du mit T.',
  project: 'Nach Projekt gruppiert bleiben Karten in ihrer Spalte. Items wechseln das Projekt nicht.',
  parent: 'Nach Eltern-Item gruppiert bleiben Karten in ihrer Spalte. Das Eltern-Item änderst du mit ⇧P.',
  none: 'Ohne Gruppierung gibt es nur eine Spalte.',
};

/** Why no card of a board grouped like this can move, or null. */
export function boardLockReason(groupBy: GroupBy): string | null {
  return groupBy === 'label' ? 'Nach Label gruppierte Boards sind nicht ziehbar: Ein Item steht in der Spalte jedes seiner Labels. Labels änderst du mit L.' : null;
}

const stateIn = (workflow: Workflow, id: string) => workflow.states.find((state) => state.id === id);

/** The status move from `from` to `to`, checked against the workflow. */
function stateMove(workflow: Workflow, current: State | undefined, target: State | undefined): MoveCheck {
  if (!target) return { ok: false, reason: `Diesen Status gibt es im Workflow „${workflow.name}“ nicht.` };
  if (current?.id === target.id) return { ok: true, patch: {}, closing: null };
  return { ok: true, patch: { state_id: target.id }, closing: isClosedCategory(target.category) ? target : null };
}

/** What dropping the item from column `from` on column `to` changes, or why it is refused. The same column changes no field. */
export function checkMove(item: WorkItem, from: string, to: string, rules: BoardRules): MoveCheck {
  const locked = boardLockReason(rules.groupBy);
  if (locked) return { ok: false, reason: locked };
  const denied = rules.editReason?.(item);
  if (denied) return { ok: false, reason: denied };
  if (from === to) return { ok: true, patch: {}, closing: null };

  switch (rules.groupBy) {
    case 'state':
    case 'category': {
      const workflow = rules.workflowOf(item);
      if (!workflow) return { ok: false, reason: 'Der Workflow des Items ist noch nicht geladen.' };
      const current = stateIn(workflow, item.state_id);
      const target =
        rules.groupBy === 'state' ? { kind: 'state' as const, state_id: to } : { kind: 'category' as const, category: to as StateCategory };
      const next = dropTargetState(item, target, workflow);
      if (next === null) {
        return {
          ok: false,
          reason:
            rules.groupBy === 'state'
              ? `Von „${current?.name ?? 'unbekannt'}“ nach „${stateIn(workflow, to)?.name ?? rules.columnLabel(to)}“ ist im Workflow „${workflow.name}“ nicht erlaubt.`
              : `Im Workflow „${workflow.name}“ führt von „${current?.name ?? 'unbekannt'}“ kein Übergang nach ${rules.columnLabel(to)}.`,
        };
      }
      return stateMove(workflow, current, stateIn(workflow, next));
    }
    case 'priority':
      return { ok: true, patch: { priority: to as Priority }, closing: null };
    case 'assignee': {
      const assignee = to === NONE_KEY ? null : to;
      const blocked = assignee ? rules.assignReason?.(assignee, item) : null;
      return blocked ? { ok: false, reason: blocked } : { ok: true, patch: { assignee_id: assignee }, closing: null };
    }
    default:
      return { ok: false, reason: STAYS_IN_COLUMN[rules.groupBy] ?? 'Hierhin lässt sich die Karte nicht verschieben.' };
  }
}

/**
 * ⇧←/⇧→: the nearest column in a direction the card may move to. Columns the card may not enter are skipped; when
 * none is left, the reason names the neighbour (or the edge of the board).
 */
export function nearestAllowed(
  item: WorkItem,
  columnKeys: readonly string[],
  fromIndex: number,
  step: 1 | -1,
  rules: BoardRules,
): { ok: true; index: number; check: Extract<MoveCheck, { ok: true }> } | { ok: false; reason: string } {
  const from = columnKeys[fromIndex];
  let firstRefusal: string | null = null;
  for (let index = fromIndex + step; index >= 0 && index < columnKeys.length; index += step) {
    const check = checkMove(item, from, columnKeys[index], rules);
    if (check.ok) return { ok: true, index, check };
    firstRefusal ??= check.reason;
    // a refusal that holds for every column (no right, a locked board) is not worth repeating per column
    if (boardLockReason(rules.groupBy) || rules.editReason?.(item)) break;
  }
  return { ok: false, reason: firstRefusal ?? `„${rules.columnLabel(from)}“ ist die ${step === -1 ? 'erste' : 'letzte'} Spalte.` };
}

/**
 * The rank of a card placed between the card above and the card below it, in a column sorted by rank. In a descending
 * column the higher rank stands above. Two neighbours with the same rank (items of different projects number their
 * ranks alike) leave no room between them: the card then goes just past the one above.
 */
export function rankForSlot(above: string | null, below: string | null, direction: 'asc' | 'desc'): string {
  const [low, high] = direction === 'asc' ? [above, below] : [below, above];
  if (low !== null && high !== null && !(low < high)) return direction === 'asc' ? rankBetween(low, null) : rankBetween(null, high);
  return rankBetween(low, high);
}

/* ---------------------------------------------------------------------- quick add */

/** What a quick add in a column sets besides the title and the type. */
export type QuickAddFields = Pick<CreateWorkItemInput, 'project_id'> & Partial<Pick<CreateWorkItemInput, 'state_id' | 'priority' | 'assignee_id' | 'type_id' | 'label_ids' | 'parent_id'>>;

/** `types`: the organisation's types; a child in a parent's column takes one that may have a parent (`childTypeId`). */
export type QuickAddContext = BoardRules & { project: Project; workflow: Workflow; types?: readonly WorkItemType[] };

/**
 * The fields of an item made in a column: its value of the grouped field. A status other than the start status is a
 * move from the start status and needs the workflow's consent, like the API checks it (spec 4.5).
 */
export function quickAddFields(columnKey: string, ctx: QuickAddContext): { ok: true; fields: QuickAddFields } | { ok: false; reason: string } {
  const { project, workflow } = ctx;
  const fields: QuickAddFields = { project_id: project.id };
  const initial = stateIn(workflow, workflow.initial_state_id);
  const startsIn = `Neue Items starten in „${initial?.name ?? 'dem Startstatus'}“.`;

  switch (ctx.groupBy) {
    case 'state': {
      const target = stateIn(workflow, columnKey);
      if (!target) return { ok: false, reason: `Den Status „${ctx.columnLabel(columnKey)}“ gibt es im Workflow „${workflow.name}“ von ${project.identifier} nicht.` };
      if (!canTransition(workflow, workflow.initial_state_id, target.id)) {
        return { ok: false, reason: `${startsIn} Von dort nach „${target.name}“ ist im Workflow „${workflow.name}“ nicht erlaubt.` };
      }
      return { ok: true, fields: target.id === workflow.initial_state_id ? fields : { ...fields, state_id: target.id } };
    }
    case 'category': {
      const start = { state_id: workflow.initial_state_id } as WorkItem;
      const target = dropTargetState(start, { kind: 'category', category: columnKey as StateCategory }, workflow);
      if (target === null) return { ok: false, reason: `${startsIn} Von dort führt im Workflow „${workflow.name}“ kein Übergang nach ${ctx.columnLabel(columnKey)}.` };
      return { ok: true, fields: target === workflow.initial_state_id ? fields : { ...fields, state_id: target } };
    }
    case 'priority':
      return { ok: true, fields: { ...fields, priority: columnKey as Priority } };
    case 'assignee': {
      if (columnKey === NONE_KEY) return { ok: true, fields };
      const blocked = ctx.assignReason?.(columnKey, { project_id: project.id } as WorkItem);
      return blocked ? { ok: false, reason: blocked } : { ok: true, fields: { ...fields, assignee_id: columnKey } };
    }
    case 'type':
      if (!project.enabled_type_ids.includes(columnKey)) return { ok: false, reason: `Der Typ „${ctx.columnLabel(columnKey)}“ ist im Projekt ${project.identifier} nicht aktiviert.` };
      return { ok: true, fields: { ...fields, type_id: columnKey } };
    case 'label':
      return { ok: true, fields: columnKey === NONE_KEY ? fields : { ...fields, label_ids: [columnKey] } };
    case 'parent': {
      if (columnKey === NONE_KEY) return { ok: true, fields };
      // the default type may be an epic, which takes no parent (two levels)
      const typeId = childTypeId(project, ctx.types ?? []);
      return typeId ? { ok: true, fields: { ...fields, parent_id: columnKey, type_id: typeId } } : { ok: false, reason: NO_CHILD_TYPE };
    }
    case 'project':
    case 'none':
      return { ok: true, fields };
  }
}

/* ------------------------------------------------------------------------- people */

/**
 * Why an account cannot take an item of a project, or null: the rule of the API and the pickers (`canTakeWork`):
 * active members, and active people who are org admins.
 */
export function assignBlocker(user: User, project: Project, members: readonly ProjectMember[]): string | null {
  if (user.disabled_at !== null) return `${user.name} ist deaktiviert.`;
  const member = members.some((entry) => entry.project_id === project.id && entry.user_id === user.id);
  return canTakeWork(user, member) ? null : `${user.name} ist nicht Mitglied im Projekt ${project.identifier} und kann das Item nicht übernehmen.`;
}
