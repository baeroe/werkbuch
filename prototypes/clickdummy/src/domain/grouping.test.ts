import { describe, expect, it } from 'vitest';
import type { GroupBy, StateCategory } from '@/types';
import { agency, makeWorkItem, standard } from './fixtures';
import { effectiveGroupBy, groupItems, type GroupContext } from './grouping';

const webItem = makeWorkItem({ id: 'wi_web_1', project_id: 'p_web', key: 'WEB-1', state_id: 'std_todo' });
const appItem = makeWorkItem({ id: 'wi_app_1', project_id: 'p_app', key: 'APP-1', state_id: 'app_todo' });

describe('effectiveGroupBy', () => {
  it('falls back to category when the items span more than one workflow', () => {
    expect(effectiveGroupBy('state', [webItem, appItem], (i) => (i.project_id === 'p_app' ? 'wf_agency' : 'wf_standard'))).toBe('category');
  });

  it('keeps state when all items share one workflow', () => {
    const other = makeWorkItem({ id: 'wi_web_2', project_id: 'p_web2', state_id: 'std_done' });

    expect(effectiveGroupBy('state', [webItem, other], () => 'wf_standard')).toBe('state');
  });

  it('keeps state for no items at all', () => {
    expect(effectiveGroupBy('state', [], () => 'wf_standard')).toBe('state');
  });

  it('leaves every other grouping alone, however many workflows there are', () => {
    const groupings: GroupBy[] = ['category', 'assignee', 'priority', 'type', 'label', 'project', 'parent', 'none'];
    const workflowOf = (i: { project_id: string }) => (i.project_id === 'p_app' ? 'wf_agency' : 'wf_standard');

    expect(groupings.map((g) => effectiveGroupBy(g, [webItem, appItem], workflowOf))).toEqual(groupings);
  });
});

describe('groupItems', () => {
  const categoryOf = new Map<string, StateCategory>([...standard.states, ...agency.states].map((s) => [s.id, s.category]));
  const labels: Record<string, string> = {
    std_todo: 'Todo',
    std_progress: 'In Progress',
    std_done: 'Done',
    started: 'Gestartet',
    completed: 'Abgeschlossen',
    u_jonas: 'Jonas Feld',
    u_ida: 'Ida Brenner',
    none: 'Keine Angabe',
    lb_forms: 'Formulare',
    lb_ux: 'UX',
    urgent: 'Dringend',
    high: 'Hoch',
    medium: 'Mittel',
    low: 'Niedrig',
    all: 'Alle',
  };
  const orders: Partial<Record<GroupBy, string[]>> = {
    state: ['std_backlog', 'std_todo', 'std_progress', 'std_done'],
    category: ['backlog', 'unstarted', 'started', 'completed', 'canceled'],
    assignee: ['u_ida', 'u_jonas', 'none'],
    priority: ['urgent', 'high', 'medium', 'low', 'none'],
    label: ['lb_forms', 'lb_ux'],
  };
  const ctx: GroupContext = {
    me: 'u_mara',
    today: '2026-10-28',
    week_start: 1,
    stateCategory: (stateId) => categoryOf.get(stateId) ?? 'backlog',
    typeHasProperty: () => false,
    hasChildren: () => false,
    isBlocked: () => false,
    isBlocking: () => false,
    labelFor: (_groupBy, key) => labels[key] ?? key,
    orderFor: (groupBy) => orders[groupBy] ?? [],
  };

  const todoMara = makeWorkItem({ id: 'a', state_id: 'std_todo', assignee_id: 'u_jonas', priority: 'high', label_ids: ['lb_forms'] });
  const progress = makeWorkItem({ id: 'b', state_id: 'std_progress', assignee_id: 'u_jonas', priority: 'urgent', label_ids: ['lb_forms', 'lb_ux'] });
  const unassigned = makeWorkItem({ id: 'c', state_id: 'std_progress', assignee_id: null, priority: 'none', label_ids: [] });
  const done = makeWorkItem({ id: 'd', state_id: 'std_done', assignee_id: 'u_ida', priority: 'low', label_ids: ['lb_ux'] });
  const items = [todoMara, progress, unassigned, done];

  const shape = (groups: ReturnType<typeof groupItems>) => groups.map((g) => [g.key, g.items.map((i) => i.id)]);

  it('groups by state in the order the context gives, and keeps empty columns', () => {
    const groups = groupItems(items, 'state', ctx);

    expect(shape(groups)).toEqual([
      ['std_backlog', []],
      ['std_todo', ['a']],
      ['std_progress', ['b', 'c']],
      ['std_done', ['d']],
    ]);
  });

  it('labels each group through the context', () => {
    expect(groupItems(items, 'state', ctx).map((g) => g.label)).toEqual(['std_backlog', 'Todo', 'In Progress', 'Done']);
  });

  it('groups by category', () => {
    expect(shape(groupItems(items, 'category', ctx))).toEqual([
      ['backlog', []],
      ['unstarted', ['a']],
      ['started', ['b', 'c']],
      ['completed', ['d']],
      ['canceled', []],
    ]);
  });

  it('puts items without a value into the group "none" and drops that group when it is empty and not ordered', () => {
    const withoutNone = groupItems([todoMara, progress], 'assignee', { ...ctx, orderFor: () => ['u_ida', 'u_jonas'] });

    expect(shape(groupItems(items, 'assignee', ctx))).toEqual([
      ['u_ida', ['d']],
      ['u_jonas', ['a', 'b']],
      ['none', ['c']],
    ]);
    expect(withoutNone.map((g) => g.key)).toEqual(['u_ida', 'u_jonas']);
  });

  it('appends groups the order does not know after the known ones, in the order of first appearance', () => {
    const stranger = makeWorkItem({ id: 'e', assignee_id: 'u_zed' });
    const another = makeWorkItem({ id: 'f', assignee_id: 'u_yan' });

    expect(groupItems([stranger, another, todoMara], 'assignee', ctx).map((g) => g.key)).toEqual(['u_ida', 'u_jonas', 'none', 'u_zed', 'u_yan']);
  });

  it('groups by priority', () => {
    expect(shape(groupItems(items, 'priority', ctx))).toEqual([
      ['urgent', ['b']],
      ['high', ['a']],
      ['medium', []],
      ['low', ['d']],
      ['none', ['c']],
    ]);
  });

  it('lists an item once per label and an item without labels under "none"', () => {
    const groups = groupItems(items, 'label', ctx);

    expect(shape(groups)).toEqual([
      ['lb_forms', ['a', 'b']],
      ['lb_ux', ['b', 'd']],
      ['none', ['c']],
    ]);
  });

  it('groups by project, type and parent', () => {
    const inApp = makeWorkItem({ id: 'g', project_id: 'p_app', type_id: 't_bug', parent_id: 'wi_epic' });
    const inWeb = makeWorkItem({ id: 'h', project_id: 'p_web', type_id: 't_task', parent_id: null });

    expect(shape(groupItems([inApp, inWeb], 'project', ctx))).toEqual([
      ['p_app', ['g']],
      ['p_web', ['h']],
    ]);
    expect(shape(groupItems([inApp, inWeb], 'type', ctx))).toEqual([
      ['t_bug', ['g']],
      ['t_task', ['h']],
    ]);
    expect(shape(groupItems([inApp, inWeb], 'parent', ctx))).toEqual([
      ['wi_epic', ['g']],
      ['none', ['h']],
    ]);
  });

  it('puts everything into one group when there is no grouping, even without items', () => {
    expect(shape(groupItems(items, 'none', ctx))).toEqual([['all', ['a', 'b', 'c', 'd']]]);
    expect(groupItems([], 'none', ctx)).toEqual([{ key: 'all', label: 'Alle', items: [] }]);
  });

  it('keeps the order of the items inside a group and does not touch the input', () => {
    const reversed = [...items].reverse();
    const copy = [...reversed];

    expect(shape(groupItems(reversed, 'state', ctx))[2]).toEqual(['std_progress', ['c', 'b']]);
    expect(reversed).toEqual(copy);
  });
});
