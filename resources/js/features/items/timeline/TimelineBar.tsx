/*
 * The bar of an epic on the axis, ported from the clickdummy: from its start to its due date in the tone of its type
 * (the tab colour with an edge in the tone), filled by the progress of its children (`children_progress`) with the
 * share beside it. The hit area is the height of the row and reaches a little beyond the ends; its grips change a date
 * (a line shows on hover). What the pointer does there is `useTimelineDrag`'s; the row says it all in words.
 */

import type { PointerEvent as ReactPointerEvent } from 'react';
import { cx } from '@/components/ui/cx';
import { dateToX, type DateRange, type TimelineScale } from '@/domain/timeline';
import { intlLocale } from '@/lib/i18n';
import type { ListedItem, TypeTone } from '@/types';

/** The bar in the tone of the epic's type: the tab colour with an edge in the tone, the progress in the tone. */
const BAR: Record<TypeTone, { bar: string; fill: string }> = {
  sky: { bar: 'bg-sky-tab ring-sky', fill: 'bg-sky' },
  ochre: { bar: 'bg-ochre-tab ring-ochre', fill: 'bg-ochre' },
  moss: { bar: 'bg-moss-tab ring-moss', fill: 'bg-moss' },
  plum: { bar: 'bg-plum-tab ring-plum', fill: 'bg-plum' },
  sand: { bar: 'bg-sand-tab ring-sand', fill: 'bg-sand' },
  slate: { bar: 'bg-slate-tab ring-slate', fill: 'bg-slate' },
};

/** How far the hit area of a bar reaches beyond its ends, and the grip that changes a date. */
const BAR_REACH = 12;
const GRIP =
  "absolute inset-y-0 cursor-ew-resize after:absolute after:inset-y-3 after:left-1/2 after:w-0.5 after:-translate-x-1/2 after:rounded-full after:bg-ink/40 after:opacity-0 after:transition-opacity after:duration-120 after:content-[''] hover:after:opacity-100";

export interface BarHandlers {
  onPointerDown(event: ReactPointerEvent<HTMLElement>): void;
  onClick(): void;
}

interface TimelineBarProps {
  item: ListedItem;
  tone: TypeTone;
  dates: DateRange;
  scale: TimelineScale;
  /** The person may change the dates: the grips show. */
  editable: boolean;
  /** The bar is being dragged: it lifts off the paper. */
  dragging: boolean;
  handlers: BarHandlers;
}

export function TimelineBar({ item, tone, dates, scale, editable, dragging, handlers }: TimelineBarProps) {
  const progress = item.children_progress;
  const x = dateToX(dates.start, scale);
  // a bar of one day at quarter zoom is 4 px: it is drawn at least 6 px wide, and its grips share it
  const shown = Math.max(dateToX(dates.due, scale) + scale.px_per_day - x, 6);
  const grip = Math.min(24, Math.max(8, shown / 3));
  const look = BAR[tone];
  const share = progress && progress.total > 0 ? progress.done / progress.total : null;

  return (
    <>
      {/* a dragged bar lifts off the paper: the drag elevation lies under it */}
      {dragging && <span aria-hidden="true" className="absolute top-1/2 h-5 -translate-y-1/2 rounded-chip shadow-elev-drag" style={{ left: x, width: shown }} />}
      <div
        aria-hidden="true"
        data-timeline-bar={item.id}
        onPointerDown={handlers.onPointerDown}
        onClick={handlers.onClick}
        className={cx('absolute inset-y-0 select-none', editable ? (dragging ? 'cursor-grabbing' : 'cursor-grab') : 'cursor-pointer')}
        style={{ left: x - BAR_REACH, width: shown + 2 * BAR_REACH }}
      >
        <div className={cx('absolute top-1/2 h-5 -translate-y-1/2 overflow-hidden rounded-chip ring-1 ring-inset', look.bar)} style={{ left: BAR_REACH, width: shown }}>
          {share !== null && <span data-progress="" className={cx('block h-full', look.fill)} style={{ width: `${share * 100}%` }} />}
        </div>
        {editable && (
          <>
            <span data-edge="start" className={GRIP} style={{ left: BAR_REACH - grip / 2, width: grip }} />
            <span data-edge="due" className={GRIP} style={{ left: BAR_REACH + shown - grip / 2, width: grip }} />
          </>
        )}
      </div>
      {share !== null && (
        <span aria-hidden="true" className="absolute top-1/2 -translate-y-1/2 pl-2 text-sm font-semibold whitespace-nowrap text-muted tabular-nums" style={{ left: x + shown }}>
          {new Intl.NumberFormat(intlLocale(), { style: 'percent' }).format(share)}
        </span>
      )}
    </>
  );
}
