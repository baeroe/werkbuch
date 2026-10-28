import { describe, expect, it } from 'vitest';
import { renderTitle } from './placeholders';

const TZ = 'Europe/Berlin';

describe('renderTitle', () => {
  it('fills {month_name} in the language of the organisation and {year}', () => {
    expect(renderTitle('Monatsbericht {month_name} {year}', new Date('2026-11-02T08:00:00Z'), 'de', TZ)).toBe('Monatsbericht November 2026');
  });

  it('fills {week} with the ISO calendar week', () => {
    expect(renderTitle('Wartung KW {week}', new Date('2026-10-29T08:00:00Z'), 'de', TZ)).toBe('Wartung KW 44');
  });

  it('fills {date}, {quarter} and {month} and leaves unknown placeholders alone', () => {
    expect(renderTitle('Bericht {date} Q{quarter}/{month} {foo}', new Date('2026-11-02T08:00:00Z'), 'en', TZ)).toBe('Bericht 2026-11-02 Q4/11 {foo}');
  });

  it('writes month names in German and in English', () => {
    const at = new Date('2026-03-02T08:00:00Z');

    expect(renderTitle('{month_name}', at, 'de', TZ)).toBe('März');
    expect(renderTitle('{month_name}', at, 'en', TZ)).toBe('March');
  });

  it('pads {month} and {week} to two digits', () => {
    // Monday 2026-02-02 is in ISO week 6
    expect(renderTitle('{year}-{month} KW {week}', new Date('2026-02-02T08:00:00Z'), 'de', TZ)).toBe('2026-02 KW 06');
  });

  it('numbers the quarters 1 to 4', () => {
    const quarters = ['2026-01-15', '2026-04-15', '2026-07-15', '2026-10-15'].map((day) =>
      renderTitle('{quarter}', new Date(`${day}T10:00:00Z`), 'de', TZ),
    );

    expect(quarters).toEqual(['1', '2', '3', '4']);
  });

  it('reads the date in the time zone, not in UTC', () => {
    // 23:30 UTC on Halloween is already the next day in Berlin
    const at = new Date('2026-10-31T23:30:00Z');

    expect(renderTitle('{date} {month_name}', at, 'de', TZ)).toBe('2026-11-01 November');
    expect(renderTitle('{date} {month_name}', at, 'de', 'UTC')).toBe('2026-10-31 Oktober');
  });

  it('uses the ISO week across the turn of the year', () => {
    // Friday 2027-01-01 still belongs to week 53 of 2026
    expect(renderTitle('KW {week}', new Date('2027-01-01T10:00:00Z'), 'de', TZ)).toBe('KW 53');
    expect(renderTitle('KW {week}', new Date('2027-01-04T10:00:00Z'), 'de', TZ)).toBe('KW 01');
  });

  it('replaces every occurrence of a placeholder', () => {
    expect(renderTitle('{year}/{year}', new Date('2026-11-02T08:00:00Z'), 'de', TZ)).toBe('2026/2026');
  });

  it('leaves text without placeholders, odd braces and inherited names untouched', () => {
    const at = new Date('2026-11-02T08:00:00Z');

    expect(renderTitle('Nichts zu tun', at, 'de', TZ)).toBe('Nichts zu tun');
    expect(renderTitle('{ year } {Year} {year', at, 'de', TZ)).toBe('{ year } {Year} {year');
    expect(renderTitle('{constructor} {toString}', at, 'de', TZ)).toBe('{constructor} {toString}');
  });
});
