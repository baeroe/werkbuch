import { useQuery } from '@tanstack/react-query';
import { deleteWorkItemType, listWorkItemTypes, saveWorkItemType } from '@/api/workItemTypes';
import { qk } from './keys';
import { useApiMutation } from './mutation';

/** All types, archived ones included (items of an archived type still show it). */
export function useWorkItemTypes() {
  return useQuery({ queryKey: qk.workItemTypes.all, queryFn: listWorkItemTypes });
}

export function useSaveWorkItemType() {
  return useApiMutation(saveWorkItemType, [qk.workItemTypes.all]);
}

/** Answers `{ outcome: 'deleted' | 'archived' }`: a type with items is archived. */
export function useDeleteWorkItemType() {
  return useApiMutation(deleteWorkItemType, [qk.workItemTypes.all, qk.projects.all]);
}
