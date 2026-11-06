import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mockApi, type MockApi } from '@/test/api';
import { list, maraInbox } from '@/test/fixtures';
import type { NotificationPreference } from '@/types';
import { qk } from './keys';
import {
  useDeleteNotification,
  useMarkAllRead,
  useMarkRead,
  useMarkUnread,
  useNotifications,
  usePreferences,
  useSavePreferences,
  useUnreadCount,
} from './notifications';

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

const unread = maraInbox.filter((notification) => notification.read_at === null);

describe('the inbox', () => {
  it('reads a page of the inbox with its filters', async () => {
    api = mockApi({ 'GET /api/v1/notifications': () => ({ body: list(maraInbox) }) });
    const { result } = renderHook(() => useNotifications({ mentions_only: true }), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual({ items: maraInbox, next_cursor: null, total: 14 });
    expect(api.calls.map((call) => call.url)).toEqual(['/api/v1/notifications?filter%5Bevent%5D=mentioned']);
  });

  it('counts the unread from the total of one row', async () => {
    api = mockApi({ 'GET /api/v1/notifications': () => ({ body: { data: unread.slice(0, 1), links: {}, meta: { next_cursor: 'next', total: unread.length } } }) });
    const { result } = renderHook(() => useUnreadCount(), { wrapper });

    // nothing is known before the answer
    expect(result.current).toBe(0);
    await waitFor(() => expect(result.current).toBe(3));
    expect(api.calls.map((call) => call.url)).toEqual(['/api/v1/notifications?per_page=1&filter%5Bunread%5D=1']);
  });

  it('makes the notifications stale after a mark', async () => {
    api = mockApi({
      'POST /api/v1/notifications/read': () => ({ body: { updated: 1 } }),
      'POST /api/v1/notifications/unread': () => ({ body: { updated: 1 } }),
      'DELETE /api/v1/notifications/n_01': () => ({ status: 204 }),
    });
    const probes = [qk.notifications.list({}), qk.notifications.list({ unread_only: true, per_page: 1 }), qk.preferences.all, qk.workItems.all];
    const stale = () => probes.map((queryKey) => queryClient.getQueryState(queryKey)?.isInvalidated);
    const fill = () => probes.forEach((queryKey) => queryClient.setQueryData(queryKey, 'cached'));
    const { result } = renderHook(() => ({ read: useMarkRead(), unread: useMarkUnread(), all: useMarkAllRead(), remove: useDeleteNotification() }), { wrapper });

    fill();
    expect(await act(() => result.current.read.mutateAsync(['n_01']))).toEqual({ updated: 1 });
    expect(stale()).toEqual([true, true, false, false]);

    fill();
    await act(() => result.current.unread.mutateAsync(['n_01']));
    expect(stale()).toEqual([true, true, false, false]);

    fill();
    await act(() => result.current.all.mutateAsync({ mentions_only: true }));
    expect(stale()).toEqual([true, true, false, false]);

    fill();
    await act(() => result.current.remove.mutateAsync('n_01'));
    expect(stale()).toEqual([true, true, false, false]);
    expect(api.calls.map((call) => `${call.method} ${call.url} ${JSON.stringify(call.body ?? null)}`)).toEqual([
      'POST /api/v1/notifications/read {"ids":["n_01"]}',
      'POST /api/v1/notifications/unread {"ids":["n_01"]}',
      'POST /api/v1/notifications/read {"all":true,"mentions_only":true}',
      'DELETE /api/v1/notifications/n_01 null',
    ]);
  });

  it('makes the notifications stale also when a later block of a mark fails: the first ones went through (T13-M1)', async () => {
    let calls = 0;
    api = mockApi({
      'POST /api/v1/notifications/read': () => (++calls === 1 ? { body: { updated: 100 } } : { status: 500, body: { reason: 'server_error' } }),
      'POST /api/v1/notifications/unread': () => ({ status: 500, body: { reason: 'server_error' } }),
    });
    const ids = Array.from({ length: 150 }, (_, n) => `n_${n}`);
    queryClient.setQueryData(qk.notifications.list({}), 'cached');
    const { result } = renderHook(() => ({ read: useMarkRead(), unread: useMarkUnread() }), { wrapper });

    await act(() => expect(result.current.read.mutateAsync(ids)).rejects.toThrow());
    expect(queryClient.getQueryState(qk.notifications.list({}))?.isInvalidated).toBe(true);

    queryClient.setQueryData(qk.notifications.list({}), 'cached');
    await act(() => expect(result.current.unread.mutateAsync(ids)).rejects.toThrow());
    expect(queryClient.getQueryState(qk.notifications.list({}))?.isInvalidated).toBe(true);
  });

  it('marks everything read without options', async () => {
    api = mockApi({ 'POST /api/v1/notifications/read': () => ({ body: { updated: 3 } }) });
    const { result } = renderHook(() => useMarkAllRead(), { wrapper });

    expect(await act(() => result.current.mutateAsync(undefined))).toEqual({ updated: 3 });
    expect(api.calls[0]!.body).toEqual({ all: true });
  });
});

describe('the notification settings', () => {
  const matrix: NotificationPreference[] = [
    { user_id: 'u_mara', event: 'assigned', channel: 'inbox', enabled: true },
    { user_id: 'u_mara', event: 'assigned', channel: 'mail', enabled: false },
  ];

  it('reads the matrix and makes it stale after saving, nothing else', async () => {
    api = mockApi({
      'GET /api/v1/notification-preferences': () => ({ body: list(matrix) }),
      'PUT /api/v1/notification-preferences': () => ({ body: { data: matrix } }),
    });
    const { result } = renderHook(() => ({ matrix: usePreferences(), save: useSavePreferences() }), { wrapper });

    await waitFor(() => expect(result.current.matrix.data).toEqual(matrix));
    queryClient.setQueryData(qk.notifications.list({}), 'cached');
    expect(await act(() => result.current.save.mutateAsync(matrix))).toEqual(matrix);
    expect(queryClient.getQueryState(qk.notifications.list({}))?.isInvalidated).toBe(false);
    await waitFor(() => expect(api!.calls.filter((call) => call.method === 'GET')).toHaveLength(2));
  });
});
