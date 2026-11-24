import { afterEach, describe, expect, it } from 'vitest';
import { mockApi, type MockApi } from '@/test/api';
import type { AgentConfig } from '@/types';
import { getAgentConfig, saveAgentConfig } from './agents';

let api: MockApi;

afterEach(() => api.restore());

const config: AgentConfig = { bot_id: 'u_kira', enabled: true, runner_ids: [], cli: 'claude', model: 'sonnet', models: {}, updated_at: null };

describe('agents', () => {
  it('reads and saves the agent configuration of a bot as a whole', async () => {
    api = mockApi({
      'GET /api/v1/bots/u_kira/agent': () => ({ body: { data: config } }),
      'PUT /api/v1/bots/u_kira/agent': () => ({ body: { data: config } }),
    });
    const input = { enabled: true, runner_ids: [], cli: 'claude' as const, model: 'sonnet', models: {} };

    expect(await getAgentConfig('u_kira')).toEqual(config);
    expect(await saveAgentConfig('u_kira', input)).toEqual(config);
    expect(api.calls[1]).toEqual({ method: 'PUT', url: '/api/v1/bots/u_kira/agent', body: input });
  });
});
