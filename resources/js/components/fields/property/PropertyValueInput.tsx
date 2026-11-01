/*
 * The value of a property in a form, one editor for all eight field types (`inputs.tsx`); controlled. The create
 * dialog, the type change and the default value of a property use it, `PropertyField` binds it to an item.
 * It reports only values it can read: a typed text that is no number or address shows its error and stays out
 * (`onUnreadable` tells a form not to send meanwhile). A required value cannot be emptied once it is set.
 */

import { useId, useState } from 'react';
import { cx } from '@/components/ui/cx';
import { describedBy, Field } from '@/components/ui/Field';
import { t } from '@/lib/i18n';
import { isPlainDoc } from '@/lib/richtext';
import type { Property, PropertyValue, RichText } from '@/types';
import { formatPropertyValue } from '../format';
import { useUserMap } from '../itemData';
import { ReadOnlyTrigger } from '../Picker';
import { EDITORS, LockedRichText } from './inputs';
import { isEmptyValue } from './parse';

/** A rich text the text area cannot hold without losing its form (R17). */
const isLockedRichText = (property: Property, value: PropertyValue | undefined) =>
  property.field_type === 'rich_text' && value !== undefined && value !== null && !isPlainDoc(value as RichText);

/** The value in words, for someone who may not change it; the reason as tooltip and description. */
function ReadOnlyValue({ property, value, id, reason }: { property: Property; value: PropertyValue | undefined; id: string; reason: string }) {
  const users = useUserMap();
  const nameOf = (userId: string) => users.get(userId)?.name ?? t('items.fields.property.unknown_person');
  // yes/no reads "Nein" without a value too (A89)
  const text = formatPropertyValue(property, property.field_type === 'boolean' ? value === true : value, nameOf);
  return (
    <ReadOnlyTrigger look="form" id={id} name={t('items.fields.picker.name', { label: property.label, value: text || t('items.fields.property.no_value_text') })} reason={reason}>
      <span className={cx('truncate', !text && 'text-muted')}>{text || t('items.fields.property.no_value')}</span>
    </ReadOnlyTrigger>
  );
}

export type PropertyValueInputProps = {
  property: Property;
  value: PropertyValue | undefined;
  /** Every valid change. Typed fields report while one types, the others when a value is chosen. */
  onChange: (value: PropertyValue) => void;
  /** A value to keep: typed fields on Enter or when the focus leaves, the others right after `onChange`. */
  onCommit?: (value: PropertyValue) => void;
  /** The typed text cannot be read (its error) or can again (null); a form does not send meanwhile. */
  onUnreadable?: (error: string | null) => void;
  /** The project: a member field offers its people. */
  projectId: string;
  required?: boolean;
  /** An error from outside, e.g. the server's refusal; it wins over the field's own. */
  error?: string | null;
  /** Shown under the field instead of the property's help. */
  hint?: string | null;
  /** In a grid that shows the label itself (detail panel): the label only names the control. */
  hideLabel?: boolean;
  /** Not allowed: the value is read-only and says why. */
  disabledReason?: string | null;
  pending?: boolean;
  id?: string;
};

export function PropertyValueInput({
  property,
  value,
  onChange,
  onCommit,
  onUnreadable,
  projectId,
  required = false,
  error: outerError,
  hint: givenHint,
  hideLabel = false,
  disabledReason,
  pending = false,
  id: givenId,
}: PropertyValueInputProps) {
  const autoId = useId();
  const id = givenId ?? autoId;
  const [ownError, setOwnError] = useState<string | null>(null);
  const error = outerError ?? ownError;
  const locked = isLockedRichText(property, value);
  const hint = locked ? t('items.fields.property.edit_in_editor') : (givenHint ?? (hideLabel ? null : property.help || null));
  const label = (
    <>
      {property.label}
      {required && <span className="ml-1.5 font-normal text-muted">{t('items.fields.property.required')}</span>}
    </>
  );

  function accept(next: PropertyValue): boolean {
    if (required && isEmptyValue(next) && !isEmptyValue(value)) {
      setOwnError(t('items.fields.property.required_kept', { label: property.label }));
      return false;
    }
    setOwnError(null);
    onChange(next);
    onCommit?.(next);
    return true;
  }

  let control;
  if (disabledReason) {
    control = <ReadOnlyValue property={property} value={value} id={id} reason={disabledReason} />;
  } else {
    const Editor = locked ? LockedRichText : EDITORS[property.field_type];
    control = (
      <Editor
        property={property}
        value={value}
        id={id}
        label={property.label}
        describedById={describedBy(id, { hint, error })}
        invalid={Boolean(error)}
        required={required}
        pending={pending}
        projectId={projectId}
        onType={onChange}
        onAccept={accept}
        setError={setOwnError}
        onUnreadable={(message) => onUnreadable?.(message)}
      />
    );
  }

  // the field is always there (with its live region), so an error that appears is announced and nothing remounts
  return (
    <Field id={id} label={hideLabel ? undefined : label} hint={hint} error={error}>
      {control}
    </Field>
  );
}
