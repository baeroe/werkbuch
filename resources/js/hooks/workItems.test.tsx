import { QueryClient, QueryClientProvider, type QueryKey } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Page } from '@/api/client';
import { currentToasts, resetToasts, runToastAction } from '@/components/ui/toast';
import { mockApi, type MockApi, type MockRoute } from '@/test/api';
import { list, makeWorkItem, ops12, standard, types, web30, web47, web47History, web47Relations, web48 } from '@/test/fixtures';
import type { WorkItem, WorkItemDetail } from '@/types';
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
  useUpdateWorkItem,
  useWorkItem,
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
      'GET /api/v1/work-items': () => ({ body: list([web47]) }),
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
    expect(api.calls.map((call) => decodeURIComponent(call.url)).sort()).toEqual([
      '/api/v1/state-usage?project=WEB',
      '/api/v1/work-items/WEB-47/history',
      '/api/v1/work-items/WEB-47?include=children,relations,type,workflow',
      '/api/v1/work-items?filter[project]=WEB',
    ]);
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
    expect(listed()[1]!.parent).toEqual({ id: 'wi_web_30', key: 'WEB-30', title: 'Relaunch' });
    expect(detailOf('WEB-30').children[0]!.parent?.title).toBe('Relaunch');

    // a child that moves to another epic names that one
    await act(() => result.current.mutateAsync({ id: 'WEB-48', patch: { parent_id: 'wi_web_60' } }));
    expect(listed()[1]!.parent).toEqual({ id: 'wi_web_60', key: 'WEB-60', title: 'Barrierefreiheit' });

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
