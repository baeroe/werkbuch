/*
 * The properties of the new item's type, in the type's order, each through the one editor for values in forms
 * (`PropertyValueInput`); required ones are marked. A property nobody touched shows its default value, which is what
 * the server stores when the request names it not. A field that shows a text it cannot read tells the form
 * (`onUnreadable`), which then does not create the item.
 */

import { t } from '@/lib/i18n';
import type { Property, PropertyValue, WorkItemType } from '@/types';
import { PropertyValueInput } from '@/components/fields/property/PropertyValueInput';

export interface PropertyEntry {
  property: Property;
  required: boolean;
}

/** What a property shows: its value, else its default; a required yes/no without either is off (A89). */
export function shownValue(property: Property, values: Record<string, PropertyValue>, required: boolean): PropertyValue | undefined {
  if (property.key in values) return values[property.key];
  return property.default_value ?? (required && property.field_type === 'boolean' ? false : undefined);
}

type PropertyInputsProps = {
  formId: string;
  type: WorkItemType;
  fields: PropertyEntry[];
  values: Record<string, PropertyValue>;
  projectId: string;
  /** The id of a property's control, so the form can put the focus there. */
  fieldId: (key: string) => string;
  /** The error a property shows: its unreadable text once the form tried to create, or the server's refusal. */
  errorOf: (key: string) => string | null;
  onChange: (key: string, value: PropertyValue) => void;
  onUnreadable: (key: string, message: string | null) => void;
};

export function PropertyInputs({ formId, type, fields, values, projectId, fieldId, errorOf, onChange, onUnreadable }: PropertyInputsProps) {
  if (fields.length === 0) return null;
  const heading = `${formId}-properties`;
  return (
    <section aria-labelledby={heading} className="border-t border-edge pt-4">
      <h3 id={heading} className="font-display text-md font-bold tracking-title text-ink">
        {t('items.create.properties', { type: type.name })}
      </h3>
      <div className="mt-3 grid gap-4 md:grid-cols-2">
        {fields.map(({ property, required }) => (
          <div key={property.id} className={property.field_type === 'rich_text' ? 'min-w-0 md:col-span-2' : 'min-w-0'}>
            <PropertyValueInput
              id={fieldId(property.key)}
              property={property}
              value={shownValue(property, values, required)}
              onChange={(value) => onChange(property.key, value)}
              onUnreadable={(message) => onUnreadable(property.key, message)}
              projectId={projectId}
              required={required}
              error={errorOf(property.key)}
            />
          </div>
        ))}
      </div>
    </section>
  );
}
