import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mockApi, type MockApi } from '@/test/api';
import { makeSystemStatus } from '@/test/fixtures';
import { qk } from './keys';
import { useRetryFailedJobs, useSendTestMail, useSystemStatus } from './system';

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

describe('the system page', () => {
  it('reads the status, and makes it stale after a retry, not after a test mail', async () => {
    const status = makeSystemStatus();
    api = mockApi({
      'GET /api/v1/system': () => ({ body: { data: status } }),
      'POST /api/v1/system/failed-jobs/retry': () => ({ body: { retried: 1 } }),
      'POST /api/v1/system/test-mail': () => ({ body: { sent_to: 'mara@example.com' } }),
    });
    const { result } = renderHook(() => ({ status: useSystemStatus(), retry: useRetryFailedJobs(), mail: useSendTestMail() }), { wrapper });
    const stale = () => queryClient.getQueryState(qk.system.all)?.isInvalidated;

    await waitFor(() => expect(result.current.status.data).toEqual(status));

    expect(await act(() => result.current.mail.mutateAsync())).toEqual({ sent_to: 'mara@example.com' });
    expect(stale()).toBe(false);

    expect(await act(() => result.current.retry.mutateAsync([status.failed_jobs[0]!.id]))).toEqual({ retried: 1 });
    await waitFor(() => expect(api!.calls.filter((call) => call.method === 'GET')).toHaveLength(2));
    expect(api.calls[2]!.body).toEqual({ ids: [status.failed_jobs[0]!.id] });
  });

  it('retries every failed job without ids', async () => {
    api = mockApi({ 'POST /api/v1/system/failed-jobs/retry': () => ({ body: { retried: 4 } }) });
    const { result } = renderHook(() => useRetryFailedJobs(), { wrapper });

    expect(await act(() => result.current.mutateAsync(undefined))).toEqual({ retried: 4 });
    expect(api.calls[0]!.body).toEqual({});
  });
});
