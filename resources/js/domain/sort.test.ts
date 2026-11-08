import { describe, expect, it } from 'vitest';
import { makeWorkItem, standard } from '@/test/fixtures';
import type { StateCategory } from '@/types';
import naturalOrder from './natural-sort-fixtures.json';
import { PRIORITY_ORDER, sortItems } from './sort';

const categoryOf = new Map<string, StateCategory>(standard.states.map((state) => [state.id, state.category]));
const ctx = { stateCategory: (stateId: string) => categoryOf.get(stateId) ?? 'backlog' };

describe('sortItems', () => {
  const byId = (items: { id: string }[]) => items.map((i) => i.id);

  it('knows the priorities from the most urgent', () => {
    expect(PRIORITY_ORDER).toEqual(['urgent', 'high', 'medium', 'low', 'none']);
  });

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
      makeWorkItem({ id: 'none', due_date: null, start_date: null, rank: 'a0' }),
      makeWorkItem({ id: 'late', due_date: '2026-11-20', start_date: '2026-10-01', rank: 'a1' }),
      makeWorkItem({ id: 'early', due_date: '2026-10-30', start_date: '2026-09-01', rank: 'a2' }),
    ];

    expect(byId(sortItems(items, { field: 'due_date', direction: 'asc' }, ctx))).toEqual(['early', 'late', 'none']);
    expect(byId(sortItems(items, { field: 'due_date', direction: 'desc' }, ctx))).toEqual(['late', 'early', 'none']);
    expect(byId(sortItems(items, { field: 'start_date', direction: 'asc' }, ctx))).toEqual(['early', 'late', 'none']);
  });

  it('breaks ties by the manual order', () => {
    const items = [
      makeWorkItem({ id: 'second', due_date: '2026-10-30', rank: 'a1' }),
      makeWorkItem({ id: 'first', due_date: '2026-10-30', rank: 'a0' }),
    ];

    expect(byId(sortItems(items, { field: 'due_date', direction: 'asc' }, ctx))).toEqual(['first', 'second']);
    expect(byId(sortItems(items, { field: 'due_date', direction: 'desc' }, ctx))).toEqual(['first', 'second']);
  });

  it('breaks ties between equal ranks of different projects by id', () => {
    const items = [makeWorkItem({ id: 'b', rank: 'a0' }), makeWorkItem({ id: 'a', rank: 'a0' })];

    expect(byId(sortItems(items, { field: 'rank', direction: 'asc' }, ctx))).toEqual(['a', 'b']);
  });

  it('sorts keys by project, then by number as a number', () => {
    const items = [
      makeWorkItem({ id: 'web10', key: 'WEB-10' }),
      makeWorkItem({ id: 'web9', key: 'WEB-9' }),
      makeWorkItem({ id: 'app12', key: 'APP-12' }),
    ];

    expect(byId(sortItems(items, { field: 'key', direction: 'asc' }, ctx))).toEqual(['app12', 'web9', 'web10']);
    expect(byId(sortItems(items, { field: 'key', direction: 'desc' }, ctx))).toEqual(['web10', 'web9', 'app12']);
  });

  it('sorts by creation and change time', () => {
    const items = [
      makeWorkItem({ id: 'new', created_at: '2026-10-20T08:00:00.000Z', updated_at: '2026-10-21T08:00:00.000Z' }),
      makeWorkItem({ id: 'old', created_at: '2026-10-10T08:00:00.000Z', updated_at: '2026-10-25T08:00:00.000Z' }),
    ];

    expect(byId(sortItems(items, { field: 'created_at', direction: 'asc' }, ctx))).toEqual(['old', 'new']);
    expect(byId(sortItems(items, { field: 'updated_at', direction: 'desc' }, ctx))).toEqual(['old', 'new']);
  });

  it('sorts number, date and text properties', () => {
    const task = (id: string, values: ReturnType<typeof makeWorkItem>['values']) => makeWorkItem({ id, type_id: 't_task', values, rank: id });

    const efforts = [task('c', { effort: 10 }), task('a', { effort: 2.5 }), task('b', {})];
    const browsers = [task('c', { browser: 'Safari' }), task('a', { browser: 'chrome' }), task('b', { browser: 'Ärger' })];
    const byEffort = sortItems(efforts, { field: 'property:effort', direction: 'asc' }, ctx);
    const byText = sortItems(browsers, { field: 'property:browser', direction: 'asc' }, ctx);

    // numbers compare as numbers (2.5 before 10), a missing value comes last
    expect(byId(byEffort)).toEqual(['a', 'c', 'b']);
    // text compares without regard to case and accents: Ärger, chrome, Safari
    expect(byId(byText)).toEqual(['b', 'a', 'c']);
  });

  it('treats an empty text and a number that is not finite as no value', () => {
    const task = (id: string, value: unknown) => makeWorkItem({ id, values: { effort: value as number }, rank: id });
    const items = [task('empty', ''), task('infinite', Infinity), task('one', 1)];

    expect(byId(sortItems(items, { field: 'property:effort', direction: 'desc' }, ctx))).toEqual(['one', 'empty', 'infinite']);
  });

  it('puts numbers before text when a column mixes them', () => {
    const task = (id: string, value: unknown) => makeWorkItem({ id, values: { mixed: value as number }, rank: id });
    const items = [task('text', 'abc'), task('number', 7)];

    expect(byId(sortItems(items, { field: 'property:mixed', direction: 'asc' }, ctx))).toEqual(['number', 'text']);
    expect(byId(sortItems([...items].reverse(), { field: 'property:mixed', direction: 'asc' }, ctx))).toEqual(['number', 'text']);
  });

  it('orders text properties like the server', () => {
    // the list natural_sort_key() puts in this order (NaturalSortTest reads the same file); built backwards with one
    // rank, so only the text decides
    const items = [...naturalOrder].reverse().map((text, index) => makeWorkItem({ id: `i${String(index).padStart(2, '0')}`, title: text, values: { browser: text }, rank: 'a0' }));
    const titles = (direction: 'asc' | 'desc') => sortItems(items, { field: 'property:browser', direction }, ctx).map((item) => item.title);

    expect(titles('asc')).toEqual(naturalOrder);
    expect(titles('desc')).toEqual([...naturalOrder].reverse());
  });

  it('reads numbers in identifiers as numbers, like the server', () => {
    const items = [
      makeWorkItem({ id: 'a10', key: 'A10-1' }),
      makeWorkItem({ id: 'web10', key: 'WEB10-2' }),
      makeWorkItem({ id: 'a2', key: 'A2-3' }),
      makeWorkItem({ id: 'web2', key: 'WEB2-1' }),
    ];

    expect(byId(sortItems(items, { field: 'key', direction: 'asc' }, ctx))).toEqual(['a2', 'a10', 'web2', 'web10']);
  });

  it('keeps ranks and days as they are', () => {
    // a rank is no text with numbers: "a10" before "a9" byte by byte; days and stamps compare as written
    const ranks = [makeWorkItem({ id: 'nine', rank: 'a9' }), makeWorkItem({ id: 'ten', rank: 'a10' })];
    const days = [makeWorkItem({ id: 'nov', due_date: '2026-11-02' }), makeWorkItem({ id: 'oct', due_date: '2026-10-30' })];

    expect(byId(sortItems(ranks, { field: 'rank', direction: 'asc' }, ctx))).toEqual(['ten', 'nine']);
    expect(byId(sortItems(days, { field: 'due_date', direction: 'asc' }, ctx))).toEqual(['oct', 'nov']);
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
