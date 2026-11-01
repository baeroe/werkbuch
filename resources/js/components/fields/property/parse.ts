/*
 * What the property editors read from what is typed, and when a value counts as empty. Pure rules without React:
 * numbers take a comma or a point as the decimal sign and a thousands separator only together with the other sign as
 * decimal sign (13c); a number that reads either way ("1.500": 1500 or 1,5?) is refused, never guessed. Text and
 * addresses as the server takes them (`App\Domain\Properties\ItemValue`).
 */

import { t } from '@/lib/i18n';
import { isBlankDoc, plainDocText, textDoc } from '@/lib/richtext';
import type { Property, PropertyValue, RichText } from '@/types';
import { formatNumber } from '../format';

/** The longest text value, as the server takes it (`ItemValue::TEXT_MAX`). */
export const MAX_TEXT = 255;

/** Empty as the server counts it: nothing, blank text, an empty list, a rich text without content. Numbers and yes/no never. */
export function isEmptyValue(value: PropertyValue | undefined): boolean {
  if (value === undefined || value === null) return true;
  if (typeof value === 'string') return value.trim() === '';
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === 'object') return isBlankDoc(value as RichText);
  return false;
}

/**
 * Empty as a reader sees it: a yes/no field reads "no" until it is switched on, so `false` and no value read the same
 * (A89). The server still stores what is set.
 */
export const readsEmpty = (property: Pick<Property, 'field_type'>, value: PropertyValue | undefined): boolean =>
  isEmptyValue(value) || (property.field_type === 'boolean' && value !== true);

export const sameValue = (a: PropertyValue | undefined, b: PropertyValue | undefined): boolean => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** The ids a dropdown or member value names: one for a single choice, several for a multiple one. */
export const idsOf = (value: PropertyValue | undefined): string[] =>
  Array.isArray(value) ? value.map(String) : typeof value === 'string' && value !== '' ? [value] : [];

/** "3,5", "3.5", "1.234,5" and "1,234.5": the separator before the decimal sign only groups thousands. */
const SIMPLE = /^(-?)(\d+)(?:[.,](\d+))?$/;
const GROUPED = /^(-?)(\d{1,3}(?:\.\d{3})+),(\d+)$/;
const GROUPED_POINT = /^(-?)(\d{1,3}(?:,\d{3})+)\.(\d+)$/;
/** One separator, three digits after it, no leading zero: "1.500" and "1,500" are 1500 or 1,5. */
const AMBIGUOUS = /^-?[1-9]\d{0,2}[.,]\d{3}$/;

/** The two readings of a number that reads either way ("1.500": 1500 or 1.5), or null when it reads one way. */
export function ambiguousNumber(text: string): { whole: number; decimal: number } | null {
  const trimmed = text.trim();
  if (!AMBIGUOUS.test(trimmed)) return null;
  return { whole: Number(trimmed.replace(/[.,]/, '')), decimal: Number(trimmed.replace(',', '.')) };
}

/**
 * A typed number, rounded to the property's decimals; null when the text is no number or reads either way
 * (`ambiguousNumber`). Comma and point are both the decimal sign ("0.500" is 0,5, never 500); the other one groups
 * thousands only before a decimal sign ("1.234,5", "1,234.5"). A number at or beyond `NUMBER_LIMIT` in amount is null too.
 */
export function parseNumber(text: string, decimals: number): number | null {
  const value = readNumber(text, decimals);
  return value !== null && Math.abs(value) >= NUMBER_LIMIT ? null : value;
}

/**
 * Numbers stay below this in amount, as the server takes them (`ItemValue::NUMBER_LIMIT`): the column holds 20 digits
 * before the decimal sign.
 */
export const NUMBER_LIMIT = 1e20;

/** The number a text reads as, rounded, without the limit of the column. */
function readNumber(text: string, decimals: number): number | null {
  const trimmed = text.trim();
  if (ambiguousNumber(trimmed)) return null;
  const match = SIMPLE.exec(trimmed) ?? GROUPED.exec(trimmed) ?? GROUPED_POINT.exec(trimmed);
  if (!match) return null;
  const [, sign, whole, fraction] = match;
  // rounded in decimal notation, half away from zero, as the server rounds: 2,6750 with two decimals is 2,68
  const digits = `${whole!.replaceAll(/[.,]/g, '')}.${fraction ?? '0'}`;
  const scaled = Math.round(Number(`${digits}e${decimals}`));
  // from 1e21 on a number prints with an exponent ("1e+21e-2" is no number); there a float has no decimals left to round
  const rounded = Math.abs(scaled) < 1e21 ? Number(`${scaled}e-${decimals}`) : Number(digits);
  return sign === '-' && rounded !== 0 ? -rounded : rounded;
}

export type Parsed = { value: PropertyValue } | { error: string; partial: boolean };

/** An address the server takes: http or https, a host, no blanks or control characters (umlauts are fine). */
function isAddress(text: string): boolean {
  if (/[\s\u0000-\u001f\u007f]/.test(text)) return false;
  try {
    const url = new URL(text);
    // http and https always have a host: the URL parser refuses them without one
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * What a typed text means for a text, number, URL or plain rich text property. `partial`: the text may still become
 * valid while one types (an address, a number ending in a comma), so its error waits for Enter or for leaving the field.
 */
export function parseTyped(property: Pick<Property, 'field_type' | 'settings'>, text: string): Parsed {
  if (property.field_type === 'rich_text') return { value: text.trim() === '' ? null : textDoc(text) };
  const trimmed = text.trim();
  if (trimmed === '') return { value: null };
  switch (property.field_type) {
    case 'number': {
      const decimals = property.settings.decimals ?? 0;
      const value = readNumber(trimmed, decimals);
      if (value !== null && Math.abs(value) >= NUMBER_LIMIT) return { error: t('items.fields.property.number_range'), partial: false };
      if (value !== null) return { value };
      // "1.500" may still become "1.500,5" while one types: the question waits for Enter or for leaving the field
      const readings = ambiguousNumber(trimmed);
      if (readings) {
        const whole = formatNumber(readings.whole, 0, { grouping: false });
        const decimal = formatNumber(readings.decimal, 3, { grouping: false });
        return { error: t('items.fields.property.number_ambiguous', { whole, decimal }), partial: true };
      }
      // digits, points and a comma may still become a number while one types ("1." on the way to "1.234,5")
      return {
        error: t('items.fields.property.number', { example: decimals > 0 ? formatNumber(3.5, 1) : formatNumber(4) }),
        partial: /^-?[\d.,]*$/.test(trimmed),
      };
    }
    case 'url':
      return isAddress(trimmed) ? { value: trimmed } : { error: t('items.fields.property.url'), partial: true };
    default:
      return trimmed.length > MAX_TEXT
        ? { error: t('items.fields.property.too_long', { max: MAX_TEXT, count: trimmed.length }), partial: false }
        : { value: trimmed };
  }
}

/** The value as the field shows it while it is edited: numbers without thousands separators, plain rich text as lines. */
export function shownText(property: Pick<Property, 'field_type' | 'settings'>, value: PropertyValue | undefined): string {
  if (value === undefined || value === null) return '';
  if (property.field_type === 'number' && typeof value === 'number') return formatNumber(value, property.settings.decimals ?? 0, { grouping: false });
  if (property.field_type === 'rich_text') return plainDocText(value as RichText);
  return String(value);
}
