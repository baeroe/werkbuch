/*
 * Who may see and do what (spec 4.3). One place decides which projects a person sees, so views, search, items,
 * relations and notifications all agree (spec 7.2: "ein Scope sichtbare Projekte").
 *
 * - Org admins have admin rights in every project, member or not.
 * - Public projects are seen by everybody; a non-member there is a viewer. Private projects only by members.
 * - 404 for what a person may not see (its existence stays hidden), 403 for what they see but may not do.
 */

import { canTakeWork } from '@/domain/people';
import type { Project, ProjectRole, User } from '@/types';
import { forbidden, notFound, conflict } from './client';
import type { Db } from './db';

const ROLE_RANK: Record<ProjectRole, number> = { viewer: 0, member: 1, admin: 2 };

export function isOrgAdmin(user: User): boolean {
  return user.org_role === 'admin';
}

/** The role a person has in a project, or null when they do not see it at all. */
export function projectRole(db: Db, user: User, project: Project): ProjectRole | null {
  if (isOrgAdmin(user)) return 'admin';
  const membership = db.project_members.find((member) => member.project_id === project.id && member.user_id === user.id);
  if (membership) return membership.role;
  return project.visibility === 'public' ? 'viewer' : null;
}

export function canSeeProject(db: Db, user: User, project: Project): boolean {
  return projectRole(db, user, project) !== null;
}

/** The projects a person sees, archived ones included (callers decide whether to show them). */
export function visibleProjects(db: Db, user: User): Project[] {
  return db.projects.filter((project) => canSeeProject(db, user, project));
}

export function visibleProjectIds(db: Db, user: User): Set<string> {
  return new Set(visibleProjects(db, user).map((project) => project.id));
}

const ROLE_TEXT: Record<ProjectRole, string> = {
  viewer: 'lesen',
  member: 'bearbeiten',
  admin: 'verwalten',
};

/** Throws 404 when the project is invisible and 403 when the role is too low. */
export function requireRole(db: Db, user: User, project: Project, minimum: ProjectRole, action?: string): ProjectRole {
  const role = projectRole(db, user, project);
  if (role === null) throw notFound('Das Projekt');
  if (ROLE_RANK[role] < ROLE_RANK[minimum]) {
    throw forbidden(action ?? `Dafür brauchst du die Rolle „${minimum === 'admin' ? 'Admin' : 'Member'}“ im Projekt ${project.identifier} (Projekt ${ROLE_TEXT[minimum]}).`);
  }
  return role;
}

/** Like `requireRole` for changes: an archived project is read-only. */
export function requireWritable(db: Db, user: User, project: Project, minimum: ProjectRole = 'member', action?: string): ProjectRole {
  const role = requireRole(db, user, project, minimum, action);
  if (project.archived_at !== null) {
    throw conflict('project_archived', `Das Projekt ${project.identifier} ist archiviert und schreibgeschützt.`);
  }
  return role;
}

export function requireOrgAdmin(user: User, action = 'Das dürfen nur Org-Admins.'): void {
  if (!isOrgAdmin(user)) throw forbidden(action);
}

/**
 * Whether an account can be given work in a project (assignee, person property): an active member, person or bot, or
 * an active person who is an org admin. The pickers and mentions offer the same accounts (`canTakeWork`).
 */
export function canBeAssigned(db: Db, user: User | undefined, project: Project): user is User {
  if (user === undefined) return false;
  const member = db.project_members.some((entry) => entry.project_id === project.id && entry.user_id === user.id);
  return canTakeWork(user, member);
}
