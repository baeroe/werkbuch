/*
 * Times of templates, read in the organisation's time zone (schedules run in it, spec 4.12, never in a fixed one) and
 * the language of the page: the short time of a run in the log, the full moment of the next run, and a term of the
 * schedule in full words with the parts of its calendar leaf.
 */

import { formatMoment } from '@/features/item-detail/activity/when';
import { useOrganization } from '@/hooks/organization';
import { intlLocale } from '@/lib/i18n';

const formats = new Map<string, Intl.DateTimeFormat>();

const OPTIONS = {
  short: { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' },
  full: { dateStyle: 'full', timeStyle: 'short' },
  leaf: { weekday: 'short', day: 'numeric', month: 'short' },
} satisfies Record<string, Intl.DateTimeFormatOptions>;

function format(style: keyof typeof OPTIONS, timeZone: string): Intl.DateTimeFormat {
  const key = `${style}:${intlLocale()}:${timeZone}`;
  let found = formats.get(key);
  if (!found) {
    found = new Intl.DateTimeFormat(intlLocale(), { ...OPTIONS[style], timeZone });
    formats.set(key, found);
  }
  return found;
}

/** "Mo., 02.11.2026, 09:00" in `timeZone`. */
export function formatRunTime(iso: string, timeZone: string): string {
  return format('short', timeZone).format(new Date(iso));
}

/** "Montag, 2. November 2026 um 09:00" in `timeZone`. */
export function formatTerm(iso: string, timeZone: string): string {
  return format('full', timeZone).format(new Date(iso));
}

/** The parts of a calendar leaf in `timeZone`: "Mo.", "2", "Nov.". */
export function termLeaf(iso: string, timeZone: string): { weekday: string; day: string; month: string } {
  const found = Object.fromEntries(format('leaf', timeZone).formatToParts(new Date(iso)).map((part) => [part.type, part.value]));
  return { weekday: found.weekday ?? '', day: found.day ?? '', month: found.month ?? '' };
}

/**
 * The time formats of templates in the organisation's zone: `short` for a run, `moment` for the next one, `term` and
 * `leaf` for a term of the schedule; `zone` is that zone.
 */
export function useTemplateTimes() {
  const zone = useOrganization().data.timezone;
  return {
    zone,
    short: (iso: string) => formatRunTime(iso, zone),
    moment: (iso: string) => formatMoment(iso, zone),
    term: (iso: string) => formatTerm(iso, zone),
    leaf: (iso: string) => termLeaf(iso, zone),
  };
}
