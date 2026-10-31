import { afterEach, describe, expect, it } from 'vitest';
import { mockApi, type MockApi } from '@/test/api';
import { list, types } from '@/test/fixtures';
import { deleteWorkItemType, listWorkItemTypes, saveWorkItemType, type WorkItemTypeInput } from './workItemTypes';

let api: MockApi;

afterEach(() => api.restore());

const [task, bug] = types as [(typeof types)[number], (typeof types)[number]];
const { id: _taskId, ...spec } = task;

describe('work item types', () => {
  it('lists the types of one page and passes the cursor', async () => {
    api = mockApi({ 'GET /api/v1/work-item-types': () => ({ body: list(types) }) });

    expect(await listWorkItemTypes({ cursor: 'c1', per_page: 2 })).toEqual({ items: types, next_cursor: null, total: 4 });
    expect(await listWorkItemTypes()).toEqual({ items: types, next_cursor: null, total: 4 });
    expect(api.calls.map((call) => call.url)).toEqual(['/api/v1/work-item-types?cursor=c1&per_page=2', '/api/v1/work-item-types']);
  });

  it('creates a type with POST and changes one with PUT, the id out of the body', async () => {
    api = mockApi({
      'POST /api/v1/work-item-types': (body) => ({ status: 201, body: { data: { ...(body as object), id: 't_new' } } }),
      'PUT /api/v1/work-item-types/t_bug': (body) => ({ body: { data: { ...(body as object), id: 't_bug' } } }),
    });
    const { id: _bugId, ...bugSpec } = bug;

    expect((await saveWorkItemType(spec)).id).toBe('t_new');
    const changed: WorkItemTypeInput = { ...bugSpec, id: 't_bug', name: 'Fehler' };
    expect((await saveWorkItemType(changed)).name).toBe('Fehler');
    expect(api.calls.map(({ method, url, body }) => [method, url, body])).toEqual([
      ['POST', '/api/v1/work-item-types', spec],
      ['PUT', '/api/v1/work-item-types/t_bug', { ...bugSpec, name: 'Fehler' }],
    ]);
  });

  it('answers the outcome of deleting a type unwrapped', async () => {
    api = mockApi({
      'DELETE /api/v1/work-item-types/t_wish': () => ({ body: { outcome: 'deleted' } }),
      'DELETE /api/v1/work-item-types/t_bug': () => ({ body: { outcome: 'archived' } }),
    });

    expect(await deleteWorkItemType('t_wish')).toEqual({ outcome: 'deleted' });
    expect(await deleteWorkItemType('t_bug')).toEqual({ outcome: 'archived' });
  });
});
