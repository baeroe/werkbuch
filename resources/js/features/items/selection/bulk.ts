/*
 * The rules of a change to several items at once (spec 5.3), shared by the bulk bar and the item commands of a list:
 * whether an action does the same allowed thing to every item (A198), how the items are named, the toast that tells
 * what the server changed, refused and did not save, the states every target knows, and the change itself
 * (`useBulkChange`: blocks of 100, K25).
 */

import { reasonText } from '@/api/client';
import type { BulkPatch } from '@/api/workItems';
import { archivedReason } from '@/components/fields/itemData';
import { toast } from '@/components/ui/toast';
import { statesInOrder } from '@/domain/workflow';
import type { BulkOutcome, useBulkChange } from '@/hooks/workItems';
import { causeOf, isTransient } from '@/lib/errors';
import { intlLocale, t, tn } from '@/lib/i18n';
import type { Permission } from '@/lib/permissions';
import type { BulkResult, ListedItem, State, Workflow } from '@/types';

export type BulkChange = ReturnType<typeof useBulkChange>;

/** "WEB-47" or "3 Items". */
export const subjectOf = (items: readonly Pick<ListedItem, 'key'>[]): string => (items.length === 1 ? items[0]!.key : tn('items.bulk.subject', items.length));

/* ------------------------------------------------------------- one action for all (A198) */

/** What an action of the bar or the item commands does: change fields, archive, delete. */
export type SelectionAction = 'edit' | 'archive' | 'delete';

/** What the verdicts read: the person's rights in a project (`usePermissions().reason`), and whether an item is closed. */
export interface SelectionRules {
  reason: (permission: Permission, projectId: string) => string | null;
  isClosed: (item: ListedItem) => boolean;
}

/**
 * Why the action cannot run on the items, or null when it does the same allowed thing to each of them. `mixed`: it is
 * allowed for some and not for others; the bar leaves the action out then, the palette too, and a key says why. When
 * it is allowed for none, the reason is that of the first item, as for one item alone.
 */
export type SelectionVerdict = { reason: string; mixed: boolean } | null;

/** Why the action is not allowed for one item: archived (deleting takes those), a missing right, an open item to archive. */
function itemDenied(item: ListedItem, action: SelectionAction, rules: SelectionRules): string | null {
  if (action === 'delete') return rules.reason('item.delete', item.project_id);
  if (item.archived_at !== null) return archivedReason(item.key);
  const denied = rules.reason('item.edit', item.project_id);
  if (denied) return denied;
  return action === 'archive' && !rules.isClosed(item) ? t('items.bulk.archive_open') : null;
}

/**
 * Whether the action does the same allowed thing to every item (A198): a change only when each item may be changed (not
 * archived, the right `item.edit`, its project not archived), archiving only when each is closed as well, deleting only
 * when the right `item.delete` holds for each. Never a part of them: the server would refuse the rest.
 */
export function selectionVerdict(items: readonly ListedItem[], action: SelectionAction, rules: SelectionRules): SelectionVerdict {
  const denied = items.map((item) => itemDenied(item, action, rules)).filter((reason): reason is string => reason !== null);
  if (denied.length === 0) return null;
  if (denied.length === items.length) return { reason: denied[0]!, mixed: false };
  const count = new Intl.NumberFormat(intlLocale());
  return { reason: t('items.selection.mixed', { count: count.format(denied.length), total: count.format(items.length), reason: denied[0]! }), mixed: true };
}

/** What `mod+backspace` does: archive or delete. */
export type RemovalEffect = 'archive' | 'delete';

/** The kinds of items `mod+backspace` tells apart: it archives a closed one and deletes an open or an archived one. */
const REMOVAL_KINDS = { open: 'delete', closed: 'archive', archived: 'delete' } as const satisfies Record<string, RemovalEffect>;
type RemovalKind = keyof typeof REMOVAL_KINDS;

const kindOf = (item: ListedItem, rules: SelectionRules): RemovalKind => (item.archived_at !== null ? 'archived' : rules.isClosed(item) ? 'closed' : 'open');

/**
 * The one thing `mod+backspace` does to all the items: only when they are all of one kind (all open, all closed or all
 * archived); null for a mix, or for none. Deleting an archived item and an open one at once is a mix too (A198).
 */
export function commonRemoval(items: readonly ListedItem[], rules: SelectionRules): RemovalEffect | null {
  const kinds = new Set(items.map((item) => kindOf(item, rules)));
  return kinds.size === 1 ? REMOVAL_KINDS[[...kinds][0]!] : null;
}

/**
 * What `mod+backspace` does to the items: what it does to each of them alone, when they are all of one kind and it is
 * allowed for all (`selectionVerdict`); otherwise why it does nothing (T15-M3: an archived item among closed ones made
 * it delete them all). One item is as it ever was.
 */
export function removalVerdict(items: readonly ListedItem[], rules: SelectionRules): { effect: RemovalEffect } | { reason: string } {
  const effect = commonRemoval(items, rules);
  if (effect === null) {
    const kinds = (Object.keys(REMOVAL_KINDS) as RemovalKind[])
      .map((kind) => [kind, items.filter((item) => kindOf(item, rules) === kind).length] as const)
      .filter(([, count]) => count > 0)
      .map(([kind, count]) => tn(`items.selection.kind.${kind}`, count));
    return { reason: t('items.selection.mixed_removal', { kinds: new Intl.ListFormat(intlLocale(), { type: 'conjunction' }).format(kinds) }) };
  }
  const verdict = selectionVerdict(items, effect, rules);
  return verdict ? { reason: verdict.reason } : { effect };
}

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
