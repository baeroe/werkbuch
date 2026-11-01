/*
 * Yes or no ("Blockiert ja", "Archiviert nein"): a small menu in the chip.
 */

import { ChevronDown } from 'lucide-react';
import { cx } from '@/components/ui/cx';
import { Menu, MenuContent, MenuRadioGroup, MenuRadioItem, MenuTrigger } from '@/components/ui/Menu';
import { t } from '@/lib/i18n';
import { chipPart, type ValueEditorProps } from './shared';

export function FlagValue({ condition, label, onChange }: ValueEditorProps) {
  const on = condition.value !== false;
  const word = on ? t('items.filter.value.yes') : t('items.filter.value.no');
  return (
    <Menu>
      <MenuTrigger render={<button type="button" aria-label={t('items.fields.picker.name', { label, value: word })} className={cx(chipPart, 'text-ink')} />}>
        {word}
        <ChevronDown className="size-3 text-muted" aria-hidden="true" />
      </MenuTrigger>
      <MenuContent className="min-w-32">
        <MenuRadioGroup value={on ? 'yes' : 'no'} onValueChange={(next) => onChange({ field: condition.field, op: 'is', value: next === 'yes' })}>
          <MenuRadioItem value="yes" closeOnClick>{t('items.filter.value.yes')}</MenuRadioItem>
          <MenuRadioItem value="no" closeOnClick>{t('items.filter.value.no')}</MenuRadioItem>
        </MenuRadioGroup>
      </MenuContent>
    </Menu>
  );
}
