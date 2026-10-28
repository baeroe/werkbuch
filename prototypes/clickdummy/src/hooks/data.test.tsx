import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it } from 'vitest';
import { simulateRemoteChange } from '@/api/live';
import { getWorkItem } from '@/api/workItems';
import { useSession } from '@/store/session';
import { useUiStore } from '@/store/ui';
import { resetApi } from '@/test/api';
import { useLiveConnected, useLiveSync, useSetLiveConnected } from './live';
import { useMarkRead, useNotifications, useUnreadCount } from './notifications';
import { queryClient as appQueryClient } from './queryClient';
import { useResetDemo } from './system';
import { useCurrentUser } from './users';
import { useFilterContext, useWorkItem, useWorkItems } from './workItems';

let queryClient: QueryClient;

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  resetApi();
  useUiStore.setState({ flashIds: [] });
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
});

describe('reading', () => {
  it('useFilterContext builds the context of the filter engine from the loaded data', async () => {
    const { result } = renderHook(() => useFilterContext(), { wrapper });
    expect(result.current).toBeUndefined(); // nothing is loaded yet

    await waitFor(() => expect(result.current).toBeDefined());
    const ctx = result.current!;

    expect(ctx).toMatchObject({ me: 'u_mara', today: '2026-10-28', time_zone: 'Europe/Berlin', week_start: 1 });
    expect(ctx.stateCategory('app_review')).toBe('started');
    expect(ctx.typeHasProperty('t_bug', 'environment')).toBe(true);
    expect(ctx.typeHasProperty('t_task', 'environment')).toBe(false);
    expect(ctx.hasChildren('wi_web_30')).toBe(true);
    expect(ctx.isBlocked('wi_web_47')).toBe(true);
    expect(ctx.isBlocking('wi_ops_12')).toBe(true);
    expect(ctx.isBlocked('wi_ops_12')).toBe(false);
  });

  it('useCurrentUser follows the session', async () => {
    const { result } = renderHook(() => useCurrentUser(), { wrapper });
    await waitFor(() => expect(result.current?.name).toBe('Mara Lindqvist'));

    act(() => useSession.getState().setUserId('u_ida'));

    await waitFor(() => expect(result.current?.name).toBe('Ida Brenner'));
  });

  it('useUnreadCount is the badge of the inbox and follows markRead', async () => {
    const { result } = renderHook(() => ({ count: useUnreadCount(), inbox: useNotifications(), read: useMarkRead() }), { wrapper });
    await waitFor(() => expect(result.current.count).toBe(3));

    const unread = result.current.inbox.data!.items.filter((notification) => notification.read_at === null);
    await act(() => result.current.read.mutateAsync([unread[0].id]));

    await waitFor(() => expect(result.current.count).toBe(2));
  });

  it('the cache is reset when another person is looked at, so nothing of the first person lingers', async () => {
    await appQueryClient.fetchQuery({ queryKey: ['probe'], queryFn: () => 'Maras Daten' });
    expect(appQueryClient.getQueryData(['probe'])).toBe('Maras Daten');

    useSession.getState().setUserId('u_ida');

    await waitFor(() => expect(appQueryClient.getQueryData(['probe'])).toBeUndefined());
  });
});

describe('live and reset', () => {
  it('useLiveSync reloads the items on a live event and highlights the changed one', async () => {
    const { result } = renderHook(
      () => {
        useLiveSync();
        return useWorkItems({ filter: { version: 1, conditions: [{ field: 'project', op: 'is', value: 'p_web' }] } });
      },
      { wrapper },
    );
    await waitFor(() => expect(result.current.data).toBeDefined());

    const event = await simulateRemoteChange();

    expect(useUiStore.getState().flashIds).toEqual([event!.item_id]);
    // the list shows what Ida changed once it has loaded again
    const stored = (await getWorkItem(event!.item_id!)).item;
    await waitFor(() => expect(result.current.data?.items.find((item) => item.id === stored.id)).toEqual(stored));
  });

  it('useLiveConnected follows the connection', async () => {
    const { result } = renderHook(() => ({ connected: useLiveConnected(), set: useSetLiveConnected() }), { wrapper });
    expect(result.current.connected).toBe(true);

    act(() => result.current.set(false));
    expect(result.current.connected).toBe(false);

    act(() => result.current.set(true));
    expect(result.current.connected).toBe(true);
  });

  it('useResetDemo brings the seed data back and signs in Mara again', async () => {
    const { result } = renderHook(() => ({ item: useWorkItem('WEB-47'), reset: useResetDemo() }), { wrapper });
    await waitFor(() => expect(result.current.item.data).toBeDefined());

    act(() => useSession.getState().setUserId('u_theo'));
    await act(() => result.current.reset.mutateAsync());

    expect(useSession.getState().userId).toBe('u_mara');
  });
});
