import { addRelation, removeRelation } from '@/api/relations';
import { qk } from './keys';
import { useApiMutation } from './mutation';

const RELATION_KEYS = [qk.workItems.all, qk.activity.all] as const;

/** Variables: `{ source_id, type_id, target_id }`: the source "blockiert" the target. */
export function useAddRelation() {
  return useApiMutation(
    ({ source_id, type_id, target_id }: { source_id: string; type_id: string; target_id: string }) => addRelation(source_id, type_id, target_id),
    RELATION_KEYS,
  );
}

/** Variable: the relation id. */
export function useRemoveRelation() {
  return useApiMutation(removeRelation, RELATION_KEYS);
}
