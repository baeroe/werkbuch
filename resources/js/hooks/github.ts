import { useQuery } from '@tanstack/react-query';
import { confirmMergeGuard, disconnectGitHub, getGitHub, getProjectRepository, setProjectRepository, startGitHubManifest, syncGitHub } from '@/api/github';
import { qk } from './keys';
import { useApiMutation } from './mutation';

/** The GitHub connection: the apps with their installations, and the repos. */
export function useGitHub({ enabled = true }: { enabled?: boolean } = {}) {
  return useQuery({ queryKey: qk.github.detail('status'), queryFn: getGitHub, enabled });
}

export function useSyncGitHub() {
  return useApiMutation(() => syncGitHub(), [qk.github.all, qk.repository.all]);
}

/** Variables: `{ owner, owner_type }` of the GitHub account. Answers what to post to GitHub; it holds a state, so it leaves the cache. */
export function useStartGitHubManifest() {
  return useApiMutation(startGitHubManifest, [], { gcTime: 0 });
}

/** Variable: the ULID of the app. */
export function useDisconnectGitHub() {
  return useApiMutation(disconnectGitHub, [qk.github.all, qk.repository.all, qk.runs.all, qk.runners.all]);
}

/** The repo of a project (its ULID); `null` without one. */
export function useProjectRepository(projectId: string | null | undefined) {
  return useQuery({ queryKey: qk.repository.detail(projectId ?? ''), queryFn: () => getProjectRepository(projectId!), enabled: !!projectId });
}

/** Variables: `{ project, repository_id, base_branch }`. */
export function useSetProjectRepository() {
  return useApiMutation(
    ({ project, ...input }: { project: string; repository_id: string | null; base_branch: string | null }) => setProjectRepository(project, input),
    [qk.repository.all, qk.github.all],
  );
}

/** Variable: the project id. */
export function useConfirmMergeGuard() {
  return useApiMutation(confirmMergeGuard, [qk.repository.all, qk.github.all, qk.runs.all]);
}
