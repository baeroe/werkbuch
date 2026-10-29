import { describe, expect, it } from 'vitest';
import { dateToX, moveRange, PX_PER_DAY, resizeRange, scaleTicks, shiftByUnit, timelineRange, xToDate, type TimelineScale, type Zoom } from './timelineScale';

const ZOOMS: Zoom[] = ['week', 'month', 'quarter'];

describe('timeline scale', () => {
  it('dateToX and xToDate round-trip at every zoom', () => {
    const days = ['2026-09-01', '2026-10-25', '2026-10-28', '2026-12-31', '2027-02-28', '2027-03-28'];
    for (const zoom of ZOOMS) {
      const scale: TimelineScale = { start: '2026-09-01', zoom, px_per_day: PX_PER_DAY[zoom] };
      for (const day of days) expect(xToDate(dateToX(day, scale), scale), `${zoom} ${day}`).toBe(day);
      // a point inside a day's column belongs to that day, its last pixel too
      expect(xToDate(dateToX('2026-10-28', scale) + PX_PER_DAY[zoom] - 0.5, scale), zoom).toBe('2026-10-28');
    }
  });

  it('month zoom with start 2026-09-01 places 2026-10-28 at 57 * px_per_day', () => {
    // September has 30 days, then 27 days of October: 57 days
    const scale: TimelineScale = { start: '2026-09-01', zoom: 'month', px_per_day: 12 };
    expect(dateToX('2026-10-28', scale)).toBe(57 * 12);
    expect(dateToX('2026-09-01', scale)).toBe(0);
    expect(dateToX('2026-08-31', scale)).toBe(-12);
  });

  it('starts the range at a week, month or quarter boundary before the earliest day, today included', () => {
    const dates = ['2026-10-01', '2026-11-15', '2026-09-01'];
    // a week (7 days) before 2026-09-01 is Tuesday 2026-08-25; its Monday is 2026-08-24
    expect(timelineRange(dates, '2026-10-28', 'week').start).toBe('2026-08-24');
    // 14 days before 2026-09-01 lies in August
    expect(timelineRange(dates, '2026-10-28', 'month').start).toBe('2026-08-01');
    // 30 days before 2026-09-01 is in the third quarter
    expect(timelineRange(dates, '2026-10-28', 'quarter').start).toBe('2026-07-01');
    // no dates at all: the range is built around today
    expect(timelineRange([], '2026-10-28', 'month').start).toBe('2026-10-01');
  });

  it('ends the range on the last day of a week, month or quarter after the latest day', () => {
    const dates = ['2026-10-01', '2026-12-20'];
    // 14 days after 2026-12-20 is Sunday 2027-01-03, the end of its week
    expect(timelineRange(dates, '2026-10-28', 'week').end).toBe('2027-01-03');
    // 28 days after 2026-12-20 lies in January
    expect(timelineRange(dates, '2026-10-28', 'month').end).toBe('2027-01-31');
    // 60 days after 2026-12-20 lies in the first quarter of 2027
    expect(timelineRange(dates, '2026-10-28', 'quarter').end).toBe('2027-03-31');
  });

  it('moves a day by one unit of the zoom: a day, a week or a month', () => {
    expect(shiftByUnit('2026-10-28', 'week', 1)).toBe('2026-10-29');
    expect(shiftByUnit('2026-10-28', 'week', -1)).toBe('2026-10-27');
    expect(shiftByUnit('2026-10-28', 'month', 1)).toBe('2026-11-04');
    expect(shiftByUnit('2026-10-28', 'month', -2)).toBe('2026-10-14');
    expect(shiftByUnit('2026-10-28', 'quarter', 1)).toBe('2026-11-28');
    // the 31st falls back to the last day of a shorter month
    expect(shiftByUnit('2026-10-31', 'quarter', 1)).toBe('2026-11-30');
    expect(shiftByUnit('2027-01-31', 'quarter', 1)).toBe('2027-02-28');
    expect(shiftByUnit('2026-12-15', 'quarter', 1)).toBe('2027-01-15');
  });

  it('moves start and due together, and changes the duration at the due date without passing the start', () => {
    expect(moveRange({ start: '2026-10-01', due: '2026-11-15' }, 'month', 1)).toEqual({ start: '2026-10-08', due: '2026-11-22' });
    expect(moveRange({ start: '2026-10-01', due: '2026-11-15' }, 'week', -1)).toEqual({ start: '2026-09-30', due: '2026-11-14' });
    expect(resizeRange({ start: '2026-10-01', due: '2026-11-15' }, 'week', 1)).toEqual({ start: '2026-10-01', due: '2026-11-16' });
    expect(resizeRange({ start: '2026-10-01', due: '2026-11-15' }, 'quarter', -1)).toEqual({ start: '2026-10-01', due: '2026-10-15' });
    // shorter than one day it does not get: the due date stops at the start
    expect(resizeRange({ start: '2026-10-01', due: '2026-10-05' }, 'month', -1)).toEqual({ start: '2026-10-01', due: '2026-10-01' });
  });

  it('labels the axis: days in weeks, calendar weeks in months, months in quarters', () => {
    const week = scaleTicks({ start: '2026-10-26', end: '2026-11-08' }, 'week');
    expect(week.major.map((tick) => [tick.date, tick.label])).toEqual([
      ['2026-10-26', 'Oktober 2026'],
      ['2026-11-01', 'November 2026'],
    ]);
    expect(week.minor).toHaveLength(14);
    expect(week.minor[2]).toMatchObject({ date: '2026-10-28', label: 'Mi 28', strong: false });
    // a new week starts on Monday
    expect(week.minor[7]).toMatchObject({ date: '2026-11-02', strong: true });

    const month = scaleTicks({ start: '2026-10-01', end: '2026-11-30' }, 'month');
    expect(month.major.map((tick) => tick.label)).toEqual(['Oktober 2026', 'November 2026']);
    expect(month.minor.map((tick) => [tick.date, tick.label])).toEqual([
      ['2026-10-05', 'KW 41'],
      ['2026-10-12', 'KW 42'],
      ['2026-10-19', 'KW 43'],
      ['2026-10-26', 'KW 44'],
      ['2026-11-02', 'KW 45'],
      ['2026-11-09', 'KW 46'],
      ['2026-11-16', 'KW 47'],
      ['2026-11-23', 'KW 48'],
      ['2026-11-30', 'KW 49'],
    ]);

    const quarter = scaleTicks({ start: '2026-07-01', end: '2026-12-31' }, 'quarter');
    expect(quarter.major.map((tick) => [tick.date, tick.label])).toEqual([
      ['2026-07-01', 'Q3 2026'],
      ['2026-10-01', 'Q4 2026'],
    ]);
    expect(quarter.minor.map((tick) => tick.label)).toEqual(['Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez']);
  });
});
