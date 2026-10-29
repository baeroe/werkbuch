import { describe, expect, it } from 'vitest';
import { daily09, everyOtherWed09, firstMonday09, monthDay31at09, weeklyMonThu09 } from '@/domain/fixtures';
import type { Schedule } from '@/types';
import { describeSchedule } from './scheduleText';

describe('describeSchedule', () => {
  it('names the n-th weekday of a month', () => {
    expect(describeSchedule(firstMonday09)).toBe('Jeden ersten Montag im Monat um 09:00');
  });

  it('names the interval and the weekday of a weekly schedule', () => {
    expect(describeSchedule(everyOtherWed09)).toBe('Alle 2 Wochen am Mittwoch um 09:00');
  });

  it('says that a late day of the month falls back to the last day', () => {
    expect(describeSchedule(monthDay31at09)).toBe('Monatlich am 31. (oder letzten Tag) um 09:00');
  });
});

describe('describeSchedule, further shapes', () => {
  const at = (overrides: Partial<Schedule>): Schedule => ({ ...daily09, ...overrides });

  it('daily: every day, or every N days', () => {
    expect(describeSchedule(daily09)).toBe('Täglich um 09:00');
    expect(describeSchedule(at({ interval: 3, time: '07:30' }))).toBe('Alle 3 Tage um 07:30');
  });

  it('weekly: the days from Monday to Sunday, joined as German lists are', () => {
    expect(describeSchedule(weeklyMonThu09)).toBe('Wöchentlich am Montag und Donnerstag um 09:00');
    expect(describeSchedule(at({ frequency: 'weekly', weekdays: [5, 1, 3] }))).toBe('Wöchentlich am Montag, Mittwoch und Freitag um 09:00');
    expect(describeSchedule(at({ frequency: 'weekly', weekdays: [0, 6] }))).toBe('Wöchentlich am Samstag und Sonntag um 09:00');
    expect(describeSchedule(at({ frequency: 'weekly', weekdays: [0, 1, 2, 3, 4, 5, 6] }))).toBe('Wöchentlich an allen Tagen um 09:00');
  });

  it('weekly without days: the weekday of the start, as the schedule runs', () => {
    // 2026-10-28 is a Wednesday
    expect(describeSchedule(at({ frequency: 'weekly', starts_on: '2026-10-28' }))).toBe('Wöchentlich am Mittwoch um 09:00');
  });

  it('monthly: a day that every month has needs no fallback; the last day and the last weekday', () => {
    expect(describeSchedule(at({ frequency: 'monthly', month_day: 15 }))).toBe('Monatlich am 15. um 09:00');
    expect(describeSchedule(at({ frequency: 'monthly', month_day: 29 }))).toBe('Monatlich am 29. (oder letzten Tag) um 09:00');
    expect(describeSchedule(at({ frequency: 'monthly', month_day: 'last' }))).toBe('Monatlich am letzten Tag um 09:00');
    expect(describeSchedule(at({ frequency: 'monthly', nth_weekday: { n: -1, weekday: 5 } }))).toBe('Jeden letzten Freitag im Monat um 09:00');
  });

  it('monthly every N months', () => {
    expect(describeSchedule(at({ frequency: 'monthly', interval: 3, month_day: 1 }))).toBe('Alle 3 Monate am 1. um 09:00');
    expect(describeSchedule(at({ frequency: 'monthly', interval: 2, nth_weekday: { n: 2, weekday: 2 } }))).toBe('Alle 2 Monate am zweiten Dienstag um 09:00');
  });

  it('monthly without a day: the day of the start, as the schedule runs', () => {
    expect(describeSchedule(at({ frequency: 'monthly', starts_on: '2026-01-31' }))).toBe('Monatlich am 31. (oder letzten Tag) um 09:00');
  });

  it('yearly: on a date, by default the date of the start', () => {
    expect(describeSchedule(at({ frequency: 'yearly', yearly_date: '12-24' }))).toBe('Jährlich am 24. Dezember um 09:00');
    expect(describeSchedule(at({ frequency: 'yearly', interval: 2, yearly_date: '12-24' }))).toBe('Alle 2 Jahre am 24. Dezember um 09:00');
    expect(describeSchedule(at({ frequency: 'yearly', starts_on: '2026-03-15' }))).toBe('Jährlich am 15. März um 09:00');
    expect(describeSchedule(at({ frequency: 'yearly', yearly_date: '02-29' }))).toBe('Jährlich am 29. Februar (oder letzten Tag) um 09:00');
  });

  it('reads a broken interval as 1, as the schedule does', () => {
    expect(describeSchedule(at({ interval: 0 }))).toBe('Täglich um 09:00');
    expect(describeSchedule(at({ interval: 2.7 }))).toBe('Alle 2 Tage um 09:00');
  });

  it('adds when the schedule ends', () => {
    expect(describeSchedule(at({ ends: { type: 'on', date: '2026-12-31' } }))).toBe('Täglich um 09:00, bis zum 31.12.2026');
    expect(describeSchedule(at({ ends: { type: 'count', count: 12 } }))).toBe('Täglich um 09:00, endet nach 12 Läufen');
    expect(describeSchedule(at({ ends: { type: 'count', count: 1 } }))).toBe('Täglich um 09:00, endet nach 1 Lauf');
  });
});
