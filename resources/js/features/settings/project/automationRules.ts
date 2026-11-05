/*
 * Rules the automation settings need to know (spec 4.13, port of the clickdummy). Auto-Close moves items from Backlog
 * or Unstarted to a chosen Canceled status, and skips an item when the workflow does not allow that move. When the
 * project switches its workflow, Auto-Close follows (A345, `FollowWorkflow` on the server): the state the mapping gives
 * its old one when that is a Canceled one, otherwise the first Canceled state, otherwise it switches off.
 */

import { canTransition, statesInOrder } from '@/domain/workflow';
import type { State, Workflow } from '@/types';

/** The most days a nightly automation waits (`AutomationKey::MAX_DAYS`); the least is 1. */
export const MAX_DAYS = 3650;

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

/** A number of days as typed: a whole number from 1 to `MAX_DAYS`. Null for anything else. */
export function parseDays(text: string): number | null {
  const trimmed = text.trim();
  if (!/^\d{1,4}$/.test(trimmed)) return null;
  const days = Number(trimmed);
  return days >= 1 && days <= MAX_DAYS ? days : null;
}

/**
 * The state Auto-Close moves items into after the project switched to `workflow` with `mapping` (old state → new
 * state): its state when that is a Canceled one of the workflow already, else the one the mapping names for it when
 * that is Canceled, else the first Canceled state; null when the workflow has none (Auto-Close switches off).
 */
export function autoCloseAfter(stateId: string | null | undefined, workflow: Workflow, mapping: Readonly<Record<string, string>>): State | null {
  const canceled = cancelTargets(workflow);
  const mapped = stateId ? mapping[stateId] : undefined;
  return canceled.find((state) => state.id === stateId) ?? canceled.find((state) => state.id === mapped) ?? canceled[0] ?? null;
}
