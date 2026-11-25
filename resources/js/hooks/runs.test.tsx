/*
 * The runs of an item (WEBU-28): they ask again every 15 s only while one waits for its runner; the log of a run keeps
 * its lines and asks for those after the last one; starting a run again and going on with a strand reload the runs.
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mockApi, type MockApi } from '@/test/api';
import { list } from '@/test/fixtures';
import type { AgentRun, RunEvent } from '@/types';
import { qk } from './keys';
import { RUNNERS_REFRESH_MS } from './runners';
import { useItemRuns, useResumeThread, useRetryRun, useRunLog } from './runs';

let queryClient: QueryClient;
let api: MockApi | undefined;

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

const asked = (path: string) => api!.calls.filter((call) => call.url.split('?')[0] === path).length;
const line = (id: string): RunEvent => ({ id, attempt: 1, kind: 'text', text: id, at: '2026-11-24T10:00:00Z' });

beforeEach(() => {
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
});

afterEach(() => {
  api?.restore();
  api = undefined;
  queryClient.clear();
  vi.useRealTimers();
});

describe('useItemRuns', () => {
  it('asks again every 15 s only while a run waits for its runner', async () => {
    vi.useFakeTimers();
    let status: AgentRun['status'] = 'waiting';
    api = mockApi({ 'GET /api/v1/runs': () => ({ body: list([{ id: 'run_1', status } as AgentRun]) }) });
    renderHook(() => useItemRuns('wi_47'), { wrapper });
    const tick = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms));
    await tick(0);
    expect(asked('/api/v1/runs')).toBe(1);

    status = 'running';
    await tick(RUNNERS_REFRESH_MS);
    expect(asked('/api/v1/runs')).toBe(2);
    await tick(RUNNERS_REFRESH_MS * 3);
    expect(asked('/api/v1/runs')).toBe(2);
  });

  it('asks nothing without an item', () => {
    api = mockApi({});
    const { result } = renderHook(() => useItemRuns(null), { wrapper });
    expect(result.current.fetchStatus).toBe('idle');
    expect(api.calls).toEqual([]);
  });
});

describe('useRunLog', () => {
  it('keeps its lines and asks only for those after the last one', async () => {
    let lines = [line('l_1'), line('l_2')];
    api = mockApi({
      'GET /api/v1/runs/run_1/events': (_body, url) => {
        const after = url.searchParams.get('filter[after]');
        const answer = after === null ? lines : lines.slice(lines.findIndex((entry) => entry.id === after) + 1);
        return { body: list(answer) };
      },
    });
    const { result } = renderHook(() => useRunLog('run_1'), { wrapper });
    await waitFor(() => expect(result.current.data?.map((entry) => entry.id)).toEqual(['l_1', 'l_2']));

    // nothing new: the same lines stay
    await act(() => queryClient.invalidateQueries({ queryKey: qk.runs.log('run_1') }));
    expect(result.current.data?.map((entry) => entry.id)).toEqual(['l_1', 'l_2']);

    lines = [...lines, line('l_3')];
    await act(() => queryClient.invalidateQueries({ queryKey: qk.runs.all }));
    await waitFor(() => expect(result.current.data?.map((entry) => entry.id)).toEqual(['l_1', 'l_2', 'l_3']));
    expect(api.calls.map((call) => call.url)).toEqual([
      '/api/v1/runs/run_1/events?per_page=100',
      '/api/v1/runs/run_1/events?filter%5Bafter%5D=l_2&per_page=100',
      '/api/v1/runs/run_1/events?filter%5Bafter%5D=l_2&per_page=100',
    ]);
  });
});

describe('useRetryRun and useResumeThread', () => {
  it('reload the runs of the item', async () => {
    api = mockApi({
      'GET /api/v1/runs': () => ({ body: list([]) }),
      'POST /api/v1/runs/run_1/retry': () => ({ status: 201, body: { data: { id: 'run_2' } } }),
      'POST /api/v1/work-items/wi_47/agent/resume': () => ({ body: { data: { run: null, braked: true } } }),
    });
    const { result } = renderHook(() => ({ runs: useItemRuns('wi_47'), retry: useRetryRun(), resume: useResumeThread() }), { wrapper });
    await waitFor(() => expect(asked('/api/v1/runs')).toBe(1));

    await act(() => result.current.retry.mutateAsync('run_1'));
    await waitFor(() => expect(asked('/api/v1/runs')).toBe(2));
    expect(await act(() => result.current.resume.mutateAsync('wi_47'))).toEqual({ run: null, braked: true });
    await waitFor(() => expect(asked('/api/v1/runs')).toBe(3));
  });
});
