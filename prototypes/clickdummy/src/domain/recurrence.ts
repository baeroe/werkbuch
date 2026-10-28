/*
 * Recurring templates (spec 4.12): when a schedule fires.
 *
 * A schedule works on the local calendar of the organisation's time zone: first the days it falls on are worked out as
 * plain 'YYYY-MM-DD' dates, then each of them is turned into an instant with the wall-clock time `time` in that zone.
 * That is why a daily 09:00 stays at 09:00 on the wall clock when summer time starts or ends.
 *
 * Counting `interval`:
 * - daily: every N days from `starts_on`
 * - weekly: every N weeks, counted from the week (Monday to Sunday) of `starts_on`; days of that week before
 *   `starts_on` are skipped
 * - monthly: every N months from the month of `starts_on`
 * - yearly: every N years from the year of `starts_on`
 */

import type { Schedule, Weekday } from '@/types';
import {
  addDays,
  createZone,
  daysInMonth,
  diffDays,
  formatDate,
  parseDate,
  parseTime,
  splitDate,
  weekdayOf,
  type YearMonthDay,
} from './tz';

/** A schedule that has been checked and normalised. */
interface Plan {
  schedule: Schedule;
  /** At least 1, a whole number. */
  interval: number;
  start: YearMonthDay;
  /** The last day the schedule may fire on, if it ends on a date. */
  endsOn: string | null;
}

/** Null when the schedule cannot be read: a start day, end day or time that does not exist. */
function prepare(schedule: Schedule): Plan | null {
  const start = parseDate(schedule.starts_on);
  if (!start || !parseTime(schedule.time)) return null;

  let endsOn: string | null = null;
  if (schedule.ends.type === 'on') {
    if (!parseDate(schedule.ends.date)) return null;
    endsOn = schedule.ends.date;
  }

  const interval = Number.isFinite(schedule.interval) && schedule.interval >= 1 ? Math.floor(schedule.interval) : 1;
  return { schedule, interval, start, endsOn };
}

/** How many runs may still happen: the wanted number, capped by what is left of a schedule that ends after N runs. */
function runLimit(schedule: Schedule, wanted: number, runCount: number): number {
  const limit = Number.isFinite(wanted) ? Math.floor(wanted) : 0;
  if (schedule.ends.type !== 'count') return limit;
  const left = Math.floor(schedule.ends.count - runCount);
  return Number.isNaN(left) ? 0 : Math.min(limit, left);
}

const isWeekday = (value: unknown): value is Weekday =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 6;

/** The days after Monday (Monday 0 … Sunday 6) a weekly schedule fires on, in order. */
function weekdayOffsets(schedule: Schedule): number[] {
  const weekdays = (schedule.weekdays ?? []).filter(isWeekday);
  if (weekdays.length === 0) weekdays.push(weekdayOf(schedule.starts_on));
  return [...new Set(weekdays.map((weekday) => (weekday + 6) % 7))].sort((a, b) => a - b);
}

/** The day of the month a monthly schedule fires on in a given month. */
function dayOfMonth(schedule: Schedule, start: YearMonthDay, year: number, month: number): number {
  const length = daysInMonth(year, month);

  const nth = schedule.nth_weekday;
  if (nth && [1, 2, 3, 4, -1].includes(nth.n) && isWeekday(nth.weekday)) {
    if (nth.n > 0) {
      const firstWeekday = weekdayOf(formatDate(year, month, 1));
      return 1 + ((nth.weekday - firstWeekday + 7) % 7) + 7 * (nth.n - 1);
    }
    const lastWeekday = weekdayOf(formatDate(year, month, length));
    return length - ((lastWeekday - nth.weekday + 7) % 7);
  }

  if (schedule.month_day === 'last') return length;
  if (typeof schedule.month_day === 'number' && Number.isFinite(schedule.month_day)) {
    return Math.min(Math.max(1, Math.floor(schedule.month_day)), length);
  }
  return Math.min(start.day, length);
}

/** The month and day a yearly schedule fires on. */
function yearlyDate(schedule: Schedule, start: YearMonthDay): { month: number; day: number } {
  const match = /^(\d{2})-(\d{2})$/.exec(schedule.yearly_date ?? '');
  if (match) {
    const month = Number(match[1]);
    const day = Number(match[2]);
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) return { month, day };
  }
  return { month: start.month, day: start.day };
}

/**
 * The days a schedule falls on from `lowest` on, in order and without end. `lowest` is not before `starts_on`.
 * A day is yielded only once; `lowest` itself is included when the schedule falls on it.
 */
function* scheduleDays(plan: Plan, lowest: string): Generator<string> {
  const { schedule, interval, start } = plan;
  const startsOn = schedule.starts_on;

  switch (schedule.frequency) {
    case 'daily': {
      const elapsed = diffDays(startsOn, lowest);
      let day = addDays(startsOn, Math.ceil(elapsed / interval) * interval);
      for (;;) {
        yield day;
        day = addDays(day, interval);
      }
    }
    case 'weekly': {
      const offsets = weekdayOffsets(schedule);
      const firstMonday = addDays(startsOn, -((weekdayOf(startsOn) + 6) % 7));
      const span = 7 * interval;
      for (let block = Math.max(0, Math.floor(diffDays(firstMonday, lowest) / span)); ; block++) {
        const monday = addDays(firstMonday, block * span);
        for (const offset of offsets) {
          const day = addDays(monday, offset);
          if (day >= lowest) yield day;
        }
      }
    }
    case 'monthly': {
      const low = splitDate(lowest);
      const anchor = start.year * 12 + start.month - 1;
      const lowIndex = low.year * 12 + low.month - 1;
      for (let block = Math.max(0, Math.floor((lowIndex - anchor) / interval)); ; block++) {
        const index = anchor + block * interval;
        const year = Math.floor(index / 12);
        const month = (index % 12) + 1;
        const day = formatDate(year, month, dayOfMonth(schedule, start, year, month));
        if (day >= lowest) yield day;
      }
    }
    case 'yearly': {
      const { month, day: dayInMonth } = yearlyDate(schedule, start);
      const lowYear = splitDate(lowest).year;
      for (let block = Math.max(0, Math.floor((lowYear - start.year) / interval)); ; block++) {
        const year = start.year + block * interval;
        const day = formatDate(year, month, Math.min(dayInMonth, daysInMonth(year, month)));
        if (day >= lowest) yield day;
      }
    }
  }
}

/** The days a schedule falls on from `from` on, not before the start day and not after the end day. */
function* scheduledDays(plan: Plan, from: string): Generator<string> {
  const lowest = from > plan.schedule.starts_on ? from : plan.schedule.starts_on;
  for (const day of scheduleDays(plan, lowest)) {
    if (plan.endsOn !== null && day > plan.endsOn) return;
    yield day;
  }
}

/**
 * The next `count` times a schedule fires after `after`, as instants in ascending order. `runCount` is how often it
 * has run so far; a schedule that ends after N runs gives at most N - runCount more. A paused schedule, or one that
 * cannot be read (no valid start day, end day or time), gives none. Throws `RangeError` for an unknown time zone.
 */
export function nextOccurrences(
  s: Schedule,
  after: Date,
  count: number,
  timeZone: string,
  runCount = 0,
): Date[] {
  const zone = createZone(timeZone);
  const plan = prepare(s);
  const limit = runLimit(s, count, runCount);
  if (s.paused || plan === null || limit <= 0 || Number.isNaN(after.getTime())) return [];

  const result: Date[] = [];
  // start a day early: the local day of `after` may still hold a time later than `after`
  for (const day of scheduledDays(plan, addDays(zone.date(after), -1))) {
    const at = zone.toUtc(day, s.time);
    if (at.getTime() <= after.getTime()) continue;
    result.push(at);
    if (result.length >= limit) break;
  }
  return result;
}

/**
 * Of all the times a schedule should have fired after `lastRunAt` and up to `now`, the latest one: the single run to
 * catch up when several were missed (spec 4.12). Null when nothing is due. Without a previous run (`lastRunAt` null)
 * the schedule counts from its start day. A paused schedule, one whose runs are used up (`runCount`) or one that cannot
 * be read gives null.
 */
export function missedRunToCatchUp(
  s: Schedule,
  lastRunAt: Date | null,
  now: Date,
  timeZone: string,
  runCount = 0,
): Date | null {
  const zone = createZone(timeZone);
  const plan = prepare(s);
  if (s.paused || plan === null || runLimit(s, 1, runCount) <= 0 || Number.isNaN(now.getTime())) return null;

  const today = zone.date(now);
  const from = lastRunAt === null ? s.starts_on : addDays(zone.date(lastRunAt), -1);

  // only the last two days up to today can hold the latest run: today's may not be due yet, the one before always is
  const latestDays: string[] = [];
  for (const day of scheduledDays(plan, from)) {
    if (day > today) break;
    latestDays.push(day);
    if (latestDays.length > 2) latestDays.shift();
  }

  for (const day of latestDays.reverse()) {
    const at = zone.toUtc(day, s.time);
    if (at.getTime() > now.getTime()) continue;
    return lastRunAt === null || at.getTime() > lastRunAt.getTime() ? at : null;
  }
  return null;
}
