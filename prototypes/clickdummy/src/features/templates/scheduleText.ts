/*
 * A schedule in words (spec 4.12), as the template list and the schedule editor show it:
 *   "Jeden ersten Montag im Monat um 09:00", "Alle 2 Wochen am Mittwoch um 09:00",
 *   "Monatlich am 31. (oder letzten Tag) um 09:00", "Täglich um 09:00, endet nach 12 Läufen".
 * It reads the schedule the way `nextOccurrences` runs it: a broken interval counts as 1, a weekly schedule without days
 * runs on the weekday of its start, a monthly one without a day on the day of its start, a yearly one on the date of its
 * start. Start and pause are not part of the sentence; the screens show them on their own.
 */

import { formatDay } from '@/components/fields/format';
import { daysInMonth, parseDate, weekdayOf } from '@/domain/tz';
import type { Schedule, Weekday } from '@/types';

const WEEKDAYS = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'] as const;
const ORDINALS: Record<number, string> = { 1: 'ersten', 2: 'zweiten', 3: 'dritten', 4: 'vierten', [-1]: 'letzten' };

const LIST = new Intl.ListFormat('de-DE', { type: 'conjunction' });
const MONTH = new Intl.DateTimeFormat('de-DE', { month: 'long', timeZone: 'UTC' });

/** A year without 29 February: a day after the shortest length of its month falls back in some years. */
const SHORT_YEAR = 2027;

const isWeekday = (value: unknown): value is Weekday => typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 6;

/** The German name of a month, counted from 1. */
export const monthName = (month: number): string => MONTH.format(new Date(Date.UTC(2026, month - 1, 1)));

/** The weekday names of the week as it is counted here: Monday first, Sunday last. */
export const weekdayName = (day: Weekday): string => WEEKDAYS[day];

/** Like the schedule: at least 1, a whole number. */
const intervalOf = (s: Schedule): number => (Number.isFinite(s.interval) && s.interval >= 1 ? Math.floor(s.interval) : 1);

/** The day of the month of the start, or null when the start is no real day. */
const startDay = (s: Schedule) => parseDate(s.starts_on);

function weeklyDays(s: Schedule): string | null {
  const chosen = (s.weekdays ?? []).filter(isWeekday);
  if (chosen.length === 0) {
    if (!startDay(s)) return null;
    chosen.push(weekdayOf(s.starts_on));
  }
  const days = [...new Set(chosen)].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7));
  if (days.length === 7) return 'an allen Tagen';
  return `am ${LIST.format(days.map((day) => WEEKDAYS[day]))}`;
}

/** A day that not every month (or year) has falls back to the month's last day: "am 31. (oder letzten Tag)". */
const FALLBACK = ' (oder letzten Tag)';

function monthly(s: Schedule, interval: number): string | null {
  const nth = s.nth_weekday;
  if (nth && ORDINALS[nth.n] && isWeekday(nth.weekday)) {
    const which = `${ORDINALS[nth.n]} ${WEEKDAYS[nth.weekday]}`;
    return interval === 1 ? `Jeden ${which} im Monat` : `Alle ${interval} Monate am ${which}`;
  }
  const lead = interval === 1 ? 'Monatlich' : `Alle ${interval} Monate`;
  if (s.month_day === 'last') return `${lead} am letzten Tag`;
  const day = typeof s.month_day === 'number' && Number.isFinite(s.month_day) ? Math.min(Math.max(1, Math.floor(s.month_day)), 31) : startDay(s)?.day;
  return day === undefined ? lead : `${lead} am ${day}.${day > 28 ? FALLBACK : ''}`;
}

function yearly(s: Schedule, interval: number): string {
  const lead = interval === 1 ? 'Jährlich' : `Alle ${interval} Jahre`;
  const match = /^(\d{2})-(\d{2})$/.exec(s.yearly_date ?? '');
  let date = match ? { month: Number(match[1]), day: Number(match[2]) } : null;
  if (!date || date.month < 1 || date.month > 12 || date.day < 1 || date.day > 31) date = startDay(s);
  if (!date) return lead;
  return `${lead} am ${date.day}. ${monthName(date.month)}${date.day > daysInMonth(SHORT_YEAR, date.month) ? FALLBACK : ''}`;
}

function ending(s: Schedule): string {
  if (s.ends.type === 'on') return parseDate(s.ends.date) ? `, bis zum ${formatDay(s.ends.date)}` : '';
  if (s.ends.type === 'count') return `, endet nach ${s.ends.count} ${s.ends.count === 1 ? 'Lauf' : 'Läufen'}`;
  return '';
}

/** The schedule as one German sentence: rhythm, day, time and, if it has one, its end. */
export function describeSchedule(s: Schedule): string {
  const interval = intervalOf(s);
  let rhythm: string;
  switch (s.frequency) {
    case 'daily':
      rhythm = interval === 1 ? 'Täglich' : `Alle ${interval} Tage`;
      break;
    case 'weekly': {
      const days = weeklyDays(s);
      rhythm = [interval === 1 ? 'Wöchentlich' : `Alle ${interval} Wochen`, days].filter(Boolean).join(' ');
      break;
    }
    case 'monthly':
      rhythm = monthly(s, interval) ?? 'Monatlich';
      break;
    case 'yearly':
      rhythm = yearly(s, interval);
      break;
  }
  return `${rhythm} um ${s.time}${ending(s)}`;
}
