import { QueryClient, QueryClientProvider, QueryObserver, type QueryKey } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ApiError } from '@/api/client';
import type { LiveEvent } from '@/api/live';
import { resetToasts } from '@/components/ui/toast';
import { runWithUndo, undoLatest } from '@/lib/undo';
import { useUiStore } from '@/store/ui';
import { mockApi, type MockApi } from '@/test/api';
import { project } from '@/test/fixtures';
import { qk } from './keys';
import { LIVE_BURST_MS, LIVE_MAX_WAIT_MS, useLiveConnected, useLiveItem, useLiveSync } from './live';
import { useMembers, useProject, useProjects } from './projects';

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
let api: MockApi | null = null;
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
  api?.restore();
  api = null;
  resetToasts();
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
  it('makes items and activity stale once for a burst of events, when the messages pause', async () => {
    const items = await shown(qk.workItems.list({ project: 'p_web' }));
    const activity = await shown(qk.activity.list({ item: 'wi_web_47', pages: 'all' }));
    const inbox = await shown(qk.notifications.list({}));
    renderHook(() => useLiveSync(), { wrapper });

    send({ event_id: 'ev_1' });
    await pass(100);
    send({ event_id: 'ev_2', type: 'work_item.state_changed' });
    await pass(250);
    send({ event_id: 'ev_3', item_id: 'wi_web_42' });
    await pass(LIVE_BURST_MS - 1);
    expect(items.fetches()).toBe(1);

    await pass(1);

    expect(items.fetches()).toBe(2);
    expect(activity.fetches()).toBe(2);
    expect(inbox.fetches()).toBe(1);
  });

  it('loads at the latest after two seconds of a steady stream, and never restarts a fetch still on its way', async () => {
    const items = await shown(qk.workItems.list({}));
    renderHook(() => useLiveSync(), { wrapper });
    const release = items.hold();

    // a message every 100 ms for three seconds: the burst never pauses
    for (let n = 1; n <= 30; n += 1) {
      send({ event_id: `ev_${n}` });
      await pass(100);
      // the first load comes after two seconds, not later, and its slow answer is never cancelled for a new one
      expect(items.fetches()).toBe(n < LIVE_MAX_WAIT_MS / 100 ? 1 : 2);
    }
    await pass(LIVE_BURST_MS);
    expect(items.fetches()).toBe(2);
    expect(queryClient.getQueryState(qk.workItems.list({}))?.fetchStatus).toBe('fetching');

    // the answer may be older than the messages that came meanwhile: once more, and only once
    release();
    await pass(0);
    expect(items.fetches()).toBe(3);
    await pass(LIVE_MAX_WAIT_MS);
    expect(items.fetches()).toBe(3);
    expect(queryClient.getQueryState(qk.workItems.list({}))?.status).toBe('success');
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

  it('loads what the person lost access to, so the screen shows it as not found (A281)', async () => {
    let lost = false;
    const ops = project('OPS', 'member');
    api = mockApi({
      'GET /api/v1/projects': () => ({ body: { data: lost ? [] : [ops], links: {}, meta: { next_cursor: null, total: lost ? 0 : 1 } } }),
      'GET /api/v1/projects/OPS': () => (lost ? { status: 404, body: { reason: 'not_found' } } : { body: { data: ops } }),
      'GET /api/v1/projects/p_ops/members': () =>
        lost ? { status: 404, body: { reason: 'not_found' } } : { body: { data: [], links: {}, meta: { next_cursor: null, total: 0 } } },
    });
    const { result } = renderHook(
      () => {
        useLiveSync();
        return { projects: useProjects({ include_archived: true }), project: useProject('OPS'), members: useMembers('p_ops') };
      },
      { wrapper },
    );
    await vi.waitFor(() => expect(result.current.project.data).toEqual(ops));

    lost = true;
    send({ event_id: null, type: 'live.refused', project_id: 'p_ops', item_id: null, actor_id: null });
    await pass(LIVE_BURST_MS);
    await vi.waitFor(() => expect(result.current.project.error).not.toBeNull());

    expect(result.current.projects.data?.items).toEqual([]);
    expect((result.current.project.error as ApiError | null)?.status).toBe(404);
    expect((result.current.members.error as ApiError | null)?.status).toBe(404);
  });

  it('loads items, history, comments and the inbox again when a channel is refused', async () => {
    const queries = [];
    for (const key of [qk.workItems.detail('OPS-12'), qk.activity.list({ item: 'wi_ops_12' }), qk.comments.list({ item: 'wi_ops_12' }), qk.notifications.list({})]) {
      queries.push(await shown(key));
    }
    renderHook(() => useLiveSync(), { wrapper });

    send({ event_id: null, type: 'live.refused', project_id: null, item_id: 'wi_ops_12', actor_id: null });
    await pass(LIVE_BURST_MS);

    expect(queries.map((query) => query.fetches())).toEqual([2, 2, 2, 2]);
  });

  it('loads nothing again for a refused channel of a project it knows is deleted, whichever message comes first', async () => {
    for (const order of [['project.deleted', 'live.refused'], ['live.refused', 'project.deleted']]) {
      const projects = await shown(qk.projects.list({ include_archived: true }));
      const project = await shown(qk.projects.detail('WEB'));
      queryClient.setQueryData(qk.projects.detail('WEB'), { id: 'p_web', identifier: 'WEB' });
      const items = await shown(qk.workItems.list({ preset: 'my' }));
      const inbox = await shown(qk.notifications.list({}));
      const { unmount } = renderHook(() => useLiveSync(), { wrapper });

      for (const type of order) send({ event_id: type === 'live.refused' ? null : 'ev_del', type, project_id: 'p_web', item_id: null, actor_id: null });
      await pass(LIVE_BURST_MS);

      // deleted wins: the lists that name the project load, the project's own queries and everything else stay
      expect([projects.fetches(), project.fetches(), items.fetches(), inbox.fetches()], order.join(' then ')).toEqual([2, 1, 1, 1]);

      send({ event_id: null, type: 'live.refused', project_id: 'p_web', item_id: null, actor_id: null });
      await pass(LIVE_BURST_MS);
      expect([projects.fetches(), project.fetches(), items.fetches(), inbox.fetches()]).toEqual([2, 1, 1, 1]);
      unmount();
      stops.splice(0).forEach((stop) => stop());
      queryClient.clear();
    }
  });

  it('remembers the last 200 deleted things, not every one', async () => {
    const first = await shown(qk.workItems.detail('WEB-1'));
    queryClient.setQueryData(qk.workItems.detail('WEB-1'), { item: { id: 'wi_0' } });
    const second = await shown(qk.workItems.detail('WEB-2'));
    queryClient.setQueryData(qk.workItems.detail('WEB-2'), { item: { id: 'wi_1' } });
    renderHook(() => useLiveSync(), { wrapper });

    for (let n = 0; n < 200; n += 1) send({ event_id: `ev_del_${n}`, type: 'work_item.deleted', item_id: `wi_${n}` });
    await pass(LIVE_BURST_MS);
    expect([first.fetches(), second.fetches()]).toEqual([1, 1]);

    send({ event_id: 'ev_del_200', type: 'work_item.deleted', item_id: 'wi_200' });
    await pass(LIVE_BURST_MS);
    // the oldest fell out: its query loads again (it would say the item is gone), the next one stays alone
    expect([first.fetches(), second.fetches()]).toEqual([2, 1]);
  });

  it('passes over messages no screen shows', async () => {
    const items = await shown(qk.workItems.list({}));
    renderHook(() => useLiveSync(), { wrapper });

    send({ event_id: 'ev_9', type: 'bot.created', project_id: null, item_id: null });
    await pass(LIVE_BURST_MS);

    expect(items.stale()).toBe(false);
    expect(items.fetches()).toBe(1);
  });

  it('does not load what was deleted (it would answer 404), only what lists it', async () => {
    const projects = await shown(qk.projects.list({ include_archived: true }));
    const project = await shown(qk.projects.detail('WEB'));
    queryClient.setQueryData(qk.projects.detail('WEB'), { id: 'p_web', identifier: 'WEB' });
    const members = await shown(qk.members.list({ project: 'p_web' }));
    const list = await shown(qk.workItems.list({ filter: { conditions: [{ field: 'project', op: 'is', value: 'p_web' }] } }));
    const mine = await shown(qk.workItems.list({ preset: 'my' }));
    const detail = await shown(qk.workItems.detail('APP-3'));
    queryClient.setQueryData(qk.workItems.detail('APP-3'), { item: { id: 'wi_app_3' } });
    const activity = await shown(qk.activity.list({ item: 'wi_app_3', pages: 'all' }));
    renderHook(() => useLiveSync(), { wrapper });

    send({ event_id: 'ev_1', type: 'work_item.deleted', project_id: 'p_app', item_id: 'wi_app_3' });
    send({ event_id: 'ev_2', type: 'project.deleted', project_id: 'p_web', item_id: null });
    await pass(LIVE_BURST_MS);

    expect([projects, mine].map((query) => query.fetches())).toEqual([2, 2]);
    expect([project, members, list, detail, activity].map((query) => query.fetches())).toEqual([1, 1, 1, 1, 1]);
    // not even stale: another view of them mounting would fetch them and get 404 (left alone until the screen is left)
    expect([project, members, list, detail, activity].some((query) => query.stale())).toBe(false);
  });

  it('does not load again a fetch it waited for when its project went meanwhile', async () => {
    const members = await shown(qk.members.list({ project: 'p_web' }));
    renderHook(() => useLiveSync(), { wrapper });
    const release = members.hold();
    void queryClient.refetchQueries({ queryKey: qk.members.all });
    await pass(0);

    send({ event_id: 'ev_1', type: 'project.member_added', item_id: null });
    await pass(LIVE_BURST_MS);
    send({ event_id: 'ev_2', type: 'project.deleted', item_id: null });
    await pass(LIVE_BURST_MS);
    release();
    await pass(0);

    expect(members.fetches()).toBe(2);
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

  it('keeps an item hidden while its removal can still be undone, and loads once the removal ran', async () => {
    const items = await shown(qk.workItems.list({}));
    renderHook(() => useLiveSync(), { wrapper });
    let finish = () => {};
    const removal = vi.fn(() => queryClient.getMutationCache().build(queryClient, { mutationFn: () => new Promise<void>((resolve) => (finish = resolve)) }).execute(undefined));
    runWithUndo({ label: 'WEB-47 gelöscht', run: removal });

    send({ event_id: 'ev_1' });
    await pass(LIVE_BURST_MS);
    // the list would bring the hidden row back while the toast still offers undo
    expect(items.fetches()).toBe(1);
    expect(items.stale()).toBe(true);

    await pass(5_000 - LIVE_BURST_MS);
    expect(removal).toHaveBeenCalledTimes(1);
    expect(items.fetches()).toBe(1);

    finish();
    await pass(0);
    expect(items.fetches()).toBe(2);
  });

  it('loads what came during the undo window once the change is taken back', async () => {
    const items = await shown(qk.workItems.list({}));
    renderHook(() => useLiveSync(), { wrapper });
    const undo = vi.fn();
    const run = vi.fn();
    runWithUndo({ label: 'WEB-47 archiviert', run, undo });

    send({ event_id: 'ev_1' });
    await pass(LIVE_BURST_MS);
    expect(items.fetches()).toBe(1);

    act(() => void undoLatest());
    await pass(0);

    expect(undo).toHaveBeenCalledTimes(1);
    expect(run).not.toHaveBeenCalled();
    expect(items.fetches()).toBe(2);
  });

  it('waits for a fetch still on its way when the mutation settles, then loads once', async () => {
    const items = await shown(qk.workItems.list({}));
    renderHook(() => useLiveSync(), { wrapper });
    const settle = mutating(null);
    const release = items.hold();
    void queryClient.refetchQueries({ queryKey: qk.workItems.all });
    await pass(0);

    send({ event_id: 'ev_1' });
    await pass(LIVE_BURST_MS);
    await settle();
    // the answer on its way is not cancelled for a new one
    expect(items.fetches()).toBe(2);

    release();
    await pass(0);
    expect(items.fetches()).toBe(3);
  });

  it('forgets a fetch it waited for when its query left the cache', async () => {
    const items = await shown(qk.workItems.list({}));
    renderHook(() => useLiveSync(), { wrapper });
    const settle = mutating(null);
    items.hold();
    void queryClient.refetchQueries({ queryKey: qk.workItems.all });
    await pass(0);

    send({ event_id: 'ev_1' });
    await pass(LIVE_BURST_MS);
    stops.splice(0).forEach((stop) => stop());
    queryClient.removeQueries({ queryKey: qk.workItems.all });
    await settle();

    expect(items.fetches()).toBe(2);
    expect(queryClient.getQueryCache().findAll({ queryKey: qk.workItems.all })).toEqual([]);
  });

  it('flashes the changed item', async () => {
    renderHook(() => useLiveSync(), { wrapper });

    send({ event_id: 'ev_1', item_id: 'wi_web_47' });
    send({ event_id: 'ev_2', type: 'project.updated', item_id: null });

    // with the new data, not before
    expect(useUiStore.getState().flashIds).toEqual([]);
    await pass(LIVE_BURST_MS);
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
