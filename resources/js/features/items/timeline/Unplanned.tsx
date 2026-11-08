/*
 * "Ohne Datum" beside the axis (spec 4.11: "Epics ohne Daten stehen in einer Seitenliste und lassen sich auf die
 * Zeitachse ziehen"): the epics of the list without a start or due date, each as a compact card with "Ab heute
 * einplanen" below it (two weeks from today, `PLANNED_DAYS`). A card dragged onto the axis starts on the day under the
 * pointer (`useTimelineDrag`). The cards take part in the keyboard cursor of the timeline like its rows.
 *
 * The list is virtualized in a box of its own like the rows (T21-M8): only the cards in view (and a few around them)
 * are rendered, each measured once it is; the card of the cursor (else the tab stop) always, so it keeps the focus
 * while it scrolls away. The timeline brings a card into view through `revealRef` before it focuses it.
 */

import { defaultRangeExtractor, useVirtualizer, type Range } from '@tanstack/react-virtual';
import { CalendarPlus } from 'lucide-react';
import { useCallback, useId, useLayoutEffect, useRef, type PointerEvent as ReactPointerEvent, type RefObject } from 'react';
import { ItemCard } from '@/components/items/ItemCard';
import { Button } from '@/components/ui/Button';
import { cx } from '@/components/ui/cx';
import { t } from '@/lib/i18n';
import type { ListedItem } from '@/types';
import type { NavProps } from './TimelineLayout';

/** What a card with its button takes until it is measured. */
const ENTRY_HEIGHT = 140;

interface UnplannedProps {
  items: ListedItem[];
  /** The item whose card is the tab stop of the timeline, if it stands here. */
  stop: string | undefined;
  selection: readonly string[];
  /** The id of the card on its way to the axis: its place stays faint. */
  planningId: string | null;
  navProps(item: ListedItem): NavProps;
  /** The look of a card besides the selection: a live change, the previewed card. */
  lookOf(item: ListedItem): string | undefined;
  nameParts(item: ListedItem): string[];
  editReason(item: ListedItem): string | null;
  busy(item: ListedItem): boolean;
  onPlan(item: ListedItem): void;
  onPlanPointerDown(event: ReactPointerEvent<HTMLElement>, item: ListedItem): void;
  onOpen(id: string): void;
  onPeek(id: string): void;
  /** Set by the list: scrolls it just enough that an epic's card is rendered and in view. */
  revealRef: RefObject<((id: string) => void) | null>;
}

export function Unplanned({ items, stop, selection, planningId, navProps, lookOf, nameParts, editReason, busy, onPlan, onPlanPointerDown, onOpen, onPeek, revealRef }: UnplannedProps) {
  const headingId = useId();
  const box = useRef<HTMLDivElement>(null);
  // the card of the cursor (or the tab stop) stays rendered while it scrolls away, so it keeps the focus
  const keepIndex = items.findIndex((item) => item.id === stop);
  const rangeExtractor = useCallback(
    (range: Range) => {
      const indexes = defaultRangeExtractor(range);
      return keepIndex < 0 || indexes.includes(keepIndex) ? indexes : [...indexes, keepIndex].sort((a, b) => a - b);
    },
    [keepIndex],
  );
  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => box.current,
    estimateSize: () => ENTRY_HEIGHT,
    getItemKey: (index) => items[index]!.id,
    overscan: 4,
    rangeExtractor,
    useFlushSync: false,
  });
  useLayoutEffect(() => {
    revealRef.current = (id) => {
      const index = items.findIndex((item) => item.id === id);
      if (index >= 0) virtualizer.scrollToIndex(index, { align: 'auto' });
    };
  });

  return (
    <aside aria-labelledby={headingId} className="flex shrink-0 flex-col rounded-card border border-line bg-surface p-3 shadow-elev-1 lg:w-72">
      <div className="flex items-baseline gap-2 px-1">
        <h2 id={headingId} className="font-display text-md font-bold tracking-title text-ink">
          {t('items.timeline.unplanned.title')}
        </h2>
        <span className="text-sm text-muted tabular-nums">{items.length}</span>
      </div>
      <p className="mt-0.5 px-1 text-sm text-pretty text-muted">{t(items.length > 0 ? 'items.timeline.unplanned.hint' : 'items.timeline.unplanned.all_dated')}</p>
      {items.length > 0 && (
        <div ref={box} data-unplanned-list="" className="-mx-1 mt-0.5 max-h-[max(16rem,calc(100dvh-14rem))] overflow-x-hidden overflow-y-auto overscroll-y-contain px-1 pt-0.5">
          <ul className="relative" style={{ height: virtualizer.getTotalSize() }}>
            {virtualizer.getVirtualItems().map((entry) => {
              const item = items[entry.index]!;
              const denied = editReason(item);
              const selected = selection.includes(item.id);
              return (
                <li
                  key={entry.key}
                  ref={virtualizer.measureElement}
                  data-index={entry.index}
                  data-unplanned-entry=""
                  className="absolute inset-x-0 top-0 flex flex-col gap-2 pb-2.5"
                  style={{ transform: `translateY(${entry.start}px)` }}
                >
                  <div
                    onPointerDown={(event) => onPlanPointerDown(event, item)}
                    // the title is a link, which the browser would drag itself
                    onDragStart={(event) => event.preventDefault()}
                    className={cx('flow-root', planningId === item.id && 'opacity-40', !denied && 'cursor-grab')}
                  >
                    <ItemCard
                      item={item}
                      compact
                      onOpen={onOpen}
                      onPeek={onPeek}
                      selected={selected}
                      cursor={item.id === stop}
                      nameParts={nameParts(item)}
                      aria-busy={busy(item) || undefined}
                      className={cx('select-none', !selected && lookOf(item))}
                      {...navProps(item)}
                    />
                  </div>
                  <Button
                    variant="secondary"
                    size="sm"
                    icon={CalendarPlus}
                    disabledReason={denied}
                    aria-label={t('items.timeline.unplanned.plan_named', { key: item.key })}
                    onClick={() => onPlan(item)}
                    className="self-start"
                  >
                    {t('items.timeline.unplanned.plan')}
                  </Button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </aside>
  );
}
