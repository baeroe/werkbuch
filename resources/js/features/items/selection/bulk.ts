/*
 * The rules of a change to several items at once (spec 5.3), shared by the bulk bar and the item commands of a list:
 * how the items are named, the toast that names what the server refused, the states every target knows, and the bulk
 * call itself in blocks of 100 (K25: the server takes at most 100 ids per call).
 */

import { reasonText } from '@/api/client';
import type { BulkPatch } from '@/api/workItems';
import { toast } from '@/components/ui/toast';
import { statesInOrder } from '@/domain/workflow';
import type { useBulkUpdateWorkItems } from '@/hooks/workItems';
import { intlLocale, t, tn } from '@/lib/i18n';
import type { BulkResult, ListedItem, State, Workflow } from '@/types';

/** How many ids one bulk call takes (`BulkUpdateWorkItems::MAX_IDS`). */
export const BULK_MAX = 100;

export type BulkMutation = ReturnType<typeof useBulkUpdateWorkItems>;

/** "WEB-47" or "3 Items". */
export const subjectOf = (items: readonly Pick<ListedItem, 'key'>[]): string => (items.length === 1 ? items[0]!.key : tn('items.bulk.subject', items.length));

/** What the toast says the items became when some were refused: changed or archived. */
export type BulkDone = 'changed' | 'archived';

/**
 * The toast after a bulk change: what changed, and each refused item by its key with the sentence of its reason
 * (`problem.reason.*`). `done` is what the title says of them when some were refused: "2 von 3 Items geändert".
 */
export function bulkToast(items: readonly ListedItem[], result: BulkResult, what: string, done: BulkDone = 'changed'): void {
  if (result.rejected.length === 0) {
    toast({ title: t('items.commands.done', { key: subjectOf(items), what }), tone: 'success' });
    return;
  }
  const keyOf = (id: string) => items.find((item) => item.id === id)?.key ?? id;
  const participle = t(done === 'archived' ? 'items.bulk.done.archived' : 'items.bulk.done.changed');
  const count = new Intl.NumberFormat(intlLocale());
  toast({
    title:
      result.updated.length === 0
        ? tn('items.bulk.none', items.length, { key: items[0]?.key ?? '', done: participle })
        : t('items.bulk.some', { updated: count.format(result.updated.length), count: count.format(items.length), done: participle }),
    description: result.rejected.map((entry) => `${keyOf(entry.id)}: ${reasonText(entry.reason)}`).join(' '),
    tone: result.updated.length === 0 ? 'error' : 'neutral',
    duration: 8000,
  });
}

/**
 * The states every target can move to: those every workflow of the targets has (A128, P29). A state belongs to one
 * workflow, so targets of different workflows share none; `workflowOf` finds the workflow of a target's project.
 */
export function commonStates(targets: readonly ListedItem[], workflowOf: (item: ListedItem) => Workflow | undefined): State[] {
  const workflows = targets.map(workflowOf);
  const [first] = workflows;
  if (!first || workflows.some((workflow) => workflow === undefined)) return [];
  return statesInOrder(first).filter((state) => workflows.every((workflow) => workflow!.states.some((other) => other.id === state.id)));
}

/**
 * One change to many items, in blocks of 100 one after the other; answers what the server changed and refused, all
 * blocks together. A block that fails stops the rest: the mutation says so in its own toast.
 */
export async function changeMany(bulk: BulkMutation, ids: readonly string[], patch: BulkPatch): Promise<BulkResult> {
  const result: BulkResult = { updated: [], rejected: [] };
  for (let from = 0; from < ids.length; from += BULK_MAX) {
    const block = await bulk.mutateAsync({ ids: ids.slice(from, from + BULK_MAX), patch });
    result.updated.push(...block.updated);
    result.rejected.push(...block.rejected);
  }
  return result;
}

/**
 * Changes the items and says how it went (`bulkToast`). It waits outside the life of the screen that asked: the bar may
 * be gone before the answer (Esc during the request), and the refused items must still be named.
 */
export async function bulkChange(bulk: BulkMutation, items: readonly ListedItem[], patch: BulkPatch, what: string): Promise<void> {
  try {
    bulkToast(items, await changeMany(bulk, items.map((item) => item.id), patch), what);
  } catch {
    // the mutation says what failed itself, with "Erneut versuchen"
  }
}
