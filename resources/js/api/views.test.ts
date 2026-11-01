import { afterEach, describe, expect, it } from 'vitest';
import { mockApi, type MockApi } from '@/test/api';
import { list, makeView, prodBugs } from '@/test/fixtures';
import type { Favorite, ViewInput } from '@/types';
import { deleteView, getView, listFavorites, listViews, saveView, toggleFavorite } from './views';

let api: MockApi;

afterEach(() => api.restore());

describe('views', () => {
  const view = makeView();
  const { id: _id, created_by: _by, created_at: _at, updated_at: _updated, ...input } = view;

  it('lists the views page by page and reads one', async () => {
    api = mockApi({
      'GET /api/v1/views': () => ({ body: { data: [view], links: {}, meta: { next_cursor: 'c2', total: 2 } } }),
      'GET /api/v1/views/v_due_week': () => ({ body: { data: view } }),
    });

    expect(await listViews()).toEqual({ items: [view], next_cursor: 'c2', total: 2 });
    await listViews({ cursor: 'c2' });
    expect(await getView('v_due_week')).toEqual(view);
    expect(api.calls.map((call) => call.url)).toEqual(['/api/v1/views', '/api/v1/views?cursor=c2', '/api/v1/views/v_due_week']);
  });

  it('creates a view without an id, replaces one with it, and never sends the id in the body', async () => {
    api = mockApi({
      'POST /api/v1/views': () => ({ status: 201, body: { data: view } }),
      'PUT /api/v1/views/v_prod_bugs': () => ({ body: { data: prodBugs } }),
    });
    const change: ViewInput = { id: 'v_prod_bugs', name: prodBugs.name, icon: prodBugs.icon, filter: prodBugs.filter, display: prodBugs.display };

    expect(await saveView(input)).toEqual(view);
    expect(await saveView(change)).toEqual(prodBugs);
    expect(api.calls).toEqual([
      { method: 'POST', url: '/api/v1/views', body: input },
      { method: 'PUT', url: '/api/v1/views/v_prod_bugs', body: { name: prodBugs.name, icon: prodBugs.icon, filter: prodBugs.filter, display: prodBugs.display } },
    ]);
  });

  it('deletes a view', async () => {
    api = mockApi({ 'DELETE /api/v1/views/v_due_week': () => ({ status: 204 }) });

    expect(await deleteView('v_due_week')).toBeUndefined();
    expect(api.calls).toEqual([{ method: 'DELETE', url: '/api/v1/views/v_due_week', body: undefined }]);
  });
});

describe('favorites', () => {
  it('lists the own favorites and toggles one, answering the new state as it comes', async () => {
    const favorite: Favorite = { user_id: 'u_mara', kind: 'project', id: 'p_web', position: 0 };
    api = mockApi({
      'GET /api/v1/favorites': () => ({ body: list([favorite]) }),
      'POST /api/v1/favorites/toggle': () => ({ body: { kind: 'project', id: 'p_web', favorite: false } }),
    });

    expect(await listFavorites()).toEqual({ items: [favorite], next_cursor: null, total: 1 });
    expect(await toggleFavorite({ kind: 'project', id: 'p_web' })).toEqual({ kind: 'project', id: 'p_web', favorite: false });
    expect(api.calls[1]).toEqual({ method: 'POST', url: '/api/v1/favorites/toggle', body: { kind: 'project', id: 'p_web' } });
  });

  it('toggles a view in the sidebar', async () => {
    api = mockApi({ 'POST /api/v1/favorites/toggle': () => ({ body: { kind: 'view', id: 'v_due_week', favorite: true } }) });

    expect(await toggleFavorite({ kind: 'view', id: 'v_due_week' })).toEqual({ kind: 'view', id: 'v_due_week', favorite: true });
    expect(api.calls[0]!.body).toEqual({ kind: 'view', id: 'v_due_week' });
  });
});
