/*
 * Time zone and calendar helpers. Intl only, no date library.
 *
 * Two kinds of values are kept apart:
 * - instants are `Date` objects, a point on the UTC time line;
 * - civil dates are 'YYYY-MM-DD' strings without a zone, plain calendar days (the format of `due_date` & co.).
 * Weekdays follow `Date#getDay()`: 0 = Sunday … 6 = Saturday.
 */

import type { Weekday } from '@/types';

const MINUTE_MS = 60_000;
const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

export interface YearMonthDay {
  year: number;
  month: number;
  day: number;
}

/** Midnight UTC of a calendar day, in ms. Unlike `Date.UTC` this treats years 0-99 as what they say. */
function dayStartMs(year: number, month: number, day: number): number {
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  return date.getTime();
}

function pad(value: number, width: number): string {
  return String(value).padStart(width, '0');
}

/* ------------------------------------------------------------------ civil dates */

export function formatDate(year: number, month: number, day: number): string {
  return `${pad(year, 4)}-${pad(month, 2)}-${pad(day, 2)}`;
}

/** The number of days in a month; `month` counts from 1. */
export function daysInMonth(year: number, month: number): number {
  return new Date(dayStartMs(year, month + 1, 0)).getUTCDate();
}

/** Splits a 'YYYY-MM-DD' string; null when it is not a real day on the calendar. */
export function parseDate(date: string): YearMonthDay | null {
  const match = DATE_PATTERN.exec(date);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) return null;
  return { year, month, day };
}

/** Like `parseDate`, but for dates that must be valid. */
export function splitDate(date: string): YearMonthDay {
  const parts = parseDate(date);
  if (!parts) throw new RangeError(`Invalid date: "${date}"`);
  return parts;
}

/** Splits an 'HH:MM' time of day; null when it is not one. */
export function parseTime(time: string): { hour: number; minute: number } | null {
  const match = TIME_PATTERN.exec(time);
  return match ? { hour: Number(match[1]), minute: Number(match[2]) } : null;
}

function dayMs(date: string): number {
  const { year, month, day } = splitDate(date);
  return dayStartMs(year, month, day);
}

export function addDays(date: string, days: number): string {
  const moved = new Date(dayMs(date) + days * DAY_MS);
  return formatDate(moved.getUTCFullYear(), moved.getUTCMonth() + 1, moved.getUTCDate());
}

/** The days from `from` to `to`; negative when `to` is earlier. */
export function diffDays(from: string, to: string): number {
  return Math.round((dayMs(to) - dayMs(from)) / DAY_MS);
}

export function weekdayOf(date: string): Weekday {
  return new Date(dayMs(date)).getUTCDay() as Weekday;
}

/** The first day of the week the date falls in; `weekStart` is the weekday the week begins on. */
export function startOfWeek(date: string, weekStart: Weekday): string {
  return addDays(date, -((weekdayOf(date) - weekStart + 7) % 7));
}

export function startOfMonth(date: string): string {
  const { year, month } = splitDate(date);
  return formatDate(year, month, 1);
}

export function endOfMonth(date: string): string {
  const { year, month } = splitDate(date);
  return formatDate(year, month, daysInMonth(year, month));
}

/** The ISO 8601 week number (weeks start on Monday, week 1 holds the first Thursday of the year). */
export function isoWeek(date: string): number {
  const weekday = weekdayOf(date);
  // the Thursday of the week decides which year the week belongs to
  const thursday = addDays(date, 4 - (weekday === 0 ? 7 : weekday));
  const { year } = splitDate(thursday);
  const dayOfYear = diffDays(formatDate(year, 1, 1), thursday) + 1;
  return Math.floor((dayOfYear - 1) / 7) + 1;
}

/* -------------------------------------------------------------------- time zones */

export interface ZonedParts extends YearMonthDay {
  hour: number;
  minute: number;
  second: number;
  weekday: Weekday;
}

/** A time zone to convert in. Create it once per computation: it holds one `Intl.DateTimeFormat`. */
export interface Zone {
  readonly timeZone: string;
  /** The wall clock of an instant. */
  parts(at: Date): ZonedParts;
  /** The local calendar day of an instant, 'YYYY-MM-DD'. */
  date(at: Date): string;
  /** The offset to UTC at an instant, in minutes east of UTC. */
  offsetMinutes(at: Date): number;
  /**
   * The instant of a wall-clock time on a local day. When the clocks turn back and the time happens twice, the first
   * one wins; when the clocks jump forward over it, the time moves forward by the length of the gap.
   * Throws `RangeError` for a date or time that does not exist on the calendar.
   */
  toUtc(date: string, time: string): Date;
}

/** Throws `RangeError` for a time zone name Intl does not know. */
export function createZone(timeZone: string): Zone {
  const format = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
  });

  function clock(at: Date) {
    const fields = { year: 0, month: 0, day: 0, hour: 0, minute: 0, second: 0 };
    for (const part of format.formatToParts(at)) {
      if (part.type in fields) fields[part.type as keyof typeof fields] = Number(part.value);
    }
    fields.hour %= 24; // some engines write midnight as 24
    return fields;
  }

  function parts(at: Date): ZonedParts {
    const fields = clock(at);
    return { ...fields, weekday: weekdayOf(formatDate(fields.year, fields.month, fields.day)) };
  }

  function offsetMs(at: Date): number {
    const { year, month, day, hour, minute, second } = clock(at);
    const wallClockAsUtc = dayStartMs(year, month, day) + hour * HOUR_MS + minute * MINUTE_MS + second * 1000;
    return wallClockAsUtc - Math.floor(at.getTime() / 1000) * 1000;
  }

  function toUtc(date: string, time: string): Date {
    const day = parseDate(date);
    const clockTime = parseTime(time);
    if (!day || !clockTime) throw new RangeError(`Invalid local time: "${date} ${time}"`);

    // the wall-clock time read as if it were UTC; the zone's offset turns it into the real instant
    const wall = dayStartMs(day.year, day.month, day.day) + clockTime.hour * HOUR_MS + clockTime.minute * MINUTE_MS;
    const offsetBefore = offsetMs(new Date(wall - DAY_MS));
    const offsetAfter = offsetMs(new Date(wall + DAY_MS));
    if (offsetBefore === offsetAfter) return new Date(wall - offsetBefore);

    // a switch is near: try the offset from before and from after it, and keep those that really give this wall time
    const early = wall - offsetBefore;
    const late = wall - offsetAfter;
    const earlyHolds = offsetMs(new Date(early)) === offsetBefore;
    const lateHolds = offsetMs(new Date(late)) === offsetAfter;
    if (earlyHolds && lateHolds) return new Date(Math.min(early, late)); // happens twice: the first time
    if (lateHolds) return new Date(late);
    return new Date(early); // only the old offset fits, or none does (gap): the old offset moves the time forward
  }

  return {
    timeZone,
    parts,
    date: (at) => {
      const { year, month, day } = clock(at);
      return formatDate(year, month, day);
    },
    offsetMinutes: (at) => offsetMs(at) / MINUTE_MS,
    toUtc,
  };
}

/** The zones `cachedZone` has handed out, by name. */
const zones = new Map<string, Zone>();

/**
 * `createZone`, remembered per time zone name. For code that needs a zone for every item of a long list (the filter
 * engine reads the day of three timestamps per item): the formatter is built once, not once per item. A zone holds no
 * state apart from its formatter, so sharing it is safe. An unknown name throws every time and is not remembered.
 */
export function cachedZone(timeZone: string): Zone {
  let zone = zones.get(timeZone);
  if (zone === undefined) {
    zone = createZone(timeZone);
    zones.set(timeZone, zone);
  }
  return zone;
}
