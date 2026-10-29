/*
 * One column of the board (moodboard "Board"): the mark and name of its group with the count, the quick add, then its
 * cards on the paper. The column is a drop target as a whole; its cards are sortable (dnd-kit) unless the board does
 * not move cards (grouped by label) or the person may not change the item.
 *
 * While a card is dragged the column shows what a drop would do: a column the card may not enter is dimmed and marked
 * (spec 4.5: "Im Board sind beim Ziehen die Spalten gedimmt, die nicht erlaubt sind"); the dragged card itself names
 * the reason while it is over such a column (BoardLayout). The card's own place shows a dashed outline.
 */

import { useDroppable } from '@dnd-kit/core';
import { SortableContext, useSortable, verticalListSortingStrategy, type SortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Ban, LoaderCircle, Plus } from 'lucide-react';
import { useId, useRef, type ComponentProps, type ReactNode } from 'react';
import { ItemCard } from '@/components/items/ItemCard';
import { cx } from '@/components/ui/cx';
import { IconButton } from '@/components/ui/IconButton';
import type { GroupBy, WorkItem } from '@/types';
import { GroupIcon } from '../display/GroupIcon';

const count = new Intl.NumberFormat('de-DE');

/** A column as the board shows it: its group and the ids of its cards in their order. */
export interface BoardColumnData {
  key: string;
  label: string;
  ids: string[];
}

/** The droppable id of a column; cards use their item id. */
export const columnDropId = (key: string) => `column:${key}`;

/** A sorted column keeps its order while a card is dragged over it: the place follows the sort, not the pointer. */
const keepOrder: SortingStrategy = () => null;

/** Card shifts follow DESIGN.md: 160 ms ease-out. */
const SHIFT = { duration: 160, easing: 'cubic-bezier(0.25, 1, 0.5, 1)' };

type ColumnDrag = {
  /** A card is being dragged somewhere on the board. */
  active: boolean;
  /** Why the dragged card may not enter this column, or null. */
  refused: string | null;
  /** The pointer is over this column. */
  over: boolean;
};

type BoardColumnProps = {
  column: BoardColumnData;
  groupBy: GroupBy;
  /** Cards can be dragged on this board. */
  sortable: boolean;
  /** The column is sorted by rank: dragging within it changes the order. */
  manual: boolean;
  drag: ColumnDrag;
  /** Why no item can be made in this column, or null. */
  addReason: string | null;
  adding: boolean;
  onAddChange: (adding: boolean) => void;
  /** The quick add form, shown while `adding`; `close` hides it and gives the focus back to the "+". */
  renderQuickAdd: (close: () => void) => ReactNode;
  /** The column's scroll box, for revealing a card. */
  listRef?: (element: HTMLUListElement | null) => void;
  children: ReactNode;
};

export function BoardColumn({ column, groupBy, sortable, manual, drag, addReason, adding, onAddChange, renderQuickAdd, listRef, children }: BoardColumnProps) {
  const headingId = useId();
  const { setNodeRef } = useDroppable({ id: columnDropId(column.key), data: { column: column.key }, disabled: !sortable });
  const addButton = useRef<HTMLButtonElement>(null);
  const refused = drag.active ? drag.refused : null;
  const dim = refused !== null;
  const close = () => {
    onAddChange(false);
    requestAnimationFrame(() => addButton.current?.focus());
  };

  return (
    <section
      ref={setNodeRef}
      aria-labelledby={headingId}
      className="flex h-full w-[min(85vw,18rem)] shrink-0 snap-start flex-col sm:w-64"
    >
      <header className={cx('flex h-11 shrink-0 items-center gap-1.5 px-1.5 transition-opacity duration-160 md:h-9', dim && 'opacity-40')}>
        <GroupIcon groupBy={groupBy} groupKey={column.key} />
        <h2 id={headingId} className="min-w-0 truncate text-ui font-semibold text-ink">
          {column.label}
        </h2>
        <span className="shrink-0 text-sm text-muted tabular-nums">
          <span className="sr-only">, </span>
          {count.format(column.ids.length)}
          <span className="sr-only">{column.ids.length === 1 ? ' Item' : ' Items'}</span>
        </span>
        {dim && <Ban className="size-3.5 shrink-0 text-muted" aria-hidden="true" />}
        <IconButton
          ref={addButton}
          icon={Plus}
          size="sm"
          label={`Item in ${column.label} anlegen`}
          aria-expanded={addReason ? undefined : adding}
          disabledReason={addReason}
          onClick={() => onAddChange(!adding)}
          className="ml-auto"
        />
      </header>

      {adding && !addReason && <div className="shrink-0 px-1.5 pb-1">{renderQuickAdd(close)}</div>}

      <SortableContext id={column.key} items={sortable ? column.ids : []} strategy={manual ? verticalListSortingStrategy : keepOrder}>
        <ul
          ref={listRef}
          data-board-list=""
          aria-labelledby={headingId}
          className={cx(
            'flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto overscroll-contain rounded-card px-1.5 pb-4 transition-[opacity,background-color] duration-160',
            dim && 'opacity-40',
            drag.active && drag.over && !refused && 'bg-hover',
          )}
        >
          {children}
          {column.ids.length === 0 && (
            <li aria-hidden={drag.active || undefined} className="mt-5 rounded-card border border-dashed border-line-strong px-3 py-5 text-center text-sm text-muted">
              Keine Items
            </li>
          )}
        </ul>
      </SortableContext>
    </section>
  );
}

/* -------------------------------------------------------------------------- cards */

type CardProps = Omit<ComponentProps<typeof ItemCard>, 'item' | 'lifted'>;

type BoardCardProps = {
  item: WorkItem;
  column: string;
  /** Cards on this board move (dnd-kit); false on a board grouped by label, where an item has several cards. */
  sortable: boolean;
  /** This card may be picked up (the person may change the item). */
  draggable: boolean;
  /** A change of the item is on its way to the server. */
  busy: boolean;
  card: CardProps;
};

/** The li of a card with its spinner and, while it is dragged, the outline of its place. */
function CardFrame({ busy, dragging, children, ...rest }: ComponentProps<'li'> & { busy: boolean; dragging: boolean }) {
  return (
    <li {...rest} className={cx('relative shrink-0', rest.className)}>
      {children}
      {dragging && <span aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-5 bottom-0 rounded-card border-2 border-dashed border-line-strong" />}
      {busy && <LoaderCircle className="pointer-events-none absolute top-0.5 right-2 size-3.5 animate-spin text-muted" aria-hidden="true" />}
    </li>
  );
}

function SortableCard({ item, column, draggable, busy, card }: BoardCardProps) {
  const { setNodeRef, listeners, transform, transition, isDragging } = useSortable({
    id: item.id,
    data: { column },
    disabled: { draggable: !draggable, droppable: false },
    transition: SHIFT,
  });
  return (
    <CardFrame
      ref={setNodeRef}
      busy={busy}
      dragging={isDragging}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      {...(draggable ? listeners : {})}
      // links can be dragged by the browser itself, which would swallow the pointer moves of dnd-kit
      onDragStart={(event) => event.preventDefault()}
      className={cx(draggable && '[-webkit-touch-callout:none]')}
    >
      <ItemCard
        item={item}
        {...card}
        aria-busy={busy || undefined}
        className={cx(card.className, draggable && 'select-none', isDragging && 'opacity-0')}
      />
    </CardFrame>
  );
}

/** A card of the board: sortable where cards move, plain on a board grouped by label. */
export function BoardCard(props: BoardCardProps) {
  if (props.sortable) return <SortableCard {...props} />;
  return (
    <CardFrame busy={props.busy} dragging={false}>
      <ItemCard item={props.item} {...props.card} aria-busy={props.busy || undefined} />
    </CardFrame>
  );
}

/* ----------------------------------------------------------------------- skeleton */

/** Columns in outline with a few cards, while the board's catalogs load. */
export function BoardSkeletonColumns() {
  const columns = [3, 2, 3, 1, 2];
  return (
    <>
      {columns.map((cards, index) => (
        <div key={index} className="flex w-[min(85vw,18rem)] shrink-0 flex-col sm:w-64">
          <div className="flex h-11 items-center gap-2 px-1.5 md:h-9">
            <span className="block size-4 rounded-full bg-line" />
            <span className="block h-3.5 w-24 rounded-chip bg-line" />
          </div>
          <div className="flex flex-col gap-2.5 px-1.5">
            {Array.from({ length: cards }, (_, card) => (
              <div key={card} className="relative mt-5 rounded-card border border-line bg-surface p-3 shadow-elev-1">
                <span className="absolute bottom-full left-3 block h-5 w-16 rounded-t-chip bg-line" />
                <span className="block h-3.5 w-4/5 rounded-chip bg-line" />
                <span className="mt-2 block h-3.5 w-1/2 rounded-chip bg-line" />
                <span className="mt-3 flex items-center justify-between">
                  <span className="block h-3 w-10 rounded-chip bg-line" />
                  <span className="block size-5 rounded-full bg-line" />
                </span>
              </div>
            ))}
          </div>
        </div>
      ))}
    </>
  );
}
