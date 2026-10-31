import { useQuery } from '@tanstack/react-query';
import { deleteProperty, listProperties, saveProperty } from '@/api/properties';
import { qk } from './keys';
import { useApiMutation } from './mutation';
import { allPages } from './pages';

/** Every property, all pages: pickers and the type editor need the whole catalog. */
export function useProperties() {
  return useQuery({ queryKey: qk.properties.all, queryFn: () => allPages((cursor) => listProperties({ cursor })) });
}

export function useSaveProperty() {
  return useApiMutation(saveProperty, [qk.properties.all]);
}

/** Answers `{ affected_items }`; the types lose the property, so they reload as well. */
export function useDeleteProperty() {
  return useApiMutation(deleteProperty, [qk.properties.all, qk.workItemTypes.all]);
}
