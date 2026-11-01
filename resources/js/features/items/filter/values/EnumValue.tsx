/*
 * The values of a choice ("Status ist Todo, In Progress"): the shared picker with search, several values at once.
 * The chip shows the first name and "+N", so it fits a phone; a value the reader does not know reads "Verborgen".
 */

import type { ReactNode } from 'react';
import { Picker, type PickerOption } from '@/components/fields/Picker';
import { t } from '@/lib/i18n';
import { valuesOf, withValues } from '../fieldOps';
import { useValueOptions } from '../useValueOptions';
import type { ValueEditorProps } from './shared';

/** How chosen values read in the chip: the first name, then "+N". */
function chosenDisplay(options: PickerOption[], values: string[], nameOf: (value: string) => string): ReactNode {
  if (values.length === 0) return <span className="text-muted">{t('items.filter.value.choose')}</span>;
  const first = options.find((option) => option.value === values[0]);
  return (
    <span className="flex min-w-0 items-center gap-1.5">
      <span className="inline-flex min-w-0 items-center gap-1">
        {first?.icon && (
          <span className="inline-flex size-4 shrink-0 items-center justify-center" aria-hidden="true">
            {first.icon}
          </span>
        )}
        <span className="max-w-24 truncate sm:max-w-40">{nameOf(values[0]!)}</span>
      </span>
      {values.length > 1 && <span className="shrink-0 text-muted tabular-nums">+{values.length - 1}</span>}
    </span>
  );
}

export function EnumValue({ condition, def, label, onChange, open, onOpenChange, project }: ValueEditorProps) {
  const { options, loading, error, retry, nameOf } = useValueOptions(def, project);
  const values = valuesOf(condition).map(String);
  // a value the reader does not know stays a choice of its own, so it can be taken away (or stays when others change)
  const shown = loading ? options : [...options, ...values.filter((value) => !options.some((option) => option.value === value)).map((value) => ({ value, label: nameOf(value) }))];
  return (
    <Picker
      look="bare"
      className="px-1 md:min-h-6"
      label={label}
      display={chosenDisplay(shown, values, nameOf)}
      displayText={values.length === 0 ? t('items.filter.value.none') : values.map(nameOf).join(', ')}
      multiple
      options={shown}
      value={values}
      onValueChange={(next) => onChange(withValues(condition, next))}
      placeholder={t('items.filter.value.search', { field: label })}
      emptyText={t('items.filter.value.empty')}
      load={{ isLoading: loading, error, retry, retrying: false }}
      open={open}
      onOpenChange={onOpenChange}
    />
  );
}
