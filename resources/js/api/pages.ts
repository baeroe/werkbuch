/*
 * The wiki of a project (spec 4.15, REST `/api/v1/projects/{project}/pages`, `/api/v1/pages`): a tree of pages, saved
 * with the version they are based on, no live editing. A save on top of an outdated version is refused with 409
 * `page_conflict`, whose `current` (`ApiError.current`) is the stored page; saving again on top of its `version` takes
 * the own text, and the server keeps the foreign one as a version first (A307). The names and signatures are the
 * clickdummy's, with these deviations: a page holds its text as Markdown (`content`) beside the Tiptap JSON
 * (`content_json`) and is sent as `content_json` (A321); `keep_current` keeps the stored state as a version before it
 * is replaced ("Meine Fassung übernehmen", A307); a version is read on its own with its text (`getPageVersion`, A315).
 */

import type { Page as WikiPage, PageNode, PageVersion, PageVersionDetail, RichText } from '@/types';
import { allPages, type Page } from './client';
import { del, get, getPage as getList, one, patch, post } from './http';

const projectPages = (project: string) => `/projects/${encodeURIComponent(project)}/pages`;
const pagePath = (id: string) => `/pages/${encodeURIComponent(id)}`;
const versionPath = (page_id: string, version_id: string) => `${pagePath(page_id)}/versions/${encodeURIComponent(version_id)}`;

/** The tree of a project (ULID or identifier): the top-level pages with their children, by rank, without text. */
export function listPages(project_id: string): Promise<Page<PageNode>> {
  return getList<PageNode>(projectPages(project_id));
}

export function getPage(id: string): Promise<WikiPage> {
  return one(get<{ data: WikiPage }>(pagePath(id)));
}

export interface CreatePageInput {
  project_id: string;
  parent_id?: string | null;
  title: string;
  emoji?: string | null;
  content?: RichText | null;
}

/** A new page at the end of its siblings; the uploads in its text become the page's. */
export function createPage(input: CreatePageInput): Promise<WikiPage> {
  return one(
    post<{ data: WikiPage }>(projectPages(input.project_id), {
      title: input.title,
      emoji: input.emoji ?? null,
      parent_id: input.parent_id ?? null,
      content_json: input.content ?? null,
    }),
  );
}

export interface SavePageInput {
  title: string;
  emoji: string | null;
  content: RichText | null;
  /** The version the text was edited on: an outdated one is refused with 409 `page_conflict`. */
  base_version: number;
  /** Keeps the stored state as a version before it is replaced, even within the pause ("Meine Fassung übernehmen"). */
  keep_current?: boolean;
}

/**
 * Saves a page. When somebody saved in the meantime (`base_version` is not the stored version) the answer is 409
 * `page_conflict` with `current`; saving again on top of `current.version` with `keep_current` takes the own text.
 * Nothing changed (title, emoji, text as stored): the page comes back as it is, with its version.
 */
export function savePage(id: string, input: SavePageInput): Promise<WikiPage> {
  const body: Record<string, unknown> = {
    title: input.title,
    emoji: input.emoji,
    content_json: input.content,
    base_version: input.base_version,
  };
  if (input.keep_current !== undefined) body.keep_current = input.keep_current;

  return one(patch<{ data: WikiPage }>(pagePath(id), body));
}

/** Moves a page with its subtree below `parent_id` (`null`: the top level), in front of `before_id` (`null`: last). */
export function movePage(id: string, parent_id: string | null, before_id: string | null): Promise<WikiPage> {
  return one(post<{ data: WikiPage }>(`${pagePath(id)}/move`, { parent_id, before_id }));
}

/** Deletes a page with its subtree, their versions and pictures; answers how many pages went. */
export function deletePage(id: string): Promise<{ deleted: number }> {
  return del<{ deleted: number }>(pagePath(id));
}

/** Every kept version of a page, the newest first, without their text (all pages of the list). */
export function listPageVersions(page_id: string): Promise<Page<PageVersion>> {
  return allPages((cursor) => getList<PageVersion>(`${pagePath(page_id)}/versions`, { cursor }));
}

/** One kept version with its text. */
export function getPageVersion(page_id: string, version_id: string): Promise<PageVersionDetail> {
  return one(get<{ data: PageVersionDetail }>(versionPath(page_id, version_id)));
}

/** Takes a kept version as the text of the page (a new version; the replaced state is kept first). */
export function restorePageVersion(page_id: string, version_id: string): Promise<WikiPage> {
  return one(post<{ data: WikiPage }>(`${versionPath(page_id, version_id)}/restore`));
}
