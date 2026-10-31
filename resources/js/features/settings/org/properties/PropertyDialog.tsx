/*
 * Creating and changing a property (spec 4.7): label, key, field type, help text, the settings of the field type, the
 * options of a dropdown and the default value. The key follows the label until somebody types one. Key and field type
 * are fixed once the property exists; a dropdown or a choice of people may only go from single to multiple choice. The
 * dialog sends the whole property every time (P24): key, field type, the settings of its field type and every option
 * with its archive stamp. A default that names an option which is archived or gone is left out, as no form could offer
 * it.
 */

import { Lock } from 'lucide-react';
import { useId, useRef, useState, type RefObject } from 'react';
import { cx } from '@/components/ui/cx';
import { FormDialog } from '@/components/ui/FormDialog';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { labelClass } from '@/components/ui/styles';
import { Switch } from '@/components/ui/Switch';
import { toast } from '@/components/ui/toast';
import { useSaveProperty } from '@/hooks/properties';
import { useSettle } from '@/hooks/mutation';
import { t, tn } from '@/lib/i18n';
import type { FieldType, Property, PropertyValue } from '@/types';
import { FIELD_TYPE_HINTS, FIELD_TYPE_LABELS, FIELD_TYPES } from '../../catalog/choices';
import { fieldMessage, noticeOf } from '../../frame/form';
import { FieldGroup, readOnlyField } from '../../frame/parts';
import { DefaultValueField } from './DefaultValueField';
import { keyFrom } from './keyFrom';
import { OptionRows, type DraftOption } from './OptionRows';

const DECIMALS = [0, 1, 2, 3, 4];

const decimalsLabel = (count: number) => (count === 0 ? t('settings.properties.dialog.decimals_none') : tn('settings.properties.dialog.decimals_count', count));

/** Whether the field type takes several values (a dropdown, a choice of people). */
const hasMultiple = (type: FieldType) => type === 'dropdown' || type === 'member';

/** Whether a field of this type can start with a value. */
const hasDefault = (type: FieldType) => type !== 'member' && type !== 'rich_text';

type PropertyDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The property to change; null creates one. */
  property: Property | null;
  finalFocus: RefObject<HTMLElement | null>;
};

export function PropertyDialog({ open, onOpenChange, property, finalFocus }: PropertyDialogProps) {
  const settle = useSettle();
  const save = useSaveProperty();
  const [label, setLabel] = useState(property?.label ?? '');
  const [key, setKey] = useState(property?.key ?? '');
  // the key follows the label until somebody writes one themselves
  const [keyTouched, setKeyTouched] = useState(property !== null);
  const [fieldType, setFieldType] = useState<FieldType>(property?.field_type ?? 'text');
  const [help, setHelp] = useState(property?.help ?? '');
  const [decimals, setDecimals] = useState(property?.settings.decimals ?? 0);
  const [multiple, setMultiple] = useState(property?.settings.multiple ?? false);
  const [options, setOptions] = useState<DraftOption[]>(() =>
    [...(property?.options ?? [])]
      .sort((a, b) => a.position - b.position)
      .map((option) => ({ id: option.id, label: option.label, color: option.color, archivedAt: option.archived_at, saved: true })),
  );
  const [defaultValue, setDefaultValue] = useState<PropertyValue>(property?.default_value ?? null);
  const [attempted, setAttempted] = useState(false);

  const active = options.filter((option) => option.archivedAt === null);
  const labelError = attempted && label.trim() === '' ? t('settings.properties.dialog.label_required') : fieldMessage(save.error, 'label');
  const keyError = attempted && key.trim() === '' ? t('settings.properties.dialog.key_required') : fieldMessage(save.error, 'key');
  const optionsError = attempted && fieldType === 'dropdown' && active.length === 0 ? t('settings.properties.dialog.options_required') : fieldMessage(save.error, 'options');
  // the options as they were sent: a refusal at `options.<n>.label` belongs to the option that was n-th then, and stays with
  // it when the list is reordered (or goes with it when it is removed)
  const sentOptions = useRef<string[]>([]);
  const optionPaths = sentOptions.current.map((_, index) => `options.${index}.label`);
  const optionError = (id: string) => {
    const index = sentOptions.current.indexOf(id);
    return index < 0 ? undefined : fieldMessage(save.error, `options.${index}.label`);
  };
  const multipleHint = useId();
  const multipleLocked = property?.settings.multiple === true;
  const settings = fieldType === 'number' ? { decimals } : hasMultiple(fieldType) ? { multiple } : {};

  function chooseType(next: FieldType) {
    setFieldType(next);
    setDefaultValue(null);
  }

  /** Single to multiple keeps the chosen option, multiple to single (only before saving) the first one. */
  function chooseMultiple(next: boolean) {
    setMultiple(next);
    const ids = Array.isArray(defaultValue) ? defaultValue : typeof defaultValue === 'string' ? [defaultValue] : [];
    setDefaultValue(ids.length === 0 ? null : next ? ids : ids[0]!);
  }

  function submit() {
    setAttempted(true);
    const missing = label.trim() === '' ? 'property-label' : key.trim() === '' ? 'property-key' : fieldType === 'dropdown' && active.length === 0 ? 'property-add-option' : null;
    if (missing) {
      document.getElementById(missing)?.focus();
      return;
    }
    // a default that points at an option which is no longer offered would be refused by every form
    const offered = new Set(active.map((option) => option.id));
    const stillOffered = fieldType !== 'dropdown' || [defaultValue].flat().every((value) => typeof value === 'string' && offered.has(value));
    sentOptions.current = fieldType === 'dropdown' ? options.map((option) => option.id) : [];
    settle(
      save.mutateAsync({
        id: property?.id,
        key,
        label,
        field_type: fieldType,
        help: help.trim(),
        default_value: hasDefault(fieldType) && stillOffered ? defaultValue : null,
        settings,
        options:
          fieldType === 'dropdown'
            ? options.map((option, position) => ({ id: option.id, label: option.label, color: option.color, position, archived_at: option.archivedAt }))
            : [],
      }),
      {
        onSuccess: (saved) => {
          onOpenChange(false);
          toast({ title: property ? t('settings.properties.dialog.saved', { label: saved.label }) : t('settings.properties.dialog.created', { label: saved.label }), tone: 'success' });
        },
      },
    );
  }

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      size="lg"
      title={property ? t('settings.properties.edit', { label: property.label }) : t('settings.properties.create')}
      description={t('settings.properties.dialog.description')}
      submitLabel={property ? t('settings.frame.save') : t('settings.catalog.submit_create')}
      pending={save.isPending}
      notice={noticeOf(save.error, ['label', 'key', 'help', 'settings.decimals', 'options', ...optionPaths, 'default_value'])}
      finalFocus={finalFocus}
      onSubmit={submit}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Input
          id="property-label"
          name="label"
          label={t('settings.properties.dialog.label')}
          autoComplete="off"
          value={label}
          error={labelError}
          onChange={(event) => {
            setLabel(event.target.value);
            if (!keyTouched) setKey(keyFrom(event.target.value));
          }}
        />
        <Input
          id="property-key"
          name="key"
          label={t('settings.properties.dialog.key')}
          hint={property ? t('settings.properties.dialog.key_fixed') : t('settings.properties.dialog.key_hint')}
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          translate="no"
          readOnly={property !== null}
          value={key}
          error={keyError}
          className={property ? readOnlyField : undefined}
          onChange={(event) => {
            setKey(event.target.value);
            setKeyTouched(true);
          }}
        />
        {property ? (
          <div className="flex min-w-0 flex-col">
            <p className={cx(labelClass, 'mb-1.5')}>{t('settings.properties.dialog.field_type')}</p>
            <p className="flex h-9 items-center gap-2 text-ui text-ink">
              <Lock className="size-3.5 text-muted" aria-hidden="true" />
              {t(FIELD_TYPE_LABELS[property.field_type])}
            </p>
            <p className="mt-1.5 text-sm text-pretty text-muted">
              {hasMultiple(property.field_type) ? t('settings.properties.dialog.field_type_fixed_multiple') : t('settings.properties.dialog.field_type_fixed')}
            </p>
          </div>
        ) : (
          <Select
            label={t('settings.properties.dialog.field_type')}
            hint={t(FIELD_TYPE_HINTS[fieldType])}
            value={fieldType}
            onValueChange={(next) => next && chooseType(next as FieldType)}
            options={FIELD_TYPES.map((type) => ({ value: type, label: t(FIELD_TYPE_LABELS[type]) }))}
          />
        )}
        <Input
          label={t('settings.properties.dialog.help')}
          name="help"
          hint={t('settings.properties.dialog.help_hint')}
          autoComplete="off"
          value={help}
          error={fieldMessage(save.error, 'help')}
          onChange={(event) => setHelp(event.target.value)}
        />
      </div>

      {fieldType === 'number' && (
        <Select
          label={t('settings.properties.dialog.decimals')}
          hint={t('settings.properties.dialog.decimals_hint')}
          error={fieldMessage(save.error, 'settings.decimals')}
          value={String(decimals)}
          onValueChange={(next) => next && setDecimals(Number(next))}
          options={DECIMALS.map((count) => ({ value: String(count), label: decimalsLabel(count) }))}
        />
      )}

      {hasMultiple(fieldType) && (
        <div className="flex flex-col gap-1">
          {/* once on, it stays on (spec 4.7): the switch of a stored multiple choice is locked */}
          <Switch
            label={t('settings.properties.dialog.multiple')}
            aria-describedby={multipleHint}
            checked={multiple}
            disabled={multipleLocked}
            onCheckedChange={chooseMultiple}
          />
          <p id={multipleHint} className="pl-12 text-sm text-pretty text-muted">
            {multipleLocked
              ? t('settings.properties.dialog.multiple_locked')
              : fieldType === 'member'
                ? t('settings.properties.dialog.multiple_hint_member')
                : t('settings.properties.dialog.multiple_hint')}
          </p>
        </div>
      )}

      {fieldType === 'dropdown' && (
        <FieldGroup legend={t('settings.properties.dialog.options')} hint={t('settings.properties.dialog.options_hint')} error={optionsError}>
          <OptionRows options={options} onChange={setOptions} labelError={optionError} />
        </FieldGroup>
      )}

      {hasDefault(fieldType) ? (
        <DefaultValueField
          key={fieldType}
          property={{
            field_type: fieldType,
            settings,
            options: options.map((option, position) => ({ id: option.id, label: option.label, color: option.color, position, archived_at: option.archivedAt })),
          }}
          value={defaultValue}
          onChange={setDefaultValue}
          error={fieldMessage(save.error, 'default_value')}
        />
      ) : (
        <p className="text-sm text-pretty text-muted">{t('settings.properties.dialog.no_default', { type: t(FIELD_TYPE_LABELS[fieldType]) })}</p>
      )}
    </FormDialog>
  );
}
