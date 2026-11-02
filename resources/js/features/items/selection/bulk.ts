/*
 * The rules of a change to several items at once (spec 5.3), shared by the bulk bar and the item commands of a list:
 * how the items are named, the toast that tells what the server changed, refused and did not save, the states every
 * target knows, and the change itself (`useBulkChange`: blocks of 100, K25).
 */

import { reasonText } from '@/api/client';
import type { BulkPatch } from '@/api/workItems';
import { toast } from '@/components/ui/toast';
import { statesInOrder } from '@/domain/workflow';
import type { BulkOutcome, useBulkChange } from '@/hooks/workItems';
import { causeOf, isTransient } from '@/lib/errors';
import { intlLocale, t, tn } from '@/lib/i18n';
import type { BulkResult, ListedItem, State, Workflow } from '@/types';

export type BulkChange = ReturnType<typeof useBulkChange>;

/** "WEB-47" or "3 Items". */
export const subjectOf = (items: readonly Pick<ListedItem, 'key'>[]): string => (items.length === 1 ? items[0]!.key : tn('items.bulk.subject', items.length));

/** What the toast says the items became when some were refused: changed or archived. */
export type BulkDone = 'changed' | 'archived';

/**
 * The toast after a bulk change, one for all its blocks: what changed; each refused item by its key with the sentence
 * of its reason (`problem.reason.*`); and, when a block failed, how many were not saved, why, and "Erneut versuchen"
 * for all of them (`retry`, only when repeating can help). `done` is what the title says of the items when not all of
 * them changed: "2 von 3 Items geändert".
 */
export function bulkToast(items: readonly ListedItem[], outcome: BulkResult | BulkOutcome, what: string, done: BulkDone = 'changed', retry?: () => void): void {
  const unsaved = 'unsaved' in outcome ? outcome.unsaved : [];
  if (outcome.rejected.length === 0 && unsaved.length === 0) {
    toast({ title: t('items.commands.done', { key: subjectOf(items), what }), tone: 'success' });
    return;
  }
  const keyOf = (id: string) => items.find((item) => item.id === id)?.key ?? id;
  const participle = t(done === 'archived' ? 'items.bulk.done.archived' : 'items.bulk.done.changed');
  const count = new Intl.NumberFormat(intlLocale());
  const refused = outcome.rejected.map((entry) => `${keyOf(entry.id)}: ${reasonText(entry.reason)}`);
  if (unsaved.length > 0) {
    const error = (outcome as BulkOutcome).error;
    // nothing got through: the failure alone, as the mutation of one item says it
    const nothing = outcome.updated.length === 0 && outcome.rejected.length === 0;
    toast({
      title: nothing
        ? t(done === 'archived' ? 'items.failed.archive' : 'items.failed.bulk')
        : t('items.bulk.unsaved', {
            updated: count.format(outcome.updated.length),
            count: count.format(items.length),
            done: participle,
            unsaved: count.format(unsaved.length),
          }),
      description: [...refused, causeOf(error)].join(' '),
      tone: 'error',
      action: retry && isTransient(error) ? { label: t('common.retry'), onClick: retry } : undefined,
    });
    return;
  }
  toast({
    title:
      outcome.updated.length === 0
        ? tn('items.bulk.none', items.length, { key: items[0]?.key ?? '', done: participle })
        : t('items.bulk.some', { updated: count.format(outcome.updated.length), count: count.format(items.length), done: participle }),
    description: refused.join(' '),
    tone: outcome.updated.length === 0 ? 'error' : 'neutral',
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
 * Changes the items and says how it went (`bulkToast`); "Erneut versuchen" changes what was not saved, all of it. It
 * waits outside the life of the screen that asked: the bar may be gone before the answer (Esc during the request), and
 * the refused items must still be named.
 */
export async function bulkChange(bulk: BulkChange, items: readonly ListedItem[], patch: BulkPatch, what: string): Promise<void> {
  const outcome = await bulk.run(
    items.map((item) => item.id),
    patch,
  );
  const unsaved = items.filter((item) => outcome.unsaved.includes(item.id));
  bulkToast(items, outcome, what, 'changed', () => void bulkChange(bulk, unsaved, patch, what));
}
