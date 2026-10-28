import { describe, expect, it } from 'vitest';
import type { Display, Filter, View } from '@/types';
import { applyViewState, decodeViewState, encodeViewState, hasUnsavedChanges, presetState, viewStateOf } from './viewState';

const filter: Filter = {
  version: 1,
  conditions: [
    { field: 'state_category', op: 'in', value: ['unstarted', 'started'] },
    { field: 'assignee', op: 'is', value: 'me' },
    { field: 'due_date', op: 'before', value: { relative: '+7d' } },
    { field: 'property:effort', op: 'between', value: [1.5, 8] },
    { field: 'blocked', op: 'is', value: true },
    { field: 'title', op: 'contains', value: 'Formular & Mail = „doppelt“' },
    { field: 'due_date', op: 'overdue' },
  ],
};

const display: Display = {
  layout: 'table',
  group_by: 'assignee',
  sort: { field: 'property:effort', direction: 'desc' },
  fields: ['key', 'title', 'state', 'property:customer'],
  show_sub_items: false,
};

const nordlicht: View = {
  id: 'v_nordlicht',
  name: 'Studio Nordlicht',
  icon: 'building-2',
  filter: { version: 1, conditions: [{ field: 'property:customer', op: 'is', value: 'opt_nordlicht' }] },
  display: { layout: 'table', group_by: 'none', sort: { field: 'key', direction: 'asc' }, fields: ['key', 'title', 'state'], show_sub_items: true },
  created_by: 'u_theo',
  created_at: '2026-10-01T09:15:00.000Z',
};

describe('the view state in the URL', () => {
  it('encode/decode round-trips filter and display', () => {
    const search = encodeViewState({ filter, display });
    expect(decodeViewState(search)).toEqual({ filter, display });
    // location.search starts with "?"
    expect(decodeViewState(`?${search}`)).toEqual({ filter, display });
  });

  it('keeps the layout readable as ?layout=board, as links of other screens write it', () => {
    expect(decodeViewState('?layout=board')).toEqual({ display: { layout: 'board' } });
    expect(new URLSearchParams(encodeViewState({ display: { layout: 'board' } })).get('layout')).toBe('board');
  });

  it('writes only what differs from the base, and nothing when nothing does', () => {
    const base = viewStateOf(nordlicht);
    expect(encodeViewState(base, base)).toBe('');

    const search = new URLSearchParams(encodeViewState({ filter: base.filter, display: { ...base.display, layout: 'list' } }, base));
    expect([...search.keys()]).toEqual(['layout']);

    const emptied = new URLSearchParams(encodeViewState({ filter: { version: 1, conditions: [] }, display: base.display }, base));
    expect(emptied.get('filter')).toBe('[]');
    expect(applyViewState(base, decodeViewState(emptied.toString())).filter.conditions).toEqual([]);
  });

  it('leaves out what it cannot read instead of failing', () => {
    expect(decodeViewState('?filter=%7Bnot-json&layout=cube&group=colour&sort=&sub=maybe')).toEqual({});
    expect(decodeViewState('?filter=[{"field":"priority","op":"unknown"},{"field":"priority","op":"in","value":["urgent"]},42]')).toEqual({
      filter: { version: 1, conditions: [{ field: 'priority', op: 'in', value: ['urgent'] }] },
    });
    expect(decodeViewState('?fields=&sort=due_date')).toEqual({ display: { fields: [], sort: { field: 'due_date', direction: 'asc' } } });
  });
});

describe('unsaved changes', () => {
  it('a view with changed filter reports unsaved changes', () => {
    const saved = viewStateOf(nordlicht);
    expect(hasUnsavedChanges(saved, saved)).toBe(false);

    const changed = { ...saved, filter: { version: 1 as const, conditions: [...saved.filter.conditions, { field: 'priority', op: 'in' as const, value: ['urgent'] }] } };
    expect(hasUnsavedChanges(saved, changed)).toBe(true);

    // the same way through the URL, as the screen reads it back
    const shown = applyViewState(saved, decodeViewState(encodeViewState(changed, saved)));
    expect(hasUnsavedChanges(saved, shown)).toBe(true);
    expect(hasUnsavedChanges(saved, applyViewState(saved, decodeViewState('')))).toBe(false);
  });

  it('a changed display is an unsaved change as well', () => {
    const saved = viewStateOf(nordlicht);
    expect(hasUnsavedChanges(saved, { ...saved, display: { ...saved.display, layout: 'list' } })).toBe(true);
    expect(hasUnsavedChanges(saved, { ...saved, display: { ...saved.display, fields: ['title', 'key', 'state'] } })).toBe(true);
  });

  it('the same conditions in another order or spelling are no change', () => {
    const saved = viewStateOf(nordlicht);
    const respelled = {
      ...saved,
      filter: { version: 1 as const, conditions: [{ field: 'property:customer', op: 'in' as const, value: ['opt_nordlicht'] }] },
    };
    expect(hasUnsavedChanges(saved, respelled)).toBe(false);

    const a = { ...saved, filter: { version: 1 as const, conditions: [...filter.conditions] } };
    const b = { ...saved, filter: { version: 1 as const, conditions: [...filter.conditions].reverse().map((condition) => (condition.field === 'state_category' ? { ...condition, value: ['started', 'unstarted'] } : condition)) } };
    expect(hasUnsavedChanges(a, b)).toBe(false);
  });

  it('a view does not change by being shown: the base of a view is its saved state', () => {
    const base = viewStateOf(nordlicht);
    expect(base.filter).toEqual(nordlicht.filter);
    expect(base.display).toEqual(nordlicht.display);
    // a copy: changing what is shown never touches the cached view
    expect(base.filter).not.toBe(nordlicht.filter);
  });
});

describe('the built-in lists', () => {
  it('"Meine Items" starts with the open items and the project list with no condition', () => {
    expect(presetState('my').filter.conditions).toEqual([{ field: 'state_category', op: 'in', value: ['backlog', 'unstarted', 'started'] }]);
    expect(presetState('project').filter.conditions).toEqual([]);
    expect(presetState('project').display.layout).toBe('list');
  });
});
