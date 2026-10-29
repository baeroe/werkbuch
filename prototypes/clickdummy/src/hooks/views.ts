import { useQuery } from '@tanstack/react-query';
import { deleteView, listFavorites, listViews, saveView, toggleFavorite } from '@/api/views';
import { qk } from './keys';
import { useApiMutation } from './mutation';

/** All team views. */
export function useViews() {
  return useQuery({ queryKey: qk.views.all, queryFn: listViews });
}

/** Creates a view (no `id`) or changes one; answers the saved view. */
export function useSaveView() {
  return useApiMutation(saveView, [qk.views.all]);
}

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
