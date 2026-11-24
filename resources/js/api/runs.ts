/*
 * The runs of agents at an item (spec 7.5, 10.6): its runs (every page, newest first as the server lists them), the log
 * of a run from a line on (`after`: only the lines that came since), starting a run again, and going on with a strand
 * a disconnect of GitHub paused. Canceling is `cancelRun` of `./runners`.
 */

import type { AgentRun, RunEvent } from '@/types';
import type { Page } from './client';
import { allPages } from './client';
import { getPage, one, post } from './http';

const runPath = (id: string) => `/runs/${encodeURIComponent(id)}`;

/** Every run of an item, newest first. */
export function listItemRuns(itemId: string): Promise<Page<AgentRun>> {
  return allPages((cursor) => getPage<AgentRun>('/runs', { cursor, 'filter[work_item_id]': itemId, per_page: 100 }));
}

/** The lines of a run in the order they came; with `after` only those after that line (every page). */
export function listRunEvents(runId: string, after: string | null = null): Promise<Page<RunEvent>> {
  return allPages((cursor) => getPage<RunEvent>(`${runPath(runId)}/events`, { cursor, 'filter[after]': after ?? undefined, per_page: 100 }));
}

/** Queues a run that ended without success again: same kind, agent, item and strand. */
export function retryRun(id: string): Promise<AgentRun> {
  return one(post<{ data: AgentRun }>(`${runPath(id)}/retry`));
}

/** What going on with a strand did: the correction it queued, or the brake that stopped it (`braked`). */
export interface ResumeOutcome {
  run: AgentRun | null;
  braked: boolean;
}

/** Goes on with the strand of an item that a disconnect of GitHub paused: a correction on the same strand. */
export function resumeThread(itemRef: string): Promise<ResumeOutcome> {
  return one(post<{ data: ResumeOutcome }>(`/work-items/${encodeURIComponent(itemRef)}/agent/resume`));
}
