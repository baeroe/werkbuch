import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createWorkItem, updateWorkItem } from '@/api/workItems';
import { toast } from '@/components/ui/toast';
import { now } from '@/lib/clock';
import { resetApi } from '@/test/api';
import type { Page } from '@/api/client';
import type { WorkItemDetail, WorkItem } from '@/types';
import { qk } from './keys';
import { useUpdateProject } from './projects';
import { useSearch } from './search';
import { useArchiveWorkItem, useBulkUpdateWorkItems, useCreateWorkItem, useTransitionWorkItem, useUpdateWorkItem, useWorkItem, useWorkItems } from './workItems';

vi.mock('@/components/ui/toast', () => ({ toast: vi.fn() }));

let queryClient: QueryClient;

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  resetApi();
  vi.mocked(toast).mockClear();
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
});

const detailTitle = () => queryClient.getQueryData<WorkItemDetail>(qk.workItems.detail('WEB-47'))?.item.title;

/** What `read` answers now and then every time it changes while the cache changes (cache events fire synchronously). */
function watch<T>(read: () => T): T[] {
  const seen: T[] = [read()];
  queryClient.getQueryCache().subscribe(() => {
    const value = read();
    if (value !== undefined && JSON.stringify(seen.at(-1)) !== JSON.stringify(value)) seen.push(value);
  });
  return seen;
}

/** Every title the cached detail of WEB-47 has had, in order. */
const recordTitles = () => watch(detailTitle);

describe('item mutations', () => {
  it('useUpdateWorkItem shows the change immediately and rolls back on failure', async () => {
    const { result } = renderHook(() => ({ detail: useWorkItem('WEB-47'), update: useUpdateWorkItem() }), { wrapper });
    await waitFor(() => expect(result.current.detail.data).toBeDefined());
    const item = result.current.detail.data!.item;
    const oldTitle = item.title;
    const titles = recordTitles();

    localStorage.setItem('api:fail', '1');
    act(() => result.current.update.mutate({ id: item.id, patch: { title: 'Neuer Titel' } }));

    await waitFor(() => expect(result.current.update.isError).toBe(true));
    // first the new title, then the old one again
    expect(titles).toEqual([oldTitle, 'Neuer Titel', oldTitle]);
    expect(detailTitle()).toBe(oldTitle);
    expect(result.current.update.isPending).toBe(false);
    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({ tone: 'error', action: expect.objectContaining({ label: 'Erneut versuchen' }) }),
    );
  });

  it('the "Erneut versuchen" action of the error toast repeats the change', async () => {
    const { result } = renderHook(() => ({ detail: useWorkItem('WEB-47'), update: useUpdateWorkItem() }), { wrapper });
    await waitFor(() => expect(result.current.detail.data).toBeDefined());
    const item = result.current.detail.data!.item;

    localStorage.setItem('api:fail', '1');
    act(() => result.current.update.mutate({ id: item.id, patch: { title: 'Beim zweiten Mal' } }));
    await waitFor(() => expect(result.current.update.isError).toBe(true));

    localStorage.removeItem('api:fail');
    const action = vi.mocked(toast).mock.calls[0][0].action!;
    act(() => action.onClick());

    await waitFor(() => expect(result.current.detail.data?.item.title).toBe('Beim zweiten Mal'));
    await waitFor(() => expect(result.current.update.isPending).toBe(false));
    expect(result.current.update.isError).toBe(false);
  });

  it('updates the cached list and the detail at once', async () => {
    const { result } = renderHook(
      () => ({
        list: useWorkItems({ filter: { version: 1, conditions: [{ field: 'project', op: 'is', value: 'p_web' }] } }),
        detail: useWorkItem('WEB-42'),
        update: useUpdateWorkItem(),
      }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.list.data && result.current.detail.data).toBeTruthy());
    const id = result.current.detail.data!.item.id;

    await act(() => result.current.update.mutateAsync({ id, patch: { priority: 'urgent' } }));

    // the observers hear about cache changes a moment later than the mutation ends
    await waitFor(() => expect(result.current.detail.data?.item.priority).toBe('urgent'));
    expect(result.current.list.data?.items.find((entry) => entry.id === id)?.priority).toBe('urgent');
  });

  it('a description conflict rolls back, and the caller gets the stored item instead of a toast', async () => {
    const { result } = renderHook(() => ({ detail: useWorkItem('WEB-42'), update: useUpdateWorkItem() }), { wrapper });
    await waitFor(() => expect(result.current.detail.data).toBeDefined());
    const item = result.current.detail.data!.item;
    const text = (value: string) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: value }] }] });
    await updateWorkItem(item.id, { description: text('Von jemand anderem') }); // somebody else saved first

    await act(async () => {
      await expect(
        result.current.update.mutateAsync({ id: item.id, patch: { description: text('Meine Fassung') }, base_description_version: item.description_version }),
      ).rejects.toMatchObject({ status: 409, reason: 'description_conflict', current: { title: item.title } });
    });

    expect(toast).not.toHaveBeenCalled();
    // after the reload the detail shows what the other person wrote
    await waitFor(() => expect(JSON.stringify(result.current.detail.data?.item.description)).toContain('Von jemand anderem'));
  });

  it('called with a key (as the API takes it) the item mutations change detail and list at once and roll back on failure', async () => {
    const args = { filter: { version: 1 as const, conditions: [{ field: 'project', op: 'is' as const, value: 'p_web' }] } };
    const listItem = (key: string) => queryClient.getQueryData<Page<WorkItem>>(qk.workItems.list(args))?.items.find((entry) => entry.key === key);
    const { result } = renderHook(() => ({ list: useWorkItems(args), detail: useWorkItem('WEB-47'), update: useUpdateWorkItem() }), { wrapper });
    await waitFor(() => expect(result.current.list.data && result.current.detail.data).toBeTruthy());
    const before = result.current.detail.data!.item.priority;
    expect(before).toBe('urgent');
    const inDetail = watch(() => queryClient.getQueryData<WorkItemDetail>(qk.workItems.detail('WEB-47'))?.item.priority);
    const inList = watch(() => listItem('WEB-47')?.priority);

    localStorage.setItem('api:fail', '1');
    act(() => result.current.update.mutate({ id: 'WEB-47', patch: { priority: 'low' } })); // the key, not the id

    await waitFor(() => expect(result.current.update.isError).toBe(true));
    expect(inDetail).toEqual([before, 'low', before]);
    expect(inList).toEqual([before, 'low', before]);
    expect(result.current.update.isPending).toBe(false);
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ action: expect.objectContaining({ label: 'Erneut versuchen' }) }));
  });

  it('a bulk edit and an archive with keys (also in lower case) show at once and roll back', async () => {
    const args = { filter: { version: 1 as const, conditions: [{ field: 'project', op: 'is' as const, value: 'p_web' }] } };
    const listItem = (key: string) => queryClient.getQueryData<Page<WorkItem>>(qk.workItems.list(args))?.items.find((entry) => entry.key === key);
    const { result } = renderHook(
      () => ({ list: useWorkItems(args), detail: useWorkItem('WEB-39'), bulk: useBulkUpdateWorkItems(), archive: useArchiveWorkItem() }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.list.data && result.current.detail.data).toBeTruthy());
    const priorities = watch(() => ['WEB-50', 'WEB-51', 'WEB-55'].map((key) => listItem(key)?.priority));
    const archived = watch(() => queryClient.getQueryData<WorkItemDetail>(qk.workItems.detail('WEB-39'))?.item.archived_at !== null);

    localStorage.setItem('api:fail', '1');
    act(() => result.current.bulk.mutate({ ids: ['web-50', 'WEB-51', 'wi_web_55'], patch: { priority: 'urgent' } }));
    await waitFor(() => expect(result.current.bulk.isError).toBe(true));
    const original = ['medium', 'low', 'none'];
    expect(priorities).toEqual([original, ['urgent', 'urgent', 'urgent'], original]);

    act(() => result.current.archive.mutate('WEB-39'));
    await waitFor(() => expect(result.current.archive.isError).toBe(true));
    expect(archived).toEqual([false, true, false]);
  });

  it('stamps an optimistic archive with the demo clock, not with the computer\'s', async () => {
    const { result } = renderHook(() => ({ detail: useWorkItem('WEB-39'), bulk: useBulkUpdateWorkItems(), archive: useArchiveWorkItem() }), { wrapper });
    await waitFor(() => expect(result.current.detail.data).toBeDefined());
    const stamps = watch(() => queryClient.getQueryData<WorkItemDetail>(qk.workItems.detail('WEB-39'))?.item.archived_at);
    const near = (iso: string | null | undefined) => iso !== null && iso !== undefined && Math.abs(Date.parse(iso) - now().getTime()) < 60_000;

    // the call fails, so only the optimistic stamp shows (and then the old state again)
    localStorage.setItem('api:fail', '1');
    act(() => result.current.archive.mutate('WEB-39'));
    await waitFor(() => expect(result.current.archive.isError).toBe(true));
    act(() => result.current.bulk.mutate({ ids: ['WEB-39'], patch: { archived: true } }));
    await waitFor(() => expect(result.current.bulk.isError).toBe(true));

    const optimistic = stamps.filter((stamp) => stamp !== null);
    expect(optimistic).toHaveLength(2);
    expect(optimistic.every(near)).toBe(true);
  });

  it('a transition the workflow does not allow rolls back and names the reason without a retry action', async () => {
    const { result } = renderHook(
      () => ({
        list: useWorkItems({ filter: { version: 1, conditions: [{ field: 'state', op: 'is', value: 'app_todo' }] } }),
        move: useTransitionWorkItem(),
      }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.list.data).toBeDefined());
    const todo = result.current.list.data!.items[0];

    await act(async () => {
      await expect(result.current.move.mutateAsync({ id: todo.id, to_state_id: 'app_done' })).rejects.toMatchObject({
        status: 409,
        reason: 'transition_not_allowed',
      });
    });

    expect(result.current.list.data?.items.find((entry) => entry.id === todo.id)?.state_id).toBe('app_todo');
    const shown = vi.mocked(toast).mock.calls[0][0];
    expect(shown.tone).toBe('error');
    expect(shown.description).toContain('nicht erlaubt');
    expect(shown.action).toBeUndefined();
  });
});

describe('the parent an item names, while a change is on its way', () => {
  const web = { filter: { version: 1 as const, conditions: [{ field: 'project', op: 'is' as const, value: 'p_web' }] } };
  // the epics are not in this list
  const tasks = { filter: { version: 1 as const, conditions: [{ field: 'project', op: 'is' as const, value: 'p_web' }, { field: 'type', op: 'is' as const, value: 't_task' }] } };
  const parentIn = (args: typeof web | typeof tasks, key: string) =>
    queryClient.getQueryData<Page<WorkItem>>(qk.workItems.list(args))?.items.find((entry) => entry.key === key)?.parent;
  const relaunch = { id: 'wi_web_30', key: 'WEB-30', title: 'Relaunch Phase 1' };

  it('a new parent shows at once, also in a list that leaves the parent out, and goes back when the change fails', async () => {
    const { result } = renderHook(() => ({ web: useWorkItems(web), tasks: useWorkItems(tasks), update: useUpdateWorkItem() }), { wrapper });
    await waitFor(() => expect(result.current.web.data && result.current.tasks.data).toBeTruthy());
    const named = watch(() => parentIn(tasks, 'WEB-44'));

    localStorage.setItem('api:fail', '1');
    act(() => result.current.update.mutate({ id: 'wi_web_44', patch: { parent_id: 'wi_web_30' } }));

    await waitFor(() => expect(result.current.update.isError).toBe(true));
    expect(named).toEqual([null, relaunch, null]);
  });

  it('a parent the cache does not know is named once the server answers, and the old one never shows in between', async () => {
    const phase2 = await createWorkItem({ project_id: 'p_web', type_id: 't_epic', title: 'Relaunch Phase 2' });
    // only the tasks are loaded: neither epic is in the cache
    const { result } = renderHook(() => ({ tasks: useWorkItems(tasks), update: useUpdateWorkItem() }), { wrapper });
    await waitFor(() => expect(result.current.tasks.data).toBeDefined());
    const named = watch(() => parentIn(tasks, 'WEB-42'));

    act(() => result.current.update.mutate({ id: 'wi_web_42', patch: { parent_id: phase2.id } }));

    await waitFor(() => expect(parentIn(tasks, 'WEB-42')?.key).toBe(phase2.key));
    expect(named).toEqual([relaunch, null, { id: phase2.id, key: phase2.key, title: 'Relaunch Phase 2' }]);
  });

  it('a renamed parent shows its new title on its children at once, and its old one again when the change fails', async () => {
    const { result } = renderHook(() => ({ web: useWorkItems(web), tasks: useWorkItems(tasks), update: useUpdateWorkItem() }), { wrapper });
    await waitFor(() => expect(result.current.web.data && result.current.tasks.data).toBeTruthy());
    const titles = watch(() => parentIn(tasks, 'WEB-42')?.title);

    localStorage.setItem('api:fail', '1');
    act(() => result.current.update.mutate({ id: 'wi_web_30', patch: { title: 'Relaunch, erste Phase' } }));

    await waitFor(() => expect(result.current.update.isError).toBe(true));
    expect(titles).toEqual(['Relaunch Phase 1', 'Relaunch, erste Phase', 'Relaunch Phase 1']);
  });
});

describe('the search after a change', () => {
  /** The titles of the items the palette's search finds. */
  const titles = (data: { items: WorkItem[] } | undefined) => data?.items.map((item) => `${item.key} ${item.title}`) ?? [];

  it('a renamed item is found by its new title at once: item changes make the search stale', async () => {
    const { result } = renderHook(() => ({ search: useSearch('Kontaktformular'), update: useUpdateWorkItem() }), { wrapper });
    await waitFor(() => expect(titles(result.current.search.data)).toContain('WEB-47 Kontaktformular sendet doppelt'));

    await act(() => result.current.update.mutateAsync({ id: 'WEB-47', patch: { title: 'Kontaktformular sendet nur einmal' } }));

    await waitFor(() => expect(titles(result.current.search.data)).toContain('WEB-47 Kontaktformular sendet nur einmal'));
    expect(titles(result.current.search.data)).not.toContain('WEB-47 Kontaktformular sendet doppelt');
  });

  it('a new item is found at once as well', async () => {
    const { result } = renderHook(() => ({ search: useSearch('Lieferschein'), create: useCreateWorkItem() }), { wrapper });
    await waitFor(() => expect(result.current.search.isSuccess).toBe(true));
    expect(titles(result.current.search.data)).toEqual([]);

    const item = await act(() => result.current.create.mutateAsync({ project_id: 'p_app', type_id: 't_task', title: 'Lieferschein als PDF anhängen' }));

    await waitFor(() => expect(titles(result.current.search.data)).toEqual([`${item.key} Lieferschein als PDF anhängen`]));
  });

  it('a renamed project as well (its update reloads everything)', async () => {
    const { result } = renderHook(() => ({ search: useSearch('Relaunch'), update: useUpdateProject() }), { wrapper });
    await waitFor(() => expect(result.current.search.data?.projects.map((project) => project.name)).toEqual(['Website-Relaunch']));

    await act(() => result.current.update.mutateAsync({ id: 'p_web', patch: { name: 'Website-Relaunch 2027' } }));

    await waitFor(() => expect(result.current.search.data?.projects.map((project) => project.name)).toEqual(['Website-Relaunch 2027']));
  });
});
