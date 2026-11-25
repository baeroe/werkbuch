/*
 * The GitHub apps of the instance, one per GitHub account (spec 10.2, 11.3, A680). Everybody reads their state; org
 * admins start the manifest flow of the app of an account (only from the session: the answer is what the browser posts
 * to GitHub), sync them and disconnect one. A project picks its repo and confirms the guard against an unauthorized
 * merge (its admins).
 */

import type { GitHubManifestStart, GitHubOwnerType, GitHubStatus, ProjectRepository } from '@/types';
import { del, get, one, post, put } from './http';

export function getGitHub(): Promise<GitHubStatus> {
  return one(get<{ data: GitHubStatus }>('/github'));
}

/** Reads the installations and repos of every app from GitHub again. */
export function syncGitHub(): Promise<GitHubStatus> {
  return one(post<{ data: GitHubStatus }>('/github/sync'));
}

/** What to post to GitHub to register the app of a GitHub account: its login and whether it is the own account or an organization. */
export function startGitHubManifest(input: { owner: string; owner_type: GitHubOwnerType }): Promise<GitHubManifestStart> {
  return one(post<{ data: GitHubManifestStart }>('/github/manifest', input));
}

/** werkbuch forgets the app (its ULID); answers how many runs it canceled. */
export function disconnectGitHub(app: string): Promise<{ canceled: number }> {
  return del<{ canceled: number }>(`/github/apps/${encodeURIComponent(app)}`);
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
