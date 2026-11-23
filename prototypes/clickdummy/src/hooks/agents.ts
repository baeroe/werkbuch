/*
 * Hooks of the runner and the agents (WEBU-18). The runs of an item are polled while one is active, so the log grows
 * and a cancel finishes on screen; when a run moves on, the item and its activity load again (a started run sets the
 * status).
 */

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { getAgentConfig, getProjectAgents, listAgentBotIds, listAgentConfigs, listAgentProjects, listRepoOwners, saveAgentConfig, saveProjectAgents } from '@/api/agents';
import { connectGithubApp, disconnectGithub, getGithub } from '@/api/github';
import { createPairing, expirePairing, getPairing, listRunners, renameRunner, revokeRunner, saveRunnerSlots, simulatePairing } from '@/api/runners';
import { deleteMcpServer, listMcpServers, saveMcpServer } from '@/api/mcp';
import { cancelRun, getItemAgents, resumeThread, retryRun } from '@/api/runs';
import { isActive } from '@/domain/agents';
import type { RunnerSlots } from '@/types';
import { qk } from './keys';
import { useApiMutation } from './mutation';

/** How often an item with an active run, or the runner list, asks again. */
export const POLL_MS = 1_500;

export function useRunners() {
  return useQuery({ queryKey: qk.runners.all, queryFn: listRunners, refetchInterval: 5_000 });
}

export function useCreatePairing() {
  return useApiMutation(createPairing, [qk.pairings.all]);
}

/** The code shown in the dialog, asked again while it waits for the runner. */
export function usePairing(code: string | null) {
  return useQuery({
    queryKey: qk.pairings.detail(code ?? ''),
    queryFn: () => getPairing(code!),
    enabled: code !== null,
    refetchInterval: (query) => (query.state.data?.runner_id ? false : POLL_MS),
  });
}

export function useSimulatePairing() {
  return useApiMutation((code: string) => simulatePairing(code), [qk.pairings.all, qk.runners.all]);
}

export function useExpirePairing() {
  return useApiMutation(expirePairing, [qk.pairings.all]);
}

export function useRenameRunner() {
  return useApiMutation(({ id, name }: { id: string; name: string }) => renameRunner(id, name), [qk.runners.all]);
}

export function useSaveRunnerSlots() {
  return useApiMutation(({ id, slots }: { id: string; slots: RunnerSlots }) => saveRunnerSlots(id, slots), [qk.runners.all, qk.itemAgents.all]);
}

export function useRevokeRunner() {
  return useApiMutation(revokeRunner, [qk.runners.all, qk.agentConfigs.all, qk.itemAgents.all]);
}

export function useGithub() {
  return useQuery({ queryKey: qk.github.all, queryFn: getGithub });
}

export function useConnectGithubApp() {
  return useApiMutation(connectGithubApp, [qk.github.all]);
}

export function useDisconnectGithub() {
  return useApiMutation(disconnectGithub, [qk.github.all, qk.projectAgents.all, qk.itemAgents.all, qk.runners.all]);
}

export function useAgentConfigs(enabled = true) {
  return useQuery({ queryKey: qk.agentConfigs.list(), queryFn: listAgentConfigs, enabled });
}

/** The bots that work as agents, for every account (the review agent of a project). */
export function useAgentBotIds() {
  return useQuery({ queryKey: qk.agentConfigs.list({ agents: true }), queryFn: listAgentBotIds });
}

export function useAgentConfig(botId: string | null) {
  return useQuery({ queryKey: qk.agentConfigs.detail(botId ?? ''), queryFn: () => getAgentConfig(botId!), enabled: botId !== null });
}

/** The projects of a bot and whether it can work as an agent there. */
export function useAgentProjects(botId: string | null) {
  return useQuery({ queryKey: qk.agentConfigs.list({ projects: botId }), queryFn: () => listAgentProjects(botId!), enabled: botId !== null });
}

export function useSaveAgentConfig() {
  return useApiMutation(saveAgentConfig, [qk.agentConfigs.all, qk.itemAgents.all]);
}

export function useProjectAgents(projectId: string | null) {
  return useQuery({ queryKey: qk.projectAgents.detail(projectId ?? ''), queryFn: () => getProjectAgents(projectId!), enabled: projectId !== null });
}

/** Which project owns which repo. */
export function useRepoOwners() {
  return useQuery({ queryKey: qk.projectAgents.list({ owners: true }), queryFn: listRepoOwners });
}

export function useSaveProjectAgents() {
  return useApiMutation(saveProjectAgents, [qk.projectAgents.all, qk.itemAgents.all]);
}

/**
 * Strand, runs and PRs of an item. Polls while a run is active; when the runs move on (a start sets the status), the
 * item and its activity load again.
 */
export function useItemAgents(itemId: string | null) {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: qk.itemAgents.detail(itemId ?? ''),
    queryFn: () => getItemAgents(itemId!),
    enabled: itemId !== null,
    refetchInterval: (state) => (state.state.data?.runs.some(isActive) ? POLL_MS : false),
  });
  const statuses = query.data?.runs.map((run) => `${run.id}:${run.status}`).join(',');
  const seen = useRef(statuses);
  useEffect(() => {
    if (statuses === undefined || seen.current === statuses) return;
    const first = seen.current === undefined;
    seen.current = statuses;
    if (first) return;
    void queryClient.invalidateQueries({ queryKey: qk.workItems.all });
    void queryClient.invalidateQueries({ queryKey: qk.activity.all });
  }, [statuses, queryClient]);
  return query;
}

export function useCancelRun() {
  return useApiMutation(cancelRun, [qk.itemAgents.all, qk.runners.all]);
}

export function useRetryRun() {
  return useApiMutation(retryRun, [qk.itemAgents.all, qk.runners.all, qk.workItems.all, qk.activity.all]);
}

/** The catalog of MCP servers; values of the environment never come along. */
export function useMcpServers() {
  return useQuery({ queryKey: qk.mcpServers.all, queryFn: listMcpServers });
}

export function useSaveMcpServer() {
  return useApiMutation(saveMcpServer, [qk.mcpServers.all, qk.projectAgents.all, qk.runners.all]);
}

export function useDeleteMcpServer() {
  return useApiMutation(deleteMcpServer, [qk.mcpServers.all, qk.projectAgents.all, qk.runners.all]);
}

/** Goes on with a strand GitHub's disconnect paused (variable: the item's id or key). */
export function useResumeThread() {
  return useApiMutation(resumeThread, [qk.itemAgents.all, qk.runners.all, qk.workItems.all, qk.activity.all]);
}
