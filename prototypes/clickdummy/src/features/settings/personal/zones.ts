/*
 * The time zones of the profile. The browser knows about 400; a list that long would have to be virtualised, and nobody
 * scrolls through it. The prototype offers the zones people actually live in, plus the ones a person already has.
 */

import { now } from '@/lib/clock';

export interface ZoneOption {
  value: string;
  label: string;
}

/** Common zones, 48 of them: one or more per region of the world. */
const COMMON_ZONES = [
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
    new Intl.DateTimeFormat('de', { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

/** "MEZ" for Berlin in winter, "GMT+9" for Tokyo: the short name of a zone at the demo's date. */
function shortName(zone: string): string {
  return new Intl.DateTimeFormat('de', { timeZone: zone, timeZoneName: 'short' }).formatToParts(now()).find((part) => part.type === 'timeZoneName')?.value ?? '';
}

/** The common zones and `own` (the zones a person or the organisation has), each once, by name, labelled "Name (short)". */
export function zoneOptions(...own: string[]): ZoneOption[] {
  return [...new Set([...COMMON_ZONES, ...own])]
    .filter(known)
    .sort((a, b) => a.localeCompare(b))
    .map((zone) => {
      const short = shortName(zone);
      return { value: zone, label: short ? `${zone} (${short})` : zone };
    });
}
