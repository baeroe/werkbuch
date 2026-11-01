/*
 * A number in the chip ("Aufwand größer als 5"), or two for "zwischen". Typed as in the fields of an item
 * (`parseNumber`): comma or point as the decimal sign, "1.234,5" grouped; "1.500" reads either way and is refused with
 * both readings (A146). The first value of "zwischen" stays while the second is still missing (13c).
 */

import { formatNumber } from '@/components/fields/format';
import { ambiguousNumber, parseNumber } from '@/components/fields/property/parse';
import { t } from '@/lib/i18n';
import { operatorLabelKey } from '../fieldOps';
import { InlineInput, type InlineParse } from './InlineInput';
import type { ValueEditorProps } from './shared';

/** The places a filter value keeps: the server compares with four (P8). */
const DECIMALS = 4;

export const numberParse: InlineParse = (text) => {
  const ambiguous = ambiguousNumber(text);
  if (ambiguous) {
    const whole = formatNumber(ambiguous.whole, 0, { grouping: false });
    const decimal = formatNumber(ambiguous.decimal, 3, { grouping: false });
    return { error: t('items.fields.property.number_ambiguous', { whole, decimal }) };
  }
  const value = parseNumber(text, DECIMALS);
  return value === null ? { error: t('items.fields.property.number', { example: formatNumber(3.5, 1) }) } : { value };
};

/** A number as the chip shows it: without grouping, up to four places. */
export const numberText = (value: unknown): string => (typeof value === 'number' ? formatNumber(value, DECIMALS, { grouping: false }) : '');

export function NumberValue({ condition, label, onChange, open }: ValueEditorProps) {
  if (condition.op === 'between') {
    const [from, to] = Array.isArray(condition.value) ? condition.value : [null, null];
    return (
      <>
        <InlineInput
          numeric
          name="filter-number-from"
          label={t('items.filter.value.from', { field: label })}
          value={numberText(from)}
          parse={numberParse}
          onCommit={(next) => onChange({ ...condition, value: [next, to ?? null] })}
          autoFocus={open}
        />
        <span className="text-sm text-muted">{t('items.filter.value.and')}</span>
        <InlineInput
          numeric
          name="filter-number-to"
          label={t('items.filter.value.to', { field: label })}
          value={numberText(to)}
          parse={numberParse}
          onCommit={(next) => onChange({ ...condition, value: [from ?? null, next] })}
          autoFocus={false}
        />
      </>
    );
  }
  return (
    <InlineInput
      numeric
      name="filter-number"
      label={`${label} ${t(operatorLabelKey(condition.op))}`}
      value={numberText(condition.value)}
      parse={numberParse}
      onCommit={(next) => onChange({ ...condition, value: next })}
      autoFocus={open}
    />
  );
}
