/*
 * Who may do what (spec 4.3), for the UI: actions a person may not take are hidden, or disabled with the reason as
 * tooltip (`<Button disabledReason={reason('item.delete', item.project_id)}>`). The server checks the same rules
 * again; this only spares people buttons that would be refused.
 *
 * Organisation: Admin or Member. Project: Admin, Member or Viewer.
 * - The role in a project is `Project.my_role` as the server computes it (P13): org admins are admins everywhere, a
 *   member who is not in a public project reads it as a viewer; private projects of others are not in the list.
 * - An archived project is read-only; its admins may still manage it (e.g. restore it).
 * Project permissions take the project's id or identifier. Without a project they ask whether any visible project
 * allows it (e.g. "c" for a new item, where the dialog lets you pick the project).
 */

import { useMemo } from 'react';
import { useProjects } from '@/hooks/projects';
import { useCurrentUser } from '@/hooks/users';
import { t } from '@/lib/i18n';
import type { Project, ProjectRole, User } from '@/types';

export type Permission =
  | 'org.manage'
  | 'org.manage_catalog'
  | 'project.create'
  | 'project.manage'
  | 'item.create'
  | 'item.edit'
  | 'item.delete'
  | 'item.comment'
  | 'wiki.edit'
  | 'template.manage'
  | 'view.create'
  | 'view.manage_any';

type ProjectPermission = 'project.manage' | 'item.create' | 'item.edit' | 'item.delete' | 'item.comment' | 'wiki.edit' | 'template.manage';

/** What the rules need: the signed-in account and the projects it sees (archived ones included), each with its role. */
export interface PermissionData {
  user: User;
  projects: Project[];
}

/** Rights of the organisation: who lacks them gets this reason. */
const ORG_ADMIN_ONLY: Partial<Record<Permission, () => string>> = {
  'org.manage': () => t('permissions.reason.org_manage'),
  'org.manage_catalog': () => t('permissions.reason.org_manage_catalog'),
  'view.manage_any': () => t('permissions.reason.view_manage_any'),
};

interface ProjectRight {
  /** The lowest role that has the right, and why a lower one may not; none when seeing the project is enough. */
  needs?: { role: ProjectRole; denied: (project: string) => string };
  /** Why no visible project allows it. */
  nowhere: () => string;
}

/** Rights of a project; the reasons take the identifier of the project. */
const PROJECT_RIGHTS: Record<ProjectPermission, ProjectRight> = {
  'project.manage': {
    needs: { role: 'admin', denied: (project) => t('permissions.reason.project_manage.admins_only', { project }) },
    nowhere: () => t('permissions.reason.project_manage.nowhere'),
  },
  'item.create': {
    needs: { role: 'member', denied: (project) => t('permissions.reason.item_create.read_only', { project }) },
    nowhere: () => t('permissions.reason.item_create.nowhere'),
  },
  'item.edit': {
    needs: { role: 'member', denied: (project) => t('permissions.reason.item_edit.read_only', { project }) },
    nowhere: () => t('permissions.reason.item_edit.nowhere'),
  },
  'item.delete': {
    needs: { role: 'admin', denied: (project) => t('permissions.reason.item_delete.admins_only', { project }) },
    nowhere: () => t('permissions.reason.item_delete.nowhere'),
  },
  'item.comment': {
    nowhere: () => t('permissions.reason.item_comment.nowhere'),
  },
  'wiki.edit': {
    needs: { role: 'member', denied: (project) => t('permissions.reason.wiki_edit.read_only', { project }) },
    nowhere: () => t('permissions.reason.wiki_edit.nowhere'),
  },
  'template.manage': {
    needs: { role: 'member', denied: (project) => t('permissions.reason.template_manage.read_only', { project }) },
    nowhere: () => t('permissions.reason.template_manage.nowhere'),
  },
};

const ROLE_RANK: Record<ProjectRole, number> = { viewer: 0, member: 1, admin: 2 };

const isProjectPermission = (permission: Permission): permission is ProjectPermission => permission in PROJECT_RIGHTS;

function projectReason(permission: ProjectPermission, project: Project): string | null {
  const { needs } = PROJECT_RIGHTS[permission];
  if (needs && ROLE_RANK[project.my_role] < ROLE_RANK[needs.role]) return needs.denied(project.identifier);
  if (project.archived_at !== null && permission !== 'project.manage') return t('permissions.reason.archived', { project: project.identifier });
  return null;
}

/** Why the person may not do this (in this project), or null when they may. */
export function deniedReason(data: PermissionData, permission: Permission, projectRef?: string): string | null {
  if (!isProjectPermission(permission)) {
    const adminOnly = ORG_ADMIN_ONLY[permission];
    return adminOnly && data.user.org_role !== 'admin' ? adminOnly() : null;
  }
  if (projectRef === undefined) {
    const anywhere = data.projects.some((project) => projectReason(permission, project) === null);
    return anywhere ? null : PROJECT_RIGHTS[permission].nowhere();
  }
  const project = data.projects.find((entry) => entry.id === projectRef || entry.identifier === projectRef);
  return project ? projectReason(permission, project) : t('permissions.reason.not_visible');
}

export interface Permissions {
  can: (permission: Permission, projectId?: string) => boolean;
  /** The reason for a tooltip or toast, or null when allowed. */
  reason: (permission: Permission, projectId?: string) => string | null;
  /**
   * The rights are still on their way: `can` answers false meanwhile. A screen that would otherwise show read-only
   * for a moment waits for this (a skeleton) instead.
   */
  loading: boolean;
}

/** The rights of the signed-in person; nothing is allowed until the projects have loaded. */
export function usePermissions(): Permissions {
  const user = useCurrentUser();
  // a guest page has no rights to load
  const projects = useProjects({ include_archived: true }, { enabled: user !== undefined });

  const projectList = projects.data?.items;
  const failed = projects.isError;

  return useMemo(() => {
    const data = user && projectList ? { user, projects: projectList } : null;
    const reason = (permission: Permission, projectId?: string) => {
      if (data) return deniedReason(data, permission, projectId);
      return failed ? t('permissions.reason.failed') : t('permissions.reason.loading');
    };
    return { can: (permission, projectId) => reason(permission, projectId) === null, reason, loading: data === null && !failed };
  }, [user, projectList, failed]);
}
