import { useQuery } from '@tanstack/react-query';
import { cancelRun, createPairing, getPairing, listActiveRuns, listRunners, revokeRunner, updateRunner } from '@/api/runners';
import type { RunnerSlots } from '@/types';
import { qk } from './keys';
import { useApiMutation } from './mutation';

/**
 * Online is a question of time (a contact within the last minute), not an event (A580): while a screen shows the
 * runners it asks again this often, also in the background tab it came from.
 */
export const RUNNERS_REFRESH_MS = 15_000;

/** How often an open pairing dialog asks whether a runner redeemed its code. */
export const PAIRING_REFRESH_MS = 2_000;

/** Every active runner; `live` asks again every 15 s while the screen shows them. */
export function useRunners({ live = false, enabled = true }: { live?: boolean; enabled?: boolean } = {}) {
  return useQuery({ queryKey: qk.runners.list({ pages: 'all' }), queryFn: listRunners, refetchInterval: live ? RUNNERS_REFRESH_MS : false, enabled });
}

/** The runs that still have to happen or happen now; `live` like the runners. */
export function useActiveRuns({ live = false }: { live?: boolean } = {}) {
  return useQuery({ queryKey: qk.runs.list({ active: true }), queryFn: () => listActiveRuns(), refetchInterval: live ? RUNNERS_REFRESH_MS : false });
}

/** Variables: `{ id, name?, slots? }`. */
export function useUpdateRunner() {
  return useApiMutation(({ id, ...input }: { id: string; name?: string; slots?: RunnerSlots }) => updateRunner(id, input), [qk.runners.all, qk.agentConfigs.all]);
}

/** Variable: the runner id. Its runs end, so the runs reload too. */
export function useRevokeRunner() {
  return useApiMutation(revokeRunner, [qk.runners.all, qk.runs.all, qk.agentConfigs.all]);
}

/** A new code; it holds the code in plain text, so the answer leaves the cache with its dialog. */
export function useCreatePairing() {
  return useApiMutation(createPairing, [], { gcTime: 0 });
}

/** A code while its dialog waits: asks every 2 s until a runner redeemed it; waits without an id. */
export function usePairing(id: string | null, { waiting = true }: { waiting?: boolean } = {}) {
  return useQuery({
    queryKey: qk.pairings.detail(id ?? ''),
    queryFn: () => getPairing(id!),
    enabled: id !== null,
    refetchInterval: (query) => (waiting && !query.state.data?.runner_id ? PAIRING_REFRESH_MS : false),
    gcTime: 0,
  });
}

/** Variable: the run id. */
export function useCancelRun() {
  return useApiMutation(cancelRun, [qk.runs.all, qk.runners.all]);
}
