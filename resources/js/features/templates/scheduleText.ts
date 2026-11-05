/*
 * A schedule in words (spec 4.12), as the template list and the schedule editor show it, ported from the clickdummy:
 *   "Jeden ersten Montag im Monat um 09:00", "Alle 2 Wochen am Mittwoch um 09:00",
 *   "Monatlich am 31. (oder letzten Tag) um 09:00", "Täglich um 09:00, endet nach 12 Läufen".
 * It reads the schedule the way the server runs it (`App\Domain\Schedule`): a broken interval counts as 1, a weekly
 * schedule without days runs on the weekday of its start, a monthly one without a day on the day of its start, a yearly
 * one on the date of its start. Start and pause are not part of the sentence; the screens show them on their own. The
 * words come from the language of the page (`schedule.*`), weekdays and months as words (keys without digits).
 */

import { formatDay } from '@/components/fields/format';
import { daysInMonth, parseDate, weekdayOf } from '@/domain/tz';
import { intlLocale, t, tn, type TranslationKey } from '@/lib/i18n';
import type { Schedule, Weekday } from '@/types';

const WEEKDAYS: Record<Weekday, TranslationKey> = {
  0: 'schedule.weekday.sunday',
  1: 'schedule.weekday.monday',
  2: 'schedule.weekday.tuesday',
  3: 'schedule.weekday.wednesday',
  4: 'schedule.weekday.thursday',
  5: 'schedule.weekday.friday',
  6: 'schedule.weekday.saturday',
};

const MONTHS: TranslationKey[] = [
  'schedule.month.january',
  'schedule.month.february',
  'schedule.month.march',
  'schedule.month.april',
  'schedule.month.may',
  'schedule.month.june',
  'schedule.month.july',
  'schedule.month.august',
  'schedule.month.september',
  'schedule.month.october',
  'schedule.month.november',
  'schedule.month.december',
];

const ORDINALS: Record<number, TranslationKey> = {
  1: 'schedule.ordinal.first',
  2: 'schedule.ordinal.second',
  3: 'schedule.ordinal.third',
  4: 'schedule.ordinal.fourth',
  [-1]: 'schedule.ordinal.last',
};

/** A year without 29 February: a day after the shortest length of its month falls back in some years. */
const SHORT_YEAR = 2027;

const isWeekday = (value: unknown): value is Weekday => typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 6;

/** The name of a month in the language of the page, counted from 1. */
export const monthName = (month: number): string => t(MONTHS[month - 1]);

/** The name of a weekday in the language of the page, 0 = Sunday. */
export const weekdayName = (day: Weekday): string => t(WEEKDAYS[day]);

/** Like the schedule: at least 1, a whole number. */
const intervalOf = (s: Schedule): number => (Number.isFinite(s.interval) && s.interval >= 1 ? Math.floor(s.interval) : 1);

/** The day of the start, or null when the start is no real day. */
const startDay = (s: Schedule) => parseDate(s.starts_on);

function weekly(s: Schedule, interval: number): string {
  const rhythm = tn('schedule.weekly', interval);
  const chosen = (s.weekdays ?? []).filter(isWeekday);
  if (chosen.length === 0) {
    if (!startDay(s)) return rhythm;
    chosen.push(weekdayOf(s.starts_on));
  }
  // the week as it is counted here: Monday first, Sunday last
  const days = [...new Set(chosen)].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7));
  if (days.length === 7) return t('schedule.on_every_day', { rhythm });
  const list = new Intl.ListFormat(intlLocale(), { type: 'conjunction' });
  return t('schedule.on_days', { rhythm, days: list.format(days.map(weekdayName)) });
}

function monthly(s: Schedule, interval: number): string {
  const nth = s.nth_weekday;
  if (nth && ORDINALS[nth.n] && isWeekday(nth.weekday)) {
    return tn('schedule.monthly_nth', interval, { ordinal: t(ORDINALS[nth.n]), weekday: weekdayName(nth.weekday) });
  }
  const rhythm = tn('schedule.monthly', interval);
  if (s.month_day === 'last') return t('schedule.on_last_day', { rhythm });
  const day = typeof s.month_day === 'number' && Number.isFinite(s.month_day) ? Math.min(Math.max(1, Math.floor(s.month_day)), 31) : startDay(s)?.day;
  if (day === undefined) return rhythm;
  // a day that not every month has falls back to the month's last day
  return t(day > 28 ? 'schedule.on_day_or_last' : 'schedule.on_day', { rhythm, day });
}

function yearly(s: Schedule, interval: number): string {
  const rhythm = tn('schedule.yearly', interval);
  const match = /^(\d{2})-(\d{2})$/.exec(s.yearly_date ?? '');
  let date = match ? { month: Number(match[1]), day: Number(match[2]) } : null;
  if (!date || date.month < 1 || date.month > 12 || date.day < 1 || date.day > 31) date = startDay(s);
  if (!date) return rhythm;
  const fallsBack = date.day > daysInMonth(SHORT_YEAR, date.month);
  return t(fallsBack ? 'schedule.on_date_or_last' : 'schedule.on_date', { rhythm, day: date.day, month: monthName(date.month) });
}

function ending(s: Schedule, sentence: string): string {
  if (s.ends.type === 'on') return parseDate(s.ends.date) ? t('schedule.ends_on', { sentence, date: formatDay(s.ends.date) }) : sentence;
  if (s.ends.type === 'count') return tn('schedule.ends_after', s.ends.count, { sentence });
  return sentence;
}

/** The schedule as one sentence: rhythm, day, time and, if it has one, its end. */
export function describeSchedule(s: Schedule): string {
  const interval = intervalOf(s);
  let rhythm: string;
  switch (s.frequency) {
    case 'daily':
      rhythm = tn('schedule.daily', interval);
      break;
    case 'weekly':
      rhythm = weekly(s, interval);
      break;
    case 'monthly':
      rhythm = monthly(s, interval);
      break;
    case 'yearly':
      rhythm = yearly(s, interval);
      break;
  }
  return ending(s, t('schedule.at_time', { rhythm, time: s.time }));
}
