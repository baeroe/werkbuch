import { describe, expect, it } from 'vitest';
import { agency, standard } from '@/domain/fixtures';
import type { Workflow } from '@/types';
import { cancelTargets, parseDays, skippedByAutoClose } from './automationRules';

describe('cancelTargets', () => {
  it('lists the states of the category Canceled in the order of the workflow', () => {
    expect(cancelTargets(standard).map((state) => state.id)).toEqual(['std_cancelled']);
    const two: Workflow = {
      ...standard,
      states: [...standard.states, { id: 'std_dropped', name: 'Dropped', icon: 'cross', category: 'canceled', position: 6 }],
    };
    expect(cancelTargets(two).map((state) => state.name)).toEqual(['Cancelled', 'Dropped']);
  });

  it('is empty for a workflow without a Canceled state, where Auto-Close has nowhere to go', () => {
    const open: Workflow = { ...standard, states: standard.states.filter((state) => state.category !== 'canceled') };
    expect(cancelTargets(open)).toEqual([]);
  });
});

describe('skippedByAutoClose', () => {
  it('is empty when Backlog and Todo may move to the target', () => {
    expect(skippedByAutoClose(standard, 'std_cancelled')).toEqual([]);
    expect(skippedByAutoClose(agency, 'app_cancelled')).toEqual([]);
  });

  it('names the states Auto-Close would have to skip because the workflow forbids the move', () => {
    const strict: Workflow = {
      ...agency,
      transitions: agency.transitions.filter(([from, to]) => !(from === 'app_todo' && to === 'app_cancelled')),
    };
    expect(skippedByAutoClose(strict, 'app_cancelled').map((state) => state.name)).toEqual(['Todo']);
  });

  it('ignores the states that are not Backlog or Unstarted: Auto-Close never touches them', () => {
    const strict: Workflow = { ...agency, transitions: agency.transitions.filter(([, to]) => to !== 'app_cancelled') };
    expect(skippedByAutoClose(strict, 'app_cancelled').map((state) => state.category)).toEqual(['backlog', 'unstarted']);
  });
});

describe('parseDays', () => {
  it.each([
    ['30', 30],
    [' 7 ', 7],
    ['1', 1],
    ['365', 365],
  ])('reads %j as %i days', (text, days) => {
    expect(parseDays(text)).toBe(days);
  });

  it.each(['', '0', '-3', '1,5', '2.5', 'abc', '1e3', '12 Tage'])('refuses %j', (text) => {
    expect(parseDays(text)).toBeNull();
  });
});
