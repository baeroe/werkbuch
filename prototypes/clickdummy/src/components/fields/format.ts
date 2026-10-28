/*
 * How item values read in German (Intl, never hand-made): days, days relative to today, numbers with the decimals of a
 * property, and any property value as one line of text (the type change dialog, rows and cards).
 */

import { plainText } from '@/lib/richtext';
import type { Property, PropertyValue, RichText, User } from '@/types';

const DAY_MS = 86_400_000;
/** Days are calendar dates: read as UTC midnights, so no time zone shifts them. */
const utc = (iso: string) => new Date(`${iso}T00:00:00Z`);

const DAY = new Intl.DateTimeFormat('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' });
const SHORT_DAY = new Intl.DateTimeFormat('de-DE', { day: '2-digit', month: '2-digit', timeZone: 'UTC' });
const RELATIVE = new Intl.RelativeTimeFormat('de-DE', { numeric: 'auto' });

/** 31.10.2026 */
export const formatDay = (iso: string): string => DAY.format(utc(iso));

/** 31.10. (cards and rows, where the year is the current one or obvious) */
export const formatShortDay = (iso: string): string => SHORT_DAY.format(utc(iso));

const WEEKDAY_DAY = new Intl.DateTimeFormat('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit', timeZone: 'UTC' });

/** Fr., 30.10. */
export const formatWeekdayDay = (iso: string): string => WEEKDAY_DAY.format(utc(iso));

/** The weekday of a day: 0 = Sunday … 6 = Saturday. */
export const weekdayOf = (iso: string): number => utc(iso).getUTCDay();

/** Whole days from `from` to `to`; negative when `to` lies before. */
export const daysBetween = (from: string, to: string): number => Math.round((utc(to).getTime() - utc(from).getTime()) / DAY_MS);

/** heute, morgen, übermorgen, in 3 Tagen, gestern, vor 2 Tagen */
export const relativeDay = (iso: string, today: string): string => RELATIVE.format(daysBetween(today, iso), 'day');

/** A day `days` after `iso`. */
export const addDays = (iso: string, days: number): string => new Date(utc(iso).getTime() + days * DAY_MS).toISOString().slice(0, 10);

const numberFormats = new Map<number, Intl.NumberFormat>();

/** A number with at most the property's decimals: 3,5 or 4. */
export function formatNumber(value: number, decimals = 0): string {
  let format = numberFormats.get(decimals);
  if (!format) {
    format = new Intl.NumberFormat('de-DE', { maximumFractionDigits: decimals });
    numberFormats.set(decimals, format);
  }
  return format.format(value);
}

const MAX_EXCERPT = 80;

/** A property value as one line: option labels, names, Ja/Nein, a day, the start of a text. Empty for no value. */
export function formatPropertyValue(property: Property, value: PropertyValue | undefined, userName: (id: string) => string): string {
  if (value === undefined || value === null) return '';
  const ids = Array.isArray(value) ? value : [value];
  switch (property.field_type) {
    case 'number':
      return typeof value === 'number' ? formatNumber(value, property.settings.decimals ?? 0) : String(value);
    case 'boolean':
      return value === true ? 'Ja' : 'Nein';
    case 'date':
      return typeof value === 'string' ? formatDay(value) : '';
    case 'dropdown':
      return ids.map((id) => property.options.find((option) => option.id === id)?.label ?? 'Unbekannte Option').join(', ');
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

/** Bots carry a word beside the name (DESIGN.md): "Agent" for a person's agent, "Bot" otherwise. */
export const botWord = (user: Pick<User, 'type' | 'owner_id'>): string | undefined => (user.type !== 'bot' ? undefined : user.owner_id ? 'Agent' : 'Bot');
