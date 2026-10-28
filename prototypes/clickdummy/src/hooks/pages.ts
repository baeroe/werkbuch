import { useQuery } from '@tanstack/react-query';
import {
  createPage,
  deletePage,
  getPage,
  listPages,
  listPageVersions,
  movePage,
  restorePageVersion,
  savePage,
  type SavePageInput,
} from '@/api/pages';
import { qk } from './keys';
import { useApiMutation } from './mutation';

/** The page tree of a project (no content). */
export function usePages(projectId: string | null | undefined) {
  return useQuery({ queryKey: qk.pages.list({ project: projectId }), queryFn: () => listPages(projectId!), enabled: !!projectId });
}

export function usePage(id: string | null | undefined) {
  return useQuery({ queryKey: qk.pages.detail(id ?? ''), queryFn: () => getPage(id!), enabled: !!id });
}

const PAGE_KEYS = [qk.pages.all, qk.pageVersions.all, qk.search.all] as const;

export function useCreatePage() {
  return useApiMutation(createPage, PAGE_KEYS);
}

/**
 * Variables: `{ id, input: { title, emoji, content, base_version } }`. Refused with 409 `page_conflict` when somebody
 * saved in the meantime: `error.current` is the stored page; save again on top of its `version` to take your text.
 */
export function useSavePage() {
  return useApiMutation(({ id, input }: { id: string; input: SavePageInput }) => savePage(id, input), PAGE_KEYS);
}

/** Variables: `{ id, parent_id, before_id }`. */
export function useMovePage() {
  return useApiMutation(
    ({ id, parent_id, before_id }: { id: string; parent_id: string | null; before_id: string | null }) => movePage(id, parent_id, before_id),
    PAGE_KEYS,
  );
}

/** Deletes a page with its subtree; the UI calls this when the undo toast has run out. Answers `{ deleted }`. */
export function useDeletePage() {
  return useApiMutation(deletePage, PAGE_KEYS);
}

export function usePageVersions(pageId: string | null | undefined) {
  return useQuery({ queryKey: qk.pageVersions.list({ page: pageId }), queryFn: () => listPageVersions(pageId!), enabled: !!pageId });
}

/** Variables: `{ page_id, version_id }`. */
export function useRestorePageVersion() {
  return useApiMutation(
    ({ page_id, version_id }: { page_id: string; version_id: string }) => restorePageVersion(page_id, version_id),
    PAGE_KEYS,
  );
}
