/*
 * The time zones the pickers offer (organisation and profile, P22). The browser knows about 400; a list that long would
 * have to be virtualised, and nobody scrolls through it. The pickers offer the zones people actually live in, plus the
 * ones the account or the organisation already has, so a zone from elsewhere is never lost by opening a form. The
 * server takes every IANA zone.
 */

import { intlLocale } from '@/lib/i18n';

export interface ZoneOption {
  value: string;
  label: string;
}

/** Common zones, 48 of them: one or more per region of the world. */
export const COMMON_ZONES: readonly string[] = [
  'UTC',
  'Europe/London',
  'Europe/Dublin',
  'Europe/Lisbon',
  'Europe/Madrid',
  'Europe/Paris',
  'Europe/Berlin',
  'Europe/Amsterdam',
  'Europe/Brussels',
  'Europe/Zurich',
  'Europe/Vienna',
  'Europe/Rome',
  'Europe/Copenhagen',
  'Europe/Stockholm',
  'Europe/Oslo',
  'Europe/Helsinki',
  'Europe/Warsaw',
  'Europe/Prague',
  'Europe/Athens',
  'Europe/Istanbul',
  'Europe/Kyiv',
  'Europe/Moscow',
  'Africa/Cairo',
  'Africa/Johannesburg',
  'Africa/Lagos',
  'Africa/Nairobi',
  'Asia/Dubai',
  'Asia/Karachi',
  'Asia/Kolkata',
  'Asia/Dhaka',
  'Asia/Bangkok',
  'Asia/Jakarta',
  'Asia/Singapore',
  'Asia/Hong_Kong',
  'Asia/Shanghai',
  'Asia/Tokyo',
  'Asia/Seoul',
  'Australia/Perth',
  'Australia/Sydney',
  'Pacific/Auckland',
  'America/Sao_Paulo',
  'America/Bogota',
  'America/Mexico_City',
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'Pacific/Honolulu',
];

/** Whether the browser can work with a zone name. */
function known(zone: string): boolean {
  try {
    new Intl.DateTimeFormat('en', { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

/** "MEZ" (German) or "CET" (English) for Berlin in winter, "GMT+9" for Tokyo: the short name of a zone today. */
function shortName(zone: string, at: Date): string {
  return new Intl.DateTimeFormat(intlLocale(), { timeZone: zone, timeZoneName: 'short' }).formatToParts(at).find((part) => part.type === 'timeZoneName')?.value ?? '';
}

/**
 * The common zones plus `current` (the zone the form shows) and `fallback` (the one that applies without a choice of
 * its own, e.g. the organisation's for a profile), each once, by name, labelled "Name (short)". `current` and
 * `fallback` stay even when the browser does not know them (with their plain name): a form never loses its value. An
 * empty one (an account without a zone of its own) adds nothing: there is no empty choice.
 */
export function zoneOptions(current: string, fallback: string): ZoneOption[] {
  const at = new Date();

  return [...new Set([...COMMON_ZONES, current, fallback])]
    .filter((zone) => zone !== '' && (zone === current || zone === fallback || known(zone)))
    .sort((a, b) => a.localeCompare(b))
    .map((zone) => {
      const short = known(zone) ? shortName(zone, at) : '';
      return { value: zone, label: short ? `${zone} (${short})` : zone };
    });
}
