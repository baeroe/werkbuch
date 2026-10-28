import { describe, expect, it } from 'vitest';
import { agency, standard } from '@/domain/fixtures';
import type { State, Workflow } from '@/types';
import { countByState, mappingEffects, suggestMapping } from './mapping';

/** A copy of a workflow without the states of a category (and the transitions that led to or from them). */
function without(workflow: Workflow, category: State['category']): Workflow {
  const gone = new Set(workflow.states.filter((state) => state.category === category).map((state) => state.id));
  return {
    ...workflow,
    id: `${workflow.id}_without_${category}`,
    states: workflow.states.filter((state) => !gone.has(state.id)),
    transitions: workflow.transitions.filter(([from, to]) => !gone.has(from) && !gone.has(to)),
  };
}

describe('suggestMapping', () => {
  it('maps a state to the one with the same name and category in the new workflow', () => {
    expect(suggestMapping(standard, agency)).toMatchObject({
      std_backlog: 'app_backlog',
      std_todo: 'app_todo',
      std_progress: 'app_progress',
      std_done: 'app_done',
      std_cancelled: 'app_cancelled',
    });
  });

  it('maps a state without a namesake to the one of its category with the same shape', () => {
    // Pending (Started, pause) and Kundenfreigabe (Started, pause) are the same kind of waiting
    expect(suggestMapping(standard, agency).std_pending).toBe('app_approval');
    expect(suggestMapping(agency, standard).app_approval).toBe('std_pending');
  });

  it('falls back to the first state of the same category', () => {
    // Review (Started, three quarters) has no namesake and no twin in Standard
    expect(suggestMapping(agency, standard).app_review).toBe('std_progress');
  });

  it('falls back to a neighbouring category when the new workflow has none of that kind', () => {
    const noBacklog = suggestMapping(standard, without(standard, 'backlog'));
    expect(noBacklog.std_backlog).toBe('std_todo');

    // a canceled item stays closed: Completed is the nearest kind
    const noCanceled = suggestMapping(standard, without(standard, 'canceled'));
    expect(noCanceled.std_cancelled).toBe('std_done');
  });

  it('gives every state of the old workflow a state of the new one', () => {
    for (const [from, to] of [
      [standard, agency],
      [agency, standard],
      [standard, without(standard, 'unstarted')],
    ] as const) {
      const mapping = suggestMapping(from, to);
      expect(Object.keys(mapping).sort()).toEqual(from.states.map((state) => state.id).sort());
      for (const target of Object.values(mapping)) expect(to.states.some((state) => state.id === target)).toBe(true);
    }
  });
});

describe('countByState', () => {
  it('counts the items in each state', () => {
    const counts = countByState([{ state_id: 'a' }, { state_id: 'b' }, { state_id: 'a' }]);
    expect([...counts]).toEqual([
      ['a', 2],
      ['b', 1],
    ]);
  });
});

describe('mappingEffects', () => {
  const counts = new Map([
    ['std_todo', 5],
    ['std_done', 3],
    ['std_cancelled', 2],
  ]);

  it('counts the items that are rewritten', () => {
    expect(mappingEffects(standard, agency, suggestMapping(standard, agency), counts)).toEqual({ items: 10, reopened: 0, closed: 0 });
  });

  it('counts closed items that land in an open state as reopened, and open items that land in a closed one as closed', () => {
    const mapping = { ...suggestMapping(standard, agency), std_done: 'app_todo', std_todo: 'app_cancelled' };
    expect(mappingEffects(standard, agency, mapping, counts)).toEqual({ items: 10, reopened: 3, closed: 5 });
  });

  it('ignores states without items', () => {
    // Backlog holds nothing, so sending it to Done closes nobody
    const mapping = { ...suggestMapping(standard, agency), std_backlog: 'app_done' };
    expect(mappingEffects(standard, agency, mapping, counts)).toEqual({ items: 10, reopened: 0, closed: 0 });
  });
});
