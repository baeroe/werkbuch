import { describe, expect, it } from 'vitest';
import type { AgentStep, User } from '@/types';
import { afterFindings, followMapping, mappingComplete, mappingErrors, pickModel, suggestMapping, whyNotAgent, whyNotHere } from './agents';
import { agency, standard } from './fixtures';

const states = (working: string | null, review: string | null, correction: string | null, merged: string | null): Record<AgentStep, string | null> => ({ working, review, correction, merged });

describe('the status of each step (spec 7.4)', () => {
  it('accepts a status of the right category for every step', () => {
    expect(mappingErrors(standard, states('std_progress', 'std_pending', 'std_todo', 'std_done'))).toEqual({});
    expect(mappingComplete(standard, states('std_progress', 'std_pending', 'std_todo', 'std_done'))).toBe(true);
    // backlog counts for the correction as well as unstarted
    expect(mappingErrors(standard, states('std_progress', 'std_pending', 'std_backlog', 'std_done'))).toEqual({});
  });

  it('refuses a status of another category and says which one the step needs', () => {
    const errors = mappingErrors(standard, states('std_todo', 'std_done', 'std_progress', 'std_cancelled'));
    expect(Object.keys(errors).sort()).toEqual(['correction', 'merged', 'review', 'working']);
    expect(errors.working).toBe('„Todo“ ist Unstarted. „In Arbeit“ braucht einen Status der Kategorie Started.');
    expect(errors.correction).toContain('Unstarted oder Backlog');
    expect(errors.merged).toContain('Cancelled');
  });

  it('refuses a status the workflow does not have (after a change of workflow)', () => {
    expect(mappingErrors(agency, states('std_progress', null, null, null)).working).toContain('gibt es im Workflow „Agentur-Freigabe“ nicht mehr');
  });

  it('is not complete while a step has no status: agents are off then', () => {
    expect(mappingErrors(standard, states('std_progress', null, null, null))).toEqual({});
    expect(mappingComplete(standard, states('std_progress', null, null, null))).toBe(false);
  });

  it('follows a change of workflow where the mapping fits the category, else the step needs a new status', () => {
    const mapping = { std_progress: 'app_progress', std_pending: 'app_approval', std_todo: 'app_todo', std_done: 'app_done' };
    const next = followMapping(states('std_progress', 'std_pending', 'std_todo', 'std_done'), mapping, agency);
    expect(next).toEqual(states('app_progress', 'app_approval', 'app_todo', 'app_done'));
    // In Arbeit lands on Done (Completed): no fit; steps without a status or a mapping have none
    expect(followMapping(states('std_progress', null, 'std_todo', 'std_done'), { std_progress: 'app_done' }, agency)).toEqual(states(null, null, null, null));
  });

  it('suggests a fitting status per step, "Review" by name where the workflow has one', () => {
    expect(suggestMapping(standard)).toEqual(states('std_progress', 'std_pending', 'std_todo', 'std_done'));
    expect(suggestMapping(agency)).toEqual(states('app_progress', 'app_review', 'app_todo', 'app_done'));
  });
});

describe('the model of a run: model label, then project, then bot (spec 7.7)', () => {
  const agent = { model: 'sonnet', models: { review: 'opus' } };
  const project = { models: { comment: 'haiku', task: '' } };
  // the catalog in its order; a model label is recognized by its field, never by its name
  const catalog = [
    { id: 'lb_seo', agent_model: null },
    { id: 'lb_fable', agent_model: 'fable' },
    { id: 'lb_named', agent_model: undefined },
    { id: 'lb_opus', agent_model: 'opus' },
    { id: 'lb_haiku', agent_model: 'haiku' },
    { id: 'lb_blank', agent_model: '  ' },
  ];

  it('takes the model label of the item first, whatever kind of run', () => {
    expect(pickModel({ type: 'task', catalog, labelIds: ['lb_seo', 'lb_opus'], project, agent })).toEqual({ model: 'opus', source: 'label', label_id: 'lb_opus' });
    expect(pickModel({ type: 'comment', catalog, labelIds: ['lb_haiku'], project, agent })).toEqual({ model: 'haiku', source: 'label', label_id: 'lb_haiku' });
  });

  it('takes the first in the order of the catalog when the item has several, not the order on the item', () => {
    expect(pickModel({ type: 'task', catalog, labelIds: ['lb_haiku', 'lb_opus', 'lb_fable'], project, agent })).toMatchObject({ model: 'fable', label_id: 'lb_fable' });
  });

  it('reads no name and no empty field', () => {
    expect(pickModel({ type: 'task', catalog, labelIds: ['lb_named', 'lb_blank', 'lb_seo'], project, agent })).toEqual({ model: 'sonnet', source: 'bot', label_id: null });
  });

  it('lets a child of an epic without a model label take the epic’s', () => {
    expect(pickModel({ type: 'task', catalog, labelIds: ['lb_seo'], epicLabelIds: ['lb_opus'], project, agent })).toMatchObject({ model: 'opus', source: 'label' });
    // the child's own model label wins over the epic's
    expect(pickModel({ type: 'task', catalog, labelIds: ['lb_haiku'], epicLabelIds: ['lb_opus'], project, agent })).toMatchObject({ model: 'haiku' });
  });

  it('then takes the project’s model for the kind of run, an empty one does not count', () => {
    expect(pickModel({ type: 'comment', catalog, labelIds: [], project, agent })).toEqual({ model: 'haiku', source: 'project', label_id: null });
    expect(pickModel({ type: 'task', catalog, labelIds: [], project, agent })).toEqual({ model: 'sonnet', source: 'bot', label_id: null });
  });

  it('then the bot’s model for the kind of run, then its default; also without project settings', () => {
    expect(pickModel({ type: 'review', catalog, labelIds: [], project, agent })).toEqual({ model: 'opus', source: 'bot', label_id: null });
    expect(pickModel({ type: 'correction', catalog, labelIds: ['lb_seo'], project: null, agent })).toEqual({ model: 'sonnet', source: 'bot', label_id: null });
  });
});

describe('the brakes (spec 7.2)', () => {
  const limits = { max_corrections: 3, max_conflicts: 2 };

  it('allows corrections up to the limit, then pauses the strand', () => {
    expect(afterFindings({ corrections: 0, conflicts: 0 }, limits, 'correction')).toEqual({ next: 'correction', used: 1, max: 3 });
    expect(afterFindings({ corrections: 2, conflicts: 0 }, limits, 'correction')).toEqual({ next: 'correction', used: 3, max: 3 });
    expect(afterFindings({ corrections: 3, conflicts: 0 }, limits, 'correction')).toEqual({ next: 'paused', kind: 'correction', max: 3 });
  });

  it('counts conflicts apart from corrections', () => {
    expect(afterFindings({ corrections: 3, conflicts: 1 }, limits, 'conflict')).toEqual({ next: 'conflict', used: 2, max: 2 });
    expect(afterFindings({ corrections: 0, conflicts: 2 }, limits, 'conflict')).toEqual({ next: 'paused', kind: 'conflict', max: 2 });
  });
});

describe('who can be an agent (spec 7.2, 10.4)', () => {
  const kira = { name: 'Kira', type: 'bot', is_default_bot: false, owner_id: 'u_mara', disabled_at: null } as Pick<User, 'name' | 'type' | 'is_default_bot' | 'owner_id' | 'disabled_at'>;
  const settings = { states: states('std_progress', 'std_pending', 'std_todo', 'std_done') } as Parameters<typeof whyNotHere>[2]['settings'];

  it('never the default bot, a bot without a responsible person, or a person', () => {
    expect(whyNotAgent(kira)).toEqual([]);
    expect(whyNotAgent({ ...kira, is_default_bot: true, owner_id: null })[0]).toContain('Standard-Bot');
    expect(whyNotAgent({ ...kira, owner_id: null })[0]).toContain('keine verantwortliche Person');
    expect(whyNotAgent({ ...kira, type: 'person' })).toEqual(['Nur Bots können Agenten sein.']);
  });

  it('works in a project where it is switched on, a member who may edit, and the steps have a status', () => {
    expect(whyNotHere(kira, { enabled: true }, { identifier: 'WEB', role: 'member', settings, workflow: standard })).toBeNull();
    expect(whyNotHere(kira, { enabled: false }, { identifier: 'WEB', role: 'member', settings, workflow: standard })).toContain('„Als Agent arbeiten“ aus');
    expect(whyNotHere(kira, null, { identifier: 'WEB', role: 'member', settings, workflow: standard })).toContain('kein Agent');
    expect(whyNotHere(kira, { enabled: true }, { identifier: 'APP', role: null, settings, workflow: standard })).toBe('Kira ist in APP kein Mitglied und darf Items nicht bearbeiten.');
    expect(whyNotHere(kira, { enabled: true }, { identifier: 'WEB', role: 'viewer', settings, workflow: standard })).toContain('nur Viewer');
    expect(whyNotHere(kira, { enabled: true }, { identifier: 'OPS', role: 'member', settings: null, workflow: standard })).toContain('In OPS sind die Agenten noch nicht eingerichtet');
  });
});
