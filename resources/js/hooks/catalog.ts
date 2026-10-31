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
import { allPages } from './pages';

/** Every label, all pages. */
export function useLabels() {
  return useQuery({ queryKey: qk.labels.all, queryFn: () => allPages((cursor) => listLabels({ cursor })) });
}

export function useSaveLabel() {
  return useApiMutation(saveLabel, [qk.labels.all]);
}

/** Answers `{ affected_items }`. */
export function useDeleteLabel() {
  return useApiMutation(deleteLabel, [qk.labels.all]);
}

/** Every relation type, all pages. */
export function useRelationTypes() {
  return useQuery({ queryKey: qk.relationTypes.all, queryFn: () => allPages((cursor) => listRelationTypes({ cursor })) });
}

export function useSaveRelationType() {
  return useApiMutation(saveRelationType, [qk.relationTypes.all]);
}

/** Answers `{ affected_relations }`; the built-in types cannot be deleted (409 `built_in`). */
export function useDeleteRelationType() {
  return useApiMutation(deleteRelationType, [qk.relationTypes.all]);
}

/** Every resolution, all pages, archived ones included. */
export function useResolutions() {
  return useQuery({ queryKey: qk.resolutions.all, queryFn: () => allPages((cursor) => listResolutions({ cursor })) });
}

export function useSaveResolution() {
  return useApiMutation(saveResolution, [qk.resolutions.all]);
}

/** Answers `{ outcome: 'deleted' | 'archived' }`. */
export function useDeleteResolution() {
  return useApiMutation(deleteResolution, [qk.resolutions.all]);
}
