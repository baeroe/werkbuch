/*
 * How many items use something: a label, a type, a property. The filter engine counts them (the same one the views
 * use), so the number agrees with what a view would show. Archived items count too, because they keep what they had.
 * Undefined while the count loads; a screen that asks before an irreversible step waits for it.
 */

import { useWorkItems } from '@/hooks/workItems';
import type { Condition } from '@/types';

export function useItemCount(condition: Condition): number | undefined {
  const items = useWorkItems({ filter: { version: 1, conditions: [condition] }, include_archived: true, per_page: 1 });
  return items.data?.total;
}
