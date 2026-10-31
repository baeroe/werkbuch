import { useQuery } from '@tanstack/react-query';
import { listFavorites, toggleFavorite } from '@/api/views';
import { qk } from './keys';
import { useApiMutation } from './mutation';

/** The favorites of the signed-in person: projects (views from Phase 5), in the order of the sidebar. */
export function useFavorites() {
  return useQuery({ queryKey: qk.favorites.all, queryFn: listFavorites });
}

/** Variables: `{ kind: 'view' | 'project', id }`. */
export function useToggleFavorite() {
  return useApiMutation(toggleFavorite, [qk.favorites.all]);
}
