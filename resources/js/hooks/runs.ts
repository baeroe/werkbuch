/*
 * The runs of agents at an item (WEBU-28, spec 10.6). The runs of an item reload on every `agent_run.*` of its project
 * (`qk.runs.all`, hooks/live.ts); while one waits for a runner they ask again every 15 s besides (online is a question
 * of time, A580). The log of a run keeps the lines it has and asks only for those after its last one: on
 * `agent_run.log` (the item's channel, at most once a second per run) and on every reload of `qk.runs.all` (A644).
 * Canceling is `useCancelRun` of `./runners`.
 */

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { listItemRuns, listRunEvents, resumeThread, retryRun } from '@/api/runs';
import type { RunEvent } from '@/types';
import { qk } from './keys';
import { useApiMutation } from './mutation';
import { RUNNERS_REFRESH_MS } from './runners';

/**
 * Every run of an item, newest first; asks again every 15 s while one waits for its runner (it may come back). With
 * `enabled` false (an item without runs, or one that was deleted) it asks nothing and keeps what it has.
 */
export function useItemRuns(itemId: string | null, { enabled = true }: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: qk.runs.list({ item: itemId }),
    queryFn: () => listItemRuns(itemId!),
    enabled: itemId !== null && enabled,
    refetchInterval: (query) => (query.state.data?.items.some((run) => run.status === 'waiting') ? RUNNERS_REFRESH_MS : false),
  });
}

/** The lines of a run so far: a reload asks only for the lines after the last one it has and adds them. */
export function useRunLog(runId: string, { enabled = true }: { enabled?: boolean } = {}) {
  const queryClient = useQueryClient();
  const queryKey = qk.runs.log(runId);
  return useQuery({
    queryKey,
    queryFn: async (): Promise<RunEvent[]> => {
      const before = queryClient.getQueryData<RunEvent[]>(queryKey) ?? [];
      const page = await listRunEvents(runId, before.at(-1)?.id ?? null);
      return page.items.length === 0 ? before : [...before, ...page.items];
    },
    enabled,
  });
}

/** Variable: the run id; answers the new run. */
export function useRetryRun() {
  return useApiMutation(retryRun, [qk.runs.all, qk.runners.all, qk.workItems.all]);
}

/** Variable: the item's id or key; answers the correction it queued or that the brake stopped it. */
export function useResumeThread() {
  return useApiMutation(resumeThread, [qk.runs.all, qk.runners.all, qk.workItems.all, qk.activity.all]);
}
