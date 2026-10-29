/*
 * Dates, times and counts as the settings screens print them: German, in the organisation's time zone. The demo
 * clock (`now()`) stands for "now", never `new Date()`.
 */

import { useOrganization } from '@/hooks/organization';
import { now } from '@/lib/clock';

const FALLBACK_ZONE = 'Europe/Berlin';

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string, style: 'date' | 'datetime'): Intl.DateTimeFormat {
  const key = `${style}:${timeZone}`;
  let found = formatters.get(key);
  if (!found) {
    found = new Intl.DateTimeFormat('de-DE', style === 'date' ? { dateStyle: 'medium', timeZone } : { dateStyle: 'medium', timeStyle: 'short', timeZone });
    formatters.set(key, found);
  }
  return found;
}

/** The time zone the organisation counts in, or Berlin until it has loaded. */
export function useOrgZone(): string {
  return useOrganization().data?.timezone ?? FALLBACK_ZONE;
}

/** "28.10.2026" style: the day of an instant in the zone. */
export const formatDate = (iso: string, timeZone: string): string => formatter(timeZone, 'date').format(new Date(iso));

/** "28.10.2026, 09:05" style. */
export const formatDateTime = (iso: string, timeZone: string): string => formatter(timeZone, 'datetime').format(new Date(iso));

const RELATIVE = new Intl.RelativeTimeFormat('de-DE', { numeric: 'auto' });
const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['day', 86_400_000],
  ['hour', 3_600_000],
  ['minute', 60_000],
];

/** "vor 2 Tagen", "gestern", "in 3 Stunden": the distance of an instant to the demo clock. */
export function relativeTime(iso: string): string {
  const distance = new Date(iso).getTime() - now().getTime();
  for (const [unit, size] of UNITS) {
    if (Math.abs(distance) >= size) return RELATIVE.format(Math.trunc(distance / size), unit);
  }
  return 'gerade eben';
}

const COUNT = new Intl.NumberFormat('de-DE');

/** "1 Item", "3 Items": the count and the right form of the noun, joined by a space that does not break the line. */
export function counted(count: number, one: string, many: string): string {
  return `${COUNT.format(count)}\u00a0${count === 1 ? one : many}`;
}
