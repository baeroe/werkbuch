/*
 * A card of the board: the item's index card (`ItemCard`) with the fields of the display among labels, priority, due
 * date and assignee, its epic before the key (except where the columns are the epics), and a spinner while a move of
 * it is on its way to the server. The card is the element of the board's cursor (`cursor`): exactly one card of the
 * board is the tab stop, Enter opens the page, a click on the title the preview.
 */

import { LoaderCircle } from 'lucide-react';
import type { ComponentProps } from 'react';
import { ItemCard } from '@/components/items/ItemCard';

type BoardCardProps = ComponentProps<typeof ItemCard> & {
  /** A move of the item is on its way to the server. */
  busy: boolean;
};

export function BoardCard({ busy, ...card }: BoardCardProps) {
  return (
    <div className="relative">
      <ItemCard {...card} aria-busy={busy || undefined} />
      {busy && <LoaderCircle className="pointer-events-none absolute top-0.5 right-2 size-3.5 animate-spin text-muted" aria-hidden="true" />}
    </div>
  );
}
