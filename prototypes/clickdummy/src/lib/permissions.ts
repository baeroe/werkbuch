/*
 * Who may do what (spec 4.3), for the UI: actions a person may not take are hidden, or disabled with the reason as
 * tooltip (`<Button disabledReason={reason('item.delete', item.project_id)}>`). The fake API checks the same rules
 * again; this only spares people buttons that would be refused.
 *
 * Organisation: Admin or Member. Project: Admin, Member or Viewer.
 * - Org admins have admin rights in every project, member or not.
 * - A member who is not in a public project reads it as a viewer; private projects stay hidden.
 * - An archived project is read-only; its admins may still manage it (e.g. restore it).
 * Project permissions take the project's id or identifier. Without a project they ask whether any visible project
 * allows it (e.g. "c" for a new item, where the dialog lets you pick the project).
 */

import { useMemo } from 'react';
import { useMembers, useProjects } from '@/hooks/projects';
import { useCurrentUser } from '@/hooks/users';
import type { Project, ProjectMember, ProjectRole, User } from '@/types';

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

/** What the rules need: the signed-in account, the projects it sees and their memberships. */
export interface PermissionData {
  user: User;
  projects: Project[];
  members: ProjectMember[];
}

/** Rights of the organisation: who lacks them gets this reason. */
const ORG_ADMIN_ONLY: Partial<Record<Permission, string>> = {
  'org.manage': 'Organisation, Personen, Bots und Webhooks verwalten nur Org-Admins.',
  'org.manage_catalog': 'Workflows, Typen, Properties, Labels, Relationstypen und Resolutions verwalten nur Org-Admins.',
  'view.manage_any': 'Fremde Views ändern und löschen nur Org-Admins.',
};

/** Rights of a project: the lowest role that has them, and what they allow (the start of the reason). */
const PROJECT_RIGHTS: Record<ProjectPermission, { minimum: ProjectRole; doing: string }> = {
  'project.manage': { minimum: 'admin', doing: 'Projekteinstellungen ändern' },
  'item.create': { minimum: 'member', doing: 'Items anlegen' },
  'item.edit': { minimum: 'member', doing: 'Items ändern' },
  'item.delete': { minimum: 'admin', doing: 'Items löschen' },
  'item.comment': { minimum: 'viewer', doing: 'Kommentieren' },
  'wiki.edit': { minimum: 'member', doing: 'Das Wiki bearbeiten' },
  'template.manage': { minimum: 'member', doing: 'Vorlagen verwalten' },
};

const ROLE_RANK: Record<ProjectRole, number> = { viewer: 0, member: 1, admin: 2 };

const isProjectPermission = (permission: Permission): permission is ProjectPermission => permission in PROJECT_RIGHTS;

/** The role in a project, or null when the person does not see it. */
function roleIn({ user, members }: PermissionData, project: Project): ProjectRole | null {
  if (user.org_role === 'admin') return 'admin';
  const membership = members.find((member) => member.project_id === project.id && member.user_id === user.id);
  if (membership) return membership.role;
  return project.visibility === 'public' ? 'viewer' : null;
}

function projectReason(data: PermissionData, permission: ProjectPermission, project: Project): string | null {
  const { minimum, doing } = PROJECT_RIGHTS[permission];
  const role = roleIn(data, project);
  if (role === null) return 'Dieses Projekt siehst du nicht.';
  if (ROLE_RANK[role] < ROLE_RANK[minimum]) {
    return minimum === 'admin'
      ? `${doing} dürfen nur Admins des Projekts ${project.identifier}.`
      : `Im Projekt ${project.identifier} darfst du nur lesen. ${doing} dürfen Member und Admins.`;
  }
  if (project.archived_at !== null && permission !== 'project.manage') return `Das Projekt ${project.identifier} ist archiviert und schreibgeschützt.`;
  return null;
}

/** Why the person may not do this (in this project), or null when they may. */
export function deniedReason(data: PermissionData, permission: Permission, projectRef?: string): string | null {
  if (!isProjectPermission(permission)) {
    const adminOnly = ORG_ADMIN_ONLY[permission];
    return adminOnly && data.user.org_role !== 'admin' ? adminOnly : null;
  }
  if (projectRef === undefined) {
    const anywhere = data.projects.some((project) => projectReason(data, permission, project) === null);
    return anywhere ? null : `${PROJECT_RIGHTS[permission].doing} darfst du in keinem Projekt.`;
  }
  const project = data.projects.find((entry) => entry.id === projectRef || entry.identifier === projectRef);
  return project ? projectReason(data, permission, project) : 'Dieses Projekt siehst du nicht.';
}

export interface Permissions {
  can: (permission: Permission, projectId?: string) => boolean;
  /** The reason for a tooltip or toast, or null when allowed. */
  reason: (permission: Permission, projectId?: string) => string | null;
}

/** The rights of the signed-in person; nothing is allowed until they have loaded. */
export function usePermissions(): Permissions {
  const user = useCurrentUser();
  const projects = useProjects({ include_archived: true });
  const members = useMembers();

  const projectList = projects.data?.items;
  const memberList = members.data?.items;
  const failed = projects.isError || members.isError;

  return useMemo(() => {
    const data = user && projectList && memberList ? { user, projects: projectList, members: memberList } : null;
    const reason = (permission: Permission, projectId?: string) => {
      if (data) return deniedReason(data, permission, projectId);
      return failed ? 'Die Rechte konnten nicht geladen werden.' : 'Die Rechte werden noch geladen.';
    };
    return { can: (permission, projectId) => reason(permission, projectId) === null, reason };
  }, [user, projectList, memberList, failed]);
}
