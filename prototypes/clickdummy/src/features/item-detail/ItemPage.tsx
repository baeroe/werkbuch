/*
 * Placeholder until Task 8 replaces this file.
 *
 * Contract with the router (lazy-loaded): the named export `ItemPage` is the screen of /items/:key and reads the key
 * itself. A key that is no key, an unknown key or one the person may not see shows the 404 page (`NotFound` from
 * src/app/PageStates); a former key (after a project was renamed) opens the item. The four states are already here.
 */

import { SquareCheck } from 'lucide-react';
import { useParams } from 'react-router';
import { ApiError } from '@/api/client';
import { ComingSoon, NotFound } from '@/app/PageStates';
import { ErrorState } from '@/components/ui/ErrorState';
import { Skeleton, SkeletonGroup } from '@/components/ui/Skeleton';
import { parseKey } from '@/domain/keys';
import { useWorkItem } from '@/hooks/workItems';

export function ItemPage() {
  const { key = '' } = useParams();
  const valid = parseKey(key) !== null;
  const detail = useWorkItem(valid ? key : null);

  if (!valid || (detail.error instanceof ApiError && detail.error.status === 404)) {
    return (
      <NotFound
        title={`${key.toUpperCase()} gibt es nicht`}
        description="Kein Item hat diesen Key, oder es liegt in einem Projekt, das du nicht siehst. Vielleicht wurde es auch gelöscht."
      />
    );
  }
  if (detail.isError) {
    return <ErrorState description={detail.error.message} onRetry={() => void detail.refetch()} retrying={detail.isFetching} />;
  }
  if (!detail.data) {
    return (
      <SkeletonGroup label="Item wird geladen …">
        <Skeleton className="h-6 w-1/2" />
        <Skeleton className="mt-6 h-40 w-full rounded-card" />
      </SkeletonGroup>
    );
  }

  const { item } = detail.data;
  return (
    <ComingSoon
      title={`${item.key} ${item.title}`}
      task={8}
      icon={SquareCheck}
      description="Hier entsteht die Seite des Items: Titel, Felder, Relationen, Kinder, Anhänge, Beschreibung und die Aktivität mit Kommentaren."
    />
  );
}
