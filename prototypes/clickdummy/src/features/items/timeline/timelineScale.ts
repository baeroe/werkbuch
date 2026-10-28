/*
 * The time axis of the timeline (spec 4.11): where a day sits in pixels, which day lies under a point, the range the
 * axis covers and its labels. Pure functions on calendar days ('YYYY-MM-DD'), so the layout stays a thin view.
 *
 * A day is a column `px_per_day` wide: day `d` spans [dateToX(d), dateToX(d) + px_per_day). A bar from start to due
 * covers both days. The zoom sets the width of a day and the unit the keyboard moves by (spec: "um eine Einheit"):
 *   week     40 px a day, unit: one day     axis: months over days
 *   month    12 px a day, unit: one week    axis: months over calendar weeks
 *   quarter   4 px a day, unit: one month   axis: quarters over months
 */

import { addDays, daysInMonth, diffDays, endOfMonth, formatDate, isoWeek, splitDate, startOfMonth, startOfWeek, weekdayOf } from '@/domain/tz';

export type Zoom = 'week' | 'month' | 'quarter';

export interface TimelineScale {
  /** The first day of the axis, at x = 0. */
  start: string;
  zoom: Zoom;
  px_per_day: number;
}

/** A start and a due date, both set. */
export interface DateRange {
  start: string;
  due: string;
}

/** How wide a day is at each zoom. */
export const PX_PER_DAY: Record<Zoom, number> = { week: 40, month: 12, quarter: 4 };

/** The zooms by name, as the switch offers them. */
export const ZOOM_LABELS: Record<Zoom, string> = { week: 'Woche', month: 'Monat', quarter: 'Quartal' };

/** What one step of the keyboard moves by, for the help and the announcements. */
export const UNIT_LABELS: Record<Zoom, { one: string; label: string }> = {
  week: { one: 'einen Tag', label: 'Tag' },
  month: { one: 'eine Woche', label: 'Woche' },
  quarter: { one: 'einen Monat', label: 'Monat' },
};

/** The left edge of a day's column. */
export function dateToX(date: string, scale: TimelineScale): number {
  return diffDays(scale.start, date) * scale.px_per_day;
}

/** The day whose column holds the point `x`. */
export function xToDate(x: number, scale: TimelineScale): string {
  // the small epsilon keeps a left edge computed in floating point inside its own day
  return addDays(scale.start, Math.floor(x / scale.px_per_day + 1e-9));
}

/* -------------------------------------------------------------------------- units */

/** A day `months` calendar months later; a day the month does not have falls back to its last day. */
function addMonths(date: string, months: number): string {
  const { year, month, day } = splitDate(date);
  const index = year * 12 + (month - 1) + months;
  const targetYear = Math.floor(index / 12);
  const targetMonth = (index % 12) + 1;
  return formatDate(targetYear, targetMonth, Math.min(day, daysInMonth(targetYear, targetMonth)));
}

/** A day moved by `steps` units of the zoom: days, weeks or calendar months. */
export function shiftByUnit(date: string, zoom: Zoom, steps: number): string {
  if (zoom === 'week') return addDays(date, steps);
  if (zoom === 'month') return addDays(date, steps * 7);
  return addMonths(date, steps);
}

/** Start and due moved together by `steps` units. */
export function moveRange(range: DateRange, zoom: Zoom, steps: number): DateRange {
  return { start: shiftByUnit(range.start, zoom, steps), due: shiftByUnit(range.due, zoom, steps) };
}

/** The due date moved by `steps` units; it never passes the start (one day is the shortest bar). */
export function resizeRange(range: DateRange, zoom: Zoom, steps: number): DateRange {
  const due = shiftByUnit(range.due, zoom, steps);
  return { start: range.start, due: due < range.start ? range.start : due };
}

/* -------------------------------------------------------------------------- range */

/** The first day of the quarter a day falls in. */
function startOfQuarter(date: string): string {
  const { year, month } = splitDate(date);
  return formatDate(year, month - ((month - 1) % 3), 1);
}

function endOfQuarter(date: string): string {
  const { year, month } = splitDate(date);
  const last = month - ((month - 1) % 3) + 2;
  return formatDate(year, last, daysInMonth(year, last));
}

/** Where a unit of the axis begins: Monday, the first of the month, the first of the quarter. */
export function startOfUnit(date: string, zoom: Zoom): string {
  if (zoom === 'week') return startOfWeek(date, 1);
  if (zoom === 'month') return startOfMonth(date);
  return startOfQuarter(date);
}

function endOfUnit(date: string, zoom: Zoom): string {
  if (zoom === 'week') return addDays(startOfWeek(date, 1), 6);
  if (zoom === 'month') return endOfMonth(date);
  return endOfQuarter(date);
}

/** Room before the earliest day; after the latest day there is twice as much, the side plans grow into. */
const PADDING_DAYS: Record<Zoom, number> = { week: 7, month: 14, quarter: 30 };

/**
 * The days the axis covers: from a unit boundary some room before the earliest of `dates` (and today) to the end of
 * the unit some room after the latest.
 */
export function timelineRange(dates: readonly string[], today: string, zoom: Zoom): { start: string; end: string } {
  const all = [...dates, today];
  const earliest = all.reduce((min, date) => (date < min ? date : min));
  const latest = all.reduce((max, date) => (date > max ? date : max));
  return {
    start: startOfUnit(addDays(earliest, -PADDING_DAYS[zoom]), zoom),
    end: endOfUnit(addDays(latest, PADDING_DAYS[zoom] * 2), zoom),
  };
}

/* -------------------------------------------------------------------------- ticks */

export interface Tick {
  date: string;
  label: string;
  /** A day that begins a new week (week zoom): its line is drawn stronger. */
  strong: boolean;
}

const MONTH_YEAR = new Intl.DateTimeFormat('de-DE', { month: 'long', year: 'numeric', timeZone: 'UTC' });
const MONTH_SHORT = new Intl.DateTimeFormat('de-DE', { month: 'short', timeZone: 'UTC' });
const WEEKDAY = new Intl.DateTimeFormat('de-DE', { weekday: 'short', timeZone: 'UTC' });
const DAY_NUMBER = new Intl.DateTimeFormat('de-DE', { day: 'numeric', timeZone: 'UTC' });
const YEAR = new Intl.DateTimeFormat('de-DE', { year: 'numeric', timeZone: 'UTC' });
const utc = (date: string) => new Date(`${date}T00:00:00Z`);

/** The days from `start` to `end` that begin a unit (`step` moves to the next one). */
function unitStarts(start: string, end: string, first: string, step: (date: string) => string): string[] {
  const days: string[] = [];
  for (let date = first; date <= end; date = step(date)) if (date >= start) days.push(date);
  return days;
}

/**
 * The two rows of the axis. `major` names the larger unit (the first one at the start of the range, even when the
 * unit began earlier); `minor` marks the smaller one.
 */
export function scaleTicks(range: { start: string; end: string }, zoom: Zoom): { major: Tick[]; minor: Tick[] } {
  const { start, end } = range;
  const months = unitStarts(start, end, startOfMonth(start), (date) => addMonths(date, 1));

  if (zoom === 'quarter') {
    const quarters = unitStarts(start, end, startOfQuarter(start), (date) => addMonths(date, 3));
    const majorDays = quarters[0] === start ? quarters : [start, ...quarters];
    return {
      major: majorDays.map((date) => ({ date, label: `Q${Math.floor((splitDate(date).month - 1) / 3) + 1} ${YEAR.format(utc(date))}`, strong: true })),
      minor: months.map((date) => ({ date, label: MONTH_SHORT.format(utc(date)), strong: false })),
    };
  }

  const majorDays = months[0] === start ? months : [start, ...months];
  const major = majorDays.map((date) => ({ date, label: MONTH_YEAR.format(utc(date)), strong: true }));

  if (zoom === 'month') {
    const mondays = unitStarts(start, end, startOfWeek(start, 1), (date) => addDays(date, 7));
    return { major, minor: mondays.map((date) => ({ date, label: `KW ${isoWeek(date)}`, strong: false })) };
  }

  const days = unitStarts(start, end, start, (date) => addDays(date, 1));
  return {
    major,
    minor: days.map((date) => ({ date, label: `${WEEKDAY.format(utc(date))} ${DAY_NUMBER.format(utc(date))}`, strong: weekdayOf(date) === 1 })),
  };
}
