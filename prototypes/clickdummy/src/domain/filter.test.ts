import { describe, expect, it } from 'vitest';
import type { Condition, Filter, FilterContext, StateCategory, WorkItem } from '@/types';
import { CORE_FILTER_FIELDS, matchesFilter, sortItems } from './filter';
import { agency, epicWithoutCustomer, makeWorkItem, overdueDone, overdueStarted, standard, web47 } from './fixtures';

const categoryOf = new Map<string, StateCategory>([...standard.states, ...agency.states].map((s) => [s.id, s.category]));

/** Which properties a type has in this fixture world (Bug carries `effort`, as WEB-47 does in the demo). */
const typeProperties: Record<string, string[]> = {
  t_task: ['customer', 'effort'],
  t_bug: ['customer', 'effort', 'environment', 'browser', 'steps'],
  t_epic: ['customer', 'target_quarter'],
  t_wish: ['customer', 'ticket_url', 'approved', 'reviewer'],
};

const ctx: FilterContext = {
  me: 'u_mara',
  today: '2026-10-28',
  week_start: 1,
  stateCategory: (stateId) => {
    const category = categoryOf.get(stateId);
    if (!category) throw new Error(`unknown state ${stateId}`);
    return category;
  },
  typeHasProperty: (typeId, key) => typeProperties[typeId]?.includes(key) ?? false,
  hasChildren: (itemId) => itemId === epicWithoutCustomer.id,
  isBlocked: (itemId) => itemId === web47.id,
};

const f = (condition: Condition): Filter => ({ version: 1, conditions: [condition] });

describe('matchesFilter', () => {
  it('assignee in ["me"] does not match an item of somebody else', () => {
    expect(matchesFilter(web47, f({ field: 'assignee', op: 'in', value: ['me'] }), ctx)).toBe(false);
  });

  it('due_date before +7d matches an item due in three days', () => {
    expect(matchesFilter(web47, f({ field: 'due_date', op: 'before', value: { relative: '+7d' } }), ctx)).toBe(true);
  });

  it('due_date before +3d does not match an item due exactly then (before is strict)', () => {
    expect(matchesFilter(web47, f({ field: 'due_date', op: 'before', value: { relative: '+3d' } }), ctx)).toBe(false);
  });

  it('state_category in [unstarted, started] matches a started item', () => {
    expect(matchesFilter(web47, f({ field: 'state_category', op: 'in', value: ['unstarted', 'started'] }), ctx)).toBe(true);
  });

  it('property:customer in [option] matches the item with that customer', () => {
    expect(matchesFilter(web47, f({ field: 'property:customer', op: 'in', value: ['opt_nordlicht'] }), ctx)).toBe(true);
  });

  it('property:effort gt 3 matches 3.5', () => {
    expect(matchesFilter(web47, f({ field: 'property:effort', op: 'gt', value: 3 }), ctx)).toBe(true);
  });

  it('title contains ignores case', () => {
    expect(matchesFilter(web47, f({ field: 'title', op: 'contains', value: 'KONTAKT' }), ctx)).toBe(true);
  });

  it('overdue matches an open item past its due date', () => {
    expect(matchesFilter(overdueStarted /* due 2026-10-27 */, f({ field: 'due_date', op: 'overdue' }), ctx)).toBe(true);
  });

  it('overdue does not match a closed item', () => {
    expect(matchesFilter(overdueDone, f({ field: 'due_date', op: 'overdue' }), ctx)).toBe(false);
  });

  it('property:customer is_empty matches an epic without a customer', () => {
    expect(matchesFilter(epicWithoutCustomer, f({ field: 'property:customer', op: 'is_empty' }), ctx)).toBe(true);
  });

  it('an empty filter matches everything', () => {
    expect(matchesFilter(web47, { version: 1, conditions: [] }, ctx)).toBe(true);
  });

  describe('combining conditions', () => {
    it('joins conditions with AND', () => {
      const both: Filter = {
        version: 1,
        conditions: [
          { field: 'assignee', op: 'in', value: ['u_jonas'] },
          { field: 'priority', op: 'is', value: 'urgent' },
        ],
      };
      const mismatch: Filter = {
        version: 1,
        conditions: [
          { field: 'assignee', op: 'in', value: ['u_jonas'] },
          { field: 'priority', op: 'is', value: 'high' },
        ],
      };

      expect(matchesFilter(web47, both, ctx)).toBe(true);
      expect(matchesFilter(web47, mismatch, ctx)).toBe(false);
    });

    it('never matches a field it does not know', () => {
      expect(matchesFilter(web47, f({ field: 'nope', op: 'is', value: 1 }), ctx)).toBe(false);
    });
  });

  describe('id and enum fields', () => {
    const mine = makeWorkItem({ assignee_id: 'u_mara' });
    const unassigned = makeWorkItem({ assignee_id: null });

    it('resolves "me" to the signed-in account', () => {
      expect(matchesFilter(mine, f({ field: 'assignee', op: 'in', value: ['me'] }), ctx)).toBe(true);
      expect(matchesFilter(mine, f({ field: 'assignee', op: 'is', value: 'me' }), ctx)).toBe(true);
      expect(matchesFilter(makeWorkItem({ created_by: 'u_mara' }), f({ field: 'created_by', op: 'is', value: 'me' }), ctx)).toBe(true);
    });

    it('is_not and not_in include unassigned items', () => {
      expect(matchesFilter(unassigned, f({ field: 'assignee', op: 'is_not', value: 'me' }), ctx)).toBe(true);
      expect(matchesFilter(unassigned, f({ field: 'assignee', op: 'not_in', value: ['u_jonas'] }), ctx)).toBe(true);
      expect(matchesFilter(web47, f({ field: 'assignee', op: 'not_in', value: ['u_jonas'] }), ctx)).toBe(false);
      expect(matchesFilter(mine, f({ field: 'assignee', op: 'is_not', value: 'me' }), ctx)).toBe(false);
    });

    it('is_empty and is_not_empty look at the assignee', () => {
      expect(matchesFilter(unassigned, f({ field: 'assignee', op: 'is_empty' }), ctx)).toBe(true);
      expect(matchesFilter(web47, f({ field: 'assignee', op: 'is_empty' }), ctx)).toBe(false);
      expect(matchesFilter(web47, f({ field: 'assignee', op: 'is_not_empty' }), ctx)).toBe(true);
    });

    it('matches priority, project, type and state', () => {
      expect(matchesFilter(web47, f({ field: 'priority', op: 'is', value: 'urgent' }), ctx)).toBe(true);
      expect(matchesFilter(web47, f({ field: 'priority', op: 'in', value: ['high', 'medium'] }), ctx)).toBe(false);
      expect(matchesFilter(web47, f({ field: 'project', op: 'in', value: ['p_web', 'p_ops'] }), ctx)).toBe(true);
      expect(matchesFilter(web47, f({ field: 'type', op: 'is', value: 't_bug' }), ctx)).toBe(true);
      expect(matchesFilter(web47, f({ field: 'state', op: 'in', value: ['std_progress'] }), ctx)).toBe(true);
      expect(matchesFilter(web47, f({ field: 'state_category', op: 'not_in', value: ['completed', 'canceled'] }), ctx)).toBe(true);
    });

    it('matches the parent', () => {
      const child = makeWorkItem({ parent_id: epicWithoutCustomer.id });

      expect(matchesFilter(child, f({ field: 'parent', op: 'is', value: epicWithoutCustomer.id }), ctx)).toBe(true);
      expect(matchesFilter(web47, f({ field: 'parent', op: 'is_empty' }), ctx)).toBe(true);
    });
  });

  describe('labels', () => {
    it('in matches when any label is in the list', () => {
      expect(matchesFilter(web47, f({ field: 'label', op: 'in', value: ['lb_forms', 'lb_ux'] }), ctx)).toBe(true);
      expect(matchesFilter(web47, f({ field: 'label', op: 'in', value: ['lb_ux'] }), ctx)).toBe(false);
    });

    it('not_in matches only when none of the labels is in the list', () => {
      expect(matchesFilter(web47, f({ field: 'label', op: 'not_in', value: ['lb_forms'] }), ctx)).toBe(false);
      expect(matchesFilter(web47, f({ field: 'label', op: 'not_in', value: ['lb_ux'] }), ctx)).toBe(true);
    });

    it('is_empty matches an item without labels; contains is membership', () => {
      expect(matchesFilter(makeWorkItem(), f({ field: 'label', op: 'is_empty' }), ctx)).toBe(true);
      expect(matchesFilter(web47, f({ field: 'label', op: 'is_empty' }), ctx)).toBe(false);
      expect(matchesFilter(web47, f({ field: 'label', op: 'contains', value: 'lb_production' }), ctx)).toBe(true);
    });
  });

  describe('dates', () => {
    it('after is strict as well', () => {
      expect(matchesFilter(web47, f({ field: 'due_date', op: 'after', value: { relative: '+2d' } }), ctx)).toBe(true);
      expect(matchesFilter(web47, f({ field: 'due_date', op: 'after', value: { relative: '+3d' } }), ctx)).toBe(false);
    });

    it('between includes both ends', () => {
      expect(matchesFilter(web47, f({ field: 'due_date', op: 'between', value: ['2026-10-28', '2026-10-31'] }), ctx)).toBe(true);
      expect(matchesFilter(web47, f({ field: 'due_date', op: 'between', value: ['2026-10-31', '2026-11-05'] }), ctx)).toBe(true);
      expect(matchesFilter(web47, f({ field: 'due_date', op: 'between', value: ['2026-11-01', '2026-11-05'] }), ctx)).toBe(false);
    });

    it('between accepts relative ends', () => {
      const inTheNextWeek = f({ field: 'due_date', op: 'between', value: [{ relative: '0d' }, { relative: '+1w' }] });

      expect(matchesFilter(web47, inTheNextWeek, ctx)).toBe(true);
    });

    it('understands today and negative relative values', () => {
      const dueToday = makeWorkItem({ due_date: '2026-10-28' });

      expect(matchesFilter(dueToday, f({ field: 'due_date', op: 'is', value: 'today' }), ctx)).toBe(true);
      expect(matchesFilter(web47, f({ field: 'due_date', op: 'is', value: 'today' }), ctx)).toBe(false);
      expect(matchesFilter(dueToday, f({ field: 'due_date', op: 'after', value: { relative: '-1w' } }), ctx)).toBe(true);
    });

    it('this_week follows the first day of the week of the organisation', () => {
      const dueSunday = makeWorkItem({ due_date: '2026-11-01' });
      const thisWeek = f({ field: 'due_date', op: 'is', value: 'this_week' });

      // Monday 2026-10-26 to Sunday 2026-11-01
      expect(matchesFilter(dueSunday, thisWeek, { ...ctx, week_start: 1 })).toBe(true);
      // Sunday 2026-10-25 to Saturday 2026-10-31
      expect(matchesFilter(dueSunday, thisWeek, { ...ctx, week_start: 0 })).toBe(false);
      expect(matchesFilter(web47, thisWeek, { ...ctx, week_start: 0 })).toBe(true);
    });

    it('this_month covers the whole calendar month', () => {
      const thisMonth = f({ field: 'due_date', op: 'is', value: 'this_month' });

      expect(matchesFilter(web47, thisMonth, ctx)).toBe(true);
      expect(matchesFilter(makeWorkItem({ due_date: '2026-11-01' }), thisMonth, ctx)).toBe(false);
      expect(matchesFilter(makeWorkItem({ due_date: '2026-10-01' }), thisMonth, ctx)).toBe(true);
    });

    it('before and after a range compare against its edges', () => {
      const beforeThisWeek = f({ field: 'due_date', op: 'before', value: 'this_week' });
      const afterThisWeek = f({ field: 'due_date', op: 'after', value: 'this_week' });

      expect(matchesFilter(makeWorkItem({ due_date: '2026-10-25' }), beforeThisWeek, ctx)).toBe(true);
      expect(matchesFilter(web47, beforeThisWeek, ctx)).toBe(false);
      expect(matchesFilter(makeWorkItem({ due_date: '2026-11-02' }), afterThisWeek, ctx)).toBe(true);
    });

    it('is_empty and is_not_empty look at the date', () => {
      expect(matchesFilter(makeWorkItem(), f({ field: 'due_date', op: 'is_empty' }), ctx)).toBe(true);
      expect(matchesFilter(web47, f({ field: 'due_date', op: 'is_not_empty' }), ctx)).toBe(true);
    });

    it('overdue needs a due date and an open item', () => {
      expect(matchesFilter(makeWorkItem(), f({ field: 'due_date', op: 'overdue' }), ctx)).toBe(false);
      expect(matchesFilter(web47, f({ field: 'due_date', op: 'overdue' }), ctx)).toBe(false);
      expect(matchesFilter(makeWorkItem({ due_date: '2026-10-28' }), f({ field: 'due_date', op: 'overdue' }), ctx)).toBe(false);
    });

    it('compares timestamps by their day', () => {
      // web47 was created on 2026-10-20
      expect(matchesFilter(web47, f({ field: 'created_at', op: 'after', value: '2026-10-19' }), ctx)).toBe(true);
      expect(matchesFilter(web47, f({ field: 'created_at', op: 'before', value: '2026-10-20' }), ctx)).toBe(false);
      expect(matchesFilter(web47, f({ field: 'created_at', op: 'is', value: '2026-10-20' }), ctx)).toBe(true);
      expect(matchesFilter(web47, f({ field: 'closed_at', op: 'is_empty' }), ctx)).toBe(true);
      expect(matchesFilter(overdueDone, f({ field: 'closed_at', op: 'is', value: '2026-10-27' }), ctx)).toBe(true);
    });
  });

  describe('flags', () => {
    it('has_children asks the context', () => {
      expect(matchesFilter(epicWithoutCustomer, f({ field: 'has_children', op: 'is', value: true }), ctx)).toBe(true);
      expect(matchesFilter(web47, f({ field: 'has_children', op: 'is', value: true }), ctx)).toBe(false);
      expect(matchesFilter(web47, f({ field: 'has_children', op: 'is', value: false }), ctx)).toBe(true);
    });

    it('blocked asks the context', () => {
      expect(matchesFilter(web47, f({ field: 'blocked', op: 'is', value: true }), ctx)).toBe(true);
      expect(matchesFilter(overdueDone, f({ field: 'blocked', op: 'is', value: true }), ctx)).toBe(false);
    });

    it('archived looks at archived_at', () => {
      const archived = makeWorkItem({ archived_at: '2026-10-20T00:00:00.000Z' });

      expect(matchesFilter(archived, f({ field: 'archived', op: 'is', value: true }), ctx)).toBe(true);
      expect(matchesFilter(web47, f({ field: 'archived', op: 'is', value: true }), ctx)).toBe(false);
      expect(matchesFilter(web47, f({ field: 'archived', op: 'is', value: false }), ctx)).toBe(true);
    });
  });

  describe('properties', () => {
    it('number operators work on numbers', () => {
      expect(matchesFilter(web47, f({ field: 'property:effort', op: 'lt', value: 4 }), ctx)).toBe(true);
      expect(matchesFilter(web47, f({ field: 'property:effort', op: 'lt', value: 3.5 }), ctx)).toBe(false);
      expect(matchesFilter(web47, f({ field: 'property:effort', op: 'is', value: 3.5 }), ctx)).toBe(true);
      expect(matchesFilter(web47, f({ field: 'property:effort', op: 'between', value: [3, 4] }), ctx)).toBe(true);
      expect(matchesFilter(web47, f({ field: 'property:effort', op: 'between', value: [4, 8] }), ctx)).toBe(false);
    });

    it('zero is a value, not empty', () => {
      const zero = makeWorkItem({ type_id: 't_task', values: { effort: 0 } });

      expect(matchesFilter(zero, f({ field: 'property:effort', op: 'is_empty' }), ctx)).toBe(false);
      expect(matchesFilter(zero, f({ field: 'property:effort', op: 'is_not_empty' }), ctx)).toBe(true);
    });

    it('is_empty is true for a missing value, an empty string and an empty list', () => {
      const wish = (values: WorkItem['values']) => makeWorkItem({ type_id: 't_wish', values });

      expect(matchesFilter(wish({}), f({ field: 'property:ticket_url', op: 'is_empty' }), ctx)).toBe(true);
      expect(matchesFilter(wish({ ticket_url: '  ' }), f({ field: 'property:ticket_url', op: 'is_empty' }), ctx)).toBe(true);
      expect(matchesFilter(wish({ reviewer: [] }), f({ field: 'property:reviewer', op: 'is_empty' }), ctx)).toBe(true);
      expect(matchesFilter(wish({ reviewer: ['u_ida'] }), f({ field: 'property:reviewer', op: 'is_empty' }), ctx)).toBe(false);
    });

    it('never matches a property the type does not have, not even is_empty', () => {
      // Epics have no environment
      expect(matchesFilter(epicWithoutCustomer, f({ field: 'property:environment', op: 'is_empty' }), ctx)).toBe(false);
      expect(matchesFilter(epicWithoutCustomer, f({ field: 'property:environment', op: 'is_not', value: 'opt_prod' }), ctx)).toBe(false);
      expect(matchesFilter(makeWorkItem({ type_id: 't_note' }), f({ field: 'property:customer', op: 'is_empty' }), ctx)).toBe(false);
    });

    it('treats an unset boolean as false', () => {
      const unset = makeWorkItem({ type_id: 't_wish', values: {} });
      const approved = makeWorkItem({ type_id: 't_wish', values: { approved: true } });

      expect(matchesFilter(unset, f({ field: 'property:approved', op: 'is', value: false }), ctx)).toBe(true);
      expect(matchesFilter(unset, f({ field: 'property:approved', op: 'is', value: true }), ctx)).toBe(false);
      expect(matchesFilter(approved, f({ field: 'property:approved', op: 'is', value: true }), ctx)).toBe(true);
      expect(matchesFilter(unset, f({ field: 'property:approved', op: 'is_empty' }), ctx)).toBe(true);
    });

    it('matches multi-select values and resolves "me" in member properties', () => {
      const reviewed = makeWorkItem({ type_id: 't_wish', values: { reviewer: ['u_ida', 'u_mara'] } });

      expect(matchesFilter(reviewed, f({ field: 'property:reviewer', op: 'in', value: ['u_ida'] }), ctx)).toBe(true);
      expect(matchesFilter(reviewed, f({ field: 'property:reviewer', op: 'in', value: ['me'] }), ctx)).toBe(true);
      expect(matchesFilter(reviewed, f({ field: 'property:reviewer', op: 'not_in', value: ['u_theo'] }), ctx)).toBe(true);
    });

    it('compares date properties with date operators', () => {
      const release = makeWorkItem({ type_id: 't_task', values: { go_live: '2026-11-02' } });
      const ctxWithGoLive: FilterContext = { ...ctx, typeHasProperty: (type, key) => key === 'go_live' || ctx.typeHasProperty(type, key) };

      expect(matchesFilter(release, f({ field: 'property:go_live', op: 'before', value: { relative: '+7d' } }), ctxWithGoLive)).toBe(true);
      expect(matchesFilter(release, f({ field: 'property:go_live', op: 'before', value: 'today' }), ctxWithGoLive)).toBe(false);
    });

    it('contains searches text properties and the text of rich text properties', () => {
      const doc = (text: string) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] });
      const bug = makeWorkItem({ type_id: 't_bug', values: { browser: 'Safari 19', steps: doc('Formular in Safari absenden') } });
      const emptyDoc = makeWorkItem({ type_id: 't_bug', values: { steps: { type: 'doc', content: [{ type: 'paragraph' }] } } });

      expect(matchesFilter(bug, f({ field: 'property:browser', op: 'contains', value: 'safari' }), ctx)).toBe(true);
      expect(matchesFilter(bug, f({ field: 'property:steps', op: 'contains', value: 'ABSENDEN' }), ctx)).toBe(true);
      expect(matchesFilter(bug, f({ field: 'property:steps', op: 'contains', value: 'chrome' }), ctx)).toBe(false);
      expect(matchesFilter(bug, f({ field: 'property:steps', op: 'is_empty' }), ctx)).toBe(false);
      expect(matchesFilter(emptyDoc, f({ field: 'property:steps', op: 'is_empty' }), ctx)).toBe(true);
    });
  });

  describe('title', () => {
    it('contains does not match text that is not in the title', () => {
      expect(matchesFilter(web47, f({ field: 'title', op: 'contains', value: 'newsletter' }), ctx)).toBe(false);
    });
  });
});

describe('CORE_FILTER_FIELDS', () => {
  it('lists the fields a condition can name besides property:<key>', () => {
    expect(CORE_FILTER_FIELDS).toEqual([
      'project',
      'type',
      'state',
      'state_category',
      'assignee',
      'created_by',
      'priority',
      'label',
      'parent',
      'start_date',
      'due_date',
      'created_at',
      'updated_at',
      'closed_at',
      'has_children',
      'blocked',
      'archived',
      'title',
    ]);
  });

  it('is_not_empty is true for every field of a fully filled item', () => {
    const full = makeWorkItem({
      parent_id: 'wi_parent',
      assignee_id: 'u_jonas',
      label_ids: ['lb_forms'],
      start_date: '2026-10-01',
      due_date: '2026-10-31',
      closed_at: '2026-10-27T15:20:00.000Z',
      archived_at: null,
    });

    for (const field of CORE_FILTER_FIELDS) {
      expect(matchesFilter(full, f({ field, op: 'is_not_empty' }), ctx), field).toBe(true);
    }
  });
});

describe('sortItems', () => {
  const byId = (items: { id: string }[]) => items.map((i) => i.id);

  it('sorts by rank in code-unit order, not by locale', () => {
    const items = [makeWorkItem({ id: 'b', rank: 'a1' }), makeWorkItem({ id: 'c', rank: 'Zz' }), makeWorkItem({ id: 'a', rank: 'a0' })];

    // capital letters sort before lower case ones, which is what fractional indexing relies on
    expect(byId(sortItems(items, { field: 'rank', direction: 'asc' }, ctx))).toEqual(['c', 'a', 'b']);
    expect(byId(sortItems(items, { field: 'rank', direction: 'desc' }, ctx))).toEqual(['b', 'a', 'c']);
  });

  it('puts the most urgent priority first when ascending', () => {
    const items = [
      makeWorkItem({ id: 'none', priority: 'none', rank: 'a0' }),
      makeWorkItem({ id: 'low', priority: 'low', rank: 'a1' }),
      makeWorkItem({ id: 'urgent', priority: 'urgent', rank: 'a2' }),
      makeWorkItem({ id: 'medium', priority: 'medium', rank: 'a3' }),
      makeWorkItem({ id: 'high', priority: 'high', rank: 'a4' }),
    ];

    expect(byId(sortItems(items, { field: 'priority', direction: 'asc' }, ctx))).toEqual(['urgent', 'high', 'medium', 'low', 'none']);
    expect(byId(sortItems(items, { field: 'priority', direction: 'desc' }, ctx))).toEqual(['none', 'low', 'medium', 'high', 'urgent']);
  });

  it('sorts dates and keeps items without a date last in both directions', () => {
    const items = [
      makeWorkItem({ id: 'none', due_date: null, rank: 'a0' }),
      makeWorkItem({ id: 'late', due_date: '2026-11-20', rank: 'a1' }),
      makeWorkItem({ id: 'early', due_date: '2026-10-30', rank: 'a2' }),
    ];

    expect(byId(sortItems(items, { field: 'due_date', direction: 'asc' }, ctx))).toEqual(['early', 'late', 'none']);
    expect(byId(sortItems(items, { field: 'due_date', direction: 'desc' }, ctx))).toEqual(['late', 'early', 'none']);
  });

  it('breaks ties by the manual order', () => {
    const items = [
      makeWorkItem({ id: 'second', due_date: '2026-10-30', rank: 'a1' }),
      makeWorkItem({ id: 'first', due_date: '2026-10-30', rank: 'a0' }),
    ];

    expect(byId(sortItems(items, { field: 'due_date', direction: 'asc' }, ctx))).toEqual(['first', 'second']);
    expect(byId(sortItems(items, { field: 'due_date', direction: 'desc' }, ctx))).toEqual(['first', 'second']);
  });

  it('sorts keys naturally: by project, then by number', () => {
    const items = [
      makeWorkItem({ id: 'web10', key: 'WEB-10' }),
      makeWorkItem({ id: 'web9', key: 'WEB-9' }),
      makeWorkItem({ id: 'app12', key: 'APP-12' }),
    ];

    expect(byId(sortItems(items, { field: 'key', direction: 'asc' }, ctx))).toEqual(['app12', 'web9', 'web10']);
  });

  it('sorts by creation and change time', () => {
    const items = [
      makeWorkItem({ id: 'new', created_at: '2026-10-27T10:00:00.000Z', updated_at: '2026-10-27T10:00:00.000Z' }),
      makeWorkItem({ id: 'old', created_at: '2026-10-01T10:00:00.000Z', updated_at: '2026-10-28T09:00:00.000Z' }),
    ];

    expect(byId(sortItems(items, { field: 'created_at', direction: 'asc' }, ctx))).toEqual(['old', 'new']);
    expect(byId(sortItems(items, { field: 'updated_at', direction: 'desc' }, ctx))).toEqual(['old', 'new']);
  });

  it('sorts number, date and text properties', () => {
    const task = (id: string, values: WorkItem['values']) => makeWorkItem({ id, type_id: 't_task', values, rank: id });

    const efforts = [task('c', { effort: 10 }), task('a', { effort: 2.5 }), task('b', {})];
    const browsers = [task('c', { browser: 'Safari' }), task('a', { browser: 'chrome' }), task('b', { browser: 'Ärger' })];
    const byEffort = sortItems(efforts, { field: 'property:effort', direction: 'asc' }, ctx);
    const byText = sortItems(browsers, { field: 'property:browser', direction: 'asc' }, ctx);

    // numbers compare as numbers (2.5 before 10), a missing value comes last
    expect(byId(byEffort)).toEqual(['a', 'c', 'b']);
    // text compares without regard to case and accents: Ärger, chrome, Safari
    expect(byId(byText)).toEqual(['b', 'a', 'c']);
  });

  it('sorts by the category of the status', () => {
    const items = [
      makeWorkItem({ id: 'done', state_id: 'std_done', rank: 'a0' }),
      makeWorkItem({ id: 'progress', state_id: 'std_progress', rank: 'a1' }),
      makeWorkItem({ id: 'backlog', state_id: 'std_backlog', rank: 'a2' }),
    ];

    expect(byId(sortItems(items, { field: 'state_category', direction: 'asc' }, ctx))).toEqual(['backlog', 'progress', 'done']);
  });

  it('falls back to the manual order for a field it does not know and leaves the input alone', () => {
    const items = [makeWorkItem({ id: 'b', rank: 'a1' }), makeWorkItem({ id: 'a', rank: 'a0' })];
    const before = [...items];

    expect(byId(sortItems(items, { field: 'nope', direction: 'asc' }, ctx))).toEqual(['a', 'b']);
    expect(items).toEqual(before);
  });
});
