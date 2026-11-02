/*
 * The time axis of the timeline (spec 4.11): where a day sits in pixels, which day lies under a point, the range the
 * axis covers and its labels. Pure functions on calendar days ('YYYY-MM-DD'), so the layout stays a thin view.
 *
 * A day is a column `px_per_day` wide: day `d` spans [dateToX(d), dateToX(d) + px_per_day). A bar from start to due
 * covers both days. The zoom sets the width of a day and the unit the keyboard moves by (spec: "um eine Einheit"):
 *   week     40 px a day, unit: one day     axis: months over days
 *   month    12 px a day, unit: one week    axis: months over calendar weeks
 *   quarter   4 px a day, unit: one month   axis: quarters over months
 *
 * Weeks begin on the organisation's first weekday (`week_start`, Monday by default); a calendar week is named by the
 * ISO number of the Monday in it.
 */

import { intlLocale, t } from '@/lib/i18n';
import type { Weekday } from '@/types';
import { addDays, daysInMonth, diffDays, endOfMonth, formatDate, isoWeek, splitDate, startOfMonth, startOfWeek, weekdayOf } from './tz';

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

/** Where a unit of the axis begins: the first day of the week, the first of the month, the first of the quarter. */
export function startOfUnit(date: string, zoom: Zoom, weekStart: Weekday = 1): string {
  if (zoom === 'week') return startOfWeek(date, weekStart);
  if (zoom === 'month') return startOfMonth(date);
  return startOfQuarter(date);
}

function endOfUnit(date: string, zoom: Zoom, weekStart: Weekday): string {
  if (zoom === 'week') return addDays(startOfWeek(date, weekStart), 6);
  if (zoom === 'month') return endOfMonth(date);
  return endOfQuarter(date);
}

/** Room before the earliest day; after the latest day there is twice as much, the side plans grow into. */
const PADDING_DAYS: Record<Zoom, number> = { week: 7, month: 14, quarter: 30 };

/**
 * The days the axis covers: from a unit boundary some room before the earliest of `dates` (and today) to the end of
 * the unit some room after the latest.
 */
export function timelineRange(dates: readonly string[], today: string, zoom: Zoom, weekStart: Weekday = 1): { start: string; end: string } {
  const all = [...dates, today];
  const earliest = all.reduce((min, date) => (date < min ? date : min));
  const latest = all.reduce((max, date) => (date > max ? date : max));
  return {
    start: startOfUnit(addDays(earliest, -PADDING_DAYS[zoom]), zoom, weekStart),
    end: endOfUnit(addDays(latest, PADDING_DAYS[zoom] * 2), zoom, weekStart),
  };
}

/* -------------------------------------------------------------------------- ticks */

export interface Tick {
  date: string;
  label: string;
  /** A day that begins a new week (week zoom, the organisation's first weekday): its line is drawn stronger. */
  strong: boolean;
}

/** The formatters of the axis in the language of the page; the locale can change between two calls. */
function formats() {
  const locale = intlLocale();
  const make = (options: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat(locale, { ...options, timeZone: 'UTC' });
  return {
    monthYear: make({ month: 'long', year: 'numeric' }),
    monthShort: make({ month: 'short' }),
    weekday: make({ weekday: 'short' }),
    dayNumber: make({ day: 'numeric' }),
    year: make({ year: 'numeric' }),
  };
}

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
export function scaleTicks(range: { start: string; end: string }, zoom: Zoom, weekStart: Weekday = 1): { major: Tick[]; minor: Tick[] } {
  const { start, end } = range;
  const format = formats();
  const months = unitStarts(start, end, startOfMonth(start), (date) => addMonths(date, 1));

  if (zoom === 'quarter') {
    const quarters = unitStarts(start, end, startOfQuarter(start), (date) => addMonths(date, 3));
    const majorDays = quarters[0] === start ? quarters : [start, ...quarters];
    return {
      major: majorDays.map((date) => ({ date, label: `Q${Math.floor((splitDate(date).month - 1) / 3) + 1} ${format.year.format(utc(date))}`, strong: true })),
      minor: months.map((date) => ({ date, label: format.monthShort.format(utc(date)), strong: false })),
    };
  }

  const majorDays = months[0] === start ? months : [start, ...months];
  const major = majorDays.map((date) => ({ date, label: format.monthYear.format(utc(date)), strong: true }));

  if (zoom === 'month') {
    const weeks = unitStarts(start, end, startOfWeek(start, weekStart), (date) => addDays(date, 7));
    // a week from Sunday is named by its Monday
    const monday = (date: string) => startOfWeek(addDays(date, 6), 1);
    return { major, minor: weeks.map((date) => ({ date, label: t('items.timeline.week_number', { week: String(isoWeek(monday(date))) }), strong: false })) };
  }

  const days = unitStarts(start, end, start, (date) => addDays(date, 1));
  return {
    major,
    minor: days.map((date) => ({ date, label: `${format.weekday.format(utc(date))} ${format.dayNumber.format(utc(date))}`, strong: weekdayOf(date) === weekStart })),
  };
}
