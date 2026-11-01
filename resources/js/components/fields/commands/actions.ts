/*
 * What the item commands do: one change with its confirmation (`apply`), and archiving or deleting with 5 s undo
 * (spec 5.1). Archiving and deleting take the item out of every cached list and out of the preview at once; the call
 * itself runs when the undo toast runs out. Deleting the item whose page is on screen leaves the page as well. The item
 * page's header (`useItemRemoval`) uses the same two functions, so the logic exists once (K27).
 *
 * Phase 4 acts on one item (K17). The selection of the lists (Phase 5) adds the bulk edit (`bulkUpdateWorkItems`) with a
 * toast that names the refused items.
 */

import { router } from '@inertiajs/react';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import type { Page } from '@/api/client';
import { toast } from '@/components/ui/toast';
import { qk } from '@/hooks/keys';
import { useArchiveWorkItem, useDeleteWorkItem } from '@/hooks/workItems';
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
 * Changes the target with its own mutation (optimistic: a refusal brings the old state back with a toast of the
 * hook) and confirms it with a toast saying `what`.
 */
export function apply(ctx: ItemCommandContext, what: string, change: (item: ListedItem) => Promise<unknown>): void {
  const [item] = ctx.targets as [ListedItem];
  ctx.settle(change(item), { onSuccess: () => done(item, what) });
}

/* ----------------------------------------------------------------------- archive, delete */

/** What archiving and deleting need; `useRemovalDeps` gives it. */
export interface RemovalDeps {
  queryClient: QueryClient;
  archive: ReturnType<typeof useArchiveWorkItem>;
  remove: ReturnType<typeof useDeleteWorkItem>;
}

export function useRemovalDeps(): RemovalDeps {
  return { queryClient: useQueryClient(), archive: useArchiveWorkItem(), remove: useDeleteWorkItem() };
}

const isPage = (data: unknown): data is Page<ListedItem> => typeof data === 'object' && data !== null && Array.isArray((data as Page<ListedItem>).items);

/**
 * Takes the item out of every cached list at once, and out of the preview. Answers `restore`, which puts it back where
 * it was (undo, or a call that failed) and loads the lists again.
 */
function hideAtOnce(queryClient: QueryClient, item: ListedItem): () => void {
  const listKey = [...qk.workItems.all, 'list'];
  const before = queryClient.getQueriesData<unknown>({ queryKey: listKey }).filter((entry): entry is [readonly unknown[], Page<ListedItem>] => isPage(entry[1]));
  queryClient.setQueriesData({ queryKey: listKey }, (data: unknown) =>
    isPage(data) && data.items.some((entry) => entry.id === item.id)
      ? { ...data, items: data.items.filter((entry) => entry.id !== item.id), total: Math.max(0, data.total - 1) }
      : data,
  );
  const ui = useUiStore.getState();
  if (ui.peekItemId === item.id || ui.peekItemId === item.key) ui.openPeek(null);

  return () => {
    for (const [key, snapshot] of before) {
      const index = snapshot.items.findIndex((entry) => entry.id === item.id);
      if (index < 0) continue;
      queryClient.setQueryData(key, (current: unknown) => {
        if (!isPage(current) || current.items.some((entry) => entry.id === item.id)) return current;
        // back in its place among the items that are still there
        const after = snapshot.items.slice(index + 1).find((entry) => current.items.some((other) => other.id === entry.id));
        const at = after ? current.items.findIndex((entry) => entry.id === after.id) : current.items.length;
        return { ...current, items: [...current.items.slice(0, at), snapshot.items[index]!, ...current.items.slice(at)], total: current.total + 1 };
      });
    }
    // the server has the last word (a failed reload keeps what is shown)
    void queryClient.invalidateQueries({ queryKey: qk.workItems.all });
  };
}

/** Archives a closed item with 5 s undo. A failure brings it back on screen (the mutation's own toast says why). */
export function archiveWithUndo(deps: RemovalDeps, item: ListedItem): void {
  const restore = hideAtOnce(deps.queryClient, item);
  runWithUndo({
    label: t('items.commands.archived', { key: item.key }),
    undo: restore,
    run: () => deps.archive.mutateAsync(item.id).catch(restore),
  });
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
  const restore = hideAtOnce(deps.queryClient, item);
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
