import { afterEach, describe, expect, it } from 'vitest';
import { mockApi, type MockApi } from '@/test/api';
import type { AgentRun, RunEvent } from '@/types';
import { listItemRuns, listRunEvents, resumeThread, retryRun } from './runs';

let api: MockApi;

afterEach(() => api.restore());

const run = { id: 'run_1', status: 'running' } as AgentRun;
const line = (id: string): RunEvent => ({ id, attempt: 1, kind: 'text', text: id, at: '2026-11-24T10:00:00Z' });

describe('runs at an item', () => {
  it('lists every run of an item across pages', async () => {
    const older = { id: 'run_0', status: 'failed' } as AgentRun;
    api = mockApi({
      'GET /api/v1/runs': (_body, url) =>
        url.searchParams.get('cursor') === 'next' ? { body: { data: [older], meta: { next_cursor: null, total: 2 } } } : { body: { data: [run], meta: { next_cursor: 'next', total: 2 } } },
    });

    expect(await listItemRuns('wi_47')).toEqual({ items: [run, older], next_cursor: null, total: 2 });
    expect(api.calls.map((call) => call.url)).toEqual(['/api/v1/runs?filter%5Bwork_item_id%5D=wi_47&per_page=100', '/api/v1/runs?cursor=next&filter%5Bwork_item_id%5D=wi_47&per_page=100']);
  });

  it('reads the log of a run, from the start or after a line', async () => {
    api = mockApi({ 'GET /api/v1/runs/run_1/events': (_body, url) => ({ body: { data: url.searchParams.has('filter[after]') ? [line('l_3')] : [line('l_1'), line('l_2')], meta: { next_cursor: null, total: 2 } } }) });

    expect((await listRunEvents('run_1')).items.map((entry) => entry.id)).toEqual(['l_1', 'l_2']);
    expect((await listRunEvents('run_1', 'l_2')).items.map((entry) => entry.id)).toEqual(['l_3']);
    expect(api.calls.map((call) => call.url)).toEqual(['/api/v1/runs/run_1/events?per_page=100', '/api/v1/runs/run_1/events?filter%5Bafter%5D=l_2&per_page=100']);
  });

  it('starts a run again and goes on with a strand', async () => {
    api = mockApi({
      'POST /api/v1/runs/run_1/retry': () => ({ status: 201, body: { data: { ...run, id: 'run_2' } } }),
      'POST /api/v1/work-items/WEB-47/agent/resume': () => ({ body: { data: { run, braked: false } } }),
    });

    expect((await retryRun('run_1')).id).toBe('run_2');
    expect(await resumeThread('WEB-47')).toEqual({ run, braked: false });
  });
});
