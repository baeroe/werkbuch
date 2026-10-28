import { useQuery } from '@tanstack/react-query';
import {
  deleteLabel,
  deleteRelationType,
  deleteResolution,
  listLabels,
  listRelationTypes,
  listResolutions,
  saveLabel,
  saveRelationType,
  saveResolution,
} from '@/api/catalog';
import { qk } from './keys';
import { useApiMutation } from './mutation';

export function useLabels() {
  return useQuery({ queryKey: qk.labels.all, queryFn: listLabels });
}

export function useSaveLabel() {
  return useApiMutation(saveLabel, [qk.labels.all]);
}

/** Answers `{ affected_items }`. */
export function useDeleteLabel() {
  return useApiMutation(deleteLabel, [qk.labels.all, qk.workItems.all, qk.templates.all]);
}

export function useRelationTypes() {
  return useQuery({ queryKey: qk.relationTypes.all, queryFn: listRelationTypes });
}

export function useSaveRelationType() {
  return useApiMutation(saveRelationType, [qk.relationTypes.all, qk.workItems.all]);
}

/** Answers `{ affected_relations }`; the built-in types cannot be deleted (409 `built_in`). */
export function useDeleteRelationType() {
  return useApiMutation(deleteRelationType, [qk.relationTypes.all, qk.workItems.all]);
}

/** All resolutions, archived ones included. */
export function useResolutions() {
  return useQuery({ queryKey: qk.resolutions.all, queryFn: listResolutions });
}

export function useSaveResolution() {
  return useApiMutation(saveResolution, [qk.resolutions.all]);
}

/** Answers `{ outcome: 'deleted' | 'archived' }`. */
export function useDeleteResolution() {
  return useApiMutation(deleteResolution, [qk.resolutions.all]);
}
