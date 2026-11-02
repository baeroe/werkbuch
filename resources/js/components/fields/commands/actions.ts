/*
 * What the item commands do: one change with its confirmation (`apply`), and archiving or deleting with 5 s undo
 * (spec 5.1). Archiving and deleting take the items out of every cached list, out of the preview and out of the
 * selection at once; the call itself runs when the undo toast runs out. Deleting the item whose page is on screen leaves
 * the page as well. The item page's header (`useItemRemoval`) uses the same functions, so the logic exists once (K27).
 *
 * Several targets (the selection of a list) change with one bulk edit (`useBulkChange`, in blocks of 100, K25) whose
 * one toast names the refused items and what was not saved; they are archived the same way, and deleted item by item,
 * a few at once (`useDeleteWorkItems`). The lists load again once, after the last block or delete.
 */

import { router } from '@inertiajs/react';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import type { Page } from '@/api/client';
import type { BulkPatch } from '@/api/workItems';
import { toast } from '@/components/ui/toast';
import { bulkChange, bulkToast, subjectOf } from '@/features/items/selection/bulk';
import { qk } from '@/hooks/keys';
import { useArchiveWorkItem, useBulkChange, useDeleteWorkItem, useDeleteWorkItems } from '@/hooks/workItems';
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
  bulk: ReturnType<typeof useBulkChange>;
  removeMany: ReturnType<typeof useDeleteWorkItems>;
}

export function useRemovalDeps(): RemovalDeps {
  return { queryClient: useQueryClient(), archive: useArchiveWorkItem(), remove: useDeleteWorkItem(), bulk: useBulkChange(), removeMany: useDeleteWorkItems() };
}

const isPage = (data: unknown): data is Page<ListedItem> => typeof data === 'object' && data !== null && Array.isArray((data as Page<ListedItem>).items);

/**
 * Takes the items out of every cached list at once, out of the preview and out of the selection. Answers `restore`,
 * which puts the named items (all by default) back where they were (undo, or a call that failed or was refused) and
 * loads the lists again (`reload: false` when the call loads them itself).
 */
type Restore = (back?: readonly string[], reload?: boolean) => void;

function hideAtOnce(queryClient: QueryClient, items: readonly ListedItem[]): Restore {
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

  return (back = [...ids], reload = true) => {
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
    if (reload) void queryClient.invalidateQueries({ queryKey: qk.workItems.all });
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
 * Archives several closed items with 5 s undo: they leave the screen at once. When the time is up, one bulk change
 * archives them all (blocks of 100). What the server still refuses (reopened meanwhile: `not_closed`) and what was not
 * saved (a block failed) comes back on screen, never what it archived; one toast names it, and "Erneut versuchen"
 * archives what was not saved.
 */
export function archiveManyWithUndo(deps: RemovalDeps, targets: readonly ListedItem[]): void {
  const restore = hideAtOnce(deps.queryClient, targets);
  runWithUndo({
    label: t('items.commands.archived', { key: subjectOf(targets) }),
    undo: () => restore(),
    run: () => archiveEach(deps, targets, restore),
  });
}

async function archiveEach(deps: RemovalDeps, targets: readonly ListedItem[], restore: Restore): Promise<void> {
  const outcome = await deps.bulk.run(
    targets.map((item) => item.id),
    { archived: true },
  );
  if (outcome.rejected.length === 0 && outcome.unsaved.length === 0) return;
  // the change loads the lists itself
  restore([...outcome.rejected.map((entry) => entry.id), ...outcome.unsaved], false);
  const unsaved = targets.filter((item) => outcome.unsaved.includes(item.id));
  bulkToast(targets, outcome, t('items.bulk.done.archived'), 'archived', () => void archiveEach(deps, unsaved, hideAtOnce(deps.queryClient, unsaved)));
}

/**
 * Archives the targets, the one place for the palette, the shortcut and the bulk bar. Every one of them is closed and
 * not archived: the callers ask `selectionVerdict` first (A198), so no part of them stays behind (T15-M3, T15-M8).
 */
export function archiveTargets(deps: RemovalDeps, targets: readonly ListedItem[]): void {
  if (targets.length === 1) archiveWithUndo(deps, targets[0]!);
  else if (targets.length > 1) archiveManyWithUndo(deps, targets);
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
 * Deletes item by item, a few at once (`useDeleteWorkItems`, which loads the lists once at the end). What fails comes
 * back on screen, and "Erneut versuchen" tries only those again (the others are gone and would answer 404).
 */
async function deleteEach(deps: RemovalDeps, targets: readonly ListedItem[], restore: Restore): Promise<void> {
  const outcome = await deps.removeMany(targets.map((item) => item.id));
  if (outcome.failed.length === 0) return;
  restore(outcome.failed, false);
  const failed = targets.filter((item) => outcome.failed.includes(item.id));
  notifyError(t('items.commands.not_deleted', { key: subjectOf(failed) }), outcome.error, () => void deleteEach(deps, failed, hideAtOnce(deps.queryClient, failed)));
}
