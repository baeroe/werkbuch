/*
 * What a board lets a card do (spec 4.5, 4.11), as pure functions the board, its keyboard and its quick add share:
 * - a card dropped on another column changes the grouped field: the status (only where the workflow allows the
 *   transition), the priority or the assignee; on a category column it takes the first status of that category the
 *   item's workflow allows (`dropTargetState`); a move into Completed or Canceled asks for the resolution
 * - a board grouped by label does not move cards at all (an item stands in the column of each of its labels); by
 *   type, project or parent a card only changes its place within its column
 * - the reason of a refusal is a code with parameters (`BoardReason`); the sentence is the key
 *   `items.board.reason.<code>`, filled with the parameters, for the toast and the column under the dragged card. Why
 *   the person may not change the item is a finished sentence of the permissions (`{ sentence }`); who cannot take an
 *   item is `assignBlocker`'s own reason, passed through as it is
 * - the order within a column is the rank (`rankForSlot`), quick add starts in the column's status only where the
 *   workflow allows the move from the start status, like the API (`createWorkItem`).
 */

import type { CreateWorkItemInput } from '@/api/workItems';
import type { GroupBy, ListedItem, Priority, Project, ProjectMember, State, StateCategory, User, Workflow, WorkItemType } from '@/types';
import { dropTargetState } from './board';
import { NONE_KEY } from './grouping';
import { childTypeId } from './hierarchy';
import { canTakeWork } from './people';
import { rankBetween } from './rank';
import { canTransition, isClosedCategory } from './workflow';

/** The longest rank the server takes (`ItemInput::RANK_MAX`). */
export const RANK_MAX = 128;

/**
 * Why a card cannot go where it was dropped; the sentence is `items.board.reason.<code>` with the parameters. A status
 * name the rules do not know (`from`, `initial`) is empty: the sentence names it as an unknown status (`reasonText`).
 * A refusal of the permissions comes as their finished sentence.
 */
export type BoardReason = { code: BoardReasonCode; params: Record<string, string> } | { sentence: string };

export type BoardReasonCode =
    | 'transition'
    | 'category'
    | 'stays_type'
    | 'stays_project'
    | 'stays_parent'
    | 'single_column'
    | 'label_locked'
    | 'first_column'
    | 'last_column'
    | 'workflow_loading'
    | 'no_room'
    | 'load_more'
    | 'state_unknown'
    | 'start_transition'
    | 'start_category'
    | 'type_disabled'
    | 'no_child_type'
    | 'not_member'
    | 'deactivated';

const reason = (code: BoardReasonCode, params: Record<string, string> = {}): BoardReason => ({ code, params });

/** What the rules need to know about the board besides the item. */
export interface BoardRules {
  groupBy: GroupBy;
  /** The workflow of an item, through its project. */
  workflowOf: (item: ListedItem) => Workflow | undefined;
  /** The name of a column, as its heading says it. */
  columnLabel: (key: string) => string;
  /** Why the person cannot change the item (a missing right, archived), as a sentence, or null. */
  editReason?: (item: ListedItem) => string | null;
  /** Why a person cannot take the item, or null (assignee boards): `assignBlocker` with what the board knows. */
  assignReason?: (userId: string, item: ListedItem) => BoardReason | null;
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
  | { ok: false; reason: BoardReason };

/** Moves that only change the place of a card within its column. */
const STAYS_IN_COLUMN = {
  type: 'stays_type',
  project: 'stays_project',
  parent: 'stays_parent',
  none: 'single_column',
} as const;

/** Why no card of a board grouped like this can move, or null. */
export function boardLockReason(groupBy: GroupBy): BoardReason | null {
  return groupBy === 'label' ? reason('label_locked') : null;
}

const stateIn = (workflow: Workflow, id: string) => workflow.states.find((state) => state.id === id);

/** What dropping the item from column `from` on column `to` changes, or why it is refused. The same column changes no field. */
export function checkMove(item: ListedItem, from: string, to: string, rules: BoardRules): MoveCheck {
  const locked = boardLockReason(rules.groupBy);
  if (locked) return { ok: false, reason: locked };
  const denied = rules.editReason?.(item);
  if (denied) return { ok: false, reason: { sentence: denied } };
  if (from === to) return { ok: true, patch: {}, closing: null };

  switch (rules.groupBy) {
    case 'state':
    case 'category': {
      const workflow = rules.workflowOf(item);
      if (!workflow) return { ok: false, reason: reason('workflow_loading') };
      const current = stateIn(workflow, item.state_id);
      const target =
        rules.groupBy === 'state' ? { kind: 'state' as const, state_id: to } : { kind: 'category' as const, category: to as StateCategory };
      const next = dropTargetState(item, target, workflow);
      if (next === null) {
        const params = { from: current?.name ?? '', workflow: workflow.name };
        return {
          ok: false,
          reason:
            rules.groupBy === 'state'
              ? reason('transition', { ...params, to: stateIn(workflow, to)?.name ?? rules.columnLabel(to) })
              : reason('category', { ...params, to: rules.columnLabel(to) }),
        };
      }
      // dropTargetState returns a status of the workflow; a workflow that changed since (an older cache) may lack it
      const nextState = stateIn(workflow, next);
      if (!nextState) return { ok: false, reason: reason('transition', { from: current?.name ?? '', workflow: workflow.name, to: rules.columnLabel(to) }) };
      if (current?.id === nextState.id) return { ok: true, patch: {}, closing: null };
      return { ok: true, patch: { state_id: nextState.id }, closing: isClosedCategory(nextState.category) ? nextState : null };
    }
    case 'priority':
      return { ok: true, patch: { priority: to as Priority }, closing: null };
    case 'assignee': {
      const assignee = to === NONE_KEY ? null : to;
      const blocked = assignee ? rules.assignReason?.(assignee, item) : null;
      return blocked ? { ok: false, reason: blocked } : { ok: true, patch: { assignee_id: assignee }, closing: null };
    }
    default:
      // the other groupings only change the place within the column (a board by label is locked above)
      return { ok: false, reason: reason(STAYS_IN_COLUMN[rules.groupBy as keyof typeof STAYS_IN_COLUMN]) };
  }
}

/**
 * ⇧←/⇧→: the nearest column in a direction the card may move to. Columns the card may not enter are skipped; when
 * none is left, the reason names the neighbour (or the edge of the board).
 */
export function nearestAllowed(
  item: ListedItem,
  columnKeys: readonly string[],
  fromIndex: number,
  step: 1 | -1,
  rules: BoardRules,
): { ok: true; index: number; check: Extract<MoveCheck, { ok: true }> } | { ok: false; reason: BoardReason } {
  const from = columnKeys[fromIndex];
  let firstRefusal: BoardReason | null = null;
  for (let index = fromIndex + step; index >= 0 && index < columnKeys.length; index += step) {
    const check = checkMove(item, from, columnKeys[index], rules);
    if (check.ok) return { ok: true, index, check };
    firstRefusal ??= check.reason;
    // a refusal that holds for every column (no right, a locked board) is not worth repeating per column
    if (boardLockReason(rules.groupBy) || rules.editReason?.(item)) break;
  }
  return { ok: false, reason: firstRefusal ?? reason(step === -1 ? 'first_column' : 'last_column', { column: rules.columnLabel(from) }) };
}

/**
 * The rank of a card placed between the card above and the card below it, in a column sorted by rank. In a descending
 * column the higher rank stands above. Two neighbours with the same rank (items of different projects number their
 * ranks alike) leave no room between them: the card then goes just past the one above. `null` when the rank would grow
 * past `RANK_MAX` characters, which the server refuses (P23): the board then has the server redistribute the ranks of
 * the card's project and asks once more with the fresh neighbours (A448); only where they belong to another project is
 * there still no room, and the card stays where it is.
 */
export function rankForSlot(above: string | null, below: string | null, direction: 'asc' | 'desc'): string | null {
  const [low, high] = direction === 'asc' ? [above, below] : [below, above];
  const crowded = low !== null && high !== null && !(low < high);
  const rank = crowded ? (direction === 'asc' ? rankBetween(low, null) : rankBetween(null, high)) : rankBetween(low, high);
  return rank.length > RANK_MAX ? null : rank;
}

/* ---------------------------------------------------------------------- quick add */

/** What a quick add in a column sets besides the title and the type. */
export type QuickAddFields = Pick<CreateWorkItemInput, 'project_id'> &
  Partial<Pick<CreateWorkItemInput, 'state_id' | 'priority' | 'assignee_id' | 'type_id' | 'label_ids' | 'parent_id'>>;

/** `types`: the organisation's types; a child in a parent's column takes one that may have a parent (`childTypeId`). */
export type QuickAddContext = BoardRules & { project: Project; workflow: Workflow; types?: readonly WorkItemType[] };

/**
 * The fields of an item made in a column: its value of the grouped field. A status other than the start status is a
 * move from the start status and needs the workflow's consent, like the API checks it (spec 4.5).
 */
export function quickAddFields(columnKey: string, ctx: QuickAddContext): { ok: true; fields: QuickAddFields } | { ok: false; reason: BoardReason } {
  const { project, workflow } = ctx;
  const fields: QuickAddFields = { project_id: project.id };
  const initial = stateIn(workflow, workflow.initial_state_id)?.name ?? '';

  switch (ctx.groupBy) {
    case 'state': {
      const target = stateIn(workflow, columnKey);
      if (!target) {
        return { ok: false, reason: reason('state_unknown', { column: ctx.columnLabel(columnKey), workflow: workflow.name, project: project.identifier }) };
      }
      if (!canTransition(workflow, workflow.initial_state_id, target.id)) {
        return { ok: false, reason: reason('start_transition', { initial, to: target.name, workflow: workflow.name }) };
      }
      return { ok: true, fields: target.id === workflow.initial_state_id ? fields : { ...fields, state_id: target.id } };
    }
    case 'category': {
      const start = { state_id: workflow.initial_state_id };
      const target = dropTargetState(start, { kind: 'category', category: columnKey as StateCategory }, workflow);
      if (target === null) {
        return { ok: false, reason: reason('start_category', { initial, column: ctx.columnLabel(columnKey), workflow: workflow.name }) };
      }
      return { ok: true, fields: target === workflow.initial_state_id ? fields : { ...fields, state_id: target } };
    }
    case 'priority':
      return { ok: true, fields: { ...fields, priority: columnKey as Priority } };
    case 'assignee': {
      if (columnKey === NONE_KEY) return { ok: true, fields };
      const blocked = ctx.assignReason?.(columnKey, { project_id: project.id } as ListedItem);
      return blocked ? { ok: false, reason: blocked } : { ok: true, fields: { ...fields, assignee_id: columnKey } };
    }
    case 'type':
      if (!project.enabled_type_ids.includes(columnKey)) {
        return { ok: false, reason: reason('type_disabled', { type: ctx.columnLabel(columnKey), project: project.identifier }) };
      }
      return { ok: true, fields: { ...fields, type_id: columnKey } };
    case 'label':
      return { ok: true, fields: columnKey === NONE_KEY ? fields : { ...fields, label_ids: [columnKey] } };
    case 'parent': {
      if (columnKey === NONE_KEY) return { ok: true, fields };
      // the default type may be an epic, which takes no parent (two levels)
      const typeId = childTypeId(project, ctx.types ?? []);
      return typeId ? { ok: true, fields: { ...fields, parent_id: columnKey, type_id: typeId } } : { ok: false, reason: reason('no_child_type') };
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
export function assignBlocker(user: User, project: Project, members: readonly ProjectMember[]): BoardReason | null {
  if (user.disabled_at !== null) return reason('deactivated', { name: user.name });
  const member = members.some((entry) => entry.project_id === project.id && entry.user_id === user.id);
  return canTakeWork(user, member) ? null : reason('not_member', { name: user.name, project: project.identifier });
}
