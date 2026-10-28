/*
 * Board rules (spec 4.11): where a dropped card ends up.
 */

import type { StateCategory, Workflow, WorkItem } from '@/types';
import { canTransition, statesInOrder } from './workflow';

/** What a card was dropped on: a status column, or (with mixed workflows) a category column. */
export type DropTarget = { kind: 'state'; state_id: string } | { kind: 'category'; category: StateCategory };

/**
 * The status an item gets when it is dropped on a column, or null when the drop is not allowed.
 * - On a status column: that status, if the workflow allows the transition.
 * - On a category column: the first status of that category (by position) the workflow lets the item move to. An item
 *   dropped on the column of its own category keeps its status.
 * Staying put gives the item's own status back, which the caller treats as "nothing to change".
 */
export function dropTargetState(item: WorkItem, target: DropTarget, wf: Workflow): string | null {
  if (target.kind === 'state') {
    return canTransition(wf, item.state_id, target.state_id) ? target.state_id : null;
  }

  const current = wf.states.find((state) => state.id === item.state_id);
  if (current?.category === target.category) return current.id;

  const reachable = statesInOrder(wf).find(
    (state) => state.category === target.category && canTransition(wf, item.state_id, state.id),
  );
  return reachable?.id ?? null;
}
