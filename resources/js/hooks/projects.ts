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

/** The projects the signed-in account sees, each with the own role (`my_role`). */
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

/** Members of one project (P13: there is no list across projects); waits until the project is known. */
export function useMembers(project: string | null | undefined) {
  return useQuery({ queryKey: qk.members.list({ project }), queryFn: () => listMembers(project!), enabled: !!project });
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

/** Joining changes the own role (`my_role`) of the project as well. */
export function useJoinProject() {
  return useApiMutation(joinProject, PROJECT_KEYS);
}

/** A change of members may change the own role (`my_role`), so the projects load again as well. */
const MEMBER_KEYS = [qk.members.all, qk.projects.all] as const;

export function useAddMember() {
  return useApiMutation(
    ({ project_id, user_id, role }: { project_id: string; user_id: string; role: ProjectRole }) => addMember(project_id, user_id, role),
    MEMBER_KEYS,
  );
}

export function useUpdateMemberRole() {
  return useApiMutation(
    ({ project_id, user_id, role }: { project_id: string; user_id: string; role: ProjectRole }) => updateMemberRole(project_id, user_id, role),
    MEMBER_KEYS,
  );
}

export function useRemoveMember() {
  return useApiMutation(({ project_id, user_id }: { project_id: string; user_id: string }) => removeMember(project_id, user_id), MEMBER_KEYS);
}
