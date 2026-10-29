import { describe, expect, it } from 'vitest';
import { agency, standard } from '@/domain/fixtures';
import { groupItems, NONE_KEY } from '@/domain/grouping';
import type { FilterContext, Project, User, WorkItem } from '@/types';
import { effectiveGrouping, groupContext, nestRows, type GroupCatalogs } from './grouping';

function item(id: string, extra: Partial<WorkItem> = {}): WorkItem {
  return {
    id,
    project_id: 'p_web',
    number: 1,
    key: id.toUpperCase(),
    type_id: 't_task',
    title: `Item ${id}`,
    description: null,
    description_version: 1,
    state_id: 'std_todo',
    resolution_id: null,
    assignee_id: null,
    priority: 'none',
    label_ids: [],
    start_date: null,
    due_date: null,
    parent_id: null,
    parent: null,
    rank: 'a0',
    values: {},
    created_by: 'u_mara',
    created_at: '2026-10-01T09:00:00.000Z',
    updated_at: '2026-10-01T09:00:00.000Z',
    started_at: null,
    closed_at: null,
    archived_at: null,
    template_id: null,
    subscriber_ids: [],
    ...extra,
  };
}

const project = (id: string, workflow_id: string, name: string): Project => ({
  id,
  identifier: id.slice(2).toUpperCase(),
  name,
  description: '',
  image_url: null,
  lead_id: 'u_mara',
  visibility: 'public',
  workflow_id,
  enabled_type_ids: ['t_task'],
  default_type_id: 't_task',
  archived_at: null,
});

const person = (id: string, name: string, type: User['type'] = 'person'): User => ({
  id,
  type,
  name,
  handle: id,
  email: null,
  org_role: 'member',
  is_default_bot: false,
  owner_id: null,
  disabled_at: null,
  avatar_url: null,
  locale: 'de',
  timezone: 'Europe/Berlin',
});

const categories = new Map([...standard.states, ...agency.states].map((state) => [state.id, state.category]));
const ctx: FilterContext = {
  me: 'u_mara',
  today: '2026-10-28',
  week_start: 1,
  stateCategory: (id) => categories.get(id)!,
  typeHasProperty: () => false,
  hasChildren: () => false,
  isBlocked: () => false,
  isBlocking: () => false,
};

const catalogs: GroupCatalogs = {
  workflows: [standard, agency],
  projects: [project('p_web', 'wf_standard', 'Website-Relaunch'), project('p_app', 'wf_agency', 'Kunden-App')],
  types: [],
  labels: [],
  users: [person('u_mara', 'Mara Lindqvist'), person('u_kira', 'Kira', 'bot'), person('u_ida', 'Ida Brenner')],
  parents: [],
};

describe('rows of a group', () => {
  it('puts children right after their parent, indented, when the parent is in the same group', () => {
    const epic = item('epic');
    const rows = nestRows([item('a'), epic, item('b'), item('child', { parent_id: 'epic' }), item('grandchild', { parent_id: 'child' })]);
    expect(rows.map((row) => [row.item.id, row.depth])).toEqual([
      ['a', 0],
      ['epic', 0],
      ['child', 1],
      ['grandchild', 2],
      ['b', 0],
    ]);
  });

  it('keeps a child whose parent is elsewhere at the top level, and shows a parent loop once', () => {
    expect(nestRows([item('orphan', { parent_id: 'gone' })]).map((row) => row.depth)).toEqual([0]);
    const loop = nestRows([item('x', { parent_id: 'y' }), item('y', { parent_id: 'x' })]);
    expect(loop.map((row) => row.item.id).sort()).toEqual(['x', 'y']);
  });
});

describe('group names and order', () => {
  it('lists every state of the workflow of a project list, empty ones included, by name', () => {
    const items = [item('a', { state_id: 'std_progress' })];
    const groups = groupItems(items, 'state', groupContext(ctx, catalogs, { items, project: catalogs.projects[0] }));
    expect(groups.map((group) => group.label)).toEqual(['Backlog', 'Todo', 'In Progress', 'Pending', 'Done', 'Cancelled']);
    expect(groups.find((group) => group.label === 'In Progress')?.items.map((entry) => entry.id)).toEqual(['a']);
  });

  it('falls back to the categories when the items have several workflows', () => {
    const items = [item('web'), item('app', { project_id: 'p_app', state_id: 'app_review' })];
    expect(effectiveGrouping('state', items, catalogs.projects)).toBe('category');
    expect(effectiveGrouping('state', items.slice(0, 1), catalogs.projects)).toBe('state');
    const groups = groupItems(items, 'category', groupContext(ctx, catalogs, { items }));
    expect(groups.map((group) => group.label)).toEqual(['Backlog', 'Unstarted', 'Started', 'Completed', 'Canceled']);
  });

  it('orders people first and by name, and names the group without an assignee', () => {
    const items = [item('a', { assignee_id: 'u_kira' }), item('b', { assignee_id: 'u_mara' }), item('c', { assignee_id: 'u_ida' }), item('d')];
    const groups = groupItems(items, 'assignee', groupContext(ctx, catalogs, { items }));
    expect(groups.map((group) => group.label)).toEqual(['Ida Brenner', 'Mara Lindqvist', 'Kira', 'Nicht zugewiesen']);
    expect(groups.at(-1)?.key).toBe(NONE_KEY);
  });
});
