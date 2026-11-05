/*
 * What the schedule editor does to a schedule, ported from the clickdummy: a first schedule, the switch to another
 * frequency that carries over what still fits (interval, time, start, end, pause) and fills what the new frequency needs
 * from what is there, and the time of day as typed. The schedules it builds are in the normal form the server keeps
 * (`Schedule::toArray`): only the fields of the frequency, weekdays sorted from 0 = Sunday.
 */

import { parseDate, parseTime, weekdayOf } from '@/domain/tz';
import type { Schedule, Weekday } from '@/types';

const pad = (value: number) => String(value).padStart(2, '0');

/** The weekdays as the server keeps them: each once, from 0 = Sunday. */
export const sortedWeekdays = (days: readonly Weekday[]): Weekday[] => [...new Set(days)].sort((a, b) => a - b);

/** A first schedule: every week on today's weekday at 09:00, from today on, without end. */
export function defaultSchedule(today: string): Schedule {
  return { frequency: 'weekly', interval: 1, weekdays: [weekdayOf(today)], time: '09:00', starts_on: today, ends: { type: 'never' }, paused: false };
}

/** The schedule with another frequency. */
export function withFrequency(s: Schedule, frequency: Schedule['frequency']): Schedule {
  const { weekdays, month_day, nth_weekday, yearly_date, ...rest } = s;
  // the fields in the order of the normal form
  const common = { frequency, interval: rest.interval };
  const tail = { time: rest.time, starts_on: rest.starts_on, ends: rest.ends, paused: rest.paused };
  const start = parseDate(s.starts_on);
  switch (frequency) {
    case 'daily':
      return { ...common, ...tail };
    case 'weekly': {
      const days: Weekday[] = weekdays?.length ? weekdays : nth_weekday ? [nth_weekday.weekday] : [weekdayOf(s.starts_on)];
      return { ...common, weekdays: sortedWeekdays(days), ...tail };
    }
    case 'monthly':
      if (nth_weekday) return { ...common, nth_weekday: { ...nth_weekday }, ...tail };
      return { ...common, month_day: month_day ?? start?.day ?? 1, ...tail };
    case 'yearly':
      return { ...common, yearly_date: yearly_date ?? (start ? `${pad(start.month)}-${pad(start.day)}` : '01-01'), ...tail };
  }
}

/**
 * A time of day as typed, as 'HH:MM': "9" → 09:00, "9:5" → 09:05, "7.30" → 07:30, "0930" → 09:30; null for anything
 * that is no time of day.
 */
export function normalizeTime(text: string): string | null {
  const trimmed = text.trim();
  const parts = /^(\d{1,2})(?:[:.](\d{1,2}))?$/.exec(trimmed) ?? /^(\d{1,2})(\d{2})$/.exec(trimmed);
  if (!parts) return null;
  const time = `${pad(Number(parts[1]))}:${pad(Number(parts[2] ?? 0))}`;
  return parseTime(time) ? time : null;
}
