import { describe, expect, it } from 'vitest';
import { agency, standard } from '@/test/fixtures';
import { boundStates, missingSteps, modelsFor, NO_STEPS, stepsComplete, suggestSteps, whyNotAgent } from './agents';

describe('suggestSteps', () => {
  it('proposes the first started status, a review by name, an unstarted correction and the first completed one', () => {
    expect(suggestSteps(agency.states)).toEqual({ working: 'app_progress', review: 'app_review', correction: 'app_todo', merged: 'app_done' });
  });

  it('takes the second started status for the review when none is named so', () => {
    expect(suggestSteps(standard.states)).toEqual({ working: 'std_progress', review: 'std_pending', correction: 'std_todo', merged: 'std_done' });
  });

  it('falls back to the one started status and to a backlog one, and leaves a step without a fitting status empty', () => {
    const states = [
      { id: 'a', name: 'Backlog', category: 'backlog' as const },
      { id: 'b', name: 'Doing', category: 'started' as const },
    ];
    expect(suggestSteps(states)).toEqual({ working: 'b', review: 'b', correction: 'a', merged: null });
  });
});

describe('stepsComplete and missingSteps', () => {
  it('needs all four steps on fitting statuses of the workflow', () => {
    const steps = suggestSteps(agency.states);
    expect(stepsComplete(agency.states, steps)).toBe(true);
    expect(stepsComplete(agency.states, { ...steps, merged: null })).toBe(false);
    expect(stepsComplete(agency.states, { ...steps, merged: 'gone' })).toBe(false);
    expect(stepsComplete(agency.states, { ...steps, merged: 'app_todo' })).toBe(false);
    expect(missingSteps({ ...steps, review: null, merged: null })).toEqual(['review', 'merged']);
    expect(missingSteps(NO_STEPS)).toHaveLength(4);
  });
});

describe('boundStates', () => {
  it('names a status that holds a step with a category the step does not accept, once', () => {
    const states = agency.states.map((state) => (state.id === 'app_progress' ? { ...state, category: 'completed' as const } : state));
    const steps = { ...suggestSteps(agency.states), review: 'app_progress' };
    expect(boundStates(states, steps)).toEqual({ app_progress: 'working' });
    expect(boundStates(agency.states, suggestSteps(agency.states))).toEqual({});
  });
});

describe('modelsFor', () => {
  it('keeps the models the new CLI knows and falls back to its default', () => {
    expect(modelsFor('codex', 'opus', { task: 'gpt-5-codex-mini', review: 'haiku' })).toEqual({ model: 'gpt-5-codex', models: { task: 'gpt-5-codex-mini' }, dropped: ['opus', 'haiku'] });
    expect(modelsFor('claude', 'opus', { task: 'opus' })).toEqual({ model: 'opus', models: { task: 'opus' }, dropped: [] });
  });
});

describe('whyNotAgent', () => {
  it('refuses the default bot, a bot without a responsible person and a deactivated one', () => {
    expect(whyNotAgent({ is_default_bot: true, owner_id: null, disabled_at: null })).toEqual(['default_bot']);
    expect(whyNotAgent({ is_default_bot: false, owner_id: null, disabled_at: '2026-11-01T00:00:00Z' })).toEqual(['no_owner', 'disabled']);
    expect(whyNotAgent({ is_default_bot: false, owner_id: 'u_mara', disabled_at: null })).toEqual([]);
  });
});
