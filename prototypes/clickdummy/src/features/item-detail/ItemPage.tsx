/*
 * The page of an item, /items/:key (spec 5.2): the path and the actions, then the item as an index card with its tab,
 * the same body as the preview (`ItemBody`), and the item commands for this item (s, a, i, p …).
 *
 * Contract with the router (lazy-loaded): the named export `ItemPage` is the screen of /items/:key and reads the key
 * itself. A key that is no key, an unknown key or one the person may not see (404, or 403 once access is lost) shows
 * the 404 page (`NotFound` from src/app/PageStates); a former key (after a project was renamed) opens the item, and
 * the address changes to the current key.
 */

import { useEffect } from 'react';
import { useNavigate, useParams } from 'react-router';
import { NotFound } from '@/app/PageStates';
import { useItemCommands } from '@/components/fields/commands';
import { ErrorState } from '@/components/ui/ErrorState';
import { Skeleton, SkeletonGroup } from '@/components/ui/Skeleton';
import { TypeTab } from '@/components/ui/TypeTab';
import { parseKey } from '@/domain/keys';
import { useWorkItem } from '@/hooks/workItems';
import { useDocumentTitle } from '@/lib/useDocumentTitle';
import type { WorkItemDetail } from '@/types';
import { ItemBody, ItemDetailProvider } from './ItemBody';
import { ItemHeader } from './ItemHeader';
import { isGone } from './shared';

function ItemPageContent({ detail }: { detail: WorkItemDetail }) {
  const { item, type } = detail;
  // the item commands act on this item (rule 2 of components/fields/commands.ts)
  useItemCommands({ scope: 'detail', itemId: item.id });
  return (
    // a new detail for each item: drafts and edits never carry over to the next one
    <ItemDetailProvider key={item.id} detail={detail} surface="page">
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

export function ItemPage() {
  const { key = '' } = useParams();
  const navigate = useNavigate();
  const valid = parseKey(key) !== null;
  const detail = useWorkItem(valid ? key : null);
  const item = detail.data?.item;
  useDocumentTitle(item ? `${item.key} ${item.title}` : valid ? key.toUpperCase() : null);

  // a former key or another spelling: the address shows the current key
  useEffect(() => {
    if (item && item.key !== key) navigate(`/items/${item.key}`, { replace: true });
  }, [item, key, navigate]);

  // gone (deleted, or access lost) shows the 404 page, also when the item was loaded before
  if (!valid || isGone(detail.error)) {
    return (
      <NotFound
        title={`${key.toUpperCase()} gibt es nicht`}
        description="Kein Item hat diesen Key, oder es liegt in einem Projekt, das du nicht siehst. Vielleicht wurde es auch gelöscht."
      />
    );
  }
  // only when nothing is loaded yet: a reload that fails keeps the item on screen, with what its editors hold
  if (detail.isError && !detail.data) {
    return <ErrorState description={detail.error.message} onRetry={() => void detail.refetch()} retrying={detail.isFetching} />;
  }
  if (!detail.data) {
    return (
      <SkeletonGroup label="Item wird geladen …" className="max-w-6xl">
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
