import { useQuery } from '@tanstack/react-query';
import {
  addMember,
  archiveProject,
  createProject,
  deleteProject,
  getProject,
  joinProject,
  listMembers,
  listProjects,
  removeMember,
  updateMemberRole,
  updateProject,
  type ListProjectsArgs,
  type UpdateProjectPatch,
} from '@/api/projects';
import type { ProjectRole } from '@/types';
import { qk, type HookOptions } from './keys';
import { useApiMutation } from './mutation';

/** The projects the signed-in account sees. */
export function useProjects(args: ListProjectsArgs = {}) {
  return useQuery({ queryKey: qk.projects.list(args), queryFn: () => listProjects(args) });
}

/** One project by identifier (a former identifier works; compare `identifier` of the answer to redirect). */
export function useProject(identifier: string | null | undefined, options: HookOptions = {}) {
  return useQuery({
    queryKey: qk.projects.detail(identifier ?? ''),
    queryFn: () => getProject(identifier!),
    enabled: !!identifier && options.enabled !== false,
  });
}

/** Members of one project, or of every project the account sees when no project is given. */
export function useMembers(projectId?: string) {
  return useQuery({ queryKey: qk.members.list({ project: projectId }), queryFn: () => listMembers(projectId) });
}

const PROJECT_KEYS = [qk.projects.all, qk.members.all, qk.favorites.all] as const;

export function useCreateProject() {
  return useApiMutation(createProject, PROJECT_KEYS);
}

/** Changing the identifier renames the keys of all items, so everything is reloaded. */
export function useUpdateProject() {
  return useApiMutation(({ id, patch }: { id: string; patch: UpdateProjectPatch }) => updateProject(id, patch), 'all');
}

export function useArchiveProject() {
  return useApiMutation(({ id, archived }: { id: string; archived?: boolean }) => archiveProject(id, archived), 'all');
}

export function useDeleteProject() {
  return useApiMutation(deleteProject, 'all');
}

export function useJoinProject() {
  return useApiMutation(joinProject, PROJECT_KEYS);
}

export function useAddMember() {
  return useApiMutation(
    ({ project_id, user_id, role }: { project_id: string; user_id: string; role: ProjectRole }) => addMember(project_id, user_id, role),
    [qk.members.all],
  );
}

export function useUpdateMemberRole() {
  return useApiMutation(
    ({ project_id, user_id, role }: { project_id: string; user_id: string; role: ProjectRole }) => updateMemberRole(project_id, user_id, role),
    [qk.members.all],
  );
}

export function useRemoveMember() {
  return useApiMutation(({ project_id, user_id }: { project_id: string; user_id: string }) => removeMember(project_id, user_id), [qk.members.all]);
}
