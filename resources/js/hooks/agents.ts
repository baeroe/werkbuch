import { useQueries, useQuery } from '@tanstack/react-query';
import { getAgentConfig, saveAgentConfig, type AgentConfigInput } from '@/api/agents';
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
  return useApiMutation(({ botId, input }: { botId: string; input: AgentConfigInput }) => saveAgentConfig(botId, input), [qk.agentConfigs.all, qk.runs.all]);
}
