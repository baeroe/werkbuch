import { describe, expect, it } from 'vitest';
import type { StateCategory, Workflow } from '@/types';
import { agency, standard } from '@/test/fixtures';
import { allowedTargets, canTransition, isClosedCategory, validateWorkflow } from './workflow';

/** The workflow with every transition that leads into `stateId` removed. */
function withoutTransitionsInto(wf: Workflow, stateId: string): Workflow {
  return { ...wf, transitions: wf.transitions.filter(([, to]) => to !== stateId) };
}

describe('canTransition', () => {
  it('rejects a transition the matrix does not list (todo to done in Agentur-Freigabe)', () => {
    expect(canTransition(agency, 'app_todo', 'app_done')).toBe(false);
  });

  it('allows a listed transition (Kundenfreigabe to done)', () => {
    expect(canTransition(agency, 'app_approval', 'app_done')).toBe(true);
  });

  it('allows an open status to move to cancelled', () => {
    expect(canTransition(agency, 'app_progress', 'app_cancelled')).toBe(true);
  });

  it('allows every transition in a free workflow', () => {
    expect(canTransition(standard, 'std_todo', 'std_done')).toBe(true);
  });

  it('treats staying in the same status as an allowed no-op', () => {
    expect(canTransition(agency, 'app_review', 'app_review')).toBe(true); // no-op
  });

  it('reopens a closed item only through the listed transitions', () => {
    expect(canTransition(agency, 'app_done', 'app_todo')).toBe(true);
    expect(canTransition(agency, 'app_done', 'app_cancelled')).toBe(false);
    expect(canTransition(agency, 'app_cancelled', 'app_backlog')).toBe(true);
  });

  it('rejects a target that is not a status of the workflow, even in a free workflow', () => {
    expect(canTransition(standard, 'std_todo', 'app_done')).toBe(false);
  });
});

describe('allowedTargets', () => {
  it('lists the statuses reachable from review, in the order of the workflow, without review itself', () => {
    expect(allowedTargets(agency, 'app_review').map((s) => s.id)).toEqual(['app_progress', 'app_approval', 'app_cancelled']);
  });

  it('offers only the listed transitions of todo (progress and cancelled)', () => {
    expect(allowedTargets(agency, 'app_todo').map((s) => s.id)).toEqual(['app_progress', 'app_cancelled']);
  });

  it('offers every other status in a free workflow', () => {
    expect(allowedTargets(standard, 'std_todo').map((s) => s.id)).toEqual([
      'std_backlog',
      'std_progress',
      'std_pending',
      'std_done',
      'std_cancelled',
    ]);
  });

  it('orders by position, not by the order of the states array', () => {
    const shuffled: Workflow = { ...agency, states: [...agency.states].reverse() };

    expect(allowedTargets(shuffled, 'app_review').map((s) => s.id)).toEqual(['app_progress', 'app_approval', 'app_cancelled']);
  });
});

describe('validateWorkflow', () => {
  it('finds nothing wrong with the shipped workflows', () => {
    expect(validateWorkflow(standard)).toEqual([]);
    expect(validateWorkflow(agency)).toEqual([]);
  });

  it('reports a workflow without a completed status', () => {
    expect(validateWorkflow({ ...agency, states: agency.states.filter((s) => s.category !== 'completed') })).toContainEqual({
      code: 'no_completed_state',
    });
  });

  it('reports a status that no transition leads to as unreachable', () => {
    expect(validateWorkflow(withoutTransitionsInto(agency, 'app_review'))).toContainEqual({
      code: 'unreachable_state',
      state_id: 'app_review',
    });
  });

  it('reports everything behind the unreachable status as unreachable too', () => {
    const issues = validateWorkflow(withoutTransitionsInto(agency, 'app_review'));

    // Kundenfreigabe and Done can only be reached through Review
    expect(issues).toContainEqual({ code: 'unreachable_state', state_id: 'app_approval' });
    expect(issues).toContainEqual({ code: 'unreachable_state', state_id: 'app_done' });
    expect(issues).not.toContainEqual({ code: 'unreachable_state', state_id: 'app_progress' });
  });

  it('reports an initial status that is not part of the workflow, and nothing else about reachability', () => {
    expect(validateWorkflow({ ...agency, initial_state_id: 'gone' })).toEqual([{ code: 'no_initial_state' }]);
  });

  it('does not check reachability in a free workflow', () => {
    expect(validateWorkflow({ ...standard, transitions: [] })).toEqual([]);
  });

  it('ignores transitions that point at statuses which no longer exist', () => {
    const withoutDone: Workflow = { ...agency, states: agency.states.filter((s) => s.id !== 'app_done') };

    expect(validateWorkflow(withoutDone)).toContainEqual({ code: 'no_completed_state' });
    expect(validateWorkflow(withoutDone)).not.toContainEqual(expect.objectContaining({ code: 'unreachable_state' }));
  });
});

describe('isClosedCategory', () => {
  it('is true for completed and canceled only', () => {
    const categories: StateCategory[] = ['backlog', 'unstarted', 'started', 'completed', 'canceled'];

    expect(categories.map(isClosedCategory)).toEqual([false, false, false, true, true]);
  });
});
