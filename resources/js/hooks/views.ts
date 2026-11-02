import { useQuery } from '@tanstack/react-query';
import { deleteView, getView, listFavorites, listViews, saveView, toggleFavorite } from '@/api/views';
import { qk, type HookOptions } from './keys';
import { useApiMutation } from './mutation';
import { allPages } from './pages';

/** Every team view (all pages): the overview and the sidebar show them all. */
export function useViews() {
  return useQuery({ queryKey: qk.views.list({ pages: 'all' }), queryFn: () => allPages((cursor) => listViews({ cursor })) });
}

/** One view by id; waits without one. */
export function useView(id: string | null | undefined, options: HookOptions = {}) {
  return useQuery({ queryKey: qk.views.detail(id ?? ''), queryFn: () => getView(id!), enabled: !!id && options.enabled !== false });
}

/** Creates a view (no `id`) or replaces one; answers the saved view. The sidebar names it, so favorites follow. */
export function useSaveView() {
  return useApiMutation(saveView, [qk.views.all, qk.favorites.all]);
}

/** Deletes a view; the server takes it out of every sidebar. Variable: the view id. */
export function useDeleteView() {
  return useApiMutation(deleteView, [qk.views.all, qk.favorites.all]);
}

/** The favorites of the signed-in person: views and projects, in the order of the sidebar. */
export function useFavorites() {
  return useQuery({ queryKey: qk.favorites.all, queryFn: listFavorites });
}

/** Variables: `{ kind: 'view' | 'project', id }`. */
export function useToggleFavorite() {
  return useApiMutation(toggleFavorite, [qk.favorites.all]);
}
