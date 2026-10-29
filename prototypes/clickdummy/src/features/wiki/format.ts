/*
 * Instants of the wiki in German, read in the organisation's time zone (Intl only).
 */

import { useMemo } from 'react';
import { useOrganization } from '@/hooks/organization';

/** The zone of the demo organisation, until the organisation has loaded. */
const FALLBACK_ZONE = 'Europe/Berlin';

export function useZone(): string {
  return useOrganization().data?.timezone ?? FALLBACK_ZONE;
}

/** "14.10.2026, 11:00" */
export function useStamp(): (iso: string) => string {
  const zone = useZone();
  return useMemo(() => {
    const format = new Intl.DateTimeFormat('de-DE', { dateStyle: 'medium', timeStyle: 'short', timeZone: zone });
    return (iso: string) => format.format(new Date(iso));
  }, [zone]);
}

/** "14. Oktober 2026" */
export function useLongDay(): (iso: string) => string {
  const zone = useZone();
  return useMemo(() => {
    const format = new Intl.DateTimeFormat('de-DE', { dateStyle: 'long', timeZone: zone });
    return (iso: string) => format.format(new Date(iso));
  }, [zone]);
}
