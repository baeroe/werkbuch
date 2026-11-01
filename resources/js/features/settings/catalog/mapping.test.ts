/*
 * The pure rules of the state mapping: the rows with their proposals, what a mapping does to the items, and when it is
 * complete.
 */

import { describe, expect, it } from 'vitest';
import { agency, standard } from '@/test/fixtures';
import type { State } from '@/types';
import { complete, effectsOf, mappingOf, mergeUsage, rowsFor, type MappingRow } from './mapping';

const state = (id: string, name: string, category: State['category'], position: number): State => ({ id, name, icon: 'circle', category, position });

describe('rowsFor', () => {
  it('gives every state with items a row, in the order of the states, and leaves out states without items or unknown ones', () => {
    const rows = rowsFor(
      [
        { state_id: 'std_done', items: 4 },
        { state_id: 'std_todo', items: 2 },
        { state_id: 'std_progress', items: 0 },
        { state_id: 'elsewhere', items: 9 },
      ],
      standard.states,
      agency.states,
    );
    expect(rows.map((row) => [row.state.id, row.items])).toEqual([
      ['std_todo', 2],
      ['std_done', 4],
    ]);
  });

  it('proposes the state of the same name, also with other case and spaces, before the first of the same category', () => {
    const to = [state('b', 'Review', 'started', 1), state('a', ' in progress ', 'started', 2), state('c', 'Fertig', 'completed', 0)];
    const rows = rowsFor(
      [
        { state_id: 'std_progress', items: 1 },
        { state_id: 'std_pending', items: 1 },
        { state_id: 'std_done', items: 1 },
        { state_id: 'std_backlog', items: 1 },
      ],
      standard.states,
      to,
    );
    expect(rows.map((row) => [row.state.name, row.target])).toEqual([
      ['Backlog', null],
      ['In Progress', 'a'],
      // the first of its category in the order of the new states, not of the list
      ['Pending', 'b'],
      ['Done', 'c'],
    ]);
  });
});

describe('effectsOf', () => {
  const row = (from: State, target: string | null, items: number): MappingRow => ({ state: from, items, target });
  const [backlog, todo, progress, , done, cancelled] = standard.states as [State, State, State, State, State, State];

  it('counts the items that open again, close, or change between Completed and Canceled', () => {
    const rows = [row(done, 'std_todo', 2), row(cancelled, 'std_backlog', 1), row(todo, 'std_done', 3), row(progress, 'std_cancelled', 1), row(cancelled, 'std_done', 5), row(backlog, 'std_todo', 7)];
    expect(effectsOf(rows, standard.states)).toEqual([
      { kind: 'reopened', items: 3 },
      { kind: 'closed', items: 4 },
      { kind: 'resolution', items: 5 },
    ]);
  });

  it('names only what happens, and skips rows without a target', () => {
    expect(effectsOf([row(done, 'std_done', 2), row(todo, null, 3), row(todo, 'gone', 1)], standard.states)).toEqual([]);
    expect(effectsOf([row(todo, 'std_done', 1)], standard.states)).toEqual([{ kind: 'closed', items: 1 }]);
  });
});

describe('complete, mappingOf and mergeUsage', () => {
  const [todo, done] = [standard.states[1]!, standard.states[4]!];

  it('is complete once every row has a target, and maps each to it', () => {
    const rows: MappingRow[] = [
      { state: todo, items: 1, target: 'app_todo' },
      { state: done, items: 2, target: null },
    ];
    expect(complete(rows)).toBe(false);
    expect(mappingOf(rows)).toEqual({ std_todo: 'app_todo' });
    rows[1] = { ...rows[1]!, target: 'app_done' };
    expect(complete(rows)).toBe(true);
    expect(complete([])).toBe(true);
    expect(mappingOf(rows)).toEqual({ std_todo: 'app_todo', std_done: 'app_done' });
  });

  it('takes the newer counts of the server over the older ones and keeps the rest', () => {
    expect(
      mergeUsage(
        [
          { state_id: 'std_todo', items: 1 },
          { state_id: 'std_done', items: 2 },
        ],
        [
          { state_id: 'std_done', items: 5 },
          { state_id: 'std_pending', items: 1 },
        ],
      ),
    ).toEqual([
      { state_id: 'std_todo', items: 1 },
      { state_id: 'std_done', items: 5 },
      { state_id: 'std_pending', items: 1 },
    ]);
  });
});
