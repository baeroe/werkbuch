/*
 * What the workflow editor holds while it is open: a workflow as the form changes it, before anything is saved. Pure
 * functions only, so the rules (a copy is a workflow of its own, a matrix starts with everything allowed, what counts as
 * a change) are tested without a screen.
 */

import type { WorkflowInput } from '@/api/workflows';
import { statesInOrder } from '@/domain/workflow';
import { t } from '@/lib/i18n';
import type { StateCategory, StateIcon, Transition, Workflow } from '@/types';
import { localId } from '../../catalog/localId';

export interface DraftState {
  id: string;
  name: string;
  icon: StateIcon;
  category: StateCategory;
}

export interface Draft {
  name: string;
  description: string;
  is_default: boolean;
  is_free: boolean;
  initial_state_id: string;
  /** In the order the form shows them; the position is the index. */
  states: DraftState[];
  transitions: Transition[];
}

/** The statuses a new workflow starts with (as the clickdummy). */
const NEW_WORKFLOW_STATES: Omit<DraftState, 'id'>[] = [
  { name: 'Backlog', icon: 'dashed', category: 'backlog' },
  { name: 'Todo', icon: 'circle', category: 'unstarted' },
  { name: 'In Progress', icon: 'half', category: 'started' },
  { name: 'Done', icon: 'check', category: 'completed' },
  { name: 'Cancelled', icon: 'cross', category: 'canceled' },
];

export function draftOf(workflow: Workflow): Draft {
  return {
    name: workflow.name,
    description: workflow.description,
    is_default: workflow.is_default,
    is_free: workflow.is_free,
    initial_state_id: workflow.initial_state_id,
    states: statesInOrder(workflow).map(({ id, name, icon, category }) => ({ id, name, icon, category })),
    transitions: workflow.transitions.map(([from, to]): Transition => [from, to]),
  };
}

/** A copy is a workflow of its own: its statuses get new ids (the transitions follow), and it is never the default. */
export function copyDraftOf(workflow: Workflow): Draft {
  const draft = draftOf(workflow);
  const renamed = new Map(draft.states.map((state) => [state.id, localId('st')]));
  const next = (id: string) => renamed.get(id) ?? id;
  return {
    ...draft,
    name: t('settings.workflows.copy_name', { name: draft.name }),
    is_default: false,
    initial_state_id: next(draft.initial_state_id),
    states: draft.states.map((state) => ({ ...state, id: next(state.id) })),
    transitions: draft.transitions.map(([from, to]): Transition => [next(from), next(to)]),
  };
}

/** A new workflow: five statuses from Backlog to Cancelled, free, Backlog as the start. */
export function blankDraft(): Draft {
  const states = NEW_WORKFLOW_STATES.map((state) => ({ ...state, id: localId('st') }));
  return { name: '', description: '', is_default: false, is_free: true, initial_state_id: states[0]!.id, states, transitions: [] };
}

/** The draft in a form that does not care for the order of transitions or for spaces around names: equal means unchanged. */
export function comparable(draft: Draft): string {
  return JSON.stringify({
    ...draft,
    name: draft.name.trim(),
    description: draft.description.trim(),
    states: draft.states.map((state) => ({ ...state, name: state.name.trim() })),
    transitions: draft.transitions.map(([from, to]) => `${from}>${to}`).sort(),
  });
}

/** The body of the save: texts trimmed, every status with its position. `state_mapping` comes with Phase 4 (P28). */
export function toInput(draft: Draft, id?: string): WorkflowInput {
  return {
    id,
    name: draft.name.trim(),
    description: draft.description.trim(),
    is_default: draft.is_default,
    is_free: draft.is_free,
    initial_state_id: draft.initial_state_id,
    states: draft.states.map((state, position) => ({ id: state.id, name: state.name.trim(), icon: state.icon, category: state.category, position })),
    transitions: draft.transitions.map(([from, to]): Transition => [from, to]),
  };
}

/** Every status may lead to every other, never to itself: where a matrix starts when a free workflow gets one. */
export function allPairs(states: readonly Pick<DraftState, 'id'>[]): Transition[] {
  return states.flatMap((from) => states.filter((to) => to.id !== from.id).map((to): Transition => [from.id, to.id]));
}

/** The draft as a workflow, for `validateWorkflow` and the matrix. */
export function toWorkflow(draft: Draft, id: string): Workflow {
  return { ...draft, id, states: draft.states.map((state, position) => ({ ...state, position })) };
}
