/*
 * A bot as an agent (spec 10.4, org admins): on or off, the runner pool, the CLI and its models. Saving replaces the
 * configuration as a whole (all five keys).
 */

import type { AgentConfig } from '@/types';
import { get, one, put } from './http';

const path = (botId: string) => `/bots/${encodeURIComponent(botId)}/agent`;

/** The configuration of a bot; one never saved answers the defaults (`updated_at` null). */
export function getAgentConfig(botId: string): Promise<AgentConfig> {
  return one(get<{ data: AgentConfig }>(path(botId)));
}

export type AgentConfigInput = Pick<AgentConfig, 'enabled' | 'runner_ids' | 'cli' | 'model' | 'models'>;

export function saveAgentConfig(botId: string, input: AgentConfigInput): Promise<AgentConfig> {
  return one(put<{ data: AgentConfig }>(path(botId), input));
}
