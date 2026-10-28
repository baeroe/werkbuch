import { describe, expect, it } from 'vitest';
import type { Schedule } from '@/types';
import { daily09, everyOtherWed09, firstMonday09, monthDay31at09, weeklyMonThu09 } from './fixtures';
import { missedRunToCatchUp, nextOccurrences } from './recurrence';

const TZ = 'Europe/Berlin';
const iso = (dates: Date[]) => dates.map((d) => d.toISOString());

/** The wall-clock time of an instant in Berlin, e.g. '09:00'. */
function berlinTime(at: Date): string {
  return new Intl.DateTimeFormat('de-DE', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(at);
}

describe('nextOccurrences', () => {
  describe('daily', () => {
    it('stays at 09:00 local time across the end of summer time (2026-10-25)', () => {
      expect(iso(nextOccurrences(daily09, new Date('2026-10-23T08:00:00Z'), 3, TZ))).toEqual([
        '2026-10-24T07:00:00.000Z',
        '2026-10-25T08:00:00.000Z',
        '2026-10-26T08:00:00.000Z',
      ]);
    });

    it('stays at 09:00 local time across the start of summer time (2027-03-28)', () => {
      expect(iso(nextOccurrences(daily09, new Date('2027-03-27T09:00:00Z'), 2, TZ))).toEqual([
        '2027-03-28T07:00:00.000Z',
        '2027-03-29T07:00:00.000Z',
      ]);
    });

    it('is 09:00 on the wall clock on every day around both switches', () => {
      const autumn = nextOccurrences(daily09, new Date('2026-10-20T00:00:00Z'), 14, TZ);
      const spring = nextOccurrences(daily09, new Date('2027-03-20T00:00:00Z'), 14, TZ);

      expect(autumn.map(berlinTime)).toEqual(Array(14).fill('09:00'));
      expect(spring.map(berlinTime)).toEqual(Array(14).fill('09:00'));
    });

    it('does not return the instant it starts after', () => {
      expect(iso(nextOccurrences(daily09, new Date('2026-10-28T08:00:00Z'), 1, TZ))).toEqual(['2026-10-29T08:00:00.000Z']);
    });

    it('counts the interval from the start day', () => {
      const everyThirdDay: Schedule = { ...daily09, interval: 3, starts_on: '2026-10-26' };

      expect(iso(nextOccurrences(everyThirdDay, new Date('2026-10-28T09:00:00Z'), 3, TZ))).toEqual([
        '2026-10-29T08:00:00.000Z',
        '2026-11-01T08:00:00.000Z',
        '2026-11-04T08:00:00.000Z',
      ]);
    });

    it('waits for a start day in the future', () => {
      const later: Schedule = { ...daily09, starts_on: '2026-12-24' };

      expect(iso(nextOccurrences(later, new Date('2026-10-28T09:00:00Z'), 1, TZ))).toEqual(['2026-12-24T08:00:00.000Z']);
    });

    it('moves a wall-clock time that does not exist (02:30 on 2027-03-28) forward by the gap', () => {
      const night: Schedule = { ...daily09, time: '02:30' };

      expect(iso(nextOccurrences(night, new Date('2027-03-27T12:00:00Z'), 2, TZ))).toEqual([
        '2027-03-28T01:30:00.000Z', // 03:30 summer time
        '2027-03-29T00:30:00.000Z', // 02:30 summer time
      ]);
    });

    it('takes the first of a wall-clock time that happens twice (02:30 on 2026-10-25)', () => {
      const night: Schedule = { ...daily09, time: '02:30' };

      expect(iso(nextOccurrences(night, new Date('2026-10-24T12:00:00Z'), 3, TZ))).toEqual([
        '2026-10-25T00:30:00.000Z', // 02:30 summer time, the first one
        '2026-10-26T01:30:00.000Z',
        '2026-10-27T01:30:00.000Z',
      ]);
    });
  });

  describe('weekly', () => {
    it('repeats on the chosen weekdays', () => {
      expect(iso(nextOccurrences(weeklyMonThu09, new Date('2026-10-28T09:00:00Z'), 3, TZ))).toEqual([
        '2026-10-29T08:00:00.000Z',
        '2026-11-02T08:00:00.000Z',
        '2026-11-05T08:00:00.000Z',
      ]);
    });

    it('counts the interval in weeks from the week of the start day', () => {
      expect(iso(nextOccurrences(everyOtherWed09 /* starts_on 2026-10-28 */, new Date('2026-10-28T09:00:00Z'), 2, TZ))).toEqual([
        '2026-11-11T08:00:00.000Z',
        '2026-11-25T08:00:00.000Z',
      ]);
    });

    it('includes the start day itself when it is still ahead', () => {
      expect(iso(nextOccurrences(everyOtherWed09, new Date('2026-10-28T07:00:00Z'), 1, TZ))).toEqual(['2026-10-28T08:00:00.000Z']);
    });

    it('skips days of the first week that lie before the start day', () => {
      const monThuEveryOtherWeek: Schedule = { ...weeklyMonThu09, interval: 2, starts_on: '2026-10-28' };

      // Monday 2026-10-26 is before the start day; the weeks 2 and 4 follow
      expect(iso(nextOccurrences(monThuEveryOtherWeek, new Date('2026-10-28T09:00:00Z'), 5, TZ))).toEqual([
        '2026-10-29T08:00:00.000Z',
        '2026-11-09T08:00:00.000Z',
        '2026-11-12T08:00:00.000Z',
        '2026-11-23T08:00:00.000Z',
        '2026-11-26T08:00:00.000Z',
      ]);
    });

    it('treats Sunday as the last day of the week', () => {
      const sundays: Schedule = { ...everyOtherWed09, weekdays: [0] };

      expect(iso(nextOccurrences(sundays, new Date('2026-10-28T09:00:00Z'), 3, TZ))).toEqual([
        '2026-11-01T08:00:00.000Z',
        '2026-11-15T08:00:00.000Z',
        '2026-11-29T08:00:00.000Z',
      ]);
    });

    it('uses the weekday of the start day when no weekdays are given', () => {
      const noWeekdays: Schedule = { ...daily09, frequency: 'weekly', starts_on: '2026-10-28' };

      expect(iso(nextOccurrences(noWeekdays, new Date('2026-10-28T09:00:00Z'), 2, TZ))).toEqual([
        '2026-11-04T08:00:00.000Z',
        '2026-11-11T08:00:00.000Z',
      ]);
    });
  });

  describe('monthly', () => {
    it('repeats on the n-th weekday of the month', () => {
      expect(iso(nextOccurrences(firstMonday09, new Date('2026-10-28T09:00:00Z'), 5, TZ))).toEqual([
        '2026-11-02T08:00:00.000Z',
        '2026-12-07T08:00:00.000Z',
        '2027-01-04T08:00:00.000Z',
        '2027-02-01T08:00:00.000Z',
        '2027-03-01T08:00:00.000Z',
      ]);
    });

    it('falls back to the last day of a month that is too short for the day of the month', () => {
      expect(iso(nextOccurrences(monthDay31at09, new Date('2026-10-28T09:00:00Z'), 3, TZ))).toEqual([
        '2026-10-31T08:00:00.000Z',
        '2026-11-30T08:00:00.000Z',
        '2026-12-31T08:00:00.000Z',
      ]);
    });

    it('shortens the 31st to the 28th in February and moves on to summer time in March', () => {
      expect(iso(nextOccurrences(monthDay31at09, new Date('2027-01-31T12:00:00Z'), 2, TZ))).toEqual([
        '2027-02-28T08:00:00.000Z',
        '2027-03-31T07:00:00.000Z',
      ]);
    });

    it('supports "last" as the day of the month', () => {
      const lastDay: Schedule = { ...monthDay31at09, month_day: 'last' };

      expect(iso(nextOccurrences(lastDay, new Date('2027-01-31T12:00:00Z'), 2, TZ))).toEqual([
        '2027-02-28T08:00:00.000Z',
        '2027-03-31T07:00:00.000Z',
      ]);
    });

    it('supports the last weekday of the month with n = -1', () => {
      const lastFriday: Schedule = { ...firstMonday09, nth_weekday: { n: -1, weekday: 5 }, time: '17:30' };

      expect(iso(nextOccurrences(lastFriday, new Date('2026-10-28T09:00:00Z'), 3, TZ))).toEqual([
        '2026-10-30T16:30:00.000Z',
        '2026-11-27T16:30:00.000Z',
        '2026-12-25T16:30:00.000Z',
      ]);
    });

    it('counts the interval in months from the month of the start day', () => {
      const quarterly: Schedule = { ...firstMonday09, interval: 3, starts_on: '2026-10-01' };

      expect(iso(nextOccurrences(quarterly, new Date('2026-10-28T09:00:00Z'), 3, TZ))).toEqual([
        '2027-01-04T08:00:00.000Z',
        '2027-04-05T07:00:00.000Z',
        '2027-07-05T07:00:00.000Z',
      ]);
    });

    it('prefers the n-th weekday when both rules are set', () => {
      const both: Schedule = { ...firstMonday09, month_day: 15 };

      expect(iso(nextOccurrences(both, new Date('2026-10-28T09:00:00Z'), 1, TZ))).toEqual(['2026-11-02T08:00:00.000Z']);
    });

    it('uses the day of the start day when no day is given', () => {
      const noDay: Schedule = { ...daily09, frequency: 'monthly', starts_on: '2026-10-15' };

      expect(iso(nextOccurrences(noDay, new Date('2026-10-28T09:00:00Z'), 2, TZ))).toEqual([
        '2026-11-15T08:00:00.000Z',
        '2026-12-15T08:00:00.000Z',
      ]);
    });
  });

  describe('yearly', () => {
    const march15: Schedule = { ...daily09, frequency: 'yearly', yearly_date: '03-15', time: '08:00' };

    it('repeats on the date every year', () => {
      expect(iso(nextOccurrences(march15, new Date('2026-10-28T09:00:00Z'), 3, TZ))).toEqual([
        '2027-03-15T07:00:00.000Z',
        '2028-03-15T07:00:00.000Z',
        '2029-03-15T07:00:00.000Z',
      ]);
    });

    it('moves February 29 to the 28th in years without a leap day', () => {
      const leapDay: Schedule = { ...march15, yearly_date: '02-29', time: '12:00' };

      expect(iso(nextOccurrences(leapDay, new Date('2026-10-28T09:00:00Z'), 3, TZ))).toEqual([
        '2027-02-28T11:00:00.000Z',
        '2028-02-29T11:00:00.000Z',
        '2029-02-28T11:00:00.000Z',
      ]);
    });

    it('counts the interval in years', () => {
      const everyOtherYear: Schedule = { ...march15, interval: 2, starts_on: '2026-01-01' };

      expect(iso(nextOccurrences(everyOtherYear, new Date('2026-10-28T09:00:00Z'), 2, TZ))).toEqual([
        '2028-03-15T07:00:00.000Z',
        '2030-03-15T07:00:00.000Z',
      ]);
    });

    it('uses the date of the start day when no date is given', () => {
      const anniversary: Schedule = { ...march15, yearly_date: undefined, starts_on: '2026-11-20' };

      expect(iso(nextOccurrences(anniversary, new Date('2026-10-28T09:00:00Z'), 2, TZ))).toEqual([
        '2026-11-20T07:00:00.000Z',
        '2027-11-20T07:00:00.000Z',
      ]);
    });
  });

  describe('end and pause', () => {
    it('stops after the number of runs when the schedule ends after N runs', () => {
      expect(nextOccurrences({ ...daily09, ends: { type: 'count', count: 3 } }, new Date('2026-10-28T09:00:00Z'), 5, TZ, 2)).toHaveLength(1);
    });

    it('counts from zero runs when the run count is not given', () => {
      expect(nextOccurrences({ ...daily09, ends: { type: 'count', count: 3 } }, new Date('2026-10-28T09:00:00Z'), 5, TZ)).toHaveLength(3);
    });

    it('returns nothing once all runs are done', () => {
      expect(nextOccurrences({ ...daily09, ends: { type: 'count', count: 3 } }, new Date('2026-10-28T09:00:00Z'), 5, TZ, 3)).toEqual([]);
    });

    it('includes the last day when the schedule ends on a date', () => {
      const untilFriday: Schedule = { ...daily09, ends: { type: 'on', date: '2026-10-30' } };

      expect(iso(nextOccurrences(untilFriday, new Date('2026-10-28T09:00:00Z'), 5, TZ))).toEqual([
        '2026-10-29T08:00:00.000Z',
        '2026-10-30T08:00:00.000Z',
      ]);
    });

    it('returns nothing for a paused schedule', () => {
      expect(nextOccurrences({ ...daily09, paused: true }, new Date('2026-10-28T09:00:00Z'), 5, TZ)).toEqual([]);
    });
  });

  describe('bad input', () => {
    it('returns nothing for a schedule it cannot read', () => {
      const after = new Date('2026-10-28T09:00:00Z');

      expect(nextOccurrences({ ...daily09, starts_on: '' }, after, 3, TZ)).toEqual([]);
      expect(nextOccurrences({ ...daily09, starts_on: '2026-02-30' }, after, 3, TZ)).toEqual([]);
      expect(nextOccurrences({ ...daily09, time: '25:99' }, after, 3, TZ)).toEqual([]);
      expect(nextOccurrences({ ...daily09, ends: { type: 'on', date: 'soon' } }, after, 3, TZ)).toEqual([]);
    });

    it('returns nothing for a count of zero or an invalid instant', () => {
      expect(nextOccurrences(daily09, new Date('2026-10-28T09:00:00Z'), 0, TZ)).toEqual([]);
      expect(nextOccurrences(daily09, new Date('nope'), 3, TZ)).toEqual([]);
    });

    it('treats an interval below one as one and does not loop forever on a weekly schedule without valid weekdays', () => {
      const odd = { ...daily09, interval: 0, frequency: 'weekly', weekdays: [] } as Schedule;

      expect(nextOccurrences(odd, new Date('2026-10-28T09:00:00Z'), 2, TZ)).toHaveLength(2);
    });

    it('rejects an unknown time zone', () => {
      expect(() => nextOccurrences(daily09, new Date('2026-10-28T09:00:00Z'), 1, 'Mars/Phobos')).toThrow(RangeError);
    });
  });

  it('returns strictly increasing, unique instants', () => {
    const dates = nextOccurrences(weeklyMonThu09, new Date('2026-10-20T00:00:00Z'), 40, TZ);

    expect(dates).toHaveLength(40);
    for (let i = 1; i < dates.length; i++) {
      expect(dates[i].getTime()).toBeGreaterThan(dates[i - 1].getTime());
    }
  });
});

describe('missedRunToCatchUp', () => {
  it('catches up the latest missed run only', () => {
    expect(
      missedRunToCatchUp(daily09, new Date('2026-10-25T08:00:00Z'), new Date('2026-10-28T09:00:00Z'), TZ)?.toISOString(),
    ).toBe('2026-10-28T08:00:00.000Z');
  });

  it('finds nothing when the last run is the latest scheduled one', () => {
    expect(missedRunToCatchUp(daily09, new Date('2026-10-28T08:00:00Z'), new Date('2026-10-28T09:00:00Z'), TZ)).toBeNull();
  });

  it('does not run ahead of time: a run that is due later today is not missed yet', () => {
    // 07:00 local time, two hours before the run
    const result = missedRunToCatchUp(daily09, new Date('2026-10-25T08:00:00Z'), new Date('2026-10-28T06:00:00Z'), TZ);

    expect(result?.toISOString()).toBe('2026-10-27T08:00:00.000Z');
  });

  it('works across the end of summer time', () => {
    const result = missedRunToCatchUp(daily09, new Date('2026-10-24T07:00:00Z'), new Date('2026-10-25T09:00:00Z'), TZ);

    expect(result?.toISOString()).toBe('2026-10-25T08:00:00.000Z');
  });

  it('catches up a monthly schedule once, even when two runs were missed', () => {
    // 2026-09-07 was the last run; 2026-10-05 and 2026-11-02 are missed
    const result = missedRunToCatchUp(firstMonday09, new Date('2026-09-07T07:00:00Z'), new Date('2026-11-03T10:00:00Z'), TZ);

    expect(result?.toISOString()).toBe('2026-11-02T08:00:00.000Z');
  });

  it('catches up the latest run since the start day when the schedule never ran', () => {
    expect(missedRunToCatchUp(daily09, null, new Date('2026-10-28T09:00:00Z'), TZ)?.toISOString()).toBe('2026-10-28T08:00:00.000Z');
  });

  it('finds nothing before the start day', () => {
    const later: Schedule = { ...daily09, starts_on: '2026-12-01' };

    expect(missedRunToCatchUp(later, null, new Date('2026-10-28T09:00:00Z'), TZ)).toBeNull();
  });

  it('does not go past the end date', () => {
    const untilMonday: Schedule = { ...daily09, ends: { type: 'on', date: '2026-10-26' } };
    const result = missedRunToCatchUp(untilMonday, new Date('2026-10-24T08:00:00Z'), new Date('2026-10-28T09:00:00Z'), TZ);

    expect(result?.toISOString()).toBe('2026-10-26T08:00:00.000Z');
  });

  it('finds nothing for a paused schedule', () => {
    expect(missedRunToCatchUp({ ...daily09, paused: true }, new Date('2026-10-25T08:00:00Z'), new Date('2026-10-28T09:00:00Z'), TZ)).toBeNull();
  });

  it('finds nothing once the schedule has run its last run', () => {
    const threeRuns: Schedule = { ...daily09, ends: { type: 'count', count: 3 } };

    expect(missedRunToCatchUp(threeRuns, new Date('2026-10-25T08:00:00Z'), new Date('2026-10-28T09:00:00Z'), TZ, 3)).toBeNull();
    expect(missedRunToCatchUp(threeRuns, new Date('2026-10-25T08:00:00Z'), new Date('2026-10-28T09:00:00Z'), TZ, 2)).not.toBeNull();
  });

  it('finds nothing for a schedule it cannot read', () => {
    expect(missedRunToCatchUp({ ...daily09, time: 'late' }, null, new Date('2026-10-28T09:00:00Z'), TZ)).toBeNull();
  });
});
