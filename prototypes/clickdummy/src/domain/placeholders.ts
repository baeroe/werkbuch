/*
 * Placeholders in template titles (spec 4.12).
 */

import type { Locale } from '@/types';
import { createZone, formatDate, isoWeek } from './tz';

const PLACEHOLDER = /\{([a-z_]+)\}/g;

const pad2 = (value: number) => String(value).padStart(2, '0');

/**
 * Fills the placeholders of a title with the date of `at`, read in `timeZone`:
 * - `{date}` 2026-11-02, `{year}` 2026, `{month}` 11, `{quarter}` 4
 * - `{week}` the ISO calendar week, `{month_name}` the name of the month in `locale`
 * `{month}` and `{week}` have two digits. Text that is not a known placeholder stays as it is.
 */
export function renderTitle(template: string, at: Date, locale: Locale, timeZone: string): string {
  const { year, month, day } = createZone(timeZone).parts(at);
  const date = formatDate(year, month, day);

  const values: Record<string, () => string> = {
    date: () => date,
    week: () => pad2(isoWeek(date)),
    month: () => pad2(month),
    month_name: () => new Intl.DateTimeFormat(locale, { month: 'long', timeZone }).format(at),
    quarter: () => String(Math.floor((month - 1) / 3) + 1),
    year: () => String(year),
  };

  return template.replace(PLACEHOLDER, (match, name: string) => (Object.hasOwn(values, name) ? values[name]() : match));
}
