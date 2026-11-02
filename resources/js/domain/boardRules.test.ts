import { describe, expect, it } from 'vitest';
import { agency, makeWorkItem, standard, types } from '@/test/fixtures';
import type { GroupBy, Project, ProjectMember, StateCategory, User, WorkItem } from '@/types';
import { assignBlocker, boardLockReason, checkMove, nearestAllowed, quickAddFields, rankForSlot, RANK_MAX, type BoardRules } from './boardRules';

const CATEGORY_LABELS: Record<StateCategory, string> = { backlog: 'Backlog', unstarted: 'Unstarted', started: 'Started', completed: 'Completed', canceled: 'Canceled' };

const appItem = (state_id: string, overrides: Partial<WorkItem> = {}) =>
  makeWorkItem({ id: 'wi_app_16', key: 'APP-16', project_id: 'p_app', state_id, ...overrides });
const webItem = (state_id: string, overrides: Partial<WorkItem> = {}) => makeWorkItem({ id: 'wi_web_48', key: 'WEB-48', project_id: 'p_web', state_id, ...overrides });

const STATE_NAMES = Object.fromEntries([...standard.states, ...agency.states].map((state) => [state.id, state.name]));

function rules(groupBy: GroupBy, overrides: Partial<BoardRules> = {}): BoardRules {
  return {
    groupBy,
    workflowOf: (item) => (item.project_id === 'p_app' ? agency : standard),
    columnLabel: (key) => STATE_NAMES[key] ?? key,
    ...overrides,
  };
}

/** The columns of the agency board, left to right. */
const APP_COLUMNS = agency.states.map((state) => state.id);

describe('dropping a card on a status column', () => {
  it('refuses a drop from Todo to Done in the agency workflow and names the transition', () => {
    expect(checkMove(appItem('app_todo'), 'app_todo', 'app_done', rules('state'))).toEqual({
      ok: false,
      reason: { code: 'transition', params: { from: 'Todo', to: 'Done', workflow: 'Agentur-Freigabe' } },
    });
  });

  it('allows a listed transition and sets the status', () => {
    expect(checkMove(appItem('app_todo'), 'app_todo', 'app_progress', rules('state'))).toEqual({ ok: true, patch: { state_id: 'app_progress' }, closing: null });
  });

  it('asks for the resolution when the card moves into a Completed or Canceled status', () => {
    const done = checkMove(appItem('app_approval'), 'app_approval', 'app_done', rules('state'));
    expect(done).toMatchObject({ ok: true, patch: { state_id: 'app_done' }, closing: { id: 'app_done', category: 'completed' } });
    const cancelled = checkMove(webItem('std_todo'), 'std_todo', 'std_cancelled', rules('state'));
    expect(cancelled).toMatchObject({ ok: true, closing: { id: 'std_cancelled' } });
  });

  it('changes nothing when the card stays in its column', () => {
    expect(checkMove(appItem('app_todo'), 'app_todo', 'app_todo', rules('state'))).toEqual({ ok: true, patch: {}, closing: null });
  });

  it('refuses any move of an item the person may not change, and says why', () => {
    const viewer = rules('state', { editReason: () => 'Im Projekt APP darfst du nur lesen. Items ändern dürfen Member und Admins.' });
    expect(checkMove(appItem('app_todo'), 'app_todo', 'app_progress', viewer)).toEqual({
      ok: false,
      reason: { code: 'edit', params: { reason: 'Im Projekt APP darfst du nur lesen. Items ändern dürfen Member und Admins.' } },
    });
    expect(checkMove(appItem('app_todo'), 'app_todo', 'app_todo', viewer)).toMatchObject({ ok: false });
  });
  it('refuses a status the workflow it knows lacks (an older cache) instead of failing, and leaves an unknown name empty', () => {
    // the item stands in a status the cached workflow does not have yet, and goes to its column
    expect(checkMove(webItem('std_new'), 'std_todo', 'std_new', rules('state'))).toEqual({
      ok: false,
      reason: { code: 'transition', params: { from: '', to: 'std_new', workflow: 'Standard' } },
    });
  });
});

describe('dropping a card on a category column (several workflows)', () => {
  const byCategory = rules('category', { columnLabel: (key) => CATEGORY_LABELS[key as StateCategory] });

  it('takes the first status of the category the workflow allows', () => {
    expect(checkMove(appItem('app_todo'), 'unstarted', 'started', byCategory)).toEqual({ ok: true, patch: { state_id: 'app_progress' }, closing: null });
    // the free workflow reaches Done straight from Backlog, and Done asks for the resolution
    expect(checkMove(webItem('std_backlog'), 'backlog', 'completed', byCategory)).toMatchObject({ ok: true, patch: { state_id: 'std_done' }, closing: { id: 'std_done' } });
  });

  it('refuses a category the workflow does not lead to from the current status', () => {
    expect(checkMove(appItem('app_todo'), 'unstarted', 'completed', byCategory)).toEqual({
      ok: false,
      reason: { code: 'category', params: { from: 'Todo', to: 'Completed', workflow: 'Agentur-Freigabe' } },
    });
  });
});

describe('dropping a card on other columns', () => {
  it('sets the priority of the column', () => {
    expect(checkMove(webItem('std_todo', { priority: 'low' }), 'low', 'urgent', rules('priority'))).toEqual({ ok: true, patch: { priority: 'urgent' }, closing: null });
  });

  it('sets the assignee of the column, or nobody in "Nicht zugewiesen"', () => {
    expect(checkMove(webItem('std_todo'), 'none', 'u_ida', rules('assignee'))).toEqual({ ok: true, patch: { assignee_id: 'u_ida' }, closing: null });
    expect(checkMove(webItem('std_todo', { assignee_id: 'u_ida' }), 'u_ida', 'none', rules('assignee'))).toEqual({ ok: true, patch: { assignee_id: null }, closing: null });
  });

  it('refuses a person who cannot take the item', () => {
    const why = { code: 'not_member' as const, params: { name: 'Sven Brandt', project: 'WEB' } };
    const blocked = rules('assignee', { assignReason: (userId) => (userId === 'u_sven' ? why : null) });
    // the reason of assignBlocker goes through as it is, not wrapped once more
    expect(checkMove(webItem('std_todo'), 'none', 'u_sven', blocked)).toEqual({ ok: false, reason: why });
  });

  it('keeps cards in their column when the grouping is not one a drop can change', () => {
    expect(checkMove(webItem('std_todo'), 't_task', 't_bug', rules('type'))).toEqual({ ok: false, reason: { code: 'stays_type', params: {} } });
    expect(checkMove(webItem('std_todo'), 'p_web', 'p_ops', rules('project'))).toEqual({ ok: false, reason: { code: 'stays_project', params: {} } });
    expect(checkMove(webItem('std_todo'), 'none', 'wi_web_30', rules('parent'))).toEqual({ ok: false, reason: { code: 'stays_parent', params: {} } });
    expect(checkMove(webItem('std_todo'), 'all', 'all2', rules('none'))).toEqual({ ok: false, reason: { code: 'single_column', params: {} } });
    // within its column the card can still change its place
    expect(checkMove(webItem('std_todo'), 't_task', 't_task', rules('type'))).toEqual({ ok: true, patch: {}, closing: null });
  });

  it('does not let a board grouped by label move cards at all', () => {
    expect(boardLockReason('label')).toEqual({ code: 'label_locked', params: {} });
    expect(boardLockReason('state')).toBeNull();
    expect(checkMove(webItem('std_todo'), 'lb_ux', 'lb_seo', rules('label'))).toMatchObject({ ok: false, reason: boardLockReason('label') });
  });
});

describe('moving a card by keyboard to the next allowed column', () => {
  const next = (state: string, step: 1 | -1) => nearestAllowed(appItem(state), APP_COLUMNS, APP_COLUMNS.indexOf(state), step, rules('state'));

  it('takes the next column when the workflow allows it', () => {
    expect(next('app_todo', 1)).toMatchObject({ ok: true, index: APP_COLUMNS.indexOf('app_progress'), check: { patch: { state_id: 'app_progress' } } });
  });

  it('skips columns the workflow does not allow', () => {
    // from Kundenfreigabe back: Review is not allowed, In Progress is
    expect(next('app_approval', -1)).toMatchObject({ ok: true, index: APP_COLUMNS.indexOf('app_progress') });
  });

  it('names the refused neighbour when no column in that direction is allowed', () => {
    expect(next('app_todo', -1)).toEqual({ ok: false, reason: { code: 'transition', params: { from: 'Todo', to: 'Backlog', workflow: 'Agentur-Freigabe' } } });
    expect(next('app_done', 1)).toEqual({ ok: false, reason: { code: 'transition', params: { from: 'Done', to: 'Cancelled', workflow: 'Agentur-Freigabe' } } });
  });

  it('says so at the edge of the board', () => {
    expect(next('app_backlog', -1)).toEqual({ ok: false, reason: { code: 'first_column', params: { column: 'Backlog' } } });
    expect(next('app_cancelled', 1)).toEqual({ ok: false, reason: { code: 'last_column', params: { column: 'Cancelled' } } });
  });
});

describe('the rank of a card placed between two others', () => {
  it('sorts between its neighbours in an ascending column', () => {
    const rank = rankForSlot('a1', 'a3', 'asc')!;
    expect(rank > 'a1' && rank < 'a3').toBe(true);
    expect(rankForSlot(null, 'a1', 'asc')! < 'a1').toBe(true);
    expect(rankForSlot('a3', null, 'asc')! > 'a3').toBe(true);
  });

  it('sorts between its neighbours in a descending column, where the higher rank stands above', () => {
    const rank = rankForSlot('a3', 'a1', 'desc')!;
    expect(rank > 'a1' && rank < 'a3').toBe(true);
    expect(rankForSlot(null, 'a3', 'desc')! > 'a3').toBe(true);
    expect(rankForSlot('a1', null, 'desc')! < 'a1').toBe(true);
  });

  it('still finds a rank when two neighbours share one (items of different projects)', () => {
    const rank = rankForSlot('a1', 'a1', 'asc')!;
    expect(rank > 'a1').toBe(true);
    // below the card and descending: just past the one above, which is the higher rank
    expect(rankForSlot('a1', 'a1', 'desc')! < 'a1').toBe(true);
  });

  it('says when a rank would grow past 128 characters', () => {
    const stem = `a0${'V'.repeat(RANK_MAX - 3)}`;
    const [low, high] = [`${stem}V`, `${stem}W`];
    expect(low).toHaveLength(RANK_MAX);

    // two neighbours at the limit leave no room for a shorter key between them
    expect(rankForSlot(low, high, 'asc')).toBeNull();
    expect(rankForSlot(high, low, 'desc')).toBeNull();
    // a rank of exactly the limit is fine
    expect(rankForSlot('a0', 'a1', 'asc')).toBe('a0V');
  });
});

describe('quick add in a column', () => {
  const app = { id: 'p_app', identifier: 'APP', enabled_type_ids: ['t_task', 't_bug', 't_epic'], default_type_id: 't_task' } as Project;
  const web = { id: 'p_web', identifier: 'WEB', enabled_type_ids: ['t_task', 't_bug', 't_epic'], default_type_id: 't_task' } as Project;

  it('creates in the column status when the workflow allows the move from the start status', () => {
    expect(quickAddFields('app_todo', { ...rules('state'), project: app, workflow: agency })).toEqual({ ok: true, fields: { project_id: 'p_app', state_id: 'app_todo' } });
    expect(quickAddFields('app_backlog', { ...rules('state'), project: app, workflow: agency })).toEqual({ ok: true, fields: { project_id: 'p_app' } });
    // the free workflow allows any status
    expect(quickAddFields('std_done', { ...rules('state'), project: web, workflow: standard })).toEqual({ ok: true, fields: { project_id: 'p_web', state_id: 'std_done' } });
  });

  it('refuses a status the start status does not lead to, with the reason', () => {
    expect(quickAddFields('app_done', { ...rules('state'), project: app, workflow: agency })).toEqual({
      ok: false,
      reason: { code: 'start_transition', params: { initial: 'Backlog', to: 'Done', workflow: 'Agentur-Freigabe' } },
    });
  });

  it('picks the first status of a category column that a new item may start in', () => {
    const byCategory = rules('category', { columnLabel: (key) => CATEGORY_LABELS[key as StateCategory] });
    expect(quickAddFields('unstarted', { ...byCategory, project: app, workflow: agency })).toEqual({ ok: true, fields: { project_id: 'p_app', state_id: 'app_todo' } });
    expect(quickAddFields('started', { ...byCategory, project: app, workflow: agency })).toEqual({
      ok: false,
      reason: { code: 'start_category', params: { initial: 'Backlog', column: 'Started', workflow: 'Agentur-Freigabe' } },
    });
  });

  it('takes over the value of other columns', () => {
    expect(quickAddFields('high', { ...rules('priority'), project: web, workflow: standard })).toEqual({ ok: true, fields: { project_id: 'p_web', priority: 'high' } });
    expect(quickAddFields('u_ida', { ...rules('assignee'), project: web, workflow: standard })).toEqual({ ok: true, fields: { project_id: 'p_web', assignee_id: 'u_ida' } });
    expect(quickAddFields('none', { ...rules('assignee'), project: web, workflow: standard })).toEqual({ ok: true, fields: { project_id: 'p_web' } });
    expect(quickAddFields('t_bug', { ...rules('type'), project: web, workflow: standard })).toEqual({ ok: true, fields: { project_id: 'p_web', type_id: 't_bug' } });
    expect(quickAddFields('lb_ux', { ...rules('label'), project: web, workflow: standard })).toEqual({ ok: true, fields: { project_id: 'p_web', label_ids: ['lb_ux'] } });
    expect(quickAddFields('wi_web_30', { ...rules('parent'), project: web, workflow: standard, types })).toEqual({
      ok: true,
      fields: { project_id: 'p_web', parent_id: 'wi_web_30', type_id: 't_task' },
    });
  });

  it('gives a child in the column of its parent a type that may have a parent, also when the default type is an epic', () => {
    const epicDefault = { ...web, default_type_id: 't_epic' } as Project;
    expect(quickAddFields('wi_web_30', { ...rules('parent'), project: epicDefault, workflow: standard, types })).toEqual({
      ok: true,
      fields: { project_id: 'p_web', parent_id: 'wi_web_30', type_id: 't_task' },
    });
    // "Ohne Eltern-Item" makes no child: the default type stands, whatever it is
    expect(quickAddFields('none', { ...rules('parent'), project: epicDefault, workflow: standard, types })).toEqual({ ok: true, fields: { project_id: 'p_web' } });

    const onlyEpics = { ...web, enabled_type_ids: ['t_epic'], default_type_id: 't_epic' } as Project;
    expect(quickAddFields('wi_web_30', { ...rules('parent'), project: onlyEpics, workflow: standard, types })).toEqual({
      ok: false,
      reason: { code: 'no_child_type', params: {} },
    });
  });

  it('refuses a type the project has not switched on', () => {
    const ops = { id: 'p_ops', identifier: 'OPS', enabled_type_ids: ['t_task'] } as Project;
    expect(quickAddFields('t_bug', { ...rules('type', { columnLabel: () => 'Bug' }), project: ops, workflow: standard })).toEqual({
      ok: false,
      reason: { code: 'type_disabled', params: { type: 'Bug', project: 'OPS' } },
    });
  });
});

describe('who can take an item', () => {
  const ops = { id: 'p_ops', identifier: 'OPS', visibility: 'private' } as Project;
  const web = { id: 'p_web', identifier: 'WEB', visibility: 'public' } as Project;
  const person = (id: string, overrides: Partial<User> = {}) => ({ id, name: id, type: 'person', org_role: 'member', disabled_at: null, ...overrides }) as User;
  const members: ProjectMember[] = [
    { project_id: 'p_ops', user_id: 'u_jonas', role: 'member' },
    { project_id: 'p_web', user_id: 'u_kira', role: 'member' },
  ];

  it('lets members take items, and org admins who are people also without membership', () => {
    expect(assignBlocker(person('u_jonas'), ops, members)).toBeNull();
    expect(assignBlocker(person('u_kira', { type: 'bot' }), web, members)).toBeNull();
    expect(assignBlocker(person('u_mara', { org_role: 'admin' }), ops, members)).toBeNull();
  });

  it('names who is no member, also of a public project, and who is deactivated', () => {
    expect(assignBlocker(person('u_sven', { name: 'Sven Brandt' }), web, members)).toEqual({ code: 'not_member', params: { name: 'Sven Brandt', project: 'WEB' } });
    expect(assignBlocker(person('u_automation', { name: 'Automation', type: 'bot', org_role: 'admin', is_default_bot: true }), ops, members)).toEqual({
      code: 'not_member',
      params: { name: 'Automation', project: 'OPS' },
    });
    expect(assignBlocker(person('u_alt', { name: 'Alte Person', disabled_at: '2026-01-01T00:00:00Z' }), web, members)).toEqual({ code: 'deactivated', params: { name: 'Alte Person' } });
  });
});

describe('the remaining refusals', () => {
  it('waits for the workflow of the item', () => {
    expect(checkMove(appItem('app_todo'), 'app_todo', 'app_progress', rules('state', { workflowOf: () => undefined }))).toEqual({
      ok: false,
      reason: { code: 'workflow_loading', params: {} },
    });
  });

  it('refuses a drop on a column the workflow of the item does not have, naming the column', () => {
    expect(checkMove(appItem('app_todo'), 'app_todo', 'std_done', rules('state'))).toMatchObject({
      ok: false,
      reason: { code: 'transition', params: { from: 'Todo', to: 'Done' } },
    });
    expect(checkMove(appItem('app_todo'), 'app_todo', 'gone', rules('state'))).toMatchObject({ ok: false, reason: { params: { to: 'gone' } } });
  });

  it('reports a refusal that holds for every column only once when moving by keyboard', () => {
    const viewer = rules('state', { editReason: () => 'nur lesen' });
    expect(nearestAllowed(appItem('app_todo'), APP_COLUMNS, 1, 1, viewer)).toEqual({ ok: false, reason: { code: 'edit', params: { reason: 'nur lesen' } } });
  });

  it('refuses a quick add in a status the workflow does not have', () => {
    const app = { id: 'p_app', identifier: 'APP', enabled_type_ids: [], default_type_id: 't_task' } as unknown as Project;
    expect(quickAddFields('std_done', { ...rules('state'), project: app, workflow: agency })).toEqual({
      ok: false,
      reason: { code: 'state_unknown', params: { column: 'Done', workflow: 'Agentur-Freigabe', project: 'APP' } },
    });
  });

  it('refuses a quick add for a person who cannot take the item', () => {
    const web = { id: 'p_web', identifier: 'WEB', enabled_type_ids: [], default_type_id: 't_task' } as unknown as Project;
    const blocked = rules('assignee', { assignReason: () => ({ code: 'deactivated', params: { name: 'Sven Brandt' } }) });
    expect(quickAddFields('u_sven', { ...blocked, project: web, workflow: standard })).toEqual({
      ok: false,
      reason: { code: 'deactivated', params: { name: 'Sven Brandt' } },
    });
  });

  it('adds no field for a project or ungrouped column', () => {
    const web = { id: 'p_web', identifier: 'WEB', enabled_type_ids: [], default_type_id: 't_task' } as unknown as Project;
    expect(quickAddFields('p_web', { ...rules('project'), project: web, workflow: standard })).toEqual({ ok: true, fields: { project_id: 'p_web' } });
    expect(quickAddFields('all', { ...rules('none'), project: web, workflow: standard })).toEqual({ ok: true, fields: { project_id: 'p_web' } });
  });
});
