import { describe, expect, it } from 'vitest';
import type { GroupBy, StateCategory } from '@/types';
import { agency, makeWorkItem, standard } from '@/test/fixtures';
import { ALL_KEY, effectiveGroupBy, groupItems, keysOf, NONE_KEY, placeItems, type GroupContext } from './grouping';

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
    stateCategory: (stateId) => categoryOf.get(stateId) ?? 'backlog',
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

describe('keysOf', () => {
  const ctx = { stateCategory: () => 'started' as StateCategory };

  it('names the keys without a value "none" and the one group "all"', () => {
    const bare = makeWorkItem({ assignee_id: null, parent_id: null, label_ids: [] });

    expect(keysOf(bare, 'assignee', ctx)).toEqual([NONE_KEY]);
    expect(keysOf(bare, 'parent', ctx)).toEqual([NONE_KEY]);
    expect(keysOf(bare, 'label', ctx)).toEqual([NONE_KEY]);
    expect(keysOf(bare, 'none', ctx)).toEqual([ALL_KEY]);
    expect(keysOf(bare, 'category', ctx)).toEqual(['started']);
  });

  it('lists a label once, even if the item carries it twice', () => {
    expect(keysOf(makeWorkItem({ label_ids: ['lb_ux', 'lb_ux', 'lb_forms'] }), 'label', ctx)).toEqual(['lb_ux', 'lb_forms']);
  });
});

describe('placeItems', () => {
  const categoryOf = new Map<string, StateCategory>(standard.states.map((s) => [s.id, s.category]));
  const ctx = { stateCategory: (stateId: string) => categoryOf.get(stateId) ?? 'backlog' };
  const rank = { field: 'rank', direction: 'asc' as const };
  const ids = (placed: ReturnType<typeof placeItems>, key: string) => placed.items.get(key)?.map((i) => i.id);

  it('moves an item that changed its state into the group it belongs to now', () => {
    // delivered in `todo`; an optimistic edit put it into `doing` in the cache
    const moved = makeWorkItem({ id: 'a', state_id: 'std_progress', rank: 'a0' });
    const stays = makeWorkItem({ id: 'b', state_id: 'std_todo', rank: 'a1' });
    const placed = placeItems(
      [
        { key: 'std_todo', items: [moved, stays] },
        { key: 'std_progress', items: [] },
      ],
      'state',
      rank,
      ctx,
    );

    expect(ids(placed, 'std_todo')).toEqual(['b']);
    expect(ids(placed, 'std_progress')).toEqual(['a']);
    expect(placed.delta.get('std_todo')).toBe(-1);
    expect(placed.delta.get('std_progress')).toBe(1);
  });

  it('keeps an item in every label group it has', () => {
    const both = makeWorkItem({ id: 'a', label_ids: ['lb_ux', 'lb_forms'] });
    const placed = placeItems(
      [
        { key: 'lb_ux', items: [both] },
        { key: 'lb_forms', items: [both] },
      ],
      'label',
      rank,
      ctx,
    );

    expect(ids(placed, 'lb_ux')).toEqual(['a']);
    expect(ids(placed, 'lb_forms')).toEqual(['a']);
    expect([...placed.delta.values()]).toEqual([0, 0]);
  });

  it('puts an item that gained a label into the new group too, and one that lost all into none', () => {
    const gained = makeWorkItem({ id: 'a', label_ids: ['lb_ux', 'lb_forms'] });
    const lost = makeWorkItem({ id: 'b', label_ids: [] });
    const placed = placeItems(
      [
        { key: 'lb_ux', items: [gained, lost] },
        { key: 'lb_forms', items: [] },
      ],
      'label',
      rank,
      ctx,
    );

    expect(ids(placed, 'lb_ux')).toEqual(['a']);
    expect(ids(placed, 'lb_forms')).toEqual(['a']);
    expect(ids(placed, 'none')).toEqual(['b']);
    expect(placed.delta.get('lb_ux')).toBe(-1);
    expect(placed.delta.get('lb_forms')).toBe(1);
    expect(placed.delta.get('none')).toBe(1);
  });

  it('sorts each group after the move', () => {
    const early = makeWorkItem({ id: 'early', state_id: 'std_todo', rank: 'a0' });
    const late = makeWorkItem({ id: 'late', state_id: 'std_todo', rank: 'a5' });
    const arrived = makeWorkItem({ id: 'arrived', state_id: 'std_todo', rank: 'a3' });
    const placed = placeItems(
      [
        { key: 'std_todo', items: [early, late] },
        { key: 'std_progress', items: [arrived] },
      ],
      'state',
      rank,
      ctx,
    );

    expect(ids(placed, 'std_todo')).toEqual(['early', 'arrived', 'late']);
    expect(placed.delta.get('std_progress')).toBe(-1);
  });

  it('counts an item once and takes the version cached last', () => {
    const old = makeWorkItem({ id: 'a', state_id: 'std_todo', title: 'old' });
    const fresh = makeWorkItem({ id: 'a', state_id: 'std_todo', title: 'fresh' });
    const placed = placeItems(
      [
        { key: 'std_todo', items: [old] },
        { key: 'std_todo', items: [old, fresh] },
      ],
      'state',
      rank,
      ctx,
    );

    expect(placed.items.get('std_todo')).toEqual([fresh]);
    expect(placed.delta.get('std_todo')).toBe(0);
  });

  it('places nothing for no groups', () => {
    const placed = placeItems([], 'none', rank, ctx);

    expect(placed.items.size).toBe(0);
    expect(placed.delta.size).toBe(0);
  });
});
