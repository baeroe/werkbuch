/*
 * A card of the board: the item's index card (`ItemCard`) with the fields of the display among labels, priority, due
 * date and assignee, its epic before the key (except where the columns are the epics), and a spinner while a move of
 * it is on its way to the server. The card is the element of the board's cursor (`cursor`): exactly one card of the
 * board is the tab stop, Enter opens the page, a click on the title the preview.
 *
 * Where cards move (`sortable`, not on a board grouped by label) the card lies in a frame dnd-kit sorts
 * (`useSortable`): pressing the frame and moving past 5 px picks the card up (a long press on touch), if the person
 * may change the item (`draggable`). While it is dragged its place shows a dashed outline and the card itself travels
 * in the board's overlay.
 */

import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { LoaderCircle } from 'lucide-react';
import type { ComponentProps, ReactNode } from 'react';
import { ItemCard } from '@/components/items/ItemCard';
import { cx } from '@/components/ui/cx';

/** Card shifts follow DESIGN.md: 160 ms ease-out. */
const SHIFT = { duration: 160, easing: 'cubic-bezier(0.25, 1, 0.5, 1)' };

type BoardCardProps = ComponentProps<typeof ItemCard> & {
  /** A move of the item is on its way to the server. */
  busy: boolean;
  /** Cards on this board move (dnd-kit); false on a board grouped by label, where an item has several cards. */
  sortable?: boolean;
  /** This card may be picked up (the person may change the item). */
  draggable?: boolean;
};

function Spinner({ busy }: { busy: boolean }) {
  return busy ? <LoaderCircle className="pointer-events-none absolute top-0.5 right-2 size-3.5 animate-spin text-muted" aria-hidden="true" /> : null;
}

function SortableFrame({ id, draggable, busy, children }: { id: string; draggable: boolean; busy: boolean; children(dragging: boolean): ReactNode }) {
  const { setNodeRef, listeners, transform, transition, isDragging } = useSortable({ id, disabled: { draggable: !draggable, droppable: false }, transition: SHIFT });
  return (
    <div
      ref={setNodeRef}
      data-card-frame=""
      style={{ transform: CSS.Translate.toString(transform), transition }}
      {...(draggable ? listeners : {})}
      // links can be dragged by the browser itself, which would swallow the pointer moves of dnd-kit
      onDragStart={(event) => event.preventDefault()}
      className={cx('relative', draggable && '[-webkit-touch-callout:none]')}
    >
      {children(isDragging)}
      {isDragging && <span aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-5 bottom-0 rounded-card border-2 border-dashed border-line-strong" />}
      <Spinner busy={busy} />
    </div>
  );
}

export function BoardCard({ busy, sortable = false, draggable = false, ...card }: BoardCardProps) {
  if (!sortable) {
    return (
      <div className="relative">
        <ItemCard {...card} aria-busy={busy || undefined} />
        <Spinner busy={busy} />
      </div>
    );
  }
  return (
    <SortableFrame id={card.item.id} draggable={draggable} busy={busy}>
      {(dragging) => <ItemCard {...card} aria-busy={busy || undefined} className={cx(card.className, draggable && 'select-none', dragging && 'opacity-0')} />}
    </SortableFrame>
  );
}
