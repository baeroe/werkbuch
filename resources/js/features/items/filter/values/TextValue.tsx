/*
 * The text of "Titel enthält", "Kunde ist", "Notiz enthält": a small field in the chip.
 */

import { t } from '@/lib/i18n';
import { operatorLabelKey } from '../fieldOps';
import { InlineInput } from './InlineInput';
import type { ValueEditorProps } from './shared';

export function TextValue({ condition, label, onChange, open }: ValueEditorProps) {
  return (
    <InlineInput
      name="filter-text"
      label={`${label} ${t(operatorLabelKey(condition.op))}`}
      value={typeof condition.value === 'string' ? condition.value : ''}
      parse={(text) => (text.trim() === '' ? { error: t('items.filter.value.text_required') } : { value: text.trim() })}
      onCommit={(value) => onChange({ ...condition, value })}
      autoFocus={open}
    />
  );
}
