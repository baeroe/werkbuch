import { useQuery } from '@tanstack/react-query';
import { deleteWorkItemType, listWorkItemTypes, saveWorkItemType } from '@/api/workItemTypes';
import { qk } from './keys';
import { useApiMutation } from './mutation';
import { allPages } from './pages';

/** Every type of every page, archived ones included (items of an archived type still show it). */
export function useWorkItemTypes() {
  return useQuery({ queryKey: qk.workItemTypes.all, queryFn: () => allPages((cursor) => listWorkItemTypes({ cursor })) });
}

export function useSaveWorkItemType() {
  return useApiMutation(saveWorkItemType, [qk.workItemTypes.all]);
}

/**
 * Answers `CatalogDeleteOutcome`: a type that items carry is archived instead, and they keep it. The projects reload
 * because they drop a deleted type from their settings.
 */
export function useDeleteWorkItemType() {
  return useApiMutation(deleteWorkItemType, [qk.workItemTypes.all, qk.projects.all]);
}
