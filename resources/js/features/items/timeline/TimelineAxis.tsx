/*
 * The axis of the timeline and the grid behind its rows, ported from the clickdummy: months (or quarters) over days,
 * calendar weeks or months (`scaleTicks`), the day under a card on its way from "Ohne Datum", the first and last day of
 * a bar that moves, and today in the highlighter (DESIGN.md: by day ink on the yellow area, at night yellow text with
 * a glow). Both are pure drawing: hidden from assistive tech, the rows say what they show.
 */

import type { RefObject } from 'react';
import { formatShortDay } from '@/components/fields/format';
import { cx } from '@/components/ui/cx';
import { dateToX, type DateRange, type Tick, type TimelineScale } from '@/domain/timeline';
import { weekdayOf } from '@/domain/tz';
import { t } from '@/lib/i18n';

/** The height of the axis above the rows (`h-14`): the rows begin below it in the scroll box. */
export const AXIS_HEIGHT = 56;

/** A chip on the axis in the accent: the day under a moving card or bar. */
const DAY_CHIP = 'absolute bottom-1 z-10 rounded-chip bg-accent px-1.5 py-0.5 text-sm font-semibold whitespace-nowrap text-on-accent tabular-nums';

interface AxisProps {
  scale: TimelineScale;
  /** The width of the days of the axis, without the title column. */
  width: number;
  ticks: { major: Tick[]; minor: Tick[] };
  today: string;
  /** The bars that move now (a drag or held keys), with the days they would get. */
  drafts: readonly (readonly [string, DateRange])[];
  /** The day under a card from "Ohne Datum", while it is over the axis. */
  planningDay: string | null;
}

/** Where today's line stands: the middle of its day. */
export const todayX = (today: string, scale: TimelineScale) => dateToX(today, scale) + scale.px_per_day / 2;

export function TimelineAxis({ scale, width, ticks, today, drafts, planningDay }: AxisProps) {
  return (
    <div data-timeline-axis="" aria-hidden="true" className="sticky top-0 z-20 flex h-14 border-b border-line bg-paper">
      <div data-timeline-label="" className="sticky left-0 z-20 flex w-(--label-w) shrink-0 items-end bg-paper px-4 pb-2 text-sm text-muted">
        {t('items.timeline.axis')}
      </div>
      <div className="relative shrink-0 overflow-clip" style={{ width }}>
        {/* a month (or quarter) keeps its name at the left edge while it is in view */}
        {ticks.major.map((tick, index) => {
          const left = dateToX(tick.date, scale);
          const right = index + 1 < ticks.major.length ? dateToX(ticks.major[index + 1]!.date, scale) : width;
          return (
            <div key={tick.date} className="absolute top-0 h-7" style={{ left, width: right - left }}>
              <span className="sticky left-(--label-w) inline-block pt-1.5 pl-1.5 text-sm font-semibold whitespace-nowrap text-ink">{tick.label}</span>
            </div>
          );
        })}
        {ticks.minor.map((tick) => (
          <span key={tick.date} className="absolute bottom-1.5 pl-1.5 text-sm whitespace-nowrap text-muted tabular-nums" style={{ left: dateToX(tick.date, scale) }}>
            {tick.label}
          </span>
        ))}
        {planningDay && (
          <span className={cx(DAY_CHIP, '-translate-x-1/2')} style={{ left: dateToX(planningDay, scale) }}>
            {t('items.timeline.from_day', { day: formatShortDay(planningDay) })}
          </span>
        )}
        {drafts.map(([id, dates]) => (
          <span key={id} className="contents">
            <span className={DAY_CHIP} style={{ left: dateToX(dates.start, scale) }}>
              {formatShortDay(dates.start)}
            </span>
            <span className={cx(DAY_CHIP, '-translate-x-full')} style={{ left: dateToX(dates.due, scale) + scale.px_per_day }}>
              {formatShortDay(dates.due)}
            </span>
          </span>
        ))}
        {/*
         * in the row of the weeks or days, so the name of the month beside it stays readable. The highlighter's own
         * tokens: by day ink on the yellow area, at night yellow text with a glow over a faint wash. The paper under it
         * covers the week numbers behind the label.
         */}
        <span data-today="" className="absolute bottom-1 z-10 flex -translate-x-1/2 bg-paper" style={{ left: todayX(today, scale) }}>
          <span className="flex h-6 items-center rounded-chip [background-color:var(--mark-bg)] px-1.5 text-sm font-semibold whitespace-nowrap tabular-nums [color:var(--mark-fg)] [text-shadow:var(--mark-glow)]">
            {t('items.timeline.today', { day: formatShortDay(today) })}
          </span>
        </span>
      </div>
    </div>
  );
}

interface GridProps extends AxisProps {
  /** The weekends get a tint at week zoom. */
  days: boolean;
  gridRef: RefObject<HTMLDivElement | null>;
}

/** The lines behind the rows: units, the weekends at week zoom, the days of what moves, and today. */
export function TimelineGrid({ scale, width, ticks, today, drafts, planningDay, days, gridRef }: GridProps) {
  const at = todayX(today, scale);
  return (
    <div ref={gridRef} data-timeline-grid="" aria-hidden="true" className="pointer-events-none absolute top-14 bottom-0 left-(--label-w)" style={{ width }}>
      {days &&
        ticks.minor
          .filter((tick) => weekdayOf(tick.date) === 0 || weekdayOf(tick.date) === 6)
          .map((tick) => <span key={`weekend-${tick.date}`} className="absolute inset-y-0 bg-hover" style={{ left: dateToX(tick.date, scale), width: scale.px_per_day }} />)}
      {ticks.minor.map((tick) => (
        <span key={`minor-${tick.date}`} className={cx('absolute inset-y-0 border-l', tick.strong ? 'border-line-strong' : 'border-line')} style={{ left: dateToX(tick.date, scale) }} />
      ))}
      {ticks.major.slice(1).map((tick) => (
        <span key={`major-${tick.date}`} className="absolute inset-y-0 border-l border-line-strong" style={{ left: dateToX(tick.date, scale) }} />
      ))}
      {planningDay && <span className="absolute inset-y-0 border-l-2 border-dashed border-accent" style={{ left: dateToX(planningDay, scale) }} />}
      {drafts.flatMap(([id, dates]) => [
        <span key={`start-${id}`} className="absolute inset-y-0 border-l border-dashed border-accent" style={{ left: dateToX(dates.start, scale) }} />,
        <span key={`due-${id}`} className="absolute inset-y-0 border-l border-dashed border-accent" style={{ left: dateToX(dates.due, scale) + scale.px_per_day }} />,
      ])}
      <span className="absolute inset-y-0 w-2 -translate-x-1/2 bg-wash" style={{ left: at }} />
      <span className="absolute inset-y-0 w-0.5 -translate-x-1/2 bg-accent" style={{ left: at }} />
    </div>
  );
}
