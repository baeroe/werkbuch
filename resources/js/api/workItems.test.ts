import { afterEach, describe, expect, it } from 'vitest';
import { mockApi, type MockApi } from '@/test/api';
import { makeAttachment, standard, types, web30, web47, web47History, web47Relations, web48, webStateGroups } from '@/test/fixtures';
import type { BulkResult, Filter, WorkItem } from '@/types';
import {
  archiveWorkItem,
  bulkUpdateWorkItems,
  changeWorkItemType,
  type ListWorkItemsArgs,
  countWorkItems,
  createWorkItem,
  deleteWorkItem,
  getWorkItem,
  groupWorkItems,
  listActivity,
  listStateUsage,
  listWorkItems,
  restoreWorkItem,
  setSubscribed,
  transitionWorkItem,
  updateWorkItem,
} from './workItems';

let api: MockApi;

afterEach(() => api.restore());

/** The address a call went to, with the brackets of the query readable. */
const sent = (index = 0) => `${api.calls[index]!.method} ${decodeURIComponent(api.calls[index]!.url)}`;

describe('reading work items', () => {
  it('lists items as a page through the query and sends the project and parent as the short form', async () => {
    api = mockApi({ 'POST /api/v1/work-items/query': () => ({ body: { data: [web47], links: {}, meta: { next_cursor: 'c2', total: 3 } } }) });

    expect(await listWorkItems({ project_id: 'WEB', parent_id: 'WEB-30' })).toEqual({ items: [web47], next_cursor: 'c2', total: 3 });
    expect(api.calls[0]).toEqual({ method: 'POST', url: '/api/v1/work-items/query', body: { shorthand: { project: 'WEB', parent: 'WEB-30' } } });

    await listWorkItems({ parent_id: 'WEB-30', include_archived: true, cursor: 'c2', per_page: 50 });
    expect(api.calls[1]!.body).toEqual({ shorthand: { parent: 'WEB-30' }, include_archived: true, cursor: 'c2', per_page: 50 });

    // the first page has no cursor: nothing at all is sent
    await listWorkItems({ cursor: null });
    expect(api.calls[2]!.body).toEqual({});
  });

  it('takes no q in the list args', () => {
    // the check is the type: `pnpm typecheck` goes RED once the list takes `q` again (the directive is then unused);
    // the assertion below only keeps the value used (21b-M5)
    // @ts-expect-error the list has no search text; only the groups carry `q`
    const args: ListWorkItemsArgs = { q: 'kontakt' };
    expect(args).toEqual({ q: 'kontakt' });
  });

  it('sends a view, filter, sort, group and lean under their own names, and no empty filter', async () => {
    const lean = { ...web47 } as Partial<WorkItem>;
    delete lean.description;
    delete lean.description_json;
    delete lean.values_markdown;
    api = mockApi({ 'POST /api/v1/work-items/query': () => ({ body: { data: [lean], links: {}, meta: { next_cursor: null, total: 1 } } }) });
    const filter: Filter = { version: 1, conditions: [{ field: 'priority', op: 'in', value: ['urgent', 'high'] }] };

    const page = await listWorkItems({ view_id: 'v_bugs', filter, sort: { field: 'due_date', direction: 'desc' }, show_sub_items: false, group_by: 'state', group: 'std_todo', lean: true });
    expect(page.items).toEqual([lean]);
    expect(api.calls[0]!.body).toEqual({
      view_id: 'v_bugs',
      filter,
      sort: { field: 'due_date', direction: 'desc' },
      show_sub_items: false,
      group_by: 'state',
      group: 'std_todo',
      lean: true,
    });

    await listWorkItems({ filter: { version: 1, conditions: [] } });
    expect(api.calls[1]!.body).toEqual({});
  });

  it('reads the groups of a list with their counts, the search as it is and no short form', async () => {
    api = mockApi({ 'POST /api/v1/work-items/groups': () => ({ body: { data: webStateGroups } }) });
    const filter: Filter = { version: 1, conditions: [{ field: 'project', op: 'is', value: 'p_web' }] };

    expect(await groupWorkItems({ filter, group_by: 'state', q: 'kontakt', include_archived: false })).toEqual(webStateGroups);
    expect(api.calls[0]).toEqual({ method: 'POST', url: '/api/v1/work-items/groups', body: { filter, group_by: 'state', q: 'kontakt', include_archived: false } });

    await groupWorkItems({ view_id: 'v_bugs', group_by: 'parent' });
    expect(api.calls[1]!.body).toEqual({ view_id: 'v_bugs', group_by: 'parent' });
  });

  it('counts named filters on the server', async () => {
    api = mockApi({ 'POST /api/v1/work-items/counts': () => ({ body: { data: { open: 4, '0': 1 } } }) });
    const open: Filter = { version: 1, conditions: [{ field: 'state_category', op: 'in', value: ['backlog', 'unstarted', 'started'] }] };

    expect(await countWorkItems({ open, '0': open })).toEqual({ open: 4, '0': 1 });
    expect(api.calls[0]).toEqual({ method: 'POST', url: '/api/v1/work-items/counts', body: { filters: { open, '0': open } } });

    await countWorkItems({ open }, { include_archived: true });
    expect(api.calls[1]!.body).toEqual({ filters: { open }, include_archived: true });
  });

  it('reads one item with everything the detail shows in one call and takes its state from the workflow', async () => {
    const file = makeAttachment({ kind: 'file', filename: 'log.txt', owner: { type: 'work_item', id: 'wi_web_47' } });
    api = mockApi({
      'GET /api/v1/work-items/WEB-47': () => ({ body: { data: { ...web47, children: [], relations: web47Relations, type: types[1], workflow: standard, attachments: [file] } } }),
    });

    expect(await getWorkItem('WEB-47')).toEqual({
      item: web47,
      type: types[1],
      state: standard.states[2],
      workflow: standard,
      children: [],
      relations: web47Relations,
      attachments: [file],
      subscribed: true,
    });
    expect(sent()).toBe('GET /api/v1/work-items/WEB-47?include=children,relations,type,workflow,attachments');
  });

  it('keeps the children of an epic in their order and escapes a reference from an address', async () => {
    api = mockApi({
      'GET /api/v1/work-items/WEB-30': () => ({ body: { data: { ...web30, children: [web48], relations: [], type: types[2], workflow: standard, attachments: [] } } }),
      'GET /api/v1/work-items/a%2Fb': () => ({ status: 404, body: { reason: 'not_found' } }),
    });

    const detail = await getWorkItem('WEB-30');

    expect(detail.children).toEqual([web48]);
    expect(detail.subscribed).toBe(false);
    expect(Object.keys(detail.item)).not.toContain('children');
    expect(Object.keys(detail.item)).not.toContain('attachments');
    await expect(getWorkItem('a/b')).rejects.toMatchObject({ status: 404 });
  });

  it('reads the history as entries of the activity, oldest first, with the page of the server', async () => {
    api = mockApi({ 'GET /api/v1/work-items/WEB-47/history': () => ({ body: { data: web47History, links: {}, meta: { next_cursor: 'h2', total: 4 } } }) });

    const page = await listActivity('WEB-47', { per_page: 3 });

    expect(sent()).toBe('GET /api/v1/work-items/WEB-47/history?per_page=3');
    expect(page.next_cursor).toBe('h2');
    expect(page.total).toBe(4);
    expect(page.items.map((entry) => [entry.kind, entry.id, entry.at])).toEqual([
      ['event', 'ev_1', '2026-10-20T09:30:00.000Z'],
      ['event', 'ev_2', '2026-10-27T08:15:00.000Z'],
      ['event', 'ev_3', '2026-10-27T09:00:00.000Z'],
    ]);
    expect(page.items[1]).toEqual({ kind: 'event', id: 'ev_2', at: '2026-10-27T08:15:00.000Z', event: web47History[1] });
  });

  it('counts the items per state of a project or of a workflow', async () => {
    api = mockApi({ 'GET /api/v1/state-usage': () => ({ body: { data: [{ state_id: 'std_todo', items: 4 }] } }) });

    expect(await listStateUsage({ project: 'WEB' })).toEqual([{ state_id: 'std_todo', items: 4 }]);
    await listStateUsage({ workflow: 'wf_agency' });

    expect([sent(), sent(1)]).toEqual(['GET /api/v1/state-usage?project=WEB', 'GET /api/v1/state-usage?workflow=wf_agency']);
  });
});

describe('changing work items', () => {
  const doc = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Neu' }] }] };

  it('creates an item and sends its description as a Tiptap document', async () => {
    api = mockApi({ 'POST /api/v1/work-items': () => ({ status: 201, body: { data: web47 } }) });

    expect(await createWorkItem({ project_id: 'p_web', type_id: 't_bug', title: 'Kontaktformular sendet doppelt', description: doc, values: { effort: 3.5 } })).toEqual(web47);
    await createWorkItem({ project_id: 'p_web', type_id: 't_task', title: 'Ohne Beschreibung' });

    expect(api.calls.map((call) => call.body)).toEqual([
      { project_id: 'p_web', type_id: 't_bug', title: 'Kontaktformular sendet doppelt', description_json: doc, values: { effort: 3.5 } },
      { project_id: 'p_web', type_id: 't_task', title: 'Ohne Beschreibung' },
    ]);
  });

  it('changes fields, the description as a document with the version it was edited on', async () => {
    api = mockApi({ 'PATCH /api/v1/work-items/WEB-47': () => ({ body: { data: web47 } }) });

    expect(await updateWorkItem('WEB-47', { description: doc }, { base_description_version: 3 })).toEqual(web47);
    await updateWorkItem('WEB-47', { description: null, title: 'Neu' });
    await updateWorkItem('WEB-47', { priority: 'high' });

    expect(api.calls.map((call) => call.body)).toEqual([
      { description_json: doc, base_description_version: 3 },
      { title: 'Neu', description_json: null },
      { priority: 'high' },
    ]);
  });

  it('hands a description conflict on with the stored item', async () => {
    api = mockApi({
      'PATCH /api/v1/work-items/WEB-47': () => ({
        status: 409,
        body: { reason: 'description_conflict', detail: 'Ida Brenner hat die Beschreibung inzwischen geändert.', current: web47 },
      }),
    });

    await expect(updateWorkItem('WEB-47', { description: doc }, { base_description_version: 2 })).rejects.toMatchObject({
      status: 409,
      reason: 'description_conflict',
      current: web47,
    });
  });

  it('moves an item, with or without a chosen resolution', async () => {
    api = mockApi({ 'POST /api/v1/work-items/WEB-47/transition': () => ({ body: { data: web47 } }) });

    expect(await transitionWorkItem('WEB-47', 'std_cancelled', 'res_duplicate')).toEqual(web47);
    await transitionWorkItem('WEB-47', 'std_done');

    expect(api.calls.map((call) => call.body)).toEqual([
      { to_state_id: 'std_cancelled', resolution_id: 'res_duplicate' },
      { to_state_id: 'std_done', resolution_id: null },
    ]);
  });

  it('changes many items and gives the answer on as it is, without `data`', async () => {
    const result: BulkResult = { updated: ['wi_web_47'], rejected: [{ id: 'WEB-30', reason: 'transition_not_allowed' }] };
    api = mockApi({ 'POST /api/v1/work-items/bulk': () => ({ body: result }) });

    expect(await bulkUpdateWorkItems(['wi_web_47', 'WEB-30'], { state_id: 'std_done', add_label_ids: ['lb_ux'] })).toEqual(result);
    expect(api.calls[0]!.body).toEqual({ ids: ['wi_web_47', 'WEB-30'], patch: { state_id: 'std_done', add_label_ids: ['lb_ux'] } });
  });

  it('gives an item another type, with the values the new type asks for', async () => {
    api = mockApi({ 'PUT /api/v1/work-items/WEB-47/type': () => ({ body: { data: web47 } }) });

    expect(await changeWorkItemType('WEB-47', 't_bug', { environment: 'opt_env_prod' })).toEqual(web47);
    await changeWorkItemType('WEB-47', 't_task');

    expect(api.calls.map((call) => call.body)).toEqual([
      { type_id: 't_bug', values: { environment: 'opt_env_prod' } },
      { type_id: 't_task', values: {} },
    ]);
  });

  it('archives, restores and deletes an item', async () => {
    const archived = { ...web47, archived_at: '2026-10-31T09:00:00.000Z' };
    api = mockApi({
      'POST /api/v1/work-items/WEB-47/archive': () => ({ body: { data: archived } }),
      'POST /api/v1/work-items/WEB-47/restore': () => ({ body: { data: web47 } }),
      'DELETE /api/v1/work-items/WEB-47': () => ({ status: 204 }),
    });

    expect(await archiveWorkItem('WEB-47')).toEqual(archived);
    expect(await restoreWorkItem('WEB-47')).toEqual(web47);
    await expect(deleteWorkItem('WEB-47')).resolves.toBeUndefined();
    expect(api.calls.map(({ method, url }) => `${method} ${url}`)).toEqual([
      'POST /api/v1/work-items/WEB-47/archive',
      'POST /api/v1/work-items/WEB-47/restore',
      'DELETE /api/v1/work-items/WEB-47',
    ]);
  });

  it('watches an item and stops watching it', async () => {
    api = mockApi({
      'PUT /api/v1/work-items/WEB-47/subscription': () => ({ body: { data: web47 } }),
      'DELETE /api/v1/work-items/WEB-47/subscription': () => ({ body: { data: { ...web47, subscribed: false } } }),
    });

    expect((await setSubscribed('WEB-47', true)).subscribed).toBe(true);
    expect((await setSubscribed('WEB-47', false)).subscribed).toBe(false);
    expect(api.calls.map(({ method }) => method)).toEqual(['PUT', 'DELETE']);
  });
});
