import { afterEach, describe, expect, it } from 'vitest';
import { mockApi, type MockApi } from '@/test/api';
import { list } from '@/test/fixtures';
import type { Favorite } from '@/types';
import { listFavorites, toggleFavorite } from './views';

let api: MockApi;

afterEach(() => api.restore());

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
});
