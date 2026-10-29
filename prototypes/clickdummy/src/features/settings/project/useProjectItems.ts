import { useWorkItems } from '@/hooks/workItems';
import type { Filter } from '@/types';

/**
 * Every item of a project, archived ones included: what its settings need to know about (items per state for the
 * workflow switch, items per type for the type list). One page of up to 100 items, which is what the prototype holds.
 */
export function useProjectItems(projectId: string) {
  const filter: Filter = { version: 1, conditions: [{ field: 'project', op: 'is', value: projectId }] };
  return useWorkItems({ filter, include_archived: true });
}
