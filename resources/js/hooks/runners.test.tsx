/*
 * The polling of the runner screen (A580): online is a question of time, not an event, so the list asks again every 15 s
 * while a screen shows it and stops when it is gone; a pairing code is asked for every 2 s until a runner redeemed it,
 * and not at all while its dialog does not wait. The clock is fake: every ask is counted at the fake API.
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mockApi, type MockApi } from '@/test/api';
import { list } from '@/test/fixtures';
import type { RunnerPairing } from '@/types';
import { PAIRING_REFRESH_MS, RUNNERS_REFRESH_MS, useActiveRuns, usePairing, useRunners } from './runners';

let queryClient: QueryClient;
let api: MockApi | undefined;

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

const asked = (path: string) => api!.calls.filter((call) => call.url.split('?')[0] === path).length;
const tick = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms));

beforeEach(() => {
  vi.useFakeTimers();
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});

afterEach(() => {
  api?.restore();
  api = undefined;
  queryClient.clear();
  vi.useRealTimers();
});

describe('useRunners and useActiveRuns', () => {
  it('ask again every 15 s while live and stop once the screen is gone', async () => {
    api = mockApi({ 'GET /api/v1/runners': () => ({ body: list([]) }), 'GET /api/v1/runs': () => ({ body: list([]) }) });
    const { unmount } = renderHook(() => ({ runners: useRunners({ live: true }), runs: useActiveRuns({ live: true }) }), { wrapper });
    await tick(0);
    expect([asked('/api/v1/runners'), asked('/api/v1/runs')]).toEqual([1, 1]);

    await tick(RUNNERS_REFRESH_MS - 1);
    expect(asked('/api/v1/runners')).toBe(1);
    await tick(1);
    expect([asked('/api/v1/runners'), asked('/api/v1/runs')]).toEqual([2, 2]);
    await tick(RUNNERS_REFRESH_MS);
    expect([asked('/api/v1/runners'), asked('/api/v1/runs')]).toEqual([3, 3]);

    unmount();
    await tick(RUNNERS_REFRESH_MS * 4);
    expect([asked('/api/v1/runners'), asked('/api/v1/runs')]).toEqual([3, 3]);
  });

  it('do not ask again without live', async () => {
    api = mockApi({ 'GET /api/v1/runners': () => ({ body: list([]) }), 'GET /api/v1/runs': () => ({ body: list([]) }) });
    renderHook(() => ({ runners: useRunners(), runs: useActiveRuns() }), { wrapper });
    await tick(0);
    await tick(RUNNERS_REFRESH_MS * 4);
    expect([asked('/api/v1/runners'), asked('/api/v1/runs')]).toEqual([1, 1]);
  });
});

describe('usePairing', () => {
  const pairing = (runner_id: string | null): RunnerPairing => ({ id: 'pc1', expires_at: '2026-10-28T09:10:00Z', redeemed_at: runner_id ? '2026-10-28T09:01:00Z' : null, runner_id });

  it('asks every 2 s until a runner redeemed the code, then no more', async () => {
    let redeemed = false;
    api = mockApi({ 'GET /api/v1/runner-pairings/pc1': () => ({ body: { data: pairing(redeemed ? 'r1' : null) } }) });
    const { result } = renderHook(() => usePairing('pc1'), { wrapper });
    await tick(0);
    expect(asked('/api/v1/runner-pairings/pc1')).toBe(1);
    await tick(PAIRING_REFRESH_MS);
    expect(asked('/api/v1/runner-pairings/pc1')).toBe(2);

    redeemed = true;
    await tick(PAIRING_REFRESH_MS);
    expect(asked('/api/v1/runner-pairings/pc1')).toBe(3);
    // the answer is read from its stream on the real clock
    await vi.waitFor(() => expect(result.current.data?.runner_id).toBe('r1'));
    await tick(PAIRING_REFRESH_MS * 5);
    expect(asked('/api/v1/runner-pairings/pc1')).toBe(3);
  });

  it('stops while its dialog does not wait (closed, the code expired) and after the unmount, and asks nothing without a code', async () => {
    api = mockApi({ 'GET /api/v1/runner-pairings/pc1': () => ({ body: { data: pairing(null) } }) });
    const { rerender, unmount } = renderHook(({ id, waiting }: { id: string | null; waiting: boolean }) => usePairing(id, { waiting }), { wrapper, initialProps: { id: null as string | null, waiting: true } });
    await tick(PAIRING_REFRESH_MS * 2);
    expect(api.calls).toHaveLength(0);

    rerender({ id: 'pc1', waiting: true });
    await tick(PAIRING_REFRESH_MS);
    expect(asked('/api/v1/runner-pairings/pc1')).toBe(2);

    rerender({ id: 'pc1', waiting: false });
    await tick(PAIRING_REFRESH_MS * 5);
    expect(asked('/api/v1/runner-pairings/pc1')).toBe(2);

    rerender({ id: 'pc1', waiting: true });
    await tick(PAIRING_REFRESH_MS);
    const before = asked('/api/v1/runner-pairings/pc1');
    unmount();
    await tick(PAIRING_REFRESH_MS * 5);
    expect(asked('/api/v1/runner-pairings/pc1')).toBe(before);
  });
});
