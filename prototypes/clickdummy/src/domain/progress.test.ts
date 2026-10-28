import { describe, expect, it } from 'vitest';
import type { StateCategory } from '@/types';
import { agency, makeWorkItem, standard } from './fixtures';
import { childProgress } from './progress';

const categoryOf = new Map<string, StateCategory>([...standard.states, ...agency.states].map((s) => [s.id, s.category]));
const cat = (stateId: string): StateCategory => categoryOf.get(stateId) ?? 'backlog';

const done = makeWorkItem({ id: 'c1', state_id: 'std_done' });
const cancelled = makeWorkItem({ id: 'c2', state_id: 'std_cancelled' });
const inProgress = makeWorkItem({ id: 'c3', state_id: 'std_progress' });
const todo = makeWorkItem({ id: 'c4', state_id: 'std_todo' });

describe('childProgress', () => {
  it('counts the closed children, completed and canceled alike, out of all children', () => {
    expect(childProgress([done, cancelled, inProgress, todo], cat)).toEqual({ done: 2, total: 4 });
  });

  it('is zero out of zero for an item without children', () => {
    expect(childProgress([], cat)).toEqual({ done: 0, total: 0 });
  });

  it('counts nothing as done while all children are open', () => {
    expect(childProgress([inProgress, todo], cat)).toEqual({ done: 0, total: 2 });
  });
});
