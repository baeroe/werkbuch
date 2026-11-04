/*
 * The wiki of a project (`@/api/pages`), and `allPages` for every list the screens read to the end.
 *
 * The hooks have the names of the clickdummy. Every change waits for the server, then makes the tree, the versions and
 * the search stale (`PAGE_KEYS`). Two rules keep a page the screen shows from going wrong:
 * - A saved page goes into the cache only when it is at least as new as what is there (13c: a late answer of a save
 *   must not overwrite a newer page that loaded meanwhile, e.g. after a live message).
 * - Deleting a page takes the queries of its subtree out of the cache before the tree loads again, and marks the
 *   subtree as gone (`usePageGone`): `usePage`, `usePageVersions` and `usePageVersion` ask for a gone page no more,
 *   so a screen still showing it never reads a 404.
 */

import { useQuery, type Query, type QueryClient } from '@tanstack/react-query';
import type { Page } from '@/api/client';
import {
  createPage,
  deletePage,
  getPage,
  getPageVersion,
  listPages,
  listPageVersions,
  movePage,
  restorePageVersion,
  savePage,
  type SavePageInput,
} from '@/api/pages';
import { markLiveGone, usePageGone } from '@/lib/liveGone';
import type { PageNode, Page as WikiPage } from '@/types';
import { qk } from './keys';
import { useApiMutation } from './mutation';

export { allPages } from '@/api/client';

/** The page tree of a project (ULID or identifier; no text). */
export function usePages(projectId: string | null | undefined) {
  return useQuery({ queryKey: qk.pages.list({ project: projectId }), queryFn: () => listPages(projectId!), enabled: !!projectId });
}

/** A page with its text; nothing is asked for a page known to be deleted. */
export function usePage(id: string | null | undefined) {
  const gone = usePageGone(id);
  return useQuery({ queryKey: qk.pages.detail(id ?? ''), queryFn: () => getPage(id!), enabled: !!id && !gone });
}

const PAGE_KEYS = [qk.pages.all, qk.pageVersions.all, qk.search.all] as const;

/** Variables: `{ project_id, parent_id?, title, emoji?, content? }`; the page comes last among its siblings. */
export function useCreatePage() {
  return useApiMutation(createPage, PAGE_KEYS);
}

/**
 * Variables: `{ id, input: { title, emoji, content, base_version, keep_current? } }`. Refused with 409 `page_conflict`
 * when somebody saved in the meantime: `error.current` is the stored page; save again on top of its `version` (with
 * `keep_current` to keep it as a version) to take your text.
 */
export function useSavePage() {
  return useApiMutation(({ id, input }: { id: string; input: SavePageInput }) => savePage(id, input), PAGE_KEYS, {
    onSuccess: (page, { id }, queryClient) =>
      queryClient.setQueryData<WikiPage>(qk.pages.detail(id), (cached) => (cached && cached.version > page.version ? cached : page)),
  });
}

/** Variables: `{ id, parent_id, before_id }`. */
export function useMovePage() {
  return useApiMutation(
    ({ id, parent_id, before_id }: { id: string; parent_id: string | null; before_id: string | null }) => movePage(id, parent_id, before_id),
    PAGE_KEYS,
  );
}

/** The page and every page below it in the trees of the cache; the page alone when no tree names it. */
function subtreeOf(queryClient: QueryClient, id: string): Set<string> {
  const find = (nodes: PageNode[]): PageNode | undefined => {
    for (const node of nodes) {
      const hit = node.id === id ? node : find(node.children);
      if (hit) return hit;
    }
    return undefined;
  };
  const collect = (node: PageNode, into: Set<string>): Set<string> => {
    into.add(node.id);
    node.children.forEach((child) => collect(child, into));
    return into;
  };
  for (const [, tree] of queryClient.getQueriesData<Page<PageNode>>({ queryKey: [...qk.pages.all, 'list'] })) {
    const root = tree && find(tree.items);
    if (root) return collect(root, new Set());
  }
  return new Set([id]);
}

/** Whether a cached query is about one of `ids`: a page, the versions of one, or one of its versions. */
function aboutPages(query: Query, ids: Set<string>): boolean {
  const [, kind, arg] = query.queryKey as readonly unknown[];
  if (kind === 'detail') {
    const data = query.state.data as { page_id?: string } | undefined;
    return ids.has(arg as string) || (data?.page_id !== undefined && ids.has(data.page_id));
  }
  return kind === 'list' && typeof arg === 'object' && arg !== null && ids.has((arg as { page?: string }).page ?? '');
}

/**
 * Deletes a page with its subtree; the UI calls this when the undo toast has run out. Answers `{ deleted }`. The
 * subtree leaves the cache (detail, versions) and counts as gone before the tree loads again.
 */
export function useDeletePage() {
  return useApiMutation(deletePage, PAGE_KEYS, {
    onSuccess: (_answer, id, queryClient) => {
      const ids = subtreeOf(queryClient, id);
      ids.forEach((page) => markLiveGone(page, 'page'));
      const roots: unknown[] = [qk.pages.all[0], qk.pageVersions.all[0]];
      queryClient.removeQueries({ predicate: (query) => roots.includes(query.queryKey[0]) && aboutPages(query, ids) });
    },
  });
}

/** The kept versions of a page, the newest first, without their text. */
export function usePageVersions(pageId: string | null | undefined) {
  const gone = usePageGone(pageId);
  return useQuery({ queryKey: qk.pageVersions.list({ page: pageId }), queryFn: () => listPageVersions(pageId!), enabled: !!pageId && !gone });
}

/** One kept version with its text (A315). */
export function usePageVersion(pageId: string | null | undefined, versionId: string | null | undefined) {
  const gone = usePageGone(pageId);
  return useQuery({
    queryKey: qk.pageVersions.detail(versionId ?? ''),
    queryFn: () => getPageVersion(pageId!, versionId!),
    enabled: !!pageId && !!versionId && !gone,
  });
}

/** Variables: `{ page_id, version_id }`; answers the page in its new version. */
export function useRestorePageVersion() {
  return useApiMutation(
    ({ page_id, version_id }: { page_id: string; version_id: string }) => restorePageVersion(page_id, version_id),
    PAGE_KEYS,
  );
}
