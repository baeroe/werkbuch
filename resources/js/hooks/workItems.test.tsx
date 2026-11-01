import { QueryClient, QueryClientProvider, type QueryKey } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Page } from '@/api/client';
import { currentToasts, resetToasts, runToastAction } from '@/components/ui/toast';
import { mockApi, type MockApi, type MockRoute } from '@/test/api';
import { list, makeWorkItem, ops12, standard, types, web30, web47, web47History, web47Relations, web48, webStateGroups } from '@/test/fixtures';
import type { ListWorkItemsArgs } from '@/api/workItems';
import type { Filter, WorkItem, WorkItemDetail } from '@/types';
import { qk } from './keys';
import { useAddRelation, useRemoveRelation } from './relations';
import {
  useActivity,
  useArchiveWorkItem,
  useBulkUpdateWorkItems,
  useChangeWorkItemType,
  useCreateWorkItem,
  useDeleteWorkItem,
  useRestoreWorkItem,
  useSetSubscribed,
  useStateUsage,
  useTransitionWorkItem,
  useGroupedWorkItems,
  useInfiniteWorkItems,
  useUpdateWorkItem,
  useWorkItem,
  useWorkItemCounts,
  useWorkItemGroups,
  useWorkItems,
} from './workItems';

let queryClient: QueryClient;
let api: MockApi | undefined;
const originalFetch = globalThis.fetch;

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 10_000 }, mutations: { retry: false } } });
});

afterEach(() => {
  api?.restore();
  api = undefined;
  globalThis.fetch = originalFetch;
  resetToasts();
});

const page = (...items: WorkItem[]): Page<WorkItem> => ({ items, next_cursor: null, total: items.length });
const detail = (item: WorkItem, changes: Partial<WorkItemDetail> = {}): WorkItemDetail => ({
  item,
  type: types[1]!,
  state: standard.states.find((state) => state.id === item.state_id)!,
  workflow: standard,
  children: [],
  relations: [],
  attachments: [],
  subscribed: item.subscribed,
  ...changes,
});

const LIST = qk.workItems.list({ project_id: 'WEB' });
const listed = () => queryClient.getQueryData<Page<WorkItem>>(LIST)!.items;
const detailOf = (ref: string) => queryClient.getQueryData<WorkItemDetail>(qk.workItems.detail(ref))!;
const newest = () => currentToasts().at(-1);

/** Every call waits until `release()` gives it the answer: the optimistic state shows in between. */
function holdFetch(answer: unknown, status = 200) {
  const waiting: (() => void)[] = [];
  const contentType = status >= 400 ? 'application/problem+json' : 'application/json';
  globalThis.fetch = () =>
    new Promise<Response>((resolve) => {
      waiting.push(() => resolve(new Response(JSON.stringify(answer), { status, headers: { 'Content-Type': contentType } })));
    });
  return { release: () => waiting.splice(0).forEach((answerCall) => answerCall()), pending: () => waiting.length };
}

describe('reading', () => {
  it('lists items, reads one with its detail, its history and the count per state', async () => {
    api = mockApi({
      'POST /api/v1/work-items/query': () => ({ body: list([web47]) }),
      'GET /api/v1/work-items/WEB-47': () => ({ body: { data: { ...web47, children: [], relations: web47Relations, type: types[1], workflow: standard } } }),
      'GET /api/v1/work-items/WEB-47/history': () => ({ body: list(web47History) }),
      'GET /api/v1/state-usage': () => ({ body: { data: [{ state_id: 'std_progress', items: 2 }] } }),
    });
    const { result } = renderHook(
      () => ({
        items: useWorkItems({ project_id: 'WEB' }),
        item: useWorkItem('WEB-47'),
        activity: useActivity('WEB-47'),
        usage: useStateUsage({ project: 'WEB' }),
      }),
      { wrapper },
    );

    await waitFor(() => expect(Object.values(result.current).every((query) => query.isSuccess)).toBe(true));
    expect(result.current.items.data?.items).toEqual([web47]);
    expect(result.current.item.data?.state.name).toBe('In Progress');
    expect(result.current.item.data?.relations).toEqual(web47Relations);
    expect(result.current.activity.data?.items.map((entry) => entry.id)).toEqual(['ev_1', 'ev_2', 'ev_3']);
    expect(result.current.usage.data).toEqual([{ state_id: 'std_progress', items: 2 }]);
    expect(api.calls.map((call) => `${call.method} ${decodeURIComponent(call.url)}`).sort()).toEqual([
      'GET /api/v1/state-usage?project=WEB',
      'GET /api/v1/work-items/WEB-47/history',
      'GET /api/v1/work-items/WEB-47?include=children,relations,type,workflow',
      'POST /api/v1/work-items/query',
    ]);
    expect(api.calls.find((call) => call.method === 'POST')!.body).toEqual({ shorthand: { project: 'WEB' } });
  });

  it('reads every page of the history, so the newest entries are there too', async () => {
    // the server pages from the oldest entry on: the newest ones stand on the last page
    api = mockApi({
      'GET /api/v1/work-items/WEB-47/history': (_body, url) =>
        url.searchParams.get('cursor') === 'next'
          ? { body: list(web47History.slice(2)) }
          : { body: { data: web47History.slice(0, 2), links: {}, meta: { next_cursor: 'next', total: 3 } } },
    });
    const { result } = renderHook(() => useActivity('WEB-47'), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.items.map((entry) => entry.id)).toEqual(['ev_1', 'ev_2', 'ev_3']);
    expect(api.calls.map((call) => call.url)).toEqual(['/api/v1/work-items/WEB-47/history', '/api/v1/work-items/WEB-47/history?cursor=next']);
  });

  it('waits while it lacks a reference or is told to', () => {
    api = mockApi({});
    const { result } = renderHook(
      () => ({
        items: useWorkItems({}, { enabled: false }),
        item: useWorkItem(null),
        held: useWorkItem('WEB-47', { enabled: false }),
        activity: useActivity(undefined),
        usage: useStateUsage({ workflow: 'wf_standard' }, { enabled: false }),
        groups: useWorkItemGroups(null),
        heldGroups: useWorkItemGroups({ group_by: 'state' }, { enabled: false }),
        counts: useWorkItemCounts(null),
        heldCounts: useWorkItemCounts({ open: { version: 1, conditions: [] } }, { enabled: false }),
      }),
      { wrapper },
    );

    expect(Object.values(result.current).every((query) => query.fetchStatus === 'idle' && query.data === undefined)).toBe(true);
    expect(api.calls).toHaveLength(0);
  });
});

describe('optimistic changes', () => {
  it('useUpdateWorkItem changes the list and the detail at once and keeps the answer of the server', async () => {
    queryClient.setQueryData(LIST, page(web47, ops12));
    queryClient.setQueryData(qk.workItems.detail('WEB-47'), detail(web47));
    queryClient.setQueryData(qk.activity.list({ item: 'WEB-47', pages: 'all' }), page());
    queryClient.setQueryData(qk.stateUsage.list({ project: 'WEB' }), []);
    const answer = { ...web47, title: 'Formular sendet doppelt', updated_at: '2026-10-31T10:00:00.000Z' };
    const held = holdFetch({ data: answer });
    const { result } = renderHook(() => useUpdateWorkItem(), { wrapper });

    act(() => result.current.mutate({ id: 'WEB-47', patch: { title: 'Formular sendet doppelt' } }));

    await waitFor(() => expect(listed()[0]!.title).toBe('Formular sendet doppelt'));
    expect(detailOf('WEB-47').item.title).toBe('Formular sendet doppelt');
    // the other item stays the very same object
    expect(listed()[1]).toBe(ops12);
    expect(held.pending()).toBe(1);

    await act(async () => held.release());
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(answer);
    // the lists, the history and the count per state load again
    expect(
      [LIST, qk.activity.list({ item: 'WEB-47', pages: 'all' }), qk.stateUsage.list({ project: 'WEB' })].map((queryKey) => queryClient.getQueryState(queryKey)?.isInvalidated),
    ).toEqual([true, true, true]);
  });

  it('keeps a lean item of a list lean when the description changes, and counts its version up', async () => {
    const { description: _md, description_json: _doc, values_markdown: _values, ...lean } = web47;
    queryClient.setQueryData(LIST, { items: [lean], next_cursor: null, total: 1 });
    api = mockApi({ 'PATCH /api/v1/work-items/WEB-47': () => ({ body: { data: web47 } }) });
    const { result } = renderHook(() => useUpdateWorkItem(), { wrapper });

    await act(() => result.current.mutateAsync({ id: 'WEB-47', patch: { description: null } }));

    expect(listed()[0]).toEqual({ ...lean, description_version: web47.description_version + 1 });
  });

  it('sends the description as a document with its base version and counts the version up', async () => {
    const doc = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Neu' }] }] };
    queryClient.setQueryData(qk.workItems.detail('WEB-47'), detail(web47));
    api = mockApi({ 'PATCH /api/v1/work-items/WEB-47': () => ({ body: { data: web47 } }) });
    const { result } = renderHook(() => useUpdateWorkItem(), { wrapper });

    await act(() => result.current.mutateAsync({ id: 'WEB-47', patch: { description: doc, values: { effort: 5, customer: null, environment: [] } }, base_description_version: 3 }));

    expect(api.calls[0]!.body).toEqual({ description_json: doc, values: { effort: 5, customer: null, environment: [] }, base_description_version: 3 });
    const { item } = detailOf('WEB-47');
    expect(item.description_json).toEqual(doc);
    expect(item.description_version).toBe(4);
    // an empty value removes the property, as on the server
    expect(item.values).toEqual({ effort: 5 });
  });

  it('takes the change back on a refusal and names the cause without "Erneut versuchen"', async () => {
    queryClient.setQueryData(LIST, page(web47));
    queryClient.setQueryData(qk.workItems.detail('WEB-47'), detail(web47));
    api = mockApi({
      'PATCH /api/v1/work-items/WEB-47': () => ({ status: 422, body: { reason: 'validation_failed', detail: 'Der Titel darf nicht leer sein.', errors: { title: ['Der Titel darf nicht leer sein.'] } } }),
    });
    const { result } = renderHook(() => useUpdateWorkItem(), { wrapper });

    await act(() => result.current.mutateAsync({ id: 'WEB-47', patch: { title: ' ' } }).catch(() => undefined));

    expect(listed()[0]).toEqual(web47);
    expect(detailOf('WEB-47').item).toEqual(web47);
    expect(newest()).toMatchObject({ title: 'Änderung nicht gespeichert', description: 'Der Titel darf nicht leer sein.', tone: 'error' });
    expect(newest()?.action).toBeUndefined();
    expect(result.current.isPending).toBe(false);
  });

  it('offers "Erneut versuchen" when the server failed, and the button sends the change again', async () => {
    queryClient.setQueryData(LIST, page(web47));
    let down = true;
    api = mockApi({
      'PATCH /api/v1/work-items/WEB-47': () => (down ? { status: 503, body: { reason: 'unavailable', detail: 'Der Server ist gerade nicht erreichbar.' } } : { body: { data: { ...web47, priority: 'low' } } }),
    });
    const { result } = renderHook(() => useUpdateWorkItem(), { wrapper });

    await act(() => result.current.mutateAsync({ id: 'WEB-47', patch: { priority: 'low' } }).catch(() => undefined));

    expect(listed()[0]!.priority).toBe('urgent');
    expect(newest()).toMatchObject({ title: 'Änderung nicht gespeichert', action: { label: 'Erneut versuchen' } });

    down = false;
    act(() => runToastAction(newest()!.id));
    await waitFor(() => expect(api!.calls).toHaveLength(2));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(listed()[0]!.priority).toBe('low');
  });

  it('leaves a description conflict to the caller: no toast, the old state back', async () => {
    queryClient.setQueryData(qk.workItems.detail('WEB-47'), detail(web47));
    const current = { ...web47, description_version: 4 };
    api = mockApi({
      'PATCH /api/v1/work-items/WEB-47': () => ({ status: 409, body: { reason: 'description_conflict', detail: 'Ida Brenner hat die Beschreibung inzwischen geändert.', current } }),
    });
    const { result } = renderHook(() => useUpdateWorkItem(), { wrapper });

    const error = await act(() => result.current.mutateAsync({ id: 'WEB-47', patch: { description: null }, base_description_version: 3 }).catch((caught: unknown) => caught));

    expect(error).toMatchObject({ status: 409, reason: 'description_conflict', current });
    expect(currentToasts()).toHaveLength(0);
    expect(detailOf('WEB-47').item).toEqual(web47);
  });

  it('finds the item by id and by its key in any case', async () => {
    queryClient.setQueryData(LIST, page(web47, web30));
    api = mockApi({
      'PATCH /api/v1/work-items/wi_web_30': () => ({ body: { data: web30 } }),
      'PATCH /api/v1/work-items/web-47': () => ({ body: { data: web47 } }),
    });
    const { result } = renderHook(() => useUpdateWorkItem(), { wrapper });

    await act(() => result.current.mutateAsync({ id: 'wi_web_30', patch: { priority: 'low' } }));
    await act(() => result.current.mutateAsync({ id: 'web-47', patch: { priority: 'low' } }));

    expect(listed().map((item) => item.priority)).toEqual(['low', 'low']);
  });

  it('reaches a detail cached under a former key, whose item has a new key by now', async () => {
    const renamed = makeWorkItem({ id: 'wi_new_1', key: 'NEW-1', title: 'Umbenannt' });
    queryClient.setQueryData(qk.workItems.detail('OLD-1'), detail(renamed));
    api = mockApi({ 'PATCH /api/v1/work-items/old-1': () => ({ body: { data: renamed } }) });
    const { result } = renderHook(() => useUpdateWorkItem(), { wrapper });

    await act(() => result.current.mutateAsync({ id: 'old-1', patch: { title: 'Neuer Titel' } }));

    expect(detailOf('OLD-1').item.title).toBe('Neuer Titel');
  });

  it('lets the parent an item names follow the change', async () => {
    const epic = makeWorkItem({ id: 'wi_web_60', key: 'WEB-60', type_id: 't_epic', title: 'Barrierefreiheit' });
    queryClient.setQueryData(LIST, page(web30, web48, epic, web47));
    queryClient.setQueryData(qk.workItems.detail('WEB-30'), detail(web30, { children: [web48] }));
    // an entry that is neither a list nor a detail stays as it is
    queryClient.setQueryData(qk.workItems.list({ broken: true }), 'cached');
    api = mockApi({
      'PATCH /api/v1/work-items/WEB-30': () => ({ body: { data: web30 } }),
      'PATCH /api/v1/work-items/WEB-48': () => ({ body: { data: web48 } }),
      'PATCH /api/v1/work-items/WEB-47': () => ({ body: { data: web47 } }),
    });
    const { result } = renderHook(() => useUpdateWorkItem(), { wrapper });

    // a renamed epic: its child names it with the new title, in the list and in the detail's children
    await act(() => result.current.mutateAsync({ id: 'WEB-30', patch: { title: 'Relaunch' } }));
    expect(listed()[1]!.parent).toEqual({ id: 'wi_web_30', key: 'WEB-30', title: 'Relaunch', type_id: 't_epic' });
    expect(detailOf('WEB-30').children[0]!.parent?.title).toBe('Relaunch');

    // a child that moves to another epic names that one
    await act(() => result.current.mutateAsync({ id: 'WEB-48', patch: { parent_id: 'wi_web_60' } }));
    expect(listed()[1]!.parent).toEqual({ id: 'wi_web_60', key: 'WEB-60', title: 'Barrierefreiheit', type_id: 't_epic' });

    // a parent the cache does not know is named by nobody until the server answers, and none is none
    await act(() => result.current.mutateAsync({ id: 'WEB-47', patch: { parent_id: 'wi_unknown' } }));
    expect(listed()[3]!.parent).toBeNull();
    await act(() => result.current.mutateAsync({ id: 'WEB-48', patch: { parent_id: null } }));
    expect(listed()[1]!.parent).toBeNull();
    expect(queryClient.getQueryData(qk.workItems.list({ broken: true }))).toBe('cached');
  });

  it('useTransitionWorkItem moves the item, the state of its detail with it, and keeps the resolution unless one is chosen', async () => {
    queryClient.setQueryData(qk.workItems.detail('WEB-47'), detail(web47));
    api = mockApi({ 'POST /api/v1/work-items/WEB-47/transition': () => ({ body: { data: web47 } }) });
    const { result } = renderHook(() => useTransitionWorkItem(), { wrapper });

    await act(() => result.current.mutateAsync({ id: 'WEB-47', to_state_id: 'std_cancelled', resolution_id: 'res_duplicate' }));
    expect(detailOf('WEB-47').state.name).toBe('Cancelled');
    expect(detailOf('WEB-47').item.resolution_id).toBe('res_duplicate');

    await act(() => result.current.mutateAsync({ id: 'WEB-47', to_state_id: 'std_done' }));
    expect(detailOf('WEB-47').item).toMatchObject({ state_id: 'std_done', resolution_id: 'res_duplicate' });
    expect(api.calls.map((call) => call.body)).toEqual([
      { to_state_id: 'std_cancelled', resolution_id: 'res_duplicate' },
      { to_state_id: 'std_done', resolution_id: null },
    ]);
  });

  it('keeps the state of a detail when the workflow does not know the new one', async () => {
    queryClient.setQueryData(qk.workItems.detail('WEB-47'), detail(web47));
    const held = holdFetch({ reason: 'transition_not_allowed', detail: 'Nicht erlaubt.' }, 409);
    const { result } = renderHook(() => useTransitionWorkItem(), { wrapper });

    act(() => result.current.mutate({ id: 'WEB-47', to_state_id: 'app_done' }));

    await waitFor(() => expect(detailOf('WEB-47').item.state_id).toBe('app_done'));
    expect(detailOf('WEB-47').state.name).toBe('In Progress');
    await act(async () => held.release());
    await waitFor(() => expect(newest()).toMatchObject({ title: 'Statuswechsel nicht gespeichert', description: 'Nicht erlaubt.' }));
    expect(detailOf('WEB-47').item.state_id).toBe('std_progress');
  });

  it('useBulkUpdateWorkItems changes every named item, adds and removes labels and archives', async () => {
    queryClient.setQueryData(LIST, page(web47, web48, ops12));
    const result_ = { updated: ['wi_web_47', 'wi_web_48'], rejected: [] };
    api = mockApi({ 'POST /api/v1/work-items/bulk': () => ({ body: result_ }) });
    const { result } = renderHook(() => useBulkUpdateWorkItems(), { wrapper });

    const answer = await act(() => result.current.mutateAsync({ ids: ['WEB-47', 'wi_web_48'], patch: { priority: 'low', add_label_ids: ['lb_ux'], remove_label_ids: ['lb_forms'] } }));
    expect(answer).toEqual(result_);
    expect(listed().map((item) => [item.priority, item.label_ids])).toEqual([
      ['low', ['lb_production', 'lb_ux']],
      ['low', ['lb_ux']],
      ['high', []],
    ]);

    await act(() => result.current.mutateAsync({ ids: ['WEB-47'], patch: { label_ids: ['lb_ux'], add_label_ids: ['lb_performance'] } }));
    expect(listed()[0]!.label_ids).toEqual(['lb_ux', 'lb_performance']);
    await act(() => result.current.mutateAsync({ ids: ['WEB-47'], patch: { remove_label_ids: ['lb_ux'] } }));
    expect(listed()[0]!.label_ids).toEqual(['lb_performance']);

    await act(() => result.current.mutateAsync({ ids: ['WEB-47'], patch: { archived: true } }));
    expect(listed()[0]!.archived_at).toMatch(/^\d{4}-\d\d-\d\dT/);
    await act(() => result.current.mutateAsync({ ids: ['WEB-47'], patch: { archived: false } }));
    expect(listed()[0]!.archived_at).toBeNull();
  });

  it('useArchiveWorkItem and useRestoreWorkItem stamp and clear the archive', async () => {
    queryClient.setQueryData(LIST, page(web47));
    const held = holdFetch({ reason: 'not_closed', detail: 'Nur geschlossene Items lassen sich archivieren.' }, 409);
    const archive = renderHook(() => useArchiveWorkItem(), { wrapper }).result;
    const restore = renderHook(() => useRestoreWorkItem(), { wrapper }).result;

    act(() => archive.current.mutate('WEB-47'));
    await waitFor(() => expect(listed()[0]!.archived_at).toMatch(/^\d{4}-\d\d-\d\dT/));
    await act(async () => held.release());
    await waitFor(() => expect(newest()).toMatchObject({ title: 'Archivieren nicht gespeichert' }));
    expect(listed()[0]!.archived_at).toBeNull();

    api = mockApi({ 'POST /api/v1/work-items/WEB-47/restore': () => ({ body: { data: web47 } }) });
    queryClient.setQueryData(LIST, page({ ...web47, archived_at: '2026-10-30T09:00:00.000Z' }));
    await act(() => restore.current.mutateAsync('WEB-47'));
    expect(listed()[0]!.archived_at).toBeNull();
  });

  it('useSetSubscribed sets `subscribed` on the item and its detail', async () => {
    const quiet = { ...web47, subscribed: false };
    queryClient.setQueryData(qk.workItems.detail('WEB-47'), detail(quiet));
    api = mockApi({
      'PUT /api/v1/work-items/WEB-47/subscription': () => ({ body: { data: web47 } }),
      'DELETE /api/v1/work-items/WEB-47/subscription': () => ({ status: 500, body: { reason: 'server_error', detail: 'Interner Fehler.' } }),
    });
    const { result } = renderHook(() => useSetSubscribed(), { wrapper });

    await act(() => result.current.mutateAsync({ id: 'WEB-47', on: true }));
    expect(detailOf('WEB-47')).toMatchObject({ subscribed: true, item: { subscribed: true } });

    await act(() => result.current.mutateAsync({ id: 'WEB-47', on: false }).catch(() => undefined));
    expect(detailOf('WEB-47').subscribed).toBe(true);
    expect(newest()).toMatchObject({ title: 'Beobachten nicht geändert', action: { label: 'Erneut versuchen' } });
  });
});

describe('changes that wait for the server', () => {
  const PROBES: Record<string, QueryKey> = {
    workItems: qk.workItems.all,
    activity: qk.activity.all,
    stateUsage: qk.stateUsage.all,
    workflows: qk.workflows.all,
  };

  /** A mutation hook, whatever its variables and answer. */
  type AnyMutation = () => { mutateAsync: (vars: never) => Promise<unknown> };

  it.each<[string, AnyMutation, unknown, string, MockRoute, string[]]>([
    ['useCreateWorkItem', useCreateWorkItem, { project_id: 'p_web', type_id: 't_task', title: 'Neu' }, 'POST /api/v1/work-items', () => ({ status: 201, body: { data: web47 } }), ['workItems', 'activity', 'stateUsage']],
    ['useChangeWorkItemType', useChangeWorkItemType, { id: 'WEB-47', type_id: 't_task' }, 'PUT /api/v1/work-items/WEB-47/type', () => ({ body: { data: web47 } }), ['workItems', 'activity', 'stateUsage']],
    ['useDeleteWorkItem', useDeleteWorkItem, 'WEB-47', 'DELETE /api/v1/work-items/WEB-47', () => ({}), ['workItems', 'activity', 'stateUsage']],
    ['useAddRelation', useAddRelation, { source_id: 'WEB-47', type_id: 'rt_blocks', target_id: 'OPS-12' }, 'POST /api/v1/work-items/WEB-47/relations', () => ({ status: 201, body: { data: web47Relations[0] } }), ['workItems', 'activity']],
    ['useRemoveRelation', useRemoveRelation, 'rel_1', 'DELETE /api/v1/relations/rel_1', () => ({}), ['workItems', 'activity']],
  ])('%s calls the API and makes stale what it changed', async (_name, useHook, vars, route, answer, stale) => {
    api = mockApi({ [route]: answer });
    Object.values(PROBES).forEach((key) => queryClient.setQueryData(key, 'cached'));
    const { result } = renderHook(() => useHook(), { wrapper });

    await act(() => result.current.mutateAsync(vars as never));

    expect(api.calls.map((call) => `${call.method} ${call.url}`)).toEqual([route]);
    expect(Object.keys(PROBES).filter((name) => queryClient.getQueryState(PROBES[name]!)?.isInvalidated)).toEqual(stale);
  });
});

/* ------------------------------------------------------------------------ pages */

/**
 * A fake `POST /work-items/query` with a keyset cursor, as the server pages: by rank, `per_page` at a time, the cursor
 * names the rank of the last item of a page and the next page starts after it. `group` takes the items of one state
 * (`group_by: state`) or of one assignee (`none` for the unassigned). The items are read anew on every call.
 */
function keysetServer(items: () => WorkItem[], per = 2): MockRoute {
  return (body) => {
    const { cursor, group, group_by: by, per_page: size = per } = body as { cursor?: string; group?: string; group_by?: string; per_page?: number };
    const inGroup = (item: WorkItem) =>
      group === undefined || (by === 'state' ? item.state_id === group : by === 'assignee' ? (item.assignee_id ?? 'none') === group : false);
    const sorted = items()
      .filter(inGroup)
      .sort((a, b) => (a.rank < b.rank ? -1 : 1));
    const rest = cursor === undefined ? sorted : sorted.filter((item) => item.rank > cursor);
    const shown = rest.slice(0, size);
    const next = rest.length > size ? shown.at(-1)!.rank : null;
    return { body: { data: shown, links: {}, meta: { next_cursor: next, total: sorted.length } } };
  };
}

const ranked = (letters: string, changes: Partial<WorkItem> = {}) =>
  [...letters].map((letter, index) => makeWorkItem({ id: `wi_${letter}`, key: `WEB-${index + 1}`, number: index + 1, title: letter, rank: `a${index + 1}`, ...changes }));

const titles = (data: Page<{ title: string }> | undefined) => data?.items.map((item) => item.title);
const bodies = () => api!.calls.filter((call) => call.url === '/api/v1/work-items/query').map((call) => call.body);

describe('pages of a list', () => {
  it('loads the pages of a list one after the other and every page with loadAll', async () => {
    const items = ranked('abcde');
    api = mockApi({ 'POST /api/v1/work-items/query': keysetServer(() => items) });
    const { result } = renderHook(() => useInfiniteWorkItems({ project_id: 'WEB' }), { wrapper });

    await waitFor(() => expect(titles(result.current.data)).toEqual(['a', 'b']));
    expect(result.current).toMatchObject({ hasMore: true, loadingMore: false, moreError: null });
    expect(result.current.data?.total).toBe(5);

    act(() => result.current.loadMore());
    expect(result.current.loadingMore).toBe(true);
    await waitFor(() => expect(titles(result.current.data)).toEqual(['a', 'b', 'c', 'd']));

    const all = await act(() => result.current.loadAll());
    expect(all.map((item) => item.title)).toEqual(['a', 'b', 'c', 'd', 'e']);
    await waitFor(() => expect(titles(result.current.data)).toEqual(['a', 'b', 'c', 'd', 'e']));
    expect(result.current.hasMore).toBe(false);
    // the first page has no cursor, every further one the rank its predecessor ended with
    expect(bodies()).toEqual([
      { shorthand: { project: 'WEB' } },
      { shorthand: { project: 'WEB' }, cursor: 'a2' },
      { shorthand: { project: 'WEB' }, cursor: 'a4' },
    ]);
    // nothing more to load: loadMore does nothing
    act(() => result.current.loadMore());
    expect(bodies()).toHaveLength(3);
  });

  it('loads on to the end with all, and shows the list again with every page it had', async () => {
    const items = ranked('abcde');
    api = mockApi({ 'POST /api/v1/work-items/query': keysetServer(() => items) });
    const first = renderHook(() => useInfiniteWorkItems({ q: 'alle' }, { all: true }), { wrapper });

    await waitFor(() => expect(titles(first.result.current.data)).toEqual(['a', 'b', 'c', 'd', 'e']));
    first.unmount();

    // Back: straight from the cache, without loading page by page again
    const again = renderHook(() => useInfiniteWorkItems({ q: 'alle' }), { wrapper });
    expect(titles(again.result.current.data)).toEqual(['a', 'b', 'c', 'd', 'e']);
  });

  it('keeps offering a page that failed, and loads it on the next try', async () => {
    const items = ranked('abcd');
    let failing = false;
    const server = keysetServer(() => items);
    api = mockApi({
      'POST /api/v1/work-items/query': (body, url) =>
        failing && (body as { cursor?: string }).cursor ? { status: 503, body: { reason: 'unavailable', detail: 'Wartung.' } } : server(body, url),
    });
    const { result } = renderHook(() => useInfiniteWorkItems({}), { wrapper });
    await waitFor(() => expect(titles(result.current.data)).toEqual(['a', 'b']));

    failing = true;
    act(() => result.current.loadMore());
    await waitFor(() => expect(result.current.moreError).not.toBeNull());
    expect(result.current).toMatchObject({ hasMore: true, loadingMore: false, isError: false });

    failing = false;
    act(() => result.current.loadMore());
    await waitFor(() => expect(titles(result.current.data)).toEqual(['a', 'b', 'c', 'd']));
    expect(result.current.moreError).toBeNull();
  });

  it('keeps every item after a change moves one across a page border, and the depth it had', async () => {
    let items = ranked('abcdef');
    api = mockApi({
      'POST /api/v1/work-items/query': keysetServer(() => items),
      'PATCH /api/v1/work-items/wi_e': () => ({ body: { data: items.find((item) => item.id === 'wi_e') } }),
    });
    const { result } = renderHook(() => ({ list: useInfiniteWorkItems({}), update: useUpdateWorkItem() }), { wrapper });
    await waitFor(() => expect(titles(result.current.list.data)).toEqual(['a', 'b']));
    act(() => result.current.list.loadMore());
    await waitFor(() => expect(titles(result.current.list.data)).toEqual(['a', 'b', 'c', 'd']));
    act(() => result.current.list.loadMore());
    await waitFor(() => expect(titles(result.current.list.data)).toEqual(['a', 'b', 'c', 'd', 'e', 'f']));
    const before = bodies().length;

    // e moves to the top: the old cursors (after b, after d) would now miss b and d
    items = items.map((item) => (item.id === 'wi_e' ? { ...item, rank: 'a0' } : item));
    await act(() => result.current.update.mutateAsync({ id: 'wi_e', patch: { rank: 'a0' } }));

    // the three pages come back along the new cursors, with nothing lost and nothing twice
    await waitFor(() => expect(titles(result.current.list.data)).toEqual(['e', 'a', 'b', 'c', 'd', 'f']));
    expect(result.current.list.hasMore).toBe(false);
    // the first page and the two after it along the cursors the new pages answered; no old cursor (a2, a4) is sent again
    expect(bodies().slice(before)).toEqual([{}, { cursor: 'a1' }, { cursor: 'a3' }]);
  });

  it('rebuilds a list that comes back after a change while it was away, along the new cursors', async () => {
    let items = ranked('abcdef');
    api = mockApi({ 'POST /api/v1/work-items/query': keysetServer(() => items) });
    const first = renderHook(() => useInfiniteWorkItems({ q: 'zurück' }), { wrapper });
    await waitFor(() => expect(titles(first.result.current.data)).toHaveLength(2));
    act(() => first.result.current.loadMore());
    await waitFor(() => expect(titles(first.result.current.data)).toHaveLength(4));
    first.unmount();

    // away (on an item page) the item moves and the lists are made stale, not loaded
    items = items.map((item) => (item.id === 'wi_e' ? { ...item, rank: 'a0' } : item));
    await act(() => queryClient.invalidateQueries({ queryKey: qk.workItems.all }));
    const before = bodies().length;

    const again = renderHook(() => useInfiniteWorkItems({ q: 'zurück' }), { wrapper });
    // Back finds its place at once, then the new chain replaces it
    expect(titles(again.result.current.data)).toEqual(['a', 'b', 'c', 'd']);
    await waitFor(() => expect(titles(again.result.current.data)).toEqual(['e', 'a', 'b', 'c']));
    expect(again.result.current.hasMore).toBe(true);
    // the old cursor of the second page (after b) is never asked for again
    expect(bodies().slice(before)).toEqual([{ shorthand: { q: 'zurück' } }, { shorthand: { q: 'zurück' }, cursor: 'a1' }]);
  });

  it('rebuilds once more when a change comes while a rebuild is on its way', async () => {
    let items = ranked('abcdef');
    api = mockApi({ 'POST /api/v1/work-items/query': keysetServer(() => items) });
    // the second page of the rebuild waits until the test lets it go
    let release = () => {};
    const gate = new Promise<void>((resolve) => (release = resolve));
    let holding = false;
    let held = false;
    const inner = globalThis.fetch;
    globalThis.fetch = async (input, init) => {
      if (holding && typeof init?.body === 'string' && (JSON.parse(init.body) as { cursor?: string }).cursor === 'a1') {
        held = true;
        await gate;
      }
      return inner(input, init);
    };
    const { result } = renderHook(() => useInfiniteWorkItems({}), { wrapper });
    await waitFor(() => expect(titles(result.current.data)).toHaveLength(2));
    act(() => result.current.loadMore());
    await waitFor(() => expect(titles(result.current.data)).toHaveLength(4));

    holding = true;
    items = items.map((item) => (item.id === 'wi_e' ? { ...item, rank: 'a0' } : item));
    await act(() => queryClient.invalidateQueries({ queryKey: qk.workItems.all }));
    await waitFor(() => expect(held).toBe(true));
    // meanwhile f moves to the top too
    items = items.map((item) => (item.id === 'wi_f' ? { ...item, rank: '0' } : item));
    await act(() => queryClient.invalidateQueries({ queryKey: qk.workItems.all }));
    holding = false;
    release();

    await waitFor(() => expect(titles(result.current.data)).toEqual(['f', 'e', 'a', 'b']));
  });

  it('stops a rebuild at the page that failed, which offers to load it again', async () => {
    let items = ranked('abcdef');
    let failing = false;
    const server = keysetServer(() => items);
    api = mockApi({
      'POST /api/v1/work-items/query': (body, url) =>
        failing && (body as { cursor?: string }).cursor === 'a1' ? { status: 503, body: { reason: 'unavailable', detail: 'Wartung.' } } : server(body, url),
    });
    const { result } = renderHook(() => useInfiniteWorkItems({}), { wrapper });
    await waitFor(() => expect(titles(result.current.data)).toHaveLength(2));
    act(() => result.current.loadMore());
    await waitFor(() => expect(titles(result.current.data)).toHaveLength(4));

    failing = true;
    items = items.map((item) => (item.id === 'wi_e' ? { ...item, rank: 'a0' } : item));
    await act(() => queryClient.invalidateQueries({ queryKey: qk.workItems.all }));

    await waitFor(() => expect(result.current.moreError).not.toBeNull());
    expect(titles(result.current.data)).toEqual(['e', 'a']);
    failing = false;
    act(() => result.current.loadMore());
    await waitFor(() => expect(titles(result.current.data)).toEqual(['e', 'a', 'b', 'c']));
  });

  it('keeps its pages when the first page only loads again, without an invalidation', async () => {
    const items = ranked('abcd');
    api = mockApi({ 'POST /api/v1/work-items/query': keysetServer(() => items) });
    const { result } = renderHook(() => useInfiniteWorkItems({}), { wrapper });
    await waitFor(() => expect(titles(result.current.data)).toEqual(['a', 'b']));
    act(() => result.current.loadMore());
    await waitFor(() => expect(titles(result.current.data)).toEqual(['a', 'b', 'c', 'd']));

    await act(() => result.current.refetch());

    expect(titles(result.current.data)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('waits while it is told to', () => {
    api = mockApi({});
    const { result } = renderHook(() => useInfiniteWorkItems({}, { enabled: false }), { wrapper });

    expect(result.current).toMatchObject({ data: undefined, hasMore: false, loadingMore: false, isFetching: false });
    expect(api.calls).toHaveLength(0);
  });
});

describe('pages of groups', () => {
  const items = [
    ...ranked('abc', { state_id: 'std_todo' }),
    ...ranked('xyz', { state_id: 'std_progress' }).map((item) => ({ ...item, id: `${item.id}_2`, key: `WEB-2${item.number}` })),
  ];
  const BY_STATE: ListWorkItemsArgs = { filter: { version: 1, conditions: [{ field: 'project', op: 'is', value: 'p_web' }] }, group_by: 'state', lean: true };

  it('loads only the groups that are enabled', async () => {
    api = mockApi({ 'POST /api/v1/work-items/query': keysetServer(() => items) });
    const { result } = renderHook(() => useGroupedWorkItems(BY_STATE, ['std_todo', 'std_progress', 'std_done'], new Set(['std_todo', 'std_progress'])), { wrapper });

    await waitFor(() => expect(titles(result.current['std_progress']!.data)).toEqual(['x', 'y']));
    expect(titles(result.current['std_todo']!.data)).toEqual(['a', 'b']);
    expect(result.current['std_done']).toMatchObject({ data: undefined, isFetching: false, hasMore: false });
    expect(bodies()).toEqual([
      { ...BY_STATE, group: 'std_todo' },
      { ...BY_STATE, group: 'std_progress' },
    ]);
  });

  it('loads more of one group without touching the others', async () => {
    api = mockApi({ 'POST /api/v1/work-items/query': keysetServer(() => items) });
    const { result } = renderHook(() => useGroupedWorkItems(BY_STATE, ['std_todo', 'std_progress'], 'all'), { wrapper });
    await waitFor(() => expect(titles(result.current['std_progress']!.data)).toEqual(['x', 'y']));
    await waitFor(() => expect(titles(result.current['std_todo']!.data)).toEqual(['a', 'b']));

    act(() => result.current['std_todo']!.loadMore());
    await waitFor(() => expect(titles(result.current['std_todo']!.data)).toEqual(['a', 'b', 'c']));

    expect(titles(result.current['std_progress']!.data)).toEqual(['x', 'y']);
    expect(result.current['std_progress']!.hasMore).toBe(true);
    expect(bodies()).toHaveLength(3);
    expect(bodies()[2]).toEqual({ ...BY_STATE, group: 'std_todo', cursor: 'a2' });
  });

  it('pages a list without grouping as its one group, all, and waits without keys', async () => {
    api = mockApi({ 'POST /api/v1/work-items/query': keysetServer(() => items, 10) });
    const { result, rerender } = renderHook(({ keys }) => useGroupedWorkItems({ ...BY_STATE, group_by: 'none' }, keys, 'all'), {
      wrapper,
      initialProps: { keys: null as string[] | null },
    });

    expect(result.current).toEqual({});
    rerender({ keys: ['all'] });
    await waitFor(() => expect(result.current['all']!.data?.items).toHaveLength(6));
    expect(bodies()).toEqual([{ ...BY_STATE, group_by: 'none' }]);
  });

  it('reaches the pages of a group with an optimistic change', async () => {
    const unassigned = ranked('ab');
    api = mockApi({ 'POST /api/v1/work-items/query': keysetServer(() => unassigned) });
    const { result } = renderHook(
      () => ({ groups: useGroupedWorkItems({ group_by: 'assignee' }, ['none'], 'all'), update: useUpdateWorkItem() }),
      { wrapper },
    );
    await waitFor(() => expect(titles(result.current.groups['none']!.data)).toEqual(['a', 'b']));

    // the change shows in the page of the group while the server has not answered yet
    const held = holdFetch({ data: { ...unassigned[0], title: 'Neu' } });
    act(() => result.current.update.mutate({ id: 'WEB-1', patch: { title: 'Neu' } }));

    await waitFor(() => expect(titles(result.current.groups['none']!.data)).toEqual(['Neu', 'b']));
    await act(async () => held.release());
  });

  it('makes groups and counts stale after a change', async () => {
    const open: Filter = { version: 1, conditions: [{ field: 'state_category', op: 'in', value: ['backlog', 'unstarted', 'started'] }] };
    api = mockApi({
      'POST /api/v1/work-items/groups': () => ({ body: { data: webStateGroups } }),
      'POST /api/v1/work-items/counts': () => ({ body: { data: { open: 3 } } }),
      'PATCH /api/v1/work-items/WEB-47': () => ({ body: { data: web47 } }),
    });
    const { result } = renderHook(
      () => ({
        groups: useWorkItemGroups({ filter: open, group_by: 'state' }),
        counts: useWorkItemCounts({ open }, { include_archived: true }),
        plain: useWorkItemCounts({ open }),
        update: useUpdateWorkItem(),
      }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.groups.data).toEqual(webStateGroups));
    await waitFor(() => expect(result.current.counts.data).toEqual({ open: 3 }));
    await waitFor(() => expect(result.current.plain.data).toEqual({ open: 3 }));
    expect(api.calls.map((call) => call.body)).toEqual([
      { filter: open, group_by: 'state' },
      { filters: { open }, include_archived: true },
      { filters: { open } },
    ]);

    await act(() => result.current.update.mutateAsync({ id: 'WEB-47', patch: { priority: 'low' } }));

    // the change made them stale: the observed ones loaded again
    await waitFor(() => expect(api!.calls.filter((call) => call.url === '/api/v1/work-items/groups')).toHaveLength(2));
    await waitFor(() => expect(api!.calls.filter((call) => call.url === '/api/v1/work-items/counts')).toHaveLength(4));
  });
});
