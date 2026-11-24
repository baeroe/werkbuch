import { useQueries, useQuery } from '@tanstack/react-query';
import { getAgentConfig, getProjectAgents, listAgentRules, saveAgentConfig, saveAgentRule, saveProjectAgents, type AgentConfigInput, type ProjectAgentsInput } from '@/api/agents';
import type { RunType } from '@/types';
import { qk } from './keys';
import { useApiMutation } from './mutation';

/** The agent configuration of a bot; waits without an id. */
export function useAgentConfig(botId: string | null | undefined) {
  return useQuery({ queryKey: qk.agentConfigs.detail(botId ?? ''), queryFn: () => getAgentConfig(botId!), enabled: !!botId });
}

/** The agent configurations of many bots (the list of bots), one query each. */
export function useAgentConfigs(botIds: readonly string[]) {
  return useQueries({ queries: botIds.map((id) => ({ queryKey: qk.agentConfigs.detail(id), queryFn: () => getAgentConfig(id) })) });
}

/** Variables: `{ botId, input }`; the whole configuration. */
export function useSaveAgentConfig() {
  // the agent settings of a project name the agents of its bots (A621)
  return useApiMutation(({ botId, input }: { botId: string; input: AgentConfigInput }) => saveAgentConfig(botId, input), [qk.agentConfigs.all, qk.runs.all, qk.projectAgents.all]);
}

/** The working rules of every kind of run (every account reads them). */
export function useAgentRules() {
  return useQuery({ queryKey: qk.agentRules.list({}), queryFn: listAgentRules });
}

/** Variables: `{ type, body }`; `body` null restores the standard. */
export function useSaveAgentRule() {
  return useApiMutation(({ type, body }: { type: RunType; body: string | null }) => saveAgentRule(type, body), [qk.agentRules.all]);
}

/** The agent settings of a project; waits without an id. */
export function useProjectAgents(projectId: string | null | undefined) {
  return useQuery({ queryKey: qk.projectAgents.detail(projectId ?? ''), queryFn: () => getProjectAgents(projectId!), enabled: !!projectId });
}

/** Variables: `{ projectId, input }`; the settings as a whole. */
export function useSaveProjectAgents() {
  return useApiMutation(({ projectId, input }: { projectId: string; input: ProjectAgentsInput }) => saveProjectAgents(projectId, input), [qk.projectAgents.all]);
}
