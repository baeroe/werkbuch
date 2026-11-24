/*
 * What the workflow editor holds while it is open: a workflow as the form changes it, before anything is saved. Pure
 * functions only, so the rules (a copy is a workflow of its own, a matrix starts with everything allowed, what counts as
 * a change, which steps of the agents go with a save) are tested without a screen.
 */

import type { WorkflowInput } from '@/api/workflows';
import { statesInOrder } from '@/domain/workflow';
import { t } from '@/lib/i18n';
import { AGENT_STEPS, fitsStep, NO_STEPS, type AgentSteps } from '@/domain/agents';
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
  /** The status per step of the agents (spec 7.4): ids of `states`, or of a status removed in this draft. */
  agent_states: AgentSteps;
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
    agent_states: { ...NO_STEPS, ...workflow.agent_states },
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
    agent_states: Object.fromEntries(AGENT_STEPS.map((step) => [step, draft.agent_states[step] === null ? null : next(draft.agent_states[step])])) as AgentSteps,
  };
}

/** A new workflow: five statuses from Backlog to Cancelled, free, Backlog as the start. */
export function blankDraft(): Draft {
  const states = NEW_WORKFLOW_STATES.map((state) => ({ ...state, id: localId('st') }));
  return { name: '', description: '', is_default: false, is_free: true, initial_state_id: states[0]!.id, states, transitions: [], agent_states: { ...NO_STEPS } };
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

/**
 * The steps of the agents a save sends, or `undefined` to leave them to the server. The server takes sent steps as
 * they are (a step on a removed status is a 422) and, without them, lets the stored ones follow `state_mapping`
 * (`WorkflowInput::agentStates`). So they go only when they changed (a new workflow: always), and then a step on a
 * status this save removes takes the status that takes over its items, when that one fits the step, else none:
 * what the server would have done.
 */
export function agentStatesToSend(draft: Draft, saved: Workflow | null, stateMapping: Record<string, string> = {}): AgentSteps | undefined {
  const stored = { ...NO_STEPS, ...saved?.agent_states };
  if (saved && AGENT_STEPS.every((step) => draft.agent_states[step] === stored[step])) return undefined;
  const states = new Map(draft.states.map((state) => [state.id, state]));
  return Object.fromEntries(
    AGENT_STEPS.map((step) => {
      const id = draft.agent_states[step];
      if (id === null || states.has(id)) return [step, id];
      const target = states.get(stateMapping[id] ?? '');
      return [step, target && fitsStep(step, target.category) ? target.id : null];
    }),
  ) as AgentSteps;
}

/**
 * The body of the save: texts trimmed, every status with its position, the steps of the agents only when they changed
 * against `saved` (`agentStatesToSend`; `state_mapping` goes beside it, `saveWorkflow`).
 */
export function toInput(draft: Draft, saved: Workflow | null = null, stateMapping?: Record<string, string>): WorkflowInput {
  const agentStates = agentStatesToSend(draft, saved, stateMapping);
  return {
    id: saved?.id,
    name: draft.name.trim(),
    description: draft.description.trim(),
    is_default: draft.is_default,
    is_free: draft.is_free,
    initial_state_id: draft.initial_state_id,
    states: draft.states.map((state, position) => ({ id: state.id, name: state.name.trim(), icon: state.icon, category: state.category, position })),
    transitions: draft.transitions.map(([from, to]): Transition => [from, to]),
    ...(agentStates ? { agent_states: agentStates } : {}),
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
