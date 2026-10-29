import { describe, expect, it } from 'vitest';
import { normalizeTime } from './ScheduleEditor';

describe('normalizeTime', () => {
  it('reads hours and minutes with a colon or a point, with or without a leading zero', () => {
    expect(normalizeTime('09:00')).toBe('09:00');
    expect(normalizeTime('9:00')).toBe('09:00');
    expect(normalizeTime(' 7.30 ')).toBe('07:30');
    expect(normalizeTime('23:59')).toBe('23:59');
  });

  it('refuses what is no time of day', () => {
    expect(normalizeTime('')).toBeNull();
    expect(normalizeTime('24:00')).toBeNull();
    expect(normalizeTime('9:7')).toBeNull();
    expect(normalizeTime('9 Uhr')).toBeNull();
    expect(normalizeTime('09:00 AM')).toBeNull();
  });
});
