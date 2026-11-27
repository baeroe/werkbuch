/*
 * A bot as an agent (spec 10.4, org admins): on or off, the runner pool, the CLI and its models. Saving replaces the
 * configuration as a whole (all five keys). The working rules of the organization per kind of run (spec 7.3, 10.5: every
 * account reads, org admins change one kind at a time) and the agent settings of a project (spec 10.3: whoever sees the
 * project reads, its admins replace them as a whole).
 */

import type { AgentConfig, AgentRule, ProjectAgents, RunType } from '@/types';
import { get, one, put } from './http';

const path = (botId: string) => `/bots/${encodeURIComponent(botId)}/agent`;

/** The configuration of a bot; one never saved answers the defaults (`updated_at` null). */
export function getAgentConfig(botId: string): Promise<AgentConfig> {
  return one(get<{ data: AgentConfig }>(path(botId)));
}

export type AgentConfigInput = Pick<AgentConfig, 'enabled' | 'runner_ids' | 'cli' | 'model' | 'models' | 'effort' | 'efforts'>;

export function saveAgentConfig(botId: string, input: AgentConfigInput): Promise<AgentConfig> {
  return one(put<{ data: AgentConfig }>(path(botId), input));
}

/** The rules of every kind of run, in the order of the kinds, each with its contract and its standard. */
export async function listAgentRules(): Promise<AgentRule[]> {
  return (await get<{ data: AgentRule[] }>('/agent-rules')).data;
}

/** Sets the rules of a kind; `null` restores the standard of werkbuch. */
export function saveAgentRule(type: RunType, body: string | null): Promise<AgentRule> {
  return one(put<{ data: AgentRule }>(`/agent-rules/${encodeURIComponent(type)}`, { body }));
}

export function getProjectAgents(projectId: string): Promise<ProjectAgents> {
  return one(get<{ data: ProjectAgents }>(`/projects/${encodeURIComponent(projectId)}/agents`));
}

/** What `PUT /projects/{project}/agents` takes: every key, `null` where a text is empty. */
export type ProjectAgentsInput = Pick<
  ProjectAgents,
  'review_bot_id' | 'instructions' | 'models' | 'efforts' | 'max_corrections' | 'max_conflicts' | 'review_person_prs' | 'comment_on_pr' | 'merge_method' | 'setup_command' | 'stop_command' | 'teardown_command'
>;

export function saveProjectAgents(projectId: string, input: ProjectAgentsInput): Promise<ProjectAgents> {
  return one(put<{ data: ProjectAgents }>(`/projects/${encodeURIComponent(projectId)}/agents`, input));
}
