/*
 * What the item commands do: one change with its confirmation (`apply`), and archiving or deleting with 5 s undo
 * (spec 5.1). Archiving and deleting take the items out of every cached list, out of the preview and out of the
 * selection at once; the call itself runs when the undo toast runs out. Deleting the item whose page is on screen leaves
 * the page as well. The item page's header (`useItemRemoval`) uses the same functions, so the logic exists once (K27).
 *
 * Several targets (the selection of a list) change with one bulk edit (`bulkUpdateWorkItems`, in blocks of 100, K25)
 * whose toast names the refused items; they are archived the same way, and deleted item by item.
 */

import { router } from '@inertiajs/react';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import type { Page } from '@/api/client';
import type { BulkPatch } from '@/api/workItems';
import { toast } from '@/components/ui/toast';
import { bulkChange, bulkToast, changeMany, subjectOf } from '@/features/items/selection/bulk';
import { qk } from '@/hooks/keys';
import { useArchiveWorkItem, useBulkUpdateWorkItems, useDeleteWorkItem } from '@/hooks/workItems';
import { notifyError } from '@/lib/errors';
import { t } from '@/lib/i18n';
import { paths } from '@/lib/links';
import { runWithUndo } from '@/lib/undo';
import { useUiStore } from '@/store/ui';
import type { ListedItem } from '@/types';
import type { ItemCommandContext } from './context';

/** Confirms a change once the server agreed: "WEB-47: Priorität High". */
const done = (item: ListedItem, what: string) => toast({ title: t('items.commands.done', { key: item.key, what }), tone: 'success' });

/**
 * Changes the targets and confirms it in a toast saying `what`: one target with its own mutation (optimistic: a refusal
 * brings the old state back with a toast of the hook), several with one bulk edit of `patch`, whose toast also names
 * what each item's rules refused.
 */
export function apply(ctx: ItemCommandContext, what: string, change: (item: ListedItem) => Promise<unknown>, patch: BulkPatch): void {
  const { targets } = ctx;
  if (targets.length > 1) {
    void bulkChange(ctx.removal.bulk, targets, patch, what);
    return;
  }
  const [item] = targets as [ListedItem];
  ctx.settle(change(item), { onSuccess: () => done(item, what) });
}

/* ----------------------------------------------------------------------- archive, delete */

/** What archiving and deleting need; `useRemovalDeps` gives it. */
export interface RemovalDeps {
  queryClient: QueryClient;
  archive: ReturnType<typeof useArchiveWorkItem>;
  remove: ReturnType<typeof useDeleteWorkItem>;
  bulk: ReturnType<typeof useBulkUpdateWorkItems>;
}

export function useRemovalDeps(): RemovalDeps {
  return { queryClient: useQueryClient(), archive: useArchiveWorkItem(), remove: useDeleteWorkItem(), bulk: useBulkUpdateWorkItems() };
}

const isPage = (data: unknown): data is Page<ListedItem> => typeof data === 'object' && data !== null && Array.isArray((data as Page<ListedItem>).items);

/**
 * Takes the items out of every cached list at once, out of the preview and out of the selection. Answers `restore`,
 * which puts the named items (all by default) back where they were (undo, or a call that failed or was refused) and
 * loads the lists again.
 */
function hideAtOnce(queryClient: QueryClient, items: readonly ListedItem[]): (back?: readonly string[]) => void {
  const ids = new Set(items.map((item) => item.id));
  const listKey = [...qk.workItems.all, 'list'];
  const before = queryClient
    .getQueriesData<unknown>({ queryKey: listKey })
    .filter((entry): entry is [readonly unknown[], Page<ListedItem>] => isPage(entry[1]) && entry[1].items.some((item) => ids.has(item.id)));
  for (const [key, page] of before) {
    const kept = page.items.filter((item) => !ids.has(item.id));
    queryClient.setQueryData(key, { ...page, items: kept, total: Math.max(0, page.total - (page.items.length - kept.length)) });
  }
  const ui = useUiStore.getState();
  if (items.some((item) => ui.peekItemId === item.id || ui.peekItemId === item.key)) ui.openPeek(null);
  if (ui.selection.some((id) => ids.has(id))) ui.setSelection(ui.selection.filter((id) => !ids.has(id)));

  return (back = [...ids]) => {
    for (const [key, snapshot] of before) {
      queryClient.setQueryData(key, (current: unknown) => {
        if (!isPage(current)) return current;
        const items = [...current.items];
        snapshot.items.forEach((entry, index) => {
          if (!back.includes(entry.id) || items.some((item) => item.id === entry.id)) return;
          // back in its place among the items that are there
          const after = snapshot.items.slice(index + 1).find((later) => items.some((item) => item.id === later.id));
          items.splice(after ? items.findIndex((item) => item.id === after.id) : items.length, 0, entry);
        });
        return items.length === current.items.length ? current : { ...current, items, total: current.total + items.length - current.items.length };
      });
    }
    // the server has the last word (a failed reload keeps what is shown)
    void queryClient.invalidateQueries({ queryKey: qk.workItems.all });
  };
}

/** Archives a closed item with 5 s undo. A failure brings it back on screen (the mutation's own toast says why). */
export function archiveWithUndo(deps: RemovalDeps, item: ListedItem): void {
  const restore = hideAtOnce(deps.queryClient, [item]);
  runWithUndo({
    label: t('items.commands.archived', { key: item.key }),
    undo: () => restore(),
    run: () => deps.archive.mutateAsync(item.id).catch(() => restore()),
  });
}

/**
 * Archives several items with 5 s undo: the closed ones leave the screen at once, the open ones stay. When the time is
 * up, one bulk edit archives them all; what the server refuses (an open item: `not_closed`) comes back on screen and
 * the toast names it. A failure brings every closed one back (the mutation's own toast says why).
 */
export function archiveManyWithUndo(deps: RemovalDeps, targets: readonly ListedItem[], closed: readonly ListedItem[]): void {
  const restore = hideAtOnce(deps.queryClient, closed);
  runWithUndo({
    label: t('items.commands.archived', { key: subjectOf(closed) }),
    undo: () => restore(),
    run: async () => {
      try {
        const result = await changeMany(
          deps.bulk,
          targets.map((item) => item.id),
          { archived: true },
        );
        if (result.rejected.length === 0) return;
        restore(result.rejected.map((entry) => entry.id));
        bulkToast(targets, result, t('items.bulk.what.archived'), 'archived');
      } catch {
        restore();
      }
    },
  });
}

/** Archives the targets: one alone, several with the closed ones (`closed`) leaving the screen at once. */
export function archiveTargets(deps: RemovalDeps, targets: readonly ListedItem[], closed: readonly ListedItem[]): void {
  if (targets.length === 1) archiveWithUndo(deps, targets[0]!);
  else archiveManyWithUndo(deps, targets, closed);
}

/**
 * Deleting the item whose page is on screen leaves the page for My items (its project's page comes with Phase 5), in
 * place of the page, so Back does not lead to an item that is gone. Answers the way back (undo, a failed delete), taken
 * only while the person is still where the delete sent them.
 */
function leavePage(item: ListedItem): () => void {
  if (window.location.pathname !== paths.item(item.key)) return () => {};
  router.visit(paths.myItems(), { replace: true });
  return () => {
    // in place of My items as well: the history reads as before the delete, Back leads where the person came from
    if (window.location.pathname === paths.myItems()) router.visit(paths.item(item.key), { replace: true });
  };
}

/** Takes the item off the screen: out of the lists and the preview, and off its page. Answers how to put it back. */
function takeAway(deps: RemovalDeps, item: ListedItem): () => void {
  const restore = hideAtOnce(deps.queryClient, [item]);
  const back = leavePage(item);
  return () => {
    restore();
    back();
  };
}

/** Deletes an item with 5 s undo. A failure brings it back on screen, and "Erneut versuchen" takes it away and deletes it again. */
export function deleteWithUndo(deps: RemovalDeps, item: ListedItem): void {
  const restore = takeAway(deps, item);
  runWithUndo({ label: t('items.commands.deleted', { key: item.key }), undo: restore, run: () => deleteNow(deps, item, restore) });
}

async function deleteNow(deps: RemovalDeps, item: ListedItem, restore: () => void): Promise<void> {
  try {
    await deps.remove.mutateAsync(item.id);
  } catch (error) {
    restore();
    notifyError(t('items.commands.not_deleted', { key: item.key }), error, () => void deleteNow(deps, item, takeAway(deps, item)));
  }
}

/** Deletes several items with 5 s undo, then item by item (there is no bulk delete). */
export function deleteManyWithUndo(deps: RemovalDeps, targets: readonly ListedItem[]): void {
  const restore = hideAtOnce(deps.queryClient, targets);
  runWithUndo({ label: t('items.commands.deleted', { key: subjectOf(targets) }), undo: () => restore(), run: () => deleteEach(deps, targets, restore) });
}

/**
 * Deletes item by item. What fails comes back on screen, and "Erneut versuchen" tries only those again (the others are
 * gone and would answer 404).
 */
async function deleteEach(deps: RemovalDeps, targets: readonly ListedItem[], restore: (back?: readonly string[]) => void): Promise<void> {
  const results = await Promise.allSettled(targets.map((item) => deps.remove.mutateAsync(item.id)));
  const failed = targets.filter((_, index) => results[index]!.status === 'rejected');
  if (failed.length === 0) return;
  restore(failed.map((item) => item.id));
  const cause = results.find((result): result is PromiseRejectedResult => result.status === 'rejected')!.reason as unknown;
  notifyError(t('items.commands.not_deleted', { key: subjectOf(failed) }), cause, () => void deleteEach(deps, failed, hideAtOnce(deps.queryClient, failed)));
}
