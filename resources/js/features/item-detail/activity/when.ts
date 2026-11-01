/*
 * When a line of the activity happened, in the organisation's time zone (13c, never a fixed one such as Berlin) and
 * the language of the page: "heute 09:12", "gestern 14:05", "20.10. 11:30", "20.10.2025".
 */

import { addDays } from '@/components/fields/format';
import { cachedZone } from '@/domain/tz';
import { intlLocale, t } from '@/lib/i18n';

const formats = new Map<string, Intl.DateTimeFormat>();

/** One formatter per language, zone and style, built on first use. */
function format(timeZone: string, style: 'time' | 'day' | 'date' | 'full'): Intl.DateTimeFormat {
  const locale = intlLocale();
  const key = `${locale}:${timeZone}:${style}`;
  let cached = formats.get(key);
  if (!cached) {
    const options: Intl.DateTimeFormatOptions =
      style === 'time'
        ? { hour: '2-digit', minute: '2-digit' }
        : style === 'day'
          ? { day: '2-digit', month: '2-digit' }
          : style === 'date'
            ? { day: '2-digit', month: '2-digit', year: 'numeric' }
            : { dateStyle: 'full', timeStyle: 'short' };
    cached = new Intl.DateTimeFormat(locale, { ...options, timeZone });
    formats.set(key, cached);
  }
  return cached;
}

/**
 * When `iso` happened, as short as it can be read: with the time today, yesterday and earlier this year, only the day
 * in earlier years. `today` ('YYYY-MM-DD') is today in `timeZone` (`useToday`).
 */
export function formatWhen(iso: string, today: string, timeZone: string): string {
  const date = new Date(iso);
  const day = cachedZone(timeZone).date(date);
  const time = format(timeZone, 'time').format(date);
  if (day === today) return t('items.activity.when.today', { time });
  if (day === addDays(today, -1)) return t('items.activity.when.yesterday', { time });
  if (day.slice(0, 4) === today.slice(0, 4)) return `${format(timeZone, 'day').format(date)} ${time}`;
  return format(timeZone, 'date').format(date);
}

/** The full moment, for the tooltip: "Dienstag, 20. Oktober 2026 um 11:30". */
export function formatMoment(iso: string, timeZone: string): string {
  return format(timeZone, 'full').format(new Date(iso));
}
