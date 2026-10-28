/*
 * The demo clock. "Today" in the demo is Wednesday 2026-10-28; the clock starts at 10:00 Europe/Berlin (CET, UTC+1,
 * so 09:00 UTC) when the page loads and then runs on with real time. The fake API, the filters ("this week") and the
 * UI all read the time from here, never from `new Date()`.
 */

import { cachedZone } from '@/domain/tz';

const DEMO_START_MS = Date.parse('2026-10-28T09:00:00.000Z');
const loadedAtMs = Date.now();

/** The demo's current instant. */
export function now(): Date {
  return new Date(DEMO_START_MS + (Date.now() - loadedAtMs));
}

/** The calendar day in a time zone, 'YYYY-MM-DD'. */
export function today(timeZone: string): string {
  return cachedZone(timeZone).date(now());
}
