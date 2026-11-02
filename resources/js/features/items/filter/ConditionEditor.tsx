/*
 * The value part of a chip, by the kind of its field (fieldOps.ts):
 * - a choice: the shared picker with search, several values at once; people offer "Ich" (`me`) first.
 * - a day or a timestamp: a popover with the quick choices, a distance from today and the calendar; "zwischen" has two.
 * - yes or no: a small menu. Text and numbers: a small field in the chip, kept on Enter or when the focus leaves.
 * Operators without a value ("ist leer", "ist überfällig") have no value part.
 */

import { t } from '@/lib/i18n';
import type { Condition, Project } from '@/types';
import { dateValueLabel, isChoice, valuesOf, VALUELESS, type FieldDef } from './fieldOps';
import { useValueOptions } from './useValueOptions';
import { DateValue } from './values/DateValue';
import { EnumValue } from './values/EnumValue';
import { FlagValue } from './values/FlagValue';
import { NumberValue, numberText } from './values/NumberValue';
import type { ValueEditorProps } from './values/shared';
import { TextValue } from './values/TextValue';

export function ConditionEditor(props: ValueEditorProps) {
  const { condition, def } = props;
  if (VALUELESS.has(condition.op)) return null;
  if (isChoice(def.kind)) return <EnumValue {...props} />;
  switch (def.kind) {
    case 'date':
    case 'stamp':
      return <DateValue {...props} />;
    case 'flag':
      return <FlagValue {...props} />;
    case 'number':
      return <NumberValue {...props} />;
    default:
      return <TextValue {...props} />;
  }
}

/** A field without options, for the conditions whose field is gone: their text needs no list. */
const NO_FIELD: FieldDef = { field: '', kind: 'text', nullable: false, acceptsMe: false };

/** The value of a condition in words, for the chip's name: "Todo, In Progress", "diese Woche", "3,5", "„Login“". */
export function useConditionText(condition: Condition, def: FieldDef | null, project?: Project): string {
  const { nameOf } = useValueOptions(def ?? NO_FIELD, project);
  if (!def || VALUELESS.has(condition.op)) return '';
  const pair = (read: (value: unknown) => string) =>
    Array.isArray(condition.value) ? t('items.filter.value.pair', { from: read(condition.value[0]), to: read(condition.value[1]) }) : read(condition.value);
  if (isChoice(def.kind)) {
    const values = valuesOf(condition);
    return values.length === 0 ? t('items.filter.value.none') : values.map(nameOf).join(', ');
  }
  switch (def.kind) {
    case 'date':
    case 'stamp':
      return condition.op === 'between' ? pair(dateValueLabel) : dateValueLabel(condition.value);
    case 'flag':
      return condition.value === false ? t('items.filter.value.no') : t('items.filter.value.yes');
    case 'number':
      return condition.op === 'between' ? pair((value) => numberText(value) || t('items.filter.value.none')) : numberText(condition.value) || t('items.filter.value.none');
    default:
      return typeof condition.value === 'string' && condition.value !== '' ? t('items.filter.value.quoted', { text: condition.value }) : t('items.filter.value.none');
  }
}
