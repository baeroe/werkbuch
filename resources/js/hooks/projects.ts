import { useQueries, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
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
import { allPages } from './pages';

/**
 * The projects the signed-in account sees, each with the own role (`my_role`): every page, because the overview, the
 * sidebar and the rights need all of them.
 */
export function useProjects(args: Omit<ListProjectsArgs, 'cursor' | 'per_page'> = {}, options: HookOptions = {}) {
  return useQuery({
    queryKey: qk.projects.list(args),
    queryFn: () => allPages((cursor) => listProjects({ ...args, cursor })),
    enabled: options.enabled !== false,
  });
}

/** The ids of projects that already made the list load again once, per query client: never a loop. */
const reloadedFor = new WeakMap<QueryClient, Set<string>>();

/**
 * The projects the rights and the workflows read (`include_archived`), loaded again once when an item names a project
 * the cached list lacks: one created or joined after the list loaded, which counts as fresh for 10 s. Without it the
 * item of a search hit would wait for its project (fields locked, "Status: loading") until something else loads the
 * list. A project that stays missing (no longer visible) is asked for once only; one that was in the list and left it again
 * is asked for once more.
 */
export function useProjectsWith(projectId: string) {
  const client = useQueryClient();
  const projects = useProjects({ include_archived: true });
  const missing = projects.data !== undefined && !projects.isFetching && !projects.data.items.some((project) => project.id === projectId);
  const present = projects.data?.items.some((project) => project.id === projectId) ?? false;
  useEffect(() => {
    const asked = reloadedFor.get(client) ?? new Set<string>();
    reloadedFor.set(client, asked);
    // a project in the list is forgotten: if it leaves the list again, it may be asked for once more
    if (present) asked.delete(projectId);
    if (!missing) return;
    if (asked.has(projectId)) return;
    asked.add(projectId);
    void client.invalidateQueries({ queryKey: qk.projects.list({ include_archived: true }), exact: true });
  }, [missing, present, projectId, client]);
  return projects;
}

/** One project by identifier (a former identifier works; compare `identifier` of the answer to redirect). */
export function useProject(identifier: string | null | undefined, options: HookOptions = {}) {
  return useQuery({
    queryKey: qk.projects.detail(identifier ?? ''),
    queryFn: () => getProject(identifier!),
    enabled: !!identifier && options.enabled !== false,
  });
}

/**
 * Members of one project (P13: there is no list across projects), every page: the assignees, the lead and the members
 * screen need all of them. Waits until the project is known.
 */
export function useMembers(project: string | null | undefined) {
  return useQuery({
    queryKey: qk.members.list({ project }),
    queryFn: () => allPages((cursor) => listMembers(project!, { cursor })),
    enabled: !!project,
  });
}

/** The members of several projects at once (the projects of a selection), each as `useMembers` loads it. */
export function useMembersOf(projects: readonly string[]) {
  return useQueries({
    queries: projects.map((project) => ({
      queryKey: qk.members.list({ project }),
      queryFn: () => allPages((cursor) => listMembers(project, { cursor })),
    })),
  });
}

const PROJECT_KEYS = [qk.projects.all, qk.members.all, qk.favorites.all, qk.search.all] as const;

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

/**
 * A change of members may change the own role (`my_role`), so the projects load again as well; and what the search
 * finds follows who sees a project (a private one gained or lost a member, 21b-M3).
 */
const MEMBER_KEYS = [qk.members.all, qk.projects.all, qk.search.all] as const;

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
