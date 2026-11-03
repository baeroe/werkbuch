import { QueryClient, QueryClientProvider, QueryObserver, type QueryKey } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LiveEvent } from '@/api/live';
import { useUiStore } from '@/store/ui';
import { qk } from './keys';
import { LIVE_BURST_MS, useLiveConnected, useLiveItem, useLiveSync } from './live';

/* The live connection stands in as a bus the test sends messages over. */
const bus = vi.hoisted(() => ({
  listeners: new Set<(event: LiveEvent) => void>(),
  connected: true,
  watched: [] as string[],
  released: [] as string[],
}));

vi.mock('@/api/live', () => ({
  subscribeLive: (callback: (event: LiveEvent) => void) => {
    bus.listeners.add(callback);
    return () => bus.listeners.delete(callback);
  },
  isLiveConnected: () => bus.connected,
  subscribeLiveStatus: () => () => {},
  watchItem: (id: string) => {
    bus.watched.push(id);
    return () => bus.released.push(id);
  },
}));

let queryClient: QueryClient;
const stops: (() => void)[] = [];

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

function send(overrides: Partial<LiveEvent>): void {
  const event: LiveEvent = { event_id: 'ev_1', type: 'work_item.updated', project_id: 'p_web', item_id: 'wi_web_47', comment_id: null, actor_id: 'u_ida', ...overrides };
  act(() => bus.listeners.forEach((listener) => listener(event)));
}

/** A query a screen shows (an active observer), counting how often it is fetched; `hold` keeps the next fetch open. */
async function shown(queryKey: QueryKey) {
  let fetches = 0;
  let held: Promise<void> | null = null;
  const observer = new QueryObserver(queryClient, {
    queryKey,
    queryFn: async () => {
      fetches += 1;
      if (held) await held;
      return fetches;
    },
    staleTime: Infinity,
  });
  stops.push(observer.subscribe(() => {}));
  await act(() => vi.advanceTimersByTimeAsync(0));
  return {
    fetches: () => fetches,
    stale: () => queryClient.getQueryState(queryKey)?.isInvalidated,
    hold: () => {
      let release = () => {};
      held = new Promise<void>((resolve) => (release = resolve));
      return () => {
        held = null;
        release();
      };
    },
  };
}

async function pass(ms: number): Promise<void> {
  await act(() => vi.advanceTimersByTimeAsync(ms));
}

/** A mutation of the screen that runs until the returned function is called; its `onSettled` loads `reloads` again. */
function mutating(reloads: QueryKey | null) {
  let finish = () => {};
  const done = new Promise<void>((resolve) => (finish = resolve));
  const mutation = queryClient.getMutationCache().build(queryClient, {
    mutationFn: () => done,
    onSettled: () => (reloads ? queryClient.invalidateQueries({ queryKey: reloads }) : undefined),
  });
  const run = mutation.execute(undefined);
  return async () => {
    finish();
    await act(() => run);
    await pass(0);
  };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  bus.listeners.clear();
  bus.watched = [];
  bus.released = [];
  bus.connected = true;
  useUiStore.setState({ flashIds: [] });
});

afterEach(() => {
  stops.splice(0).forEach((stop) => stop());
  queryClient.clear();
  vi.useRealTimers();
});

describe('useLiveConnected', () => {
  it('reads whether live updates arrive', () => {
    bus.connected = false;
    const { result } = renderHook(() => useLiveConnected());

    expect(result.current).toBe(false);
  });
});

describe('useLiveSync', () => {
  it('makes items and activity stale once for a burst of events', async () => {
    const items = await shown(qk.workItems.list({ project: 'p_web' }));
    const activity = await shown(qk.activity.list({ item: 'wi_web_47', pages: 'all' }));
    const inbox = await shown(qk.notifications.list({}));
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    renderHook(() => useLiveSync(), { wrapper });

    send({ event_id: 'ev_1' });
    await pass(100);
    send({ event_id: 'ev_2', type: 'work_item.state_changed' });
    await pass(150);
    send({ event_id: 'ev_3', item_id: 'wi_web_42' });
    await pass(LIVE_BURST_MS - 251);
    expect(items.fetches()).toBe(1);

    await pass(1);

    expect(items.fetches()).toBe(2);
    expect(activity.fetches()).toBe(2);
    expect(inbox.fetches()).toBe(1);
    expect(invalidate.mock.calls.map(([filters]) => filters?.queryKey)).toEqual([qk.workItems.all, qk.activity.all]);
  });

  it('drops an event it has seen', async () => {
    const items = await shown(qk.workItems.list({}));
    renderHook(() => useLiveSync(), { wrapper });

    send({ event_id: 'ev_1' });
    await pass(LIVE_BURST_MS);
    send({ event_id: 'ev_1' });
    await pass(LIVE_BURST_MS);

    expect(items.fetches()).toBe(2);
  });

  it('never drops notifications.changed as a duplicate (no event behind it)', async () => {
    const inbox = await shown(qk.notifications.list({ unread_only: true }));
    renderHook(() => useLiveSync(), { wrapper });

    send({ event_id: null, type: 'notifications.changed', project_id: null, item_id: null, actor_id: null });
    await pass(LIVE_BURST_MS);
    send({ event_id: null, type: 'notifications.changed', project_id: null, item_id: null, actor_id: null });
    await pass(LIVE_BURST_MS);

    expect(inbox.fetches()).toBe(3);
  });

  it('makes the inbox stale on notifications.changed, and nothing else', async () => {
    const inbox = await shown(qk.notifications.list({}));
    const items = await shown(qk.workItems.list({}));
    renderHook(() => useLiveSync(), { wrapper });

    send({ event_id: null, type: 'notifications.changed', project_id: null, item_id: null, actor_id: null, unread_changed: true });
    await pass(LIVE_BURST_MS);

    expect(inbox.fetches()).toBe(2);
    expect(items.fetches()).toBe(1);
  });

  it('makes comments and activity stale on comment events', async () => {
    const comments = await shown(qk.comments.list({ item: 'wi_web_47', pages: 'all' }));
    const activity = await shown(qk.activity.list({ item: 'wi_web_47' }));
    const items = await shown(qk.workItems.list({}));
    renderHook(() => useLiveSync(), { wrapper });

    send({ type: 'comment.created', comment_id: 'c_1' });
    await pass(LIVE_BURST_MS);

    expect(comments.fetches()).toBe(2);
    expect(activity.fetches()).toBe(2);
    expect(items.fetches()).toBe(1);
  });

  it('loads the projects again on project events and a new org role, so the channels follow (K14)', async () => {
    const projects = await shown(qk.projects.list({ include_archived: true }));
    const members = await shown(qk.members.list({ project: 'p_web' }));
    renderHook(() => useLiveSync(), { wrapper });

    send({ event_id: 'ev_1', type: 'project.member_added', item_id: null });
    await pass(LIVE_BURST_MS);
    send({ event_id: 'ev_2', type: 'user.role_changed', project_id: null, item_id: null });
    await pass(LIVE_BURST_MS);

    expect(projects.fetches()).toBe(3);
    expect(members.fetches()).toBe(2);
  });

  it('loads everything a screen shows again once the connection is back', async () => {
    const shownKeys = [qk.workItems.all, qk.activity.all, qk.comments.all, qk.projects.all, qk.members.all, qk.notifications.all];
    const queries = [];
    for (const key of shownKeys) queries.push(await shown([...key, 'list']));
    renderHook(() => useLiveSync(), { wrapper });

    send({ event_id: null, type: 'live.reconnected', project_id: null, item_id: null, actor_id: null });
    await pass(LIVE_BURST_MS);

    expect(queries.map((query) => query.fetches())).toEqual([2, 2, 2, 2, 2, 2]);
    expect(useUiStore.getState().flashIds).toEqual([]);
  });

  it('loads the projects and the items again when a channel is refused (A281)', async () => {
    const projects = await shown(qk.projects.list({}));
    const items = await shown(qk.workItems.detail('OPS-12'));
    renderHook(() => useLiveSync(), { wrapper });

    send({ event_id: null, type: 'live.refused', project_id: null, item_id: null, actor_id: null });
    await pass(LIVE_BURST_MS);

    expect(projects.fetches()).toBe(2);
    expect(items.fetches()).toBe(2);
  });

  it('passes over messages no screen shows', async () => {
    const items = await shown(qk.workItems.list({}));
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    renderHook(() => useLiveSync(), { wrapper });

    send({ event_id: 'ev_9', type: 'bot.created', project_id: null, item_id: null });
    await pass(LIVE_BURST_MS);

    expect(invalidate).not.toHaveBeenCalled();
    expect(items.fetches()).toBe(1);
  });

  it('marks only stale while a mutation runs, and the mutation’s own refetch wins', async () => {
    const items = await shown(qk.workItems.list({}));
    renderHook(() => useLiveSync(), { wrapper });
    const settle = mutating(qk.workItems.all);

    send({ event_id: 'ev_1' });
    await pass(LIVE_BURST_MS);
    // the optimistic state stays on screen: nothing is fetched under it
    expect(items.fetches()).toBe(1);
    expect(items.stale()).toBe(true);

    await settle();

    // the mutation loaded the items itself; the live event adds no second fetch
    expect(items.fetches()).toBe(2);
    expect(items.stale()).toBe(false);
  });

  it('refetches what arrived during a mutation once it settles (K12)', async () => {
    const inbox = await shown(qk.notifications.list({}));
    renderHook(() => useLiveSync(), { wrapper });
    const settle = mutating(qk.workItems.all);
    const second = mutating(null);

    send({ event_id: null, type: 'notifications.changed', project_id: null, item_id: null, actor_id: null });
    await pass(LIVE_BURST_MS);
    expect(inbox.fetches()).toBe(1);

    await settle();
    // another mutation still runs
    expect(inbox.fetches()).toBe(1);

    await second();
    expect(inbox.fetches()).toBe(2);
  });

  it('fetches again after the mutation what was being fetched when the event came', async () => {
    const items = await shown(qk.workItems.list({}));
    renderHook(() => useLiveSync(), { wrapper });
    const settle = mutating(null);
    const release = items.hold();
    void queryClient.refetchQueries({ queryKey: qk.workItems.all });
    await pass(0);

    send({ event_id: 'ev_1' });
    await pass(LIVE_BURST_MS);
    release();
    await pass(0);
    // the answer that was on its way may be older than the event
    expect(items.fetches()).toBe(2);
    expect(items.stale()).toBe(false);

    await settle();

    expect(items.fetches()).toBe(3);
  });

  it('flashes the changed item', async () => {
    renderHook(() => useLiveSync(), { wrapper });

    send({ event_id: 'ev_1', item_id: 'wi_web_47' });

    expect(useUiStore.getState().flashIds).toEqual(['wi_web_47']);
    send({ event_id: 'ev_2', type: 'project.updated', item_id: null });
    expect(useUiStore.getState().flashIds).toEqual(['wi_web_47']);
  });

  it('stops listening when the shell goes', async () => {
    const items = await shown(qk.workItems.list({}));
    const { unmount } = renderHook(() => useLiveSync(), { wrapper });
    send({ event_id: 'ev_1' });
    unmount();
    await pass(LIVE_BURST_MS);

    expect(bus.listeners.size).toBe(0);
    expect(items.fetches()).toBe(1);
  });
});

describe('useLiveItem', () => {
  it('holds the channel of the item while it is shown, and none without an item', () => {
    const { rerender, unmount } = renderHook(({ id }: { id: string | null }) => useLiveItem(id), { initialProps: { id: 'wi_web_47' as string | null } });

    expect(bus.watched).toEqual(['wi_web_47']);
    rerender({ id: 'wi_web_30' });
    expect(bus.released).toEqual(['wi_web_47']);
    rerender({ id: null });
    unmount();

    expect(bus.watched).toEqual(['wi_web_47', 'wi_web_30']);
    expect(bus.released).toEqual(['wi_web_47', 'wi_web_30']);
  });
});
