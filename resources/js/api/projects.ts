/*
 * Projects and their members (spec 4.4, 4.3). Every function that takes a project accepts its id, its identifier or
 * a former identifier (`id` below stands for any of them). The role of the signed-in account is `Project.my_role`;
 * members are listed per project only (P13).
 */

import type { Project, ProjectMember, ProjectRole } from '@/types';
import type { Page, PageArgs } from './client';
import { del, get, getPage, one, patch as sendPatch, post } from './http';

/** The path of a project; a reference from an address may hold anything, so it is escaped. */
export const projectPath = (id: string) => `/projects/${encodeURIComponent(id)}`;

export interface ListProjectsArgs extends PageArgs {
  include_archived?: boolean;
}

/** The projects the signed-in account sees; archived ones only on request. */
export function listProjects(args: ListProjectsArgs = {}): Promise<Page<Project>> {
  return getPage<Project>('/projects', { ...args });
}

export function getProject(identifier: string): Promise<Project> {
  return one(get<{ data: Project }>(projectPath(identifier)));
}

/** Without a workflow the project gets the default one; without types, every active type, and the first is the default. */
export interface CreateProjectInput {
  name: string;
  identifier: string;
  description?: string;
  image_url?: string | null;
  lead_id?: string;
  visibility?: Project['visibility'];
  workflow_id?: string;
  enabled_type_ids?: string[];
  default_type_id?: string;
}

/** Any member of the organisation may create a project; they become its admin, and the lead joins it. */
export function createProject(input: CreateProjectInput): Promise<Project> {
  return one(post<{ data: Project }>('/projects', input));
}

/** `enabled_type_ids` and `default_type_id` are project settings (project admins); the workflow changes through `assignWorkflow`. */
export type UpdateProjectPatch = Partial<
  Pick<Project, 'name' | 'description' | 'image_url' | 'lead_id' | 'visibility' | 'enabled_type_ids' | 'default_type_id' | 'identifier'>
>;

/**
 * Project settings (project admins). Changing the identifier keeps the old one as an alias, so it still finds the
 * project (spec 4.4).
 */
export function updateProject(id: string, patch: UpdateProjectPatch): Promise<Project> {
  return one(sendPatch<{ data: Project }>(projectPath(id), patch));
}

/** Archives a project (it becomes read-only and leaves navigation and views) or, with `false`, restores it. */
export function archiveProject(id: string, archived = true): Promise<Project> {
  return one(post<{ data: Project }>(`${projectPath(id)}/${archived ? 'archive' : 'restore'}`));
}

/** Deletes a project with everything in it (project admins): it is gone at once, its data goes in the background. */
export function deleteProject(id: string): Promise<void> {
  return del<void>(projectPath(id));
}

/* ---------------------------------------------------------------------- members */

/** Members of one project. */
export function listMembers(project: string): Promise<Page<ProjectMember>> {
  return getPage<ProjectMember>(`${projectPath(project)}/members`);
}

/** Joins a public project as a member with one click. */
export function joinProject(id: string): Promise<ProjectMember> {
  return one(post<{ data: ProjectMember }>(`${projectPath(id)}/join`));
}

export function addMember(project_id: string, user_id: string, role: ProjectRole): Promise<ProjectMember> {
  return one(post<{ data: ProjectMember }>(`${projectPath(project_id)}/members`, { user_id, role }));
}

export function updateMemberRole(project_id: string, user_id: string, role: ProjectRole): Promise<ProjectMember> {
  return one(sendPatch<{ data: ProjectMember }>(`${projectPath(project_id)}/members/${user_id}`, { role }));
}

export function removeMember(project_id: string, user_id: string): Promise<void> {
  return del<void>(`${projectPath(project_id)}/members/${user_id}`);
}
