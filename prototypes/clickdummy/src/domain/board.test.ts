import { describe, expect, it } from 'vitest';
import type { Workflow } from '@/types';
import { agency, makeWorkItem, standard } from './fixtures';
import { dropTargetState } from './board';

const appTodoItem = makeWorkItem({ id: 'wi_app_1', project_id: 'p_app', key: 'APP-1', state_id: 'app_todo' });
const appApprovalItem = makeWorkItem({ id: 'wi_app_2', project_id: 'p_app', key: 'APP-2', state_id: 'app_approval' });
const webTodoItem = makeWorkItem({ id: 'wi_web_1', project_id: 'p_web', key: 'WEB-1', state_id: 'std_todo' });

describe('dropTargetState', () => {
  describe('on a category column', () => {
    it('refuses when no status of the category can be reached (todo to completed in Agentur-Freigabe)', () => {
      expect(dropTargetState(appTodoItem, { kind: 'category', category: 'completed' }, agency)).toBeNull();
    });

    it('picks the status of the category the workflow allows (Kundenfreigabe to completed is Done)', () => {
      expect(dropTargetState(appApprovalItem, { kind: 'category', category: 'completed' }, agency)).toBe('app_done');
    });

    it('picks the first status of the category in a free workflow', () => {
      expect(dropTargetState(webTodoItem, { kind: 'category', category: 'started' }, standard)).toBe('std_progress');
    });

    it('skips a first status of the category that is not allowed and takes the next that is', () => {
      const detour: Workflow = {
        ...agency,
        states: [
          { id: 's_a', name: 'A', icon: 'circle', category: 'unstarted', position: 0 },
          { id: 's_b', name: 'B', icon: 'half', category: 'started', position: 1 },
          { id: 's_c', name: 'C', icon: 'three-quarter', category: 'started', position: 2 },
        ],
        initial_state_id: 's_a',
        transitions: [['s_a', 's_c']],
      };
      const atA = makeWorkItem({ state_id: 's_a' });

      expect(dropTargetState(atA, { kind: 'category', category: 'started' }, detour)).toBe('s_c');
    });

    it('takes the first allowed status of the category in a restricted workflow', () => {
      expect(dropTargetState(appTodoItem, { kind: 'category', category: 'started' }, agency)).toBe('app_progress');
    });

    it('leaves the status alone when the item is dropped on the column of its own category', () => {
      const pending = makeWorkItem({ state_id: 'std_pending' });

      expect(dropTargetState(pending, { kind: 'category', category: 'started' }, standard)).toBe('std_pending');
    });

    it('goes by the position of the statuses, not by their order in the array', () => {
      const shuffled = { ...standard, states: [...standard.states].reverse() };

      expect(dropTargetState(webTodoItem, { kind: 'category', category: 'started' }, shuffled)).toBe('std_progress');
    });

    it('refuses a category the workflow does not have', () => {
      const withoutCancelled = { ...standard, states: standard.states.filter((s) => s.category !== 'canceled') };

      expect(dropTargetState(webTodoItem, { kind: 'category', category: 'canceled' }, withoutCancelled)).toBeNull();
    });
  });

  describe('on a status column', () => {
    it('returns the status when the transition is allowed', () => {
      expect(dropTargetState(appTodoItem, { kind: 'state', state_id: 'app_progress' }, agency)).toBe('app_progress');
    });

    it('refuses a transition the workflow does not allow', () => {
      expect(dropTargetState(appTodoItem, { kind: 'state', state_id: 'app_done' }, agency)).toBeNull();
    });

    it('returns the status itself when it is dropped on its own column', () => {
      expect(dropTargetState(appTodoItem, { kind: 'state', state_id: 'app_todo' }, agency)).toBe('app_todo');
    });

    it('refuses a column of another workflow', () => {
      expect(dropTargetState(webTodoItem, { kind: 'state', state_id: 'app_progress' }, standard)).toBeNull();
    });
  });
});
