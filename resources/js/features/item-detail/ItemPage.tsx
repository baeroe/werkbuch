/*
 * The page of an item, /items/{key} (spec 5.2): the path and the actions, then the item as an index card with its tab,
 * the same body as the preview (`ItemBody`), and the item commands for this item (s, a, i, p …).
 *
 * Contract with the page `Items/Show`: it renders `ItemPage({ itemKey })` with the key in the spelling the item has
 * (the server moved a former key to the current one with a 301 and answered 404 for what the person may not see).
 * Loaded, an item whose key has changed since (its project was renamed) puts its current key into the address
 * (`router.replace`, no new visit). Gone (deleted, or access lost: 404 or 403) it shows the 404 page, also when it was
 * loaded before; any other failure shows an error with "Erneut versuchen", or keeps the item when it was loaded.
 */

import { router, usePage } from '@inertiajs/react';
import { useEffect } from 'react';
import { ErrorState } from '@/components/ui/ErrorState';
import { Skeleton, SkeletonGroup } from '@/components/ui/Skeleton';
import { TypeTab } from '@/components/ui/TypeTab';
import { useItemCommands } from '@/components/fields/commands';
import { useWorkItem } from '@/hooks/workItems';
import { t } from '@/lib/i18n';
import { paths } from '@/lib/links';
import { useDocumentTitle } from '@/lib/useDocumentTitle';
import { NotFound } from '@/shell/PageStates';
import type { WorkItemDetail } from '@/types';
import { ItemHeader } from './header/ItemHeader';
import { ItemBody, ItemDetailProvider } from './ItemBody';
import { isGone } from './shared';

function ItemPageContent({ detail }: { detail: WorkItemDetail }) {
  const { item, type } = detail;
  // the item commands act on this item (rule 2 of components/fields/commands/context.ts)
  useItemCommands({ scope: 'detail', itemId: item.id });
  return (
    // a new detail for each item: drafts and edits never carry over to the next one
    <ItemDetailProvider key={item.id} surface="page">
      <article className="max-w-6xl pb-8">
        <ItemHeader detail={detail} surface="page" />
        <div className="relative mt-8 rounded-card border border-line bg-surface shadow-elev-1">
          <span className="absolute bottom-full left-5">
            <TypeTab tone={type.tone} icon={type.icon} label={item.key} />
          </span>
          <div className="px-4 pt-4 pb-6 md:px-6 md:pt-5">
            <ItemBody detail={detail} surface="page" />
          </div>
        </div>
      </article>
    </ItemDetailProvider>
  );
}

export function ItemPage({ itemKey }: { itemKey: string }) {
  const detail = useWorkItem(itemKey);
  const item = detail.data?.item;
  const gone = isGone(detail.error);
  // the 404 page names its own tab
  useDocumentTitle(gone ? null : item ? `${item.key} ${item.title}` : itemKey);

  // renamed meanwhile: the address shows the current key
  const { url } = usePage();
  const [path, query = ''] = url.split('?');
  const current = item ? paths.item(item.key) : null;
  useEffect(() => {
    if (current && path !== current) router.replace({ url: `${current}${query ? `?${query}` : ''}`, preserveState: true, preserveScroll: true });
  }, [current, path, query]);

  // gone (deleted, or access lost) shows the 404 page, also when the item was loaded before
  if (gone) {
    return <NotFound title={t('items.page.not_found.title', { key: itemKey })} description={t('items.page.not_found.description')} />;
  }
  // only when nothing is loaded yet: a reload that fails keeps the item on screen, with what its editors hold
  if (detail.isError && !detail.data) {
    return <ErrorState description={detail.error.message} onRetry={() => void detail.refetch()} retrying={detail.isFetching} />;
  }
  if (!detail.data) {
    return (
      <SkeletonGroup label={t('items.page.loading')} className="max-w-6xl">
        <Skeleton className="mt-3 h-4 w-64" />
        <div className="mt-10 rounded-card border border-line bg-surface p-6 shadow-elev-1">
          <Skeleton className="h-7 w-1/2" />
          <div className="mt-6 grid gap-8 lg:grid-cols-[minmax(0,1fr)_19rem]">
            <div className="flex flex-col gap-3">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-28 w-full rounded-ctl" />
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-16 w-full rounded-ctl" />
            </div>
            <div className="flex flex-col gap-3">
              {[0, 1, 2, 3, 4, 5].map((row) => (
                <Skeleton key={row} className="h-4 w-full" />
              ))}
            </div>
          </div>
        </div>
      </SkeletonGroup>
    );
  }
  return <ItemPageContent detail={detail.data} />;
}
