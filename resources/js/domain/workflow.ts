/*
 * Workflows (spec 4.5): which transitions are allowed, and whether a workflow can be saved.
 */

import type { State, StateCategory, Workflow } from '@/types';

/** The categories from left to right: how boards, lists and sorting arrange them. */
export const CATEGORY_ORDER: readonly StateCategory[] = ['backlog', 'unstarted', 'started', 'completed', 'canceled'];

/** Completed and canceled items are closed; everything else is open. */
export function isClosedCategory(category: StateCategory): category is 'completed' | 'canceled' {
  return category === 'completed' || category === 'canceled';
}

/** The states of a workflow by position. */
export function statesInOrder(wf: Workflow): State[] {
  return [...wf.states].sort((a, b) => a.position - b.position);
}

/**
 * Whether an item may move from one state to another. Staying in the same state is a no-op and always allowed.
 * A free workflow allows every state of the workflow; any other one only the listed pairs.
 */
export function canTransition(wf: Workflow, from: string, to: string): boolean {
  if (from === to) return true;
  if (!wf.states.some((state) => state.id === to)) return false;
  if (wf.is_free) return true;
  return wf.transitions.some(([transitionFrom, transitionTo]) => transitionFrom === from && transitionTo === to);
}

/** The states an item in `from` can move to, by position, without `from` itself. */
export function allowedTargets(wf: Workflow, from: string): State[] {
  return statesInOrder(wf).filter((state) => state.id !== from && canTransition(wf, from, state.id));
}

export interface WorkflowIssue {
  code: 'no_initial_state' | 'no_completed_state' | 'unreachable_state';
  /** Set for `unreachable_state`. */
  state_id?: string;
}

/** The ids of the states reachable from `start` over the listed transitions. */
function reachableStates(wf: Workflow, start: string): Set<string> {
  const known = new Set(wf.states.map((state) => state.id));
  const reached = new Set([start]);
  // `reached` keeps insertion order, so iterating it visits states in the order they were found (breadth first)
  for (const current of reached) {
    for (const [from, to] of wf.transitions) {
      if (from === current && known.has(to)) reached.add(to);
    }
  }
  return reached;
}

/**
 * What stops a workflow from being saved: it needs a start state that is one of its states, at least one Completed
 * state, and every state must be reachable from the start state. A free workflow reaches everything. Without a start
 * state reachability cannot be judged, so it is not reported.
 */
export function validateWorkflow(wf: Workflow): WorkflowIssue[] {
  const issues: WorkflowIssue[] = [];

  const hasInitialState = wf.states.some((state) => state.id === wf.initial_state_id);
  if (!hasInitialState) issues.push({ code: 'no_initial_state' });

  if (!wf.states.some((state) => state.category === 'completed')) issues.push({ code: 'no_completed_state' });

  if (hasInitialState && !wf.is_free) {
    const reachable = reachableStates(wf, wf.initial_state_id);
    for (const state of statesInOrder(wf)) {
      if (!reachable.has(state.id)) issues.push({ code: 'unreachable_state', state_id: state.id });
    }
  }

  return issues;
}
