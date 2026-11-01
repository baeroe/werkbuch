/*
 * Rows and names of the groups of the item layouts: `nestRows` (port of the clickdummy's `display/grouping.test.ts`,
 * same names) and `groupLabel`, which names the groups the server delivers from the catalogs the browser holds.
 */

import { describe, expect, it } from 'vitest';
import { ALL_KEY, NONE_KEY } from '@/domain/grouping';
import { initI18n } from '@/lib/i18n';
import { agency, ida, labels, makeWorkItem, mara, project, standard, types } from '@/test/fixtures';
import en from '../../../../../lang/en.json';
import { CATEGORY_LABEL_KEYS, GROUP_LABEL_KEYS, groupLabel, nestRows, type GroupCatalogs } from './groupLabels';

const item = (id: string, parent_id: string | null = null) => makeWorkItem({ id, key: id.toUpperCase(), parent_id });

const catalogs: GroupCatalogs = {
  workflows: [standard, agency],
  projects: [project('WEB', 'admin', { name: 'Website-Relaunch' })],
  types,
  labels,
  users: [mara, ida],
};

describe('rows of a group', () => {
  it('puts children right after their parent, indented, when the parent is in the same group', () => {
    const rows = nestRows([item('a'), item('epic'), item('b'), item('child', 'epic'), item('grandchild', 'child')]);
    expect(rows.map((row) => [row.item.id, row.depth])).toEqual([
      ['a', 0],
      ['epic', 0],
      ['child', 1],
      ['grandchild', 2],
      ['b', 0],
    ]);
  });

  it('keeps a child whose parent is elsewhere at the top level, and shows a parent loop once', () => {
    expect(nestRows([item('orphan', 'gone')]).map((row) => row.depth)).toEqual([0]);
    const loop = nestRows([item('x', 'y'), item('y', 'x')]);
    expect(loop.map((row) => row.item.id).sort()).toEqual(['x', 'y']);
    // an item that names itself as its parent stands at the top level
    expect(nestRows([item('self', 'self')]).map((row) => row.depth)).toEqual([0]);
  });
});

describe('group names', () => {
  it('names a project the reader does not know a hidden project', () => {
    expect(groupLabel('project', 'p_web', catalogs)).toBe('Website-Relaunch');
    expect(groupLabel('project', '01jzzzzzzzzzzzzzzzzzzzzzzz', catalogs)).toBe('Verborgenes Projekt');
    // and an account or label it does not know as unknown, never by its id
    expect(groupLabel('assignee', 'u_gone', catalogs)).toBe('Unbekannte Person');
    expect(groupLabel('label', 'lb_gone', catalogs)).toBe('Unbekanntes Label');
    expect(groupLabel('type', 't_gone', catalogs)).toBe('Unbekannter Typ');
    expect(groupLabel('state', 'st_gone', catalogs)).toBe('Unbekannter Status');
  });

  it('names the group without an assignee, without labels and without a parent', () => {
    expect(groupLabel('assignee', NONE_KEY, catalogs)).toBe('Nicht zugewiesen');
    expect(groupLabel('label', NONE_KEY, catalogs)).toBe('Ohne Label');
    expect(groupLabel('parent', NONE_KEY, catalogs, null)).toBe('Ohne Eltern-Item');
    // the one group of an ungrouped list
    expect(groupLabel('none', ALL_KEY, catalogs)).toBe('Alle Items');
    expect(groupLabel('state', ALL_KEY, catalogs)).toBe('Alle Items');
  });

  it('names a parent group by key and title from the server', () => {
    expect(groupLabel('parent', 'wi_web_30', catalogs, { id: 'wi_web_30', key: 'WEB-30', title: 'Relaunch der Startseite', type_id: 't_epic' })).toBe(
      'WEB-30 Relaunch der Startseite',
    );
    // a parent the server did not name (one the reader does not see) stays hidden
    expect(groupLabel('parent', 'wi_secret', catalogs)).toBe('Verborgenes Eltern-Item');
  });

  it('names states, categories, priorities, types, people and labels from the catalogs', () => {
    expect(groupLabel('state', 'app_approval', catalogs)).toBe('Kundenfreigabe');
    expect(groupLabel('category', 'completed', catalogs)).toBe('Completed');
    expect(groupLabel('category', 'bogus', catalogs)).toBe('bogus');
    expect(groupLabel('priority', 'urgent', catalogs)).toBe('Urgent');
    expect(groupLabel('type', 't_bug', catalogs)).toBe('Bug');
    expect(groupLabel('assignee', 'u_ida', catalogs)).toBe('Ida Brenner');
    expect(groupLabel('label', 'lb_forms', catalogs)).toBe('Formulare');
  });

  it('names every grouping and category in both languages', () => {
    expect(Object.keys(GROUP_LABEL_KEYS)).toEqual(['state', 'category', 'assignee', 'priority', 'type', 'label', 'project', 'parent', 'none']);
    expect(Object.keys(CATEGORY_LABEL_KEYS)).toEqual(['backlog', 'unstarted', 'started', 'completed', 'canceled']);
    initI18n({ locale: 'en', translations: en });
    expect(groupLabel('assignee', NONE_KEY, catalogs)).toBe('Unassigned');
    expect(groupLabel('project', 'p_hidden', catalogs)).toBe('Hidden project');
  });
});
