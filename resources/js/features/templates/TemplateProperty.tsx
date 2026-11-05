/*
 * A property of the template's items, through the one editor for values in forms (`PropertyValueInput`), as the create
 * dialog has it. A template may be saved without a value of a required property (A349): the field says that a run
 * fails meanwhile. A value the template already carries stays valid even when it could not be chosen today (A356).
 * Whoever may not manage templates reads the value in words.
 */

import { isEmptyValue } from '@/components/fields/property/parse';
import { PropertyValueInput } from '@/components/fields/property/PropertyValueInput';
import { t } from '@/lib/i18n';
import type { Property, PropertyValue } from '@/types';

type TemplatePropertyProps = {
  property: Property;
  required: boolean;
  value: PropertyValue | undefined;
  projectId: string;
  /** The id of the control, so the editor can put the focus there. */
  id: string;
  /** Why the person may not change it, or null. */
  denied: string | null;
  /** A refusal of the server, or the text the field cannot read once saving was tried. */
  error: string | null;
  onChange: (value: PropertyValue) => void;
  onUnreadable: (message: string | null) => void;
};

export function TemplateProperty({ property, required, value, projectId, id, denied, error, onChange, onUnreadable }: TemplatePropertyProps) {
  const missing = required && isEmptyValue(value);
  return (
    <div className={property.field_type === 'rich_text' ? 'min-w-0 md:col-span-2' : 'min-w-0'}>
      <PropertyValueInput
        id={id}
        property={property}
        value={value}
        onChange={onChange}
        onUnreadable={onUnreadable}
        projectId={projectId}
        required={required}
        hint={missing ? t('templates.editor.required_hint') : undefined}
        error={error}
        disabledReason={denied}
      />
    </div>
  );
}
