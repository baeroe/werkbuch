/*
 * What the schedule editor does to a schedule: a first schedule, and the switch to another frequency that carries over
 * what still fits (interval, time, start, end, pause) and fills what the new frequency needs from what is there.
 */

import { parseDate, weekdayOf } from '@/domain/tz';
import type { Schedule, Weekday } from '@/types';

/** A first schedule: every week on today's weekday at 09:00, from today on, without end. */
export function defaultSchedule(today: string): Schedule {
  return { frequency: 'weekly', interval: 1, weekdays: [weekdayOf(today)], time: '09:00', starts_on: today, ends: { type: 'never' }, paused: false };
}

/** The schedule with another frequency. */
export function withFrequency(s: Schedule, frequency: Schedule['frequency']): Schedule {
  const { weekdays, month_day, nth_weekday, yearly_date, ...common } = s;
  const start = parseDate(s.starts_on);
  switch (frequency) {
    case 'daily':
      return { ...common, frequency };
    case 'weekly': {
      const days: Weekday[] = weekdays?.length ? weekdays : nth_weekday ? [nth_weekday.weekday] : start ? [weekdayOf(s.starts_on)] : [1];
      return { ...common, frequency, weekdays: [...days] };
    }
    case 'monthly':
      if (nth_weekday) return { ...common, frequency, nth_weekday: { ...nth_weekday } };
      return { ...common, frequency, month_day: month_day ?? start?.day ?? 1 };
    case 'yearly': {
      const pad = (value: number) => String(value).padStart(2, '0');
      return { ...common, frequency, yearly_date: yearly_date ?? (start ? `${pad(start.month)}-${pad(start.day)}` : '01-01') };
    }
  }
}
