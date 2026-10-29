import { afterEach, describe, expect, it, vi } from 'vitest';
import { now, today } from './clock';

afterEach(() => vi.useRealTimers());

describe('clock', () => {
  it('starts at 10:00 Europe/Berlin on Wednesday 2026-10-28', () => {
    const start = now();

    expect(start.getTime()).toBeGreaterThanOrEqual(Date.parse('2026-10-28T09:00:00.000Z'));
    expect(start.getTime()).toBeLessThan(Date.parse('2026-10-28T09:05:00.000Z')); // a test run is no five minutes long
    expect(today('Europe/Berlin')).toBe('2026-10-28');
  });

  it('runs on with real time', () => {
    vi.useFakeTimers();
    const before = now().getTime();

    vi.advanceTimersByTime(90 * 60_000);

    expect(now().getTime() - before).toBe(90 * 60_000);
  });

  it('answers the calendar day of the time zone asked for', () => {
    vi.useFakeTimers();
    // 15 hours after 10:00 Berlin it is 01:00 on the 29th in Berlin, but still 16:00 on the 28th in Los Angeles
    vi.advanceTimersByTime(15 * 3_600_000);

    expect(today('Europe/Berlin')).toBe('2026-10-29');
    expect(today('America/Los_Angeles')).toBe('2026-10-28');
  });
});
