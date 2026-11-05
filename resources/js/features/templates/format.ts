/*
 * Times of templates, read in the organisation's time zone (schedules run in it, spec 4.12, never in a fixed one) and
 * the language of the page: the short time of a run in the log, the full moment of the next run.
 */

import { formatMoment } from '@/features/item-detail/activity/when';
import { useOrganization } from '@/hooks/organization';
import { intlLocale } from '@/lib/i18n';

const shorts = new Map<string, Intl.DateTimeFormat>();

/** "Mo., 02.11.2026, 09:00" in `timeZone`. */
export function formatRunTime(iso: string, timeZone: string): string {
  const key = `${intlLocale()}:${timeZone}`;
  let format = shorts.get(key);
  if (!format) {
    format = new Intl.DateTimeFormat(intlLocale(), { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone });
    shorts.set(key, format);
  }
  return format.format(new Date(iso));
}

/** The time formats of templates in the organisation's zone: `short` for a run, `moment` for the next one. */
export function useTemplateTimes(): { short: (iso: string) => string; moment: (iso: string) => string } {
  const zone = useOrganization().data.timezone;
  return { short: (iso) => formatRunTime(iso, zone), moment: (iso) => formatMoment(iso, zone) };
}
