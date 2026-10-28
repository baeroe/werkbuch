import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { updateWorkItem } from '@/api/workItems';
import { toast } from '@/components/ui/toast';
import { resetApi } from '@/test/api';
import type { WorkItemDetail } from '@/types';
import { qk } from './keys';
import { useTransitionWorkItem, useUpdateWorkItem, useWorkItem, useWorkItems } from './workItems';

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

/** Every title the cached detail of WEB-47 has had, in order (cache events fire synchronously). */
function recordTitles(): string[] {
  const seen: string[] = [];
  queryClient.getQueryCache().subscribe(() => {
    const title = detailTitle();
    if (title !== undefined && seen.at(-1) !== title) seen.push(title);
  });
  return seen;
}

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
    expect(titles).toEqual(['Neuer Titel', oldTitle]);
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
