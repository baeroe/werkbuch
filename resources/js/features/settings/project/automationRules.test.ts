import { describe, expect, it } from 'vitest';
import { agency, standard } from '@/test/fixtures';
import type { Workflow } from '@/types';
import { autoCloseAfter, cancelTargets, MAX_DAYS, parseDays, skippedByAutoClose } from './automationRules';

describe('cancelTargets', () => {
  it('lists the states of the category Canceled in the order of the workflow', () => {
    expect(cancelTargets(standard).map((state) => state.id)).toEqual(['std_cancelled']);
    const two: Workflow = {
      ...standard,
      // listed before Cancelled, but placed after it
      states: [{ id: 'std_dropped', name: 'Dropped', icon: 'cross', category: 'canceled', position: 6 }, ...standard.states],
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
    ['3650', 3650],
  ])('reads %j as %i days', (text, days) => {
    expect(parseDays(text)).toBe(days);
  });

  it.each(['', '0', '-3', '1,5', '2.5', 'abc', '1e3', '12 Tage', '3651', '99999999999999999999'])('refuses %j', (text) => {
    expect(parseDays(text)).toBeNull();
  });

  it('stops where the server stops', () => {
    expect(MAX_DAYS).toBe(3650);
  });
});

describe('autoCloseAfter', () => {
  const two: Workflow = {
    ...agency,
    states: [...agency.states, { id: 'app_dropped', name: 'Dropped', icon: 'cross', category: 'canceled', position: 7 }],
  };

  it('takes the state the mapping names when it is a Canceled one', () => {
    expect(autoCloseAfter('std_cancelled', two, { std_cancelled: 'app_dropped' })?.name).toBe('Dropped');
  });

  it('takes the first Canceled state when the mapping names none or another category', () => {
    expect(autoCloseAfter('std_cancelled', two, {})?.name).toBe('Cancelled');
    expect(autoCloseAfter('std_cancelled', two, { std_cancelled: 'app_done' })?.name).toBe('Cancelled');
    expect(autoCloseAfter(null, two, {})?.name).toBe('Cancelled');
  });

  it('keeps a state that is a Canceled one of the workflow already', () => {
    expect(autoCloseAfter('app_dropped', two, { app_dropped: 'app_cancelled' })?.name).toBe('Dropped');
  });

  it('is null for a workflow without a Canceled state: Auto-Close switches off', () => {
    const open: Workflow = { ...agency, states: agency.states.filter((state) => state.category !== 'canceled') };
    expect(autoCloseAfter('std_cancelled', open, { std_cancelled: 'app_done' })).toBeNull();
  });
});
