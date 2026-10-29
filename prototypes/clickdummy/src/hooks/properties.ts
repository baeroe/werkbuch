import { useQuery } from '@tanstack/react-query';
import { deleteProperty, listProperties, saveProperty } from '@/api/properties';
import { qk } from './keys';
import { useApiMutation } from './mutation';

export function useProperties() {
  return useQuery({ queryKey: qk.properties.all, queryFn: listProperties });
}

export function useSaveProperty() {
  return useApiMutation(saveProperty, [qk.properties.all]);
}

/** Answers `{ affected_items }`: their values for the property are gone. */
export function useDeleteProperty() {
  return useApiMutation(deleteProperty, [qk.properties.all, qk.workItemTypes.all, qk.workItems.all, qk.views.all, qk.templates.all]);
}
