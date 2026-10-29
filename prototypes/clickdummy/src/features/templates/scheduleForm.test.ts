import { describe, expect, it } from 'vitest';
import { daily09, firstMonday09, monthDay31at09, weeklyMonThu09 } from '@/domain/fixtures';
import { defaultSchedule, withFrequency } from './scheduleForm';

describe('defaultSchedule', () => {
  it('runs weekly on the weekday of today at 09:00, from today on, without end', () => {
    // 2026-10-28 is a Wednesday
    expect(defaultSchedule('2026-10-28')).toEqual({
      frequency: 'weekly',
      interval: 1,
      weekdays: [3],
      time: '09:00',
      starts_on: '2026-10-28',
      ends: { type: 'never' },
      paused: false,
    });
  });
});

describe('withFrequency', () => {
  it('keeps interval, time, start, end and pause, and drops what the old frequency needed', () => {
    const daily = withFrequency(firstMonday09, 'daily');
    expect(daily).toEqual({ frequency: 'daily', interval: 1, time: '09:00', starts_on: '2026-01-01', ends: { type: 'never' }, paused: false });
  });

  it('weekly: keeps chosen days, else takes the weekday of an n-th weekday, else the weekday of the start', () => {
    expect(withFrequency(weeklyMonThu09, 'weekly').weekdays).toEqual([1, 4]);
    expect(withFrequency(firstMonday09, 'weekly').weekdays).toEqual([1]);
    // 2026-01-01 is a Thursday
    expect(withFrequency(daily09, 'weekly').weekdays).toEqual([4]);
  });

  it('monthly: keeps a day or an n-th weekday, else takes the day of the start', () => {
    expect(withFrequency(monthDay31at09, 'monthly')).toMatchObject({ month_day: 31 });
    expect(withFrequency(firstMonday09, 'monthly')).toMatchObject({ nth_weekday: { n: 1, weekday: 1 } });
    expect(withFrequency({ ...daily09, starts_on: '2026-03-15' }, 'monthly')).toMatchObject({ month_day: 15 });
  });

  it('yearly: keeps a date, else takes the date of the start', () => {
    expect(withFrequency({ ...daily09, frequency: 'yearly', yearly_date: '12-24' }, 'yearly').yearly_date).toBe('12-24');
    expect(withFrequency({ ...daily09, starts_on: '2026-03-15' }, 'yearly').yearly_date).toBe('03-15');
  });
});
