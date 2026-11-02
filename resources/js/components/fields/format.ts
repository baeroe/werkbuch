/*
 * How item values read (Intl in the language of the page, never hand-made): days, days relative to today, numbers with
 * the decimals of a property, and any property value as one line of text (the type change dialog, rows and cards).
 * Days are calendar dates without a zone; "today" comes from `useToday` (the organisation's time zone), never from a
 * fixed one (13c).
 */

import { intlLocale, t } from '@/lib/i18n';
import { plainText } from '@/lib/richtext';
import type { Property, PropertyValue, RichText, User } from '@/types';

const DAY_MS = 86_400_000;
/** Days are calendar dates: read as UTC midnights, so no time zone shifts them. */
const utc = (iso: string) => new Date(`${iso}T00:00:00Z`);

const formats = new Map<string, Intl.DateTimeFormat>();

/** One formatter per language and style, built on first use. */
function dayFormat(style: 'day' | 'short' | 'weekday'): Intl.DateTimeFormat {
  const locale = intlLocale();
  const key = `${locale}:${style}`;
  let format = formats.get(key);
  if (!format) {
    const options: Intl.DateTimeFormatOptions =
      style === 'day'
        ? { day: '2-digit', month: '2-digit', year: 'numeric' }
        : style === 'short'
          ? { day: '2-digit', month: '2-digit' }
          : { weekday: 'short', day: '2-digit', month: '2-digit' };
    format = new Intl.DateTimeFormat(locale, { ...options, timeZone: 'UTC' });
    formats.set(key, format);
  }
  return format;
}

/** 31.10.2026 */
export const formatDay = (iso: string): string => dayFormat('day').format(utc(iso));

/** 31.10. (cards and rows, where the year is the current one or obvious) */
export const formatShortDay = (iso: string): string => dayFormat('short').format(utc(iso));

/** Fr., 30.10. */
export const formatWeekdayDay = (iso: string): string => dayFormat('weekday').format(utc(iso));

/** Whole days from `from` to `to`; negative when `to` lies before. */
export const daysBetween = (from: string, to: string): number => Math.round((utc(to).getTime() - utc(from).getTime()) / DAY_MS);

const relatives = new Map<string, Intl.RelativeTimeFormat>();

/** heute, morgen, übermorgen, in 3 Tagen, gestern, vor 2 Tagen; `today` from `useToday` (the organisation's zone). */
export function relativeDay(iso: string, today: string): string {
  const locale = intlLocale();
  let format = relatives.get(locale);
  if (!format) {
    format = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
    relatives.set(locale, format);
  }
  return format.format(daysBetween(today, iso), 'day');
}

/** A day `days` after `iso`. */
export const addDays = (iso: string, days: number): string => new Date(utc(iso).getTime() + days * DAY_MS).toISOString().slice(0, 10);

const numberFormats = new Map<string, Intl.NumberFormat>();

/**
 * A number with at most the property's decimals: 3,5 or 1.500 for reading; `grouping: false` gives 1500 for a field
 * that is edited, where a separator would sit in the middle of the typing.
 */
export function formatNumber(value: number, decimals = 0, { grouping = true }: { grouping?: boolean } = {}): string {
  const locale = intlLocale();
  const key = `${locale}:${decimals}:${grouping}`;
  let format = numberFormats.get(key);
  if (!format) {
    format = new Intl.NumberFormat(locale, { maximumFractionDigits: decimals, useGrouping: grouping });
    numberFormats.set(key, format);
  }
  return format.format(value);
}

const sizeFormats = new Map<string, Intl.NumberFormat>();

/** The size of a file as people read it: 512 Byte, 120 kB, 25,3 MB (powers of 1000, like the file managers). */
export function formatSize(bytes: number): string {
  const [unit, value, decimals] = bytes < 1000 ? (['byte', bytes, 0] as const) : bytes < 1_000_000 ? (['kilobyte', bytes / 1000, 0] as const) : (['megabyte', bytes / 1_000_000, 1] as const);
  const key = `${intlLocale()}:${unit}`;
  let format = sizeFormats.get(key);
  if (!format) {
    format = new Intl.NumberFormat(intlLocale(), { style: 'unit', unit, unitDisplay: 'short', maximumFractionDigits: decimals });
    sizeFormats.set(key, format);
  }
  return format.format(value);
}

const MAX_EXCERPT = 80;

/** A property value as one line: option labels, names, yes/no, a day, the start of a text. Empty for no value. */
export function formatPropertyValue(property: Property, value: PropertyValue | undefined, userName: (id: string) => string): string {
  if (value === undefined || value === null) return '';
  const ids = Array.isArray(value) ? value : [value];
  switch (property.field_type) {
    case 'number':
      return typeof value === 'number' ? formatNumber(value, property.settings.decimals ?? 0) : String(value);
    case 'boolean':
      return value === true ? t('items.fields.yes') : t('items.fields.no');
    case 'date':
      return typeof value === 'string' ? formatDay(value) : '';
    case 'dropdown':
      return ids.map((id) => property.options.find((option) => option.id === id)?.label ?? t('items.fields.unknown_option')).join(', ');
    case 'member':
      return ids.map((id) => userName(String(id))).join(', ');
    case 'rich_text': {
      const text = plainText(value as RichText);
      return text.length > MAX_EXCERPT ? `${text.slice(0, MAX_EXCERPT - 1).trimEnd()}…` : text;
    }
    case 'text':
    case 'url':
      return String(value);
  }
}

/** Bots carry the word "Bot" beside the name (DESIGN.md), also a bot that belongs to a person. */
export const botWord = (user: Pick<User, 'type'>): string | undefined => (user.type === 'bot' ? t('items.fields.bot') : undefined);
