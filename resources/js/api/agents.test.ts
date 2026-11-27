import { afterEach, describe, expect, it } from 'vitest';
import { mockApi, type MockApi } from '@/test/api';
import type { AgentConfig } from '@/types';
import { getAgentConfig, getProjectAgents, listAgentRules, saveAgentConfig, saveAgentRule, saveProjectAgents } from './agents';

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

describe('agent rules and project agents', () => {
  it('reads the rules, saves one kind and restores it with null', async () => {
    const rule = { type: 'task', body: 'Mine.', standard: false, contract: 'Contract.', standard_body: 'Standard.' };
    api = mockApi({
      'GET /api/v1/agent-rules': () => ({ body: { data: [rule] } }),
      'PUT /api/v1/agent-rules/task': () => ({ body: { data: rule } }),
    });

    expect(await listAgentRules()).toEqual([rule]);
    expect(await saveAgentRule('task', null)).toEqual(rule);
    expect(api.calls[1]).toEqual({ method: 'PUT', url: '/api/v1/agent-rules/task', body: { body: null } });
  });

  it('reads and saves the agent settings of a project as a whole', async () => {
    const input = {
      review_bot_id: null,
      instructions: null,
      models: { review: 'claude:opus' },
      max_corrections: 3,
      max_conflicts: 2,
      review_person_prs: true,
      comment_on_pr: true,
      merge_method: 'squash' as const,
      setup_command: null,
      stop_command: null,
      teardown_command: null,
    };
    const settings = { project_id: 'p_web', ...input, bots: [], steps_complete: true, updated_at: null };
    api = mockApi({
      'GET /api/v1/projects/p_web/agents': () => ({ body: { data: settings } }),
      'PUT /api/v1/projects/p_web/agents': () => ({ body: { data: settings } }),
    });

    expect(await getProjectAgents('p_web')).toEqual(settings);
    expect(await saveProjectAgents('p_web', input)).toEqual(settings);
    expect(api.calls[1]).toEqual({ method: 'PUT', url: '/api/v1/projects/p_web/agents', body: input });
  });
});
