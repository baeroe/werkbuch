import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it } from 'vitest';
import { FAIL_KEY } from '@/api/client';
import { getDb, saveDb } from '@/api/db';
import { resetApi } from '@/test/api';
import type { ListWorkItemsArgs } from '@/api/workItems';
import { useInfiniteWorkItems } from './workItems';

let queryClient: QueryClient;
const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;

/** WEB with 180 more items, in these tests only. */
function moreItems(count = 180) {
  const db = getDb();
  const model = db.items.find((item) => item.key === 'WEB-43')!;
  for (let n = 0; n < count; n += 1) {
    const number = 1000 + n;
    db.items.push({ ...structuredClone(model), id: `wi_web_${number}`, number, key: `WEB-${number}`, title: `Zusatzaufgabe ${number}`, parent_id: null, rank: `z${String(n).padStart(4, '0')}`, subscriber_ids: [] });
  }
  saveDb();
}

const args: ListWorkItemsArgs = { filter: { version: 1, conditions: [{ field: 'project', op: 'is', value: 'p_web' }] } };

beforeEach(() => {
  resetApi();
  moreItems();
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});

describe('useInfiniteWorkItems', () => {
  it('shows a list again with every page it had loaded, so Back finds the place it left', async () => {
    const first = renderHook(() => useInfiniteWorkItems(args), { wrapper });
    await waitFor(() => expect(first.result.current.data?.items).toHaveLength(100));
    act(() => first.result.current.loadMore());
    await waitFor(() => expect(first.result.current.data?.items).toHaveLength(200));
    first.unmount();

    const again = renderHook(() => useInfiniteWorkItems(args), { wrapper });
    // straight from the cache, without loading page by page again
    expect(again.result.current.data?.items).toHaveLength(200);
  });

  it('keeps offering a page that failed, and loads it on the next try', async () => {
    const { result } = renderHook(() => useInfiniteWorkItems(args), { wrapper });
    await waitFor(() => expect(result.current.data?.items).toHaveLength(100));

    localStorage.setItem(FAIL_KEY, '1');
    act(() => result.current.loadMore());
    await waitFor(() => expect(result.current.moreError).not.toBeNull());
    expect(result.current.hasMore).toBe(true);

    localStorage.removeItem(FAIL_KEY);
    act(() => result.current.loadMore());
    await waitFor(() => expect(result.current.data?.items).toHaveLength(200));
    expect(result.current.moreError).toBeNull();
  });
});
