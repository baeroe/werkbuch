/*
 * A list whose rows can be put in another order: the statuses of a workflow, the properties of a type, the options of
 * a dropdown. Each row has a handle. With the pointer it is dragged; with the keyboard Space lifts the row, the
 * arrows move it, Space puts it down and Escape takes it back (dnd-kit's keyboard sensor), and a screen reader hears
 * where it is in German. While a row is dragged, a copy of it floats above the page as DESIGN.md wants a dragged card to
 * (lifted, tilted, with the drag elevation); the copy is inert and cannot select text, and the row itself stays as the
 * gap it will fill. The copy is rendered into `document.body`, because a dialog's glass would otherwise become the
 * reference of its position.
 */

import {
  closestCenter,
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type Announcements,
  type DragEndEvent,
  type Modifier,
  type ScreenReaderInstructions,
  type UniqueIdentifier,
} from '@dnd-kit/core';
import { arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical } from 'lucide-react';
import { useId, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { cx } from '@/components/ui/cx';

export interface SortableControls {
  /** The handle to drag by; put it where the row wants it. */
  handle: ReactNode;
  dragging: boolean;
  /** Position in the list, from 0. */
  index: number;
}

type SortableListProps<T extends { id: string }> = {
  items: T[];
  onReorder: (items: T[]) => void;
  /** Names the list for screen readers: "Status". */
  label: string;
  /** Names a row for its handle and the announcements: "Backlog". */
  nameOf: (item: T) => string;
  renderItem: (item: T, controls: SortableControls) => ReactNode;
  disabled?: boolean;
  className?: string;
  /** Classes of every row. */
  rowClassName?: string;
};

const INSTRUCTIONS: ScreenReaderInstructions = {
  draggable: 'Leertaste drücken, um den Eintrag aufzunehmen. Mit den Pfeiltasten verschieben, mit der Leertaste ablegen, mit Escape abbrechen.',
};

/** A row moves up and down, never sideways. */
const verticalOnly: Modifier = ({ transform }) => ({ ...transform, x: 0 });

const prefersReducedMotion = () => typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const HANDLE_LOOK = 'inline-flex size-11 shrink-0 items-center justify-center rounded-chip text-muted md:size-7';

type RowProps<T extends { id: string }> = Pick<SortableListProps<T>, 'nameOf' | 'renderItem' | 'disabled' | 'rowClassName'> & { item: T; index: number };

function SortableRow<T extends { id: string }>({ item, index, nameOf, renderItem, disabled, rowClassName }: RowProps<T>) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: item.id, disabled });
  const handle = (
    <button
      type="button"
      ref={setActivatorNodeRef}
      {...attributes}
      {...listeners}
      aria-roledescription="sortierbar"
      aria-label={`${nameOf(item) || 'Eintrag'} verschieben`}
      className={cx(HANDLE_LOOK, 'touch-none transition-colors duration-120', disabled ? 'cursor-not-allowed opacity-50' : 'cursor-grab hover:bg-hover hover:text-ink active:cursor-grabbing')}
    >
      <GripVertical className="size-4" aria-hidden="true" />
    </button>
  );
  return (
    <li ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }} className={cx(rowClassName, isDragging && 'bg-sunken opacity-50')}>
      {renderItem(item, { handle, dragging: isDragging, index })}
    </li>
  );
}

export function SortableList<T extends { id: string }>({ items, onReorder, label, nameOf, renderItem, disabled, className, rowClassName }: SortableListProps<T>) {
  const contextId = useId();
  const [activeId, setActiveId] = useState<UniqueIdentifier | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));

  const nameById = (id: string | number) => nameOf(items.find((item) => item.id === id) ?? ({ id: String(id) } as T)) || 'Eintrag';
  const place = (id: string | number) => `Position ${items.findIndex((item) => item.id === id) + 1} von ${items.length}`;

  const announcements: Announcements = {
    onDragStart: ({ active }) => `${nameById(active.id)} aufgenommen. ${place(active.id)}.`,
    onDragOver: ({ active, over }) => (over ? `${nameById(active.id)} liegt über ${place(over.id)}.` : undefined),
    onDragEnd: ({ active, over }) => (over ? `${nameById(active.id)} abgelegt auf ${place(over.id)}.` : `${nameById(active.id)} abgelegt.`),
    onDragCancel: ({ active }) => `Verschieben abgebrochen. ${nameById(active.id)} bleibt auf ${place(active.id)}.`,
  };

  function onDragEnd({ active, over }: DragEndEvent) {
    setActiveId(null);
    if (!over || active.id === over.id) return;
    const from = items.findIndex((item) => item.id === active.id);
    const to = items.findIndex((item) => item.id === over.id);
    if (from >= 0 && to >= 0) onReorder(arrayMove(items, from, to));
  }

  const activeIndex = activeId === null ? -1 : items.findIndex((item) => item.id === activeId);

  return (
    <DndContext
      id={contextId}
      sensors={sensors}
      collisionDetection={closestCenter}
      modifiers={[verticalOnly]}
      onDragStart={({ active }) => setActiveId(active.id)}
      onDragEnd={onDragEnd}
      onDragCancel={() => setActiveId(null)}
      accessibility={{ announcements, screenReaderInstructions: INSTRUCTIONS }}
    >
      <SortableContext items={items.map((item) => item.id)} strategy={verticalListSortingStrategy}>
        <ul aria-label={label} className={cx(className, activeIndex >= 0 && 'select-none')}>
          {items.map((item, index) => (
            <SortableRow key={item.id} item={item} index={index} nameOf={nameOf} renderItem={renderItem} disabled={disabled} rowClassName={rowClassName} />
          ))}
        </ul>
      </SortableContext>
      {createPortal(
        <DragOverlay dropAnimation={prefersReducedMotion() ? null : undefined} zIndex={70}>
          {activeIndex >= 0 && (
            // the copy only shows the row: it is inert, hidden from screen readers and cannot be selected
            <div inert aria-hidden="true" className="-rotate-1 scale-[1.02] rounded-ctl border border-line-strong bg-surface shadow-elev-drag select-none">
              {renderItem(items[activeIndex], {
                handle: (
                  <span className={HANDLE_LOOK}>
                    <GripVertical className="size-4" aria-hidden="true" />
                  </span>
                ),
                dragging: true,
                index: activeIndex,
              })}
            </div>
          )}
        </DragOverlay>,
        document.body,
      )}
    </DndContext>
  );
}
