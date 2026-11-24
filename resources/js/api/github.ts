/*
 * The one GitHub app of the instance (spec 10.2, 11.3). Everybody reads its state; org admins start the manifest flow
 * (only from the session: the answer is what the browser posts to GitHub), sync it and disconnect it. A project picks
 * its repo and confirms the guard against an unauthorized merge (its admins).
 */

import type { GitHubManifestStart, GitHubStatus, ProjectRepository } from '@/types';
import { del, get, one, post, put } from './http';

export function getGitHub(): Promise<GitHubStatus> {
  return one(get<{ data: GitHubStatus }>('/github'));
}

/** Reads the installations and repos from GitHub again. */
export function syncGitHub(): Promise<GitHubStatus> {
  return one(post<{ data: GitHubStatus }>('/github/sync'));
}

/** What to post to GitHub to register the app; `organization` is the login of a GitHub organization (else the own account). */
export function startGitHubManifest(organization: string | null): Promise<GitHubManifestStart> {
  return one(post<{ data: GitHubManifestStart }>('/github/manifest', { organization }));
}

/** werkbuch forgets the app; answers how many runs it canceled. */
export function disconnectGitHub(): Promise<{ canceled: number }> {
  return del<{ canceled: number }>('/github');
}

const repositoryPath = (project: string) => `/projects/${encodeURIComponent(project)}/repository`;

/** The repo of a project, or `null`. */
export function getProjectRepository(project: string): Promise<ProjectRepository | null> {
  return one(get<{ data: ProjectRepository | null }>(repositoryPath(project)));
}

/** Sets the repo of a project (its ULID or `owner/name`, `null` takes it away) and the base branch (`null`: the default branch). */
export function setProjectRepository(project: string, input: { repository_id: string | null; base_branch: string | null }): Promise<ProjectRepository | null> {
  return one(put<{ data: ProjectRepository | null }>(repositoryPath(project), input));
}

/** Confirms an unauthorized merge: the strands of the project go on. */
export function confirmMergeGuard(project: string): Promise<ProjectRepository | null> {
  return one(post<{ data: ProjectRepository | null }>(`${repositoryPath(project)}/confirm-guard`));
}
