import { afterEach, describe, expect, it } from 'vitest';
import { mockApi, type MockApi } from '@/test/api';
import type { AgentRun, Runner, RunnerPairing } from '@/types';
import { cancelRun, createPairing, getPairing, listActiveRuns, listRunners, revokeRunner, updateRunner } from './runners';

let api: MockApi;

afterEach(() => api.restore());

const runner = { id: 'r_1', name: 'mac-studio' } as Runner;
const run = { id: 'run_1', status: 'running' } as AgentRun;
const pairing: RunnerPairing = { id: 'p_1', code: 'ABCD-EFGH', command: 'curl …', expires_at: '2026-11-24T10:10:00Z', redeemed_at: null, runner_id: null };

describe('runners', () => {
  it('lists every runner across pages', async () => {
    const second = { id: 'r_2', name: 'build-01' } as Runner;
    api = mockApi({
      'GET /api/v1/runners': (_body, url) =>
        url.searchParams.get('cursor') === 'next' ? { body: { data: [second], meta: { next_cursor: null, total: 2 } } } : { body: { data: [runner], meta: { next_cursor: 'next', total: 2 } } },
    });

    expect(await listRunners()).toEqual({ items: [runner, second], next_cursor: null, total: 2 });
  });

  it('renames, sets the places and revokes a runner', async () => {
    api = mockApi({
      'PATCH /api/v1/runners/r_1': () => ({ body: { data: runner } }),
      'DELETE /api/v1/runners/r_1': () => ({ body: { canceled: 2 } }),
    });

    expect(await updateRunner('r_1', { name: 'mac-studio' })).toEqual(runner);
    expect(await updateRunner('r_1', { slots: { total: 3, per_repo: 1, light: 2 } })).toEqual(runner);
    expect(await revokeRunner('r_1')).toEqual({ canceled: 2 });
    expect(api.calls.map((call) => call.body)).toEqual([{ name: 'mac-studio' }, { slots: { total: 3, per_repo: 1, light: 2 } }, undefined]);
  });

  it('makes a pairing code and reads it again', async () => {
    api = mockApi({
      'POST /api/v1/runner-pairings': () => ({ status: 201, body: { data: pairing } }),
      'GET /api/v1/runner-pairings/p_1': () => ({ body: { data: { ...pairing, code: undefined, runner_id: 'r_1' } } }),
    });

    expect(await createPairing()).toEqual(pairing);
    expect((await getPairing('p_1')).runner_id).toBe('r_1');
  });

  it('lists the active runs by their status and cancels one', async () => {
    api = mockApi({
      'GET /api/v1/runs': () => ({ body: { data: [run], meta: { next_cursor: null, total: 1 } } }),
      'POST /api/v1/runs/run_1/cancel': () => ({ body: { data: { ...run, status: 'canceling' } } }),
    });

    expect((await listActiveRuns()).items).toEqual([run]);
    expect((await cancelRun('run_1')).status).toBe('canceling');
    expect(decodeURIComponent(api.calls[0]!.url)).toBe('/api/v1/runs?filter[status]=queued,waiting,running,canceling');
  });
});
