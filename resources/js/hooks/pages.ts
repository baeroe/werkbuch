/*
 * The wiki of a project (`@/api/pages`), and `allPages` for every list the screens read to the end.
 *
 * The hooks have the names of the clickdummy. Every change waits for the server, then makes the tree, the versions,
 * the search and the references stale (`PAGE_KEYS`: a reference shows the title of its page, and this tab does not
 * hear its own changes live, A282). Two rules keep a page the screen shows from going wrong:
 * - A saved page goes into the cache only when it is at least as new as what is there (13c: a late answer of a save
 *   must not overwrite a newer page that loaded meanwhile, e.g. after a live message).
 * - Deleting a page takes the queries of its subtree out of the cache before the tree loads again, and marks the
 *   subtree as gone (`usePageGone`): `usePage`, `usePageVersions` and `usePageVersion` ask for a gone page no more,
 *   so a screen still showing it never reads a 404. The subtree is what the caller names, what the cached trees hold
 *   below the page, and every cached page of the project the tree on the server holds no more (`goneFromTree`): a
 *   screen may have taken the subtree out of its tree already (the undo toast of a delete, `withoutPages`).
 */

import { useQuery, useQueryClient, type Query, type QueryClient } from '@tanstack/react-query';
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
import { drafts, pageDraft } from '@/lib/drafts';
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

const PAGE_KEYS = [qk.pages.all, qk.pageVersions.all, qk.search.all, qk.references.all] as const;

/** Every page of a tree. */
export function treeIds(nodes: readonly PageNode[], into = new Set<string>()): Set<string> {
  for (const node of nodes) {
    into.add(node.id);
    treeIds(node.children, into);
  }
  return into;
}

/**
 * The pages of a project the cache knows that its tree on the server holds no more: deleted (with `useDeletePage`
 * here, or by somebody else when a live message could not name them all). The cached trees of the project (by the
 * project in the key, or the pages in the answer: a screen may name it by its identifier) and the cached pages of the
 * project tell which there were, as they stand before the read: a page that comes into the cache while the tree is
 * read (just created, a live message) may be missing from a tree read before it. The tree is read past the cache, so
 * no answer a screen shows is replaced; a tree that cannot be read takes nothing as gone.
 */
export async function goneFromTree(queryClient: QueryClient, project: string): Promise<string[]> {
  // what the cache knows before the read: a page that comes into it meanwhile may be newer than the tree that is read
  const known = new Set<string>();
  const cache = queryClient.getQueryCache();
  for (const query of cache.findAll({ queryKey: [...qk.pages.all, 'list'] })) {
    const nodes = (query.state.data as Page<PageNode> | undefined)?.items ?? [];
    if ((query.queryKey[2] as { project?: unknown } | undefined)?.project === project || nodes.some((node) => node.project_id === project)) treeIds(nodes, known);
  }
  for (const query of cache.findAll({ queryKey: [...qk.pages.all, 'detail'] })) {
    const page = query.state.data as { id?: string; project_id?: string } | undefined;
    if (page?.id !== undefined && page.project_id === project) known.add(page.id);
  }
  let fresh: Set<string>;
  try {
    fresh = treeIds((await listPages(project)).items);
  } catch {
    return [];
  }
  return [...known].filter((id) => !fresh.has(id));
}

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

/** The project of a page as the cache knows it: its detail, or a tree that holds it. */
function projectOf(queryClient: QueryClient, id: string): string | undefined {
  const detail = queryClient.getQueryData<WikiPage>(qk.pages.detail(id));
  if (detail) return detail.project_id;
  for (const [, tree] of queryClient.getQueriesData<Page<PageNode>>({ queryKey: [...qk.pages.all, 'list'] })) {
    const nodes = tree?.items ?? [];
    if (treeIds(nodes).has(id)) return nodes[0]!.project_id;
  }
  return undefined;
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

export interface DeletePageVars {
  id: string;
  /** The project of the page, when the cache may not know it any more. */
  project_id?: string;
  /** The page and its subtree as the screen knew it before it took them out of its tree (the undo toast). */
  subtree?: readonly string[];
}

/**
 * Deletes a page with its subtree; the UI calls this when the undo toast has run out. Variable: the page id, or
 * `{ id, project_id?, subtree? }`. Answers `{ deleted }`. Before the tree loads again, the subtree counts as gone and
 * leaves the cache (detail, versions): what the variables name, what the cached trees hold below the page, and every
 * cached page of the project the tree on the server holds no more (read once more past the cache, `goneFromTree`).
 * The drafts (`page:<id>`) of the subtree it deleted go too; those of pages only `goneFromTree` found stay.
 */
export function useDeletePage() {
  const queryClient = useQueryClient();
  return useApiMutation(
    async (vars: string | DeletePageVars) => {
      const { id, project_id, subtree = [] } = typeof vars === 'string' ? { id: vars } : vars;
      const project = project_id ?? projectOf(queryClient, id);
      const answer = await deletePage(id);
      const deleted = new Set([id, ...subtree, ...subtreeOf(queryClient, id)]);
      const ids = new Set(deleted);
      if (project !== undefined) (await goneFromTree(queryClient, project)).forEach((page) => ids.add(page));
      forget(queryClient, ids);
      // the text this person kept on the pages they deleted goes with them (their own decision, T16-M1); a page someone
      // else deleted keeps its draft as a parked text (`ParkedDraft`)
      deleted.forEach((page) => drafts.setPage(pageDraft(page), null));
      return answer;
    },
    PAGE_KEYS,
  );
}

/** Marks deleted pages as gone and takes their queries (detail, versions) out of the cache. */
function forget(queryClient: QueryClient, ids: Set<string>): void {
  const roots: unknown[] = [qk.pages.all[0], qk.pageVersions.all[0]];
  ids.forEach((page) => markLiveGone(page, 'page'));
  queryClient.removeQueries({ predicate: (query) => roots.includes(query.queryKey[0]) && aboutPages(query, ids) });
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

/**
 * Variables: `{ page_id, version_id }`; answers the page in its new version, which goes into the cache like a save's
 * (only when at least as new): the open page shows the restored text at once.
 */
export function useRestorePageVersion() {
  return useApiMutation(
    ({ page_id, version_id }: { page_id: string; version_id: string }) => restorePageVersion(page_id, version_id),
    PAGE_KEYS,
    {
      onSuccess: (page, { page_id }, queryClient) =>
        queryClient.setQueryData<WikiPage>(qk.pages.detail(page_id), (cached) => (cached && cached.version > page.version ? cached : page)),
    },
  );
}
