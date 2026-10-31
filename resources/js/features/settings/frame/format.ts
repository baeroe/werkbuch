/*
 * Dates and times as the settings screens print them: in the language of the page and in the organisation's time zone.
 * "Now" is `Date.now()`, so a test that sets the clock (`vi.setSystemTime`) steers `relativeTime`.
 */

import { useOrganization } from '@/hooks/organization';
import { intlLocale, t } from '@/lib/i18n';

const FALLBACK_ZONE = 'Europe/Berlin';

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string, style: 'date' | 'datetime'): Intl.DateTimeFormat {
  const locale = intlLocale();
  const key = `${locale}:${style}:${timeZone}`;
  let found = formatters.get(key);
  if (!found) {
    found = new Intl.DateTimeFormat(locale, style === 'date' ? { dateStyle: 'medium', timeZone } : { dateStyle: 'medium', timeStyle: 'short', timeZone });
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

const relativeFormatters = new Map<string, Intl.RelativeTimeFormat>();

function relativeFormatter(): Intl.RelativeTimeFormat {
  const locale = intlLocale();
  let found = relativeFormatters.get(locale);
  if (!found) {
    found = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
    relativeFormatters.set(locale, found);
  }
  return found;
}

const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['day', 86_400_000],
  ['hour', 3_600_000],
  ['minute', 60_000],
];

/** "vor 2 Tagen", "gestern", "in 3 Stunden": the distance of an instant to now. */
export function relativeTime(iso: string): string {
  const distance = new Date(iso).getTime() - Date.now();
  for (const [unit, size] of UNITS) {
    if (Math.abs(distance) >= size) return relativeFormatter().format(Math.trunc(distance / size), unit);
  }
  return t('settings.frame.just_now');
}
