/*
 * Times of templates in German, read in the organisation's time zone, and the organisation's language for the
 * placeholders of a title ({month_name}). Schedules run in that zone (spec 4.12), so the screen shows them in it too.
 */

import { useMemo } from 'react';
import { useOrganization } from '@/hooks/organization';
import type { Locale } from '@/types';

/** The demo organisation's settings, until the organisation has loaded. */
const FALLBACK = { timezone: 'Europe/Berlin', locale: 'de' as Locale };

export function useOrgClock(): { zone: string; locale: Locale } {
  const organization = useOrganization().data;
  return { zone: organization?.timezone ?? FALLBACK.timezone, locale: organization?.locale ?? FALLBACK.locale };
}

export interface RunFormats {
  /** "Mo., 02.11.2026, 09:00" */
  short: (at: Date | string) => string;
  /** "Montag, 2. November 2026 um 09:00" */
  full: (at: Date | string) => string;
  /** The parts of a calendar leaf: "Mo.", "2", "Nov." */
  leaf: (at: Date | string) => { weekday: string; day: string; month: string };
}

export function useRunFormats(): RunFormats {
  const { zone } = useOrgClock();
  return useMemo(() => {
    const short = new Intl.DateTimeFormat('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: zone });
    const full = new Intl.DateTimeFormat('de-DE', { dateStyle: 'full', timeStyle: 'short', timeZone: zone });
    const parts = new Intl.DateTimeFormat('de-DE', { weekday: 'short', day: 'numeric', month: 'short', timeZone: zone });
    const date = (at: Date | string) => (typeof at === 'string' ? new Date(at) : at);
    return {
      short: (at) => short.format(date(at)),
      full: (at) => full.format(date(at)),
      leaf: (at) => {
        const found = Object.fromEntries(parts.formatToParts(date(at)).map((part) => [part.type, part.value]));
        return { weekday: found.weekday ?? '', day: found.day ?? '', month: found.month ?? '' };
      },
    };
  }, [zone]);
}
