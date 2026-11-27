/*
 * Runners (spec 6.2, 10.1, org admins): the machines that run agents. A revoked runner is not listed; revoking answers
 * how many of its runs it canceled. A pairing code (only from the session) is shown once with its command; asking for
 * it again says whether a runner redeemed it. The runs of agents are read here for the cards (what runs where) and
 * canceled from them.
 */

import type { AgentRun, Runner, RunnerPairing, RunnerSlots, RunStatus } from '@/types';
import type { Page } from './client';
import { allPages } from './client';
import { del, get, getPage, one, patch, post } from './http';

const path = (id: string) => `/runners/${encodeURIComponent(id)}`;

/** Every active runner (all pages), by name. */
export function listRunners(): Promise<Page<Runner>> {
  return allPages((cursor) => getPage<Runner>('/runners', { cursor }));
}

/** Renames a runner, sets its places, or both: only the keys sent change. */
export function updateRunner(id: string, input: { name?: string; slots?: RunnerSlots; usage_limit?: number | null }): Promise<Runner> {
  return one(patch<{ data: Runner }>(path(id), input));
}

/** Revokes a runner: its token stops working and its runs end. Answers how many it canceled. */
export function revokeRunner(id: string): Promise<{ canceled: number }> {
  return del<{ canceled: number }>(path(id));
}

/** A new one-time code for ten minutes, with the command that installs a runner with it; older codes stop working. */
export function createPairing(): Promise<RunnerPairing> {
  return one(post<{ data: RunnerPairing }>('/runner-pairings'));
}

/** A code again (without the code itself): whether and by which runner it was redeemed. */
export function getPairing(id: string): Promise<RunnerPairing> {
  return one(get<{ data: RunnerPairing }>(`/runner-pairings/${encodeURIComponent(id)}`));
}

/** The runs that still have to happen or happen now, newest first (every page). */
export function listActiveRuns(statuses: readonly RunStatus[] = ['queued', 'waiting', 'running', 'canceling']): Promise<Page<AgentRun>> {
  return allPages((cursor) => getPage<AgentRun>('/runs', { cursor, 'filter[status]': statuses.join(',') }));
}

/** Cancels a run: a running one ends at the runner's next contact (`canceling`). */
export function cancelRun(id: string): Promise<AgentRun> {
  return one(post<{ data: AgentRun }>(`/runs/${encodeURIComponent(id)}/cancel`));
}
