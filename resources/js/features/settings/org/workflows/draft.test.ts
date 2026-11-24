/*
 * The draft of the workflow editor: what a copy is, how a new workflow starts, what counts as a change, the body of the
 * save with the steps of the agents only when they changed, and where a matrix starts.
 */

import { describe, expect, it } from 'vitest';
import { validateWorkflow } from '@/domain/workflow';
import { agency, standard } from '@/test/fixtures';
import type { Transition, Workflow } from '@/types';
import { agentStatesToSend, allPairs, blankDraft, comparable, copyDraftOf, draftOf, toInput, toWorkflow } from './draft';

// the agency workflow with its states out of order: the draft goes by position
const shuffled: Workflow = { ...agency, states: [...agency.states].reverse() };

describe('draftOf', () => {
  it('takes the states by position, without the position, and copies the transitions', () => {
    const draft = draftOf(shuffled);

    expect(draft.states.map((state) => state.id)).toEqual(agency.states.map((state) => state.id));
    expect(draft.states[0]).toEqual({ id: 'app_backlog', name: 'Backlog', icon: 'dashed', category: 'backlog' });
    expect(draft.transitions).toEqual(agency.transitions);
    expect(draft.transitions[0]).not.toBe(agency.transitions[0]);
    expect(draft).toMatchObject({ name: 'Agentur-Freigabe', is_default: false, is_free: false, initial_state_id: 'app_backlog' });
  });
});

describe('copyDraftOf', () => {
  it('gives every state a new id and lets the start and the transitions follow', () => {
    const copy = copyDraftOf(shuffled);
    const ids = new Map(agency.states.map((state, index) => [state.id, copy.states[index]!.id]));

    expect(copy.name).toBe('Agentur-Freigabe (Kopie)');
    expect(copy.states.map((state) => state.name)).toEqual(agency.states.map((state) => state.name));
    expect(copy.states.some((state) => agency.states.some((original) => original.id === state.id))).toBe(false);
    expect(new Set(copy.states.map((state) => state.id)).size).toBe(agency.states.length);
    expect(copy.initial_state_id).toBe(ids.get('app_backlog'));
    expect(copy.transitions).toEqual(agency.transitions.map(([from, to]) => [ids.get(from), ids.get(to)]));
    // the copy is as sound as the original
    expect(validateWorkflow(toWorkflow(copy, 'copy'))).toEqual([]);
  });

  it('is never the default, even of the default workflow', () => {
    const copy = copyDraftOf(standard);

    expect(standard.is_default).toBe(true);
    expect(copy.is_default).toBe(false);
    expect(copy.is_free).toBe(true);
  });

  it('keeps a transition that names no state of the workflow as it is', () => {
    const copy = copyDraftOf({ ...agency, transitions: [['app_backlog', 'gone']] });

    expect(copy.transitions[0]![1]).toBe('gone');
  });
});

describe('blankDraft', () => {
  it('starts free with five states from Backlog to Cancelled and Backlog as the start', () => {
    const draft = blankDraft();

    expect(draft.states.map((state) => [state.name, state.icon, state.category])).toEqual([
      ['Backlog', 'dashed', 'backlog'],
      ['Todo', 'circle', 'unstarted'],
      ['In Progress', 'half', 'started'],
      ['Done', 'check', 'completed'],
      ['Cancelled', 'cross', 'canceled'],
    ]);
    expect(draft).toMatchObject({ name: '', description: '', is_default: false, is_free: true, transitions: [] });
    expect(draft.initial_state_id).toBe(draft.states[0]!.id);
    expect(blankDraft().states[0]!.id).not.toBe(draft.states[0]!.id);
    expect(validateWorkflow(toWorkflow(draft, 'new'))).toEqual([]);
  });
});

describe('comparable', () => {
  it('ignores the order of the transitions and the spaces around names and the description', () => {
    const draft = draftOf(agency);
    const same = {
      ...draft,
      name: ' Agentur-Freigabe ',
      description: `${draft.description}\n`,
      states: draft.states.map((state) => ({ ...state, name: `${state.name}  ` })),
      transitions: [...draft.transitions].reverse(),
    };

    expect(comparable(same)).toBe(comparable(draft));
  });

  it('sees a change of a name, a state, the order of the states or a transition', () => {
    const draft = draftOf(agency);

    expect(comparable({ ...draft, name: 'Agentur' })).not.toBe(comparable(draft));
    expect(comparable({ ...draft, states: [...draft.states].reverse() })).not.toBe(comparable(draft));
    expect(comparable({ ...draft, states: draft.states.map((state) => ({ ...state, category: 'started' as const })) })).not.toBe(comparable(draft));
    expect(comparable({ ...draft, transitions: draft.transitions.slice(1) })).not.toBe(comparable(draft));
    expect(comparable({ ...draft, is_free: true })).not.toBe(comparable(draft));
  });
});

describe('toInput', () => {
  it('trims the texts and gives every state its position, with the id of the workflow when there is one', () => {
    const draft = { ...draftOf(shuffled), name: ' Agentur ', description: ' Mit Prüfung ' };
    draft.states[1] = { ...draft.states[1]!, name: ' Todo ' };

    const input = toInput(draft, agency);

    expect(input).toMatchObject({ id: 'wf_agency', name: 'Agentur', description: 'Mit Prüfung', is_default: false, is_free: false, initial_state_id: 'app_backlog' });
    expect(input.states.map((state) => [state.id, state.name, state.position])).toEqual(agency.states.map((state) => [state.id, state.id === 'app_todo' ? 'Todo' : state.name, state.position]));
    expect(input.transitions).toEqual(agency.transitions);
    expect(input).not.toHaveProperty('state_mapping');
    // the steps of the agents did not change: the server keeps them
    expect(input).not.toHaveProperty('agent_states');
    expect(toInput(blankDraft()).id).toBeUndefined();
    expect(toInput(blankDraft()).agent_states).toEqual({ working: null, review: null, correction: null, merged: null });
  });
});

describe('agentStatesToSend', () => {
  it('sends the steps of a new workflow, and of a saved one only when they changed', () => {
    expect(agentStatesToSend(draftOf(agency), null)).toEqual(agency.agent_states);
    expect(agentStatesToSend(draftOf(agency), agency)).toBeUndefined();
    const changed = { ...draftOf(agency), agent_states: { ...agency.agent_states, review: 'app_approval' } };
    expect(agentStatesToSend(changed, agency)).toEqual({ ...agency.agent_states, review: 'app_approval' });
    // a workflow the server has not given steps yet reads as none
    expect(agentStatesToSend(draftOf(standard), { ...standard, agent_states: undefined as never })).toBeUndefined();
  });

  it('lets a changed step on a removed status follow the status that takes over its items, when that one fits', () => {
    const draft = draftOf(agency);
    // In Review is removed, and the merged step changes
    const removed = { ...draft, states: draft.states.filter((state) => state.id !== 'app_review'), agent_states: { ...draft.agent_states, merged: null } };

    expect(agentStatesToSend(removed, agency, { app_review: 'app_approval' })).toEqual({ working: 'app_progress', review: 'app_approval', correction: 'app_todo', merged: null });
    // a target of another category, or none: the step goes empty
    expect(agentStatesToSend(removed, agency, { app_review: 'app_done' })?.review).toBeNull();
    expect(agentStatesToSend(removed, agency)?.review).toBeNull();
  });
});

describe('allPairs', () => {
  it('lets every state lead to every other, never to itself', () => {
    const pairs = allPairs([{ id: 'a' }, { id: 'b' }, { id: 'c' }]);

    expect(pairs).toEqual<Transition[]>([
      ['a', 'b'],
      ['a', 'c'],
      ['b', 'a'],
      ['b', 'c'],
      ['c', 'a'],
      ['c', 'b'],
    ]);
    expect(allPairs(agency.states)).toHaveLength(7 * 6);
    expect(allPairs([])).toEqual([]);
  });
});

describe('toWorkflow', () => {
  it('numbers the states by their place in the draft', () => {
    const workflow = toWorkflow(draftOf(shuffled), 'wf_x');

    expect(workflow.id).toBe('wf_x');
    expect(workflow.states.map((state) => state.position)).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });
});
