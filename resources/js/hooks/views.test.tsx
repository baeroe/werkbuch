import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mockApi, type MockApi } from '@/test/api';
import { list, makeView, prodBugs } from '@/test/fixtures';
import { qk } from './keys';
import { useDeleteView, useSaveView, useToggleFavorite, useView, useViews } from './views';

let queryClient: QueryClient;
let api: MockApi | undefined;

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 10_000 }, mutations: { retry: false } } });
});

afterEach(() => {
  api?.restore();
  api = undefined;
});

const dueWeek = makeView();

describe('views', () => {
  it('lists every view across pages', async () => {
    api = mockApi({
      'GET /api/v1/views': (_body, url) =>
        url.searchParams.get('cursor') === 'next' ? { body: list([prodBugs], 2) } : { body: { data: [dueWeek], links: {}, meta: { next_cursor: 'next', total: 2 } } },
    });
    const { result } = renderHook(() => useViews(), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual({ items: [dueWeek, prodBugs], next_cursor: null, total: 2 });
    expect(api.calls.map((call) => call.url)).toEqual(['/api/v1/views', '/api/v1/views?cursor=next']);
  });

  it('reads one view, and waits without an id or when told to', async () => {
    api = mockApi({ 'GET /api/v1/views/v_due_week': () => ({ body: { data: dueWeek } }) });
    const { result } = renderHook(() => ({ one: useView('v_due_week'), none: useView(null), held: useView('v_prod_bugs', { enabled: false }) }), { wrapper });

    await waitFor(() => expect(result.current.one.data).toEqual(dueWeek));
    expect([result.current.none.fetchStatus, result.current.held.fetchStatus]).toEqual(['idle', 'idle']);
    expect(api.calls).toHaveLength(1);
  });

  it('makes views and favorites stale after saving and deleting', async () => {
    const { id: _id, created_by: _by, created_at: _at, updated_at: _updated, ...input } = dueWeek;
    api = mockApi({
      'POST /api/v1/views': () => ({ status: 201, body: { data: dueWeek } }),
      'DELETE /api/v1/views/v_due_week': () => ({ status: 204 }),
      'POST /api/v1/favorites/toggle': () => ({ body: { kind: 'view', id: 'v_due_week', favorite: true } }),
    });
    const probes = [qk.views.list({ pages: 'all' }), qk.views.detail('v_due_week'), qk.favorites.all, qk.projects.all];
    const stale = () => probes.map((queryKey) => queryClient.getQueryState(queryKey)?.isInvalidated);
    const fill = () => probes.forEach((queryKey) => queryClient.setQueryData(queryKey, 'cached'));
    const { result } = renderHook(() => ({ save: useSaveView(), remove: useDeleteView(), toggle: useToggleFavorite() }), { wrapper });

    fill();
    expect(await act(() => result.current.save.mutateAsync(input))).toEqual(dueWeek);
    expect(stale()).toEqual([true, true, true, false]);

    fill();
    await act(() => result.current.remove.mutateAsync('v_due_week'));
    expect(stale()).toEqual([true, true, true, false]);

    fill();
    await act(() => result.current.toggle.mutateAsync({ kind: 'view', id: 'v_due_week' }));
    expect(stale()).toEqual([false, false, true, false]);
    expect(api.calls.map((call) => `${call.method} ${call.url}`)).toEqual(['POST /api/v1/views', 'DELETE /api/v1/views/v_due_week', 'POST /api/v1/favorites/toggle']);
  });
});
