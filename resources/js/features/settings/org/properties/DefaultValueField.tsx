/*
 * The default value of a property (spec 4.7), one control per field type: text and URL as a line, a number as a line
 * that takes a comma or a point as the decimal sign (there are no thousands separators here), a single dropdown as a
 * choice with "No default", a multiple one as checkboxes, yes or no as a switch, a date as a date field (P15). What the
 * field reports is what the dialog sends: trimmed, a number as a number, the options in their order, `null` for empty.
 * A text that is no number goes to the server as it is, which refuses it at this field. People and rich text have no
 * default; the dialog says so instead of showing this field.
 */

import { useState } from 'react';
import { Checkbox } from '@/components/ui/Checkbox';
import { ToneDot } from '@/components/ui/Chip';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Switch } from '@/components/ui/Switch';
import { intlLocale, t } from '@/lib/i18n';
import type { Property, PropertyValue } from '@/types';
import { FieldGroup } from '../../frame/parts';

/** What the field needs of the property being edited: its field type, settings and options as they are in the form. */
export type DefaultFor = Pick<Property, 'field_type' | 'settings' | 'options'>;

type DefaultValueFieldProps = {
  property: DefaultFor;
  value: PropertyValue;
  onChange: (value: PropertyValue) => void;
  /** The server's refusal of the default. */
  error?: string;
};

const NONE = 'none';

/** "3,5" and "3.5" are 3.5, a blank is no default; anything else stays text for the server to refuse. */
function parseNumber(text: string): PropertyValue {
  const trimmed = text.trim();
  if (trimmed === '') return null;
  return /^-?\d+([.,]\d+)?$/.test(trimmed) ? Number(trimmed.replace(',', '.')) : trimmed;
}

/** The ids a value names: one for a single choice, several for a multiple one. */
const idsOf = (value: PropertyValue): string[] => (Array.isArray(value) ? value : typeof value === 'string' ? [value] : []);

/** Text, URL and number: typed, reported as the dialog sends it. */
function TypedDefault({ property, value, onChange, error }: DefaultValueFieldProps) {
  const number = property.field_type === 'number';
  const [text, setText] = useState(() =>
    typeof value === 'number' ? new Intl.NumberFormat(intlLocale(), { useGrouping: false, maximumFractionDigits: 20 }).format(value) : typeof value === 'string' ? value : '',
  );
  return (
    <Input
      id="property-default"
      name="default_value"
      label={t('settings.properties.dialog.default')}
      hint={t('settings.properties.dialog.default_hint')}
      error={error}
      autoComplete="off"
      type={property.field_type === 'url' ? 'url' : 'text'}
      inputMode={number ? 'decimal' : property.field_type === 'url' ? 'url' : undefined}
      className={number ? 'tabular-nums' : undefined}
      value={text}
      onChange={(event) => {
        setText(event.target.value);
        const trimmed = event.target.value.trim();
        onChange(number ? parseNumber(trimmed) : trimmed || null);
      }}
    />
  );
}

export function DefaultValueField({ property, value, onChange, error }: DefaultValueFieldProps) {
  const options = property.options.filter((option) => option.archived_at === null);
  const optionLabel = (label: string) => label.trim() || t('settings.properties.default.unnamed');

  switch (property.field_type) {
    case 'boolean':
      return (
        <FieldGroup legend={t('settings.properties.dialog.default')} hint={t('settings.properties.dialog.default_hint')} error={error}>
          <Switch
            label={value === true ? t('settings.properties.default.yes') : t('settings.properties.default.no')}
            aria-label={t('settings.properties.dialog.default')}
            aria-invalid={error ? true : undefined}
            checked={value === true}
            onCheckedChange={onChange}
          />
        </FieldGroup>
      );
    case 'date':
      return (
        <Input
          id="property-default"
          name="default_value"
          type="date"
          label={t('settings.properties.dialog.default')}
          hint={t('settings.properties.dialog.default_hint')}
          error={error}
          className="tabular-nums"
          value={typeof value === 'string' ? value : ''}
          onChange={(event) => onChange(event.target.value === '' ? null : event.target.value)}
        />
      );
    case 'dropdown': {
      const chosen = idsOf(value);
      if (property.settings.multiple) {
        return (
          <FieldGroup legend={t('settings.properties.dialog.default')} hint={t('settings.properties.dialog.default_hint')} error={error}>
            {options.length === 0 ? (
              <p className="text-sm text-muted">{t('settings.properties.default.no_options')}</p>
            ) : (
              <div className="flex flex-col">
                {options.map((option, index) => (
                  <Checkbox
                    key={option.id}
                    label={
                      <span className="flex min-w-0 items-center gap-2">
                        <ToneDot tone={option.color} className="size-2" />
                        <span className="min-w-0 truncate">{optionLabel(option.label)}</span>
                      </span>
                    }
                    aria-invalid={error && index === 0 ? true : undefined}
                    checked={chosen.includes(option.id)}
                    onCheckedChange={(checked) => {
                      const next = options.filter((candidate) => (candidate.id === option.id ? checked : chosen.includes(candidate.id))).map((candidate) => candidate.id);
                      onChange(next.length > 0 ? next : null);
                    }}
                  />
                ))}
              </div>
            )}
          </FieldGroup>
        );
      }
      return (
        <Select
          id="property-default"
          label={t('settings.properties.dialog.default')}
          hint={t('settings.properties.dialog.default_hint')}
          error={error}
          // a default whose option was archived meanwhile shows as none: the dialog leaves it out
          value={chosen.find((id) => options.some((option) => option.id === id)) ?? NONE}
          onValueChange={(next) => onChange(next === null || next === NONE ? null : next)}
          options={[
            { value: NONE, label: t('settings.properties.default.none') },
            ...options.map((option) => ({ value: option.id, label: optionLabel(option.label), icon: <ToneDot tone={option.color} className="size-2" /> })),
          ]}
        />
      );
    }
    default:
      // text, number and URL; a new field type starts a new line (the dialog keys this field by it)
      return <TypedDefault property={property} value={value} onChange={onChange} error={error} />;
  }
}
