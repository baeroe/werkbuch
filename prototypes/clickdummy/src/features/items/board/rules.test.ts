import { describe, expect, it } from 'vitest';
import { agency, makeWorkItem, standard } from '@/domain/fixtures';
import type { GroupBy, Project, ProjectMember, StateCategory, User, WorkItem } from '@/types';
import { CATEGORY_LABELS } from '../display/grouping';
import { assignBlocker, boardLockReason, checkMove, nearestAllowed, quickAddFields, rankForSlot, type BoardRules } from './rules';

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
      reason: 'Von „Todo“ nach „Done“ ist im Workflow „Agentur-Freigabe“ nicht erlaubt.',
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
      reason: 'Im Projekt APP darfst du nur lesen. Items ändern dürfen Member und Admins.',
    });
    expect(checkMove(appItem('app_todo'), 'app_todo', 'app_todo', viewer)).toMatchObject({ ok: false });
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
      reason: 'Im Workflow „Agentur-Freigabe“ führt von „Todo“ kein Übergang nach Completed.',
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
    const blocked = rules('assignee', { assignReason: (userId) => (userId === 'u_sven' ? 'Sven Brandt hat keinen Zugriff auf OPS.' : null) });
    expect(checkMove(webItem('std_todo'), 'none', 'u_sven', blocked)).toEqual({ ok: false, reason: 'Sven Brandt hat keinen Zugriff auf OPS.' });
  });

  it('keeps cards in their column when the grouping is not one a drop can change', () => {
    expect(checkMove(webItem('std_todo'), 't_task', 't_bug', rules('type'))).toEqual({
      ok: false,
      reason: 'Nach Typ gruppiert bleiben Karten in ihrer Spalte. Den Typ änderst du mit T.',
    });
    expect(checkMove(webItem('std_todo'), 'p_web', 'p_ops', rules('project'))).toMatchObject({ ok: false, reason: expect.stringContaining('Projekt') });
    expect(checkMove(webItem('std_todo'), 'none', 'wi_web_30', rules('parent'))).toMatchObject({ ok: false, reason: expect.stringContaining('Eltern-Item') });
    // within its column the card can still change its place
    expect(checkMove(webItem('std_todo'), 't_task', 't_task', rules('type'))).toEqual({ ok: true, patch: {}, closing: null });
  });

  it('does not let a board grouped by label move cards at all', () => {
    expect(boardLockReason('label')).toBe('Nach Label gruppierte Boards sind nicht ziehbar: Ein Item steht in der Spalte jedes seiner Labels. Labels änderst du mit L.');
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
    expect(next('app_todo', -1)).toEqual({ ok: false, reason: 'Von „Todo“ nach „Backlog“ ist im Workflow „Agentur-Freigabe“ nicht erlaubt.' });
    expect(next('app_done', 1)).toEqual({ ok: false, reason: 'Von „Done“ nach „Cancelled“ ist im Workflow „Agentur-Freigabe“ nicht erlaubt.' });
  });

  it('says so at the edge of the board', () => {
    expect(next('app_backlog', -1)).toEqual({ ok: false, reason: '„Backlog“ ist die erste Spalte.' });
    expect(next('app_cancelled', 1)).toEqual({ ok: false, reason: '„Cancelled“ ist die letzte Spalte.' });
  });
});

describe('the rank of a card placed between two others', () => {
  it('sorts between its neighbours in an ascending column', () => {
    const rank = rankForSlot('a1', 'a3', 'asc');
    expect(rank > 'a1' && rank < 'a3').toBe(true);
    expect(rankForSlot(null, 'a1', 'asc') < 'a1').toBe(true);
    expect(rankForSlot('a3', null, 'asc') > 'a3').toBe(true);
  });

  it('sorts between its neighbours in a descending column, where the higher rank stands above', () => {
    const rank = rankForSlot('a3', 'a1', 'desc');
    expect(rank > 'a1' && rank < 'a3').toBe(true);
    expect(rankForSlot(null, 'a3', 'desc') > 'a3').toBe(true);
    expect(rankForSlot('a1', null, 'desc') < 'a1').toBe(true);
  });

  it('still finds a rank when two neighbours share one (items of different projects)', () => {
    const rank = rankForSlot('a1', 'a1', 'asc');
    expect(rank > 'a1').toBe(true);
  });
});

describe('quick add in a column', () => {
  const app = { id: 'p_app', identifier: 'APP', enabled_type_ids: ['t_task', 't_bug', 't_epic'] } as Project;
  const web = { id: 'p_web', identifier: 'WEB', enabled_type_ids: ['t_task', 't_bug', 't_epic'] } as Project;

  it('creates in the column status when the workflow allows the move from the start status', () => {
    expect(quickAddFields('app_todo', { ...rules('state'), project: app, workflow: agency })).toEqual({ ok: true, fields: { project_id: 'p_app', state_id: 'app_todo' } });
    expect(quickAddFields('app_backlog', { ...rules('state'), project: app, workflow: agency })).toEqual({ ok: true, fields: { project_id: 'p_app' } });
    // the free workflow allows any status
    expect(quickAddFields('std_done', { ...rules('state'), project: web, workflow: standard })).toEqual({ ok: true, fields: { project_id: 'p_web', state_id: 'std_done' } });
  });

  it('refuses a status the start status does not lead to, with the reason', () => {
    expect(quickAddFields('app_done', { ...rules('state'), project: app, workflow: agency })).toEqual({
      ok: false,
      reason: 'Neue Items starten in „Backlog“. Von dort nach „Done“ ist im Workflow „Agentur-Freigabe“ nicht erlaubt.',
    });
  });

  it('picks the first status of a category column that a new item may start in', () => {
    const byCategory = rules('category', { columnLabel: (key) => CATEGORY_LABELS[key as StateCategory] });
    expect(quickAddFields('unstarted', { ...byCategory, project: app, workflow: agency })).toEqual({ ok: true, fields: { project_id: 'p_app', state_id: 'app_todo' } });
    expect(quickAddFields('started', { ...byCategory, project: app, workflow: agency })).toEqual({
      ok: false,
      reason: 'Neue Items starten in „Backlog“. Von dort führt im Workflow „Agentur-Freigabe“ kein Übergang nach Started.',
    });
  });

  it('takes over the value of other columns', () => {
    expect(quickAddFields('high', { ...rules('priority'), project: web, workflow: standard })).toEqual({ ok: true, fields: { project_id: 'p_web', priority: 'high' } });
    expect(quickAddFields('u_ida', { ...rules('assignee'), project: web, workflow: standard })).toEqual({ ok: true, fields: { project_id: 'p_web', assignee_id: 'u_ida' } });
    expect(quickAddFields('none', { ...rules('assignee'), project: web, workflow: standard })).toEqual({ ok: true, fields: { project_id: 'p_web' } });
    expect(quickAddFields('t_bug', { ...rules('type'), project: web, workflow: standard })).toEqual({ ok: true, fields: { project_id: 'p_web', type_id: 't_bug' } });
    expect(quickAddFields('lb_ux', { ...rules('label'), project: web, workflow: standard })).toEqual({ ok: true, fields: { project_id: 'p_web', label_ids: ['lb_ux'] } });
    expect(quickAddFields('wi_web_30', { ...rules('parent'), project: web, workflow: standard })).toEqual({ ok: true, fields: { project_id: 'p_web', parent_id: 'wi_web_30' } });
  });

  it('refuses a type the project has not switched on', () => {
    const ops = { id: 'p_ops', identifier: 'OPS', enabled_type_ids: ['t_task'] } as Project;
    expect(quickAddFields('t_bug', { ...rules('type', { columnLabel: () => 'Bug' }), project: ops, workflow: standard })).toEqual({
      ok: false,
      reason: 'Der Typ „Bug“ ist im Projekt OPS nicht aktiviert.',
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
    expect(assignBlocker(person('u_sven', { name: 'Sven Brandt' }), web, members)).toBe('Sven Brandt ist nicht Mitglied im Projekt WEB und kann das Item nicht übernehmen.');
    expect(assignBlocker(person('u_automation', { name: 'Automation', type: 'bot', org_role: 'admin', is_default_bot: true }), ops, members)).toBe(
      'Automation ist nicht Mitglied im Projekt OPS und kann das Item nicht übernehmen.',
    );
    expect(assignBlocker(person('u_alt', { name: 'Alte Person', disabled_at: '2026-01-01T00:00:00Z' }), web, members)).toBe('Alte Person ist deaktiviert.');
  });
});
