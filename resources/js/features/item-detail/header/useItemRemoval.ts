/*
 * Archive and delete from the header of the detail, with 5 s undo: the same two functions the item commands use
 * (`archiveWithUndo`, `deleteWithUndo` of components/fields/commands), so the logic exists once (K27). They take the
 * item out of every list and out of the preview at once; deleting from the item page leaves the page, undo comes back.
 */

import { archiveWithUndo, deleteWithUndo, useRemovalDeps } from '@/components/fields/commands';
import type { WorkItem } from '@/types';

export function useItemRemoval(item: WorkItem): { archive: () => void; remove: () => void } {
  const deps = useRemovalDeps();
  return { archive: () => archiveWithUndo(deps, item), remove: () => deleteWithUndo(deps, item) };
}
