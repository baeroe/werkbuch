import { describe, expect, it } from 'vitest';
import {
  addDays,
  cachedZone,
  createZone,
  daysInMonth,
  diffDays,
  endOfMonth,
  formatDate,
  isoWeek,
  parseDate,
  parseTime,
  startOfMonth,
  startOfWeek,
  weekdayOf,
} from './tz';

describe('createZone', () => {
  const berlin = createZone('Europe/Berlin');

  it('reads the wall clock of an instant', () => {
    // 08:00 UTC is 09:00 in winter and 10:00 in summer
    expect(berlin.parts(new Date('2026-12-01T08:00:00Z'))).toEqual({ year: 2026, month: 12, day: 1, hour: 9, minute: 0, second: 0, weekday: 2 });
    expect(berlin.parts(new Date('2026-07-01T08:00:00Z'))).toMatchObject({ hour: 10 });
  });

  it('shows midnight as hour 0', () => {
    expect(berlin.parts(new Date('2026-11-30T23:00:00Z'))).toMatchObject({ day: 1, hour: 0 });
  });

  it('gives the local date of an instant', () => {
    expect(berlin.date(new Date('2026-10-31T23:30:00Z'))).toBe('2026-11-01');
    expect(createZone('UTC').date(new Date('2026-10-31T23:30:00Z'))).toBe('2026-10-31');
    expect(createZone('America/New_York').date(new Date('2026-11-01T03:30:00Z'))).toBe('2026-10-31');
  });

  it('reports the offset to UTC in minutes', () => {
    expect(berlin.offsetMinutes(new Date('2026-12-01T08:00:00Z'))).toBe(60);
    expect(berlin.offsetMinutes(new Date('2026-07-01T08:00:00Z'))).toBe(120);
    expect(createZone('Asia/Kolkata').offsetMinutes(new Date('2026-07-01T08:00:00Z'))).toBe(330);
    expect(createZone('America/New_York').offsetMinutes(new Date('2026-12-01T08:00:00Z'))).toBe(-300);
  });

  describe('toUtc', () => {
    it('converts a wall-clock time outside the switches', () => {
      expect(berlin.toUtc('2026-12-01', '09:00').toISOString()).toBe('2026-12-01T08:00:00.000Z');
      expect(berlin.toUtc('2026-07-01', '09:00').toISOString()).toBe('2026-07-01T07:00:00.000Z');
    });

    it('converts around the end of summer time (2026-10-25)', () => {
      expect(berlin.toUtc('2026-10-24', '09:00').toISOString()).toBe('2026-10-24T07:00:00.000Z');
      expect(berlin.toUtc('2026-10-25', '09:00').toISOString()).toBe('2026-10-25T08:00:00.000Z');
    });

    it('converts around the start of summer time (2027-03-28)', () => {
      expect(berlin.toUtc('2027-03-27', '09:00').toISOString()).toBe('2027-03-27T08:00:00.000Z');
      expect(berlin.toUtc('2027-03-28', '09:00').toISOString()).toBe('2027-03-28T07:00:00.000Z');
    });

    it('takes the first of a time that happens twice', () => {
      // 02:30 happens at 00:30 UTC (summer time) and again at 01:30 UTC (winter time)
      expect(berlin.toUtc('2026-10-25', '02:30').toISOString()).toBe('2026-10-25T00:30:00.000Z');
    });

    it('moves a time that does not exist forward by the length of the gap', () => {
      // the clocks jump from 02:00 to 03:00, so 02:30 becomes 03:30
      expect(berlin.toUtc('2027-03-28', '02:30').toISOString()).toBe('2027-03-28T01:30:00.000Z');
      expect(berlin.parts(berlin.toUtc('2027-03-28', '02:30'))).toMatchObject({ hour: 3, minute: 30 });
    });

    it('works for zones west of UTC and for the American switch dates', () => {
      const newYork = createZone('America/New_York');

      expect(newYork.toUtc('2026-11-01', '09:00').toISOString()).toBe('2026-11-01T14:00:00.000Z');
      expect(newYork.toUtc('2026-11-01', '01:30').toISOString()).toBe('2026-11-01T05:30:00.000Z'); // the first 01:30
      expect(newYork.toUtc('2027-03-14', '02:30').toISOString()).toBe('2027-03-14T07:30:00.000Z'); // 03:30 EDT
    });

    it('works in UTC', () => {
      expect(createZone('UTC').toUtc('2026-10-28', '23:59').toISOString()).toBe('2026-10-28T23:59:00.000Z');
    });

    it('rejects a date or time it cannot read', () => {
      expect(() => berlin.toUtc('2026-02-30', '09:00')).toThrow(RangeError);
      expect(() => berlin.toUtc('2026-10-28', '9am')).toThrow(RangeError);
    });
  });

  it('rejects a time zone that does not exist', () => {
    expect(() => createZone('Mars/Phobos')).toThrow(RangeError);
  });
});

describe('cachedZone', () => {
  it('gives the same zone for the same name and a different one for another name', () => {
    expect(cachedZone('Europe/Berlin')).toBe(cachedZone('Europe/Berlin'));
    expect(cachedZone('Europe/Berlin')).not.toBe(cachedZone('UTC'));
  });

  it('works like createZone', () => {
    expect(cachedZone('Europe/Berlin').date(new Date('2026-10-31T23:30:00Z'))).toBe('2026-11-01');
    expect(cachedZone('Europe/Berlin').toUtc('2026-10-25', '09:00').toISOString()).toBe('2026-10-25T08:00:00.000Z');
  });

  it('keeps throwing for a time zone that does not exist', () => {
    expect(() => cachedZone('Mars/Phobos')).toThrow(RangeError);
    expect(() => cachedZone('Mars/Phobos')).toThrow(RangeError);
  });
});

describe('civil dates', () => {
  it('parses and formats', () => {
    expect(parseDate('2026-10-28')).toEqual({ year: 2026, month: 10, day: 28 });
    expect(formatDate(2026, 3, 5)).toBe('2026-03-05');
  });

  it('rejects dates that are not on the calendar', () => {
    expect(parseDate('2026-02-29')).toBeNull(); // 2026 is not a leap year
    expect(parseDate('2028-02-29')).toEqual({ year: 2028, month: 2, day: 29 });
    expect(parseDate('2026-13-01')).toBeNull();
    expect(parseDate('2026-00-10')).toBeNull();
    expect(parseDate('2026-1-5')).toBeNull();
    expect(parseDate('28.10.2026')).toBeNull();
    expect(parseDate('')).toBeNull();
  });

  it('parses a time of day', () => {
    expect(parseTime('09:05')).toEqual({ hour: 9, minute: 5 });
    expect(parseTime('00:00')).toEqual({ hour: 0, minute: 0 });
    expect(parseTime('23:59')).toEqual({ hour: 23, minute: 59 });
    expect(parseTime('24:00')).toBeNull();
    expect(parseTime('12:60')).toBeNull();
    expect(parseTime('9:00')).toBeNull();
  });

  it('adds days across month and year ends', () => {
    expect(addDays('2026-10-28', 4)).toBe('2026-11-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2027-03-01', -1)).toBe('2027-02-28');
    expect(addDays('2028-03-01', -1)).toBe('2028-02-29');
    expect(addDays('2026-10-28', 0)).toBe('2026-10-28');
  });

  it('counts the days between two dates', () => {
    expect(diffDays('2026-10-28', '2026-11-04')).toBe(7);
    expect(diffDays('2026-11-04', '2026-10-28')).toBe(-7);
    expect(diffDays('2026-10-25', '2026-10-26')).toBe(1); // the day summer time ends is still one day
  });

  it('knows the weekday', () => {
    expect(weekdayOf('2026-10-28')).toBe(3); // Wednesday
    expect(weekdayOf('2026-11-01')).toBe(0); // Sunday
    expect(weekdayOf('2026-10-31')).toBe(6); // Saturday
  });

  it('knows the length of a month, leap years included', () => {
    expect(daysInMonth(2026, 2)).toBe(28);
    expect(daysInMonth(2028, 2)).toBe(29);
    expect(daysInMonth(2100, 2)).toBe(28);
    expect(daysInMonth(2000, 2)).toBe(29);
    expect(daysInMonth(2026, 4)).toBe(30);
    expect(daysInMonth(2026, 12)).toBe(31);
  });

  it('finds the start of the week for both week starts', () => {
    expect(startOfWeek('2026-10-28', 1)).toBe('2026-10-26'); // Wednesday -> Monday
    expect(startOfWeek('2026-10-28', 0)).toBe('2026-10-25'); // Wednesday -> Sunday
    expect(startOfWeek('2026-11-01', 1)).toBe('2026-10-26'); // Sunday belongs to the week before
    expect(startOfWeek('2026-11-01', 0)).toBe('2026-11-01');
    expect(startOfWeek('2026-10-26', 1)).toBe('2026-10-26');
  });

  it('finds the first and last day of a month', () => {
    expect(startOfMonth('2026-10-28')).toBe('2026-10-01');
    expect(endOfMonth('2026-10-28')).toBe('2026-10-31');
    expect(endOfMonth('2027-02-10')).toBe('2027-02-28');
    expect(endOfMonth('2028-02-10')).toBe('2028-02-29');
  });

  it('numbers the ISO weeks', () => {
    expect(isoWeek('2026-10-29')).toBe(44);
    expect(isoWeek('2025-12-29')).toBe(1); // Monday of week 1 of 2026
    expect(isoWeek('2026-01-01')).toBe(1);
    expect(isoWeek('2026-12-31')).toBe(53);
    expect(isoWeek('2027-01-01')).toBe(53);
    expect(isoWeek('2027-01-04')).toBe(1);
    expect(isoWeek('2026-02-02')).toBe(6);
  });

  it('throws on a date it cannot read where a valid one is required', () => {
    expect(() => addDays('2026-02-30', 1)).toThrow(RangeError);
    expect(() => weekdayOf('soon')).toThrow(RangeError);
  });
});
