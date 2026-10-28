/*
 * Rules the automation settings need to know (spec 4.13). Auto-Close moves items from Backlog or Unstarted to a chosen
 * Canceled status, and skips an item when the workflow does not allow that move.
 */

import { canTransition, statesInOrder } from '@/domain/workflow';
import type { State, Workflow } from '@/types';

/** The states Auto-Close can move items to: those of the category Canceled. Empty when the workflow has none. */
export function cancelTargets(workflow: Workflow): State[] {
  return statesInOrder(workflow).filter((state) => state.category === 'canceled');
}

/** The Backlog and Unstarted states whose items Auto-Close would skip, because the workflow forbids the move to the target. */
export function skippedByAutoClose(workflow: Workflow, targetStateId: string): State[] {
  return statesInOrder(workflow).filter(
    (state) => (state.category === 'backlog' || state.category === 'unstarted') && !canTransition(workflow, state.id, targetStateId),
  );
}

/** A number of days as typed: a whole number from 1 up. Null for anything else. */
export function parseDays(text: string): number | null {
  const trimmed = text.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const days = Number(trimmed);
  return days >= 1 ? days : null;
}
