/*
 * A property of an item (spec 4.7), saved on its own: a chosen value at once, a typed one on Enter or when the focus
 * leaves the field. The change is optimistic (`useUpdateWorkItem`); a refusal of the server shows its words at the
 * field as well as in the toast, and the focus stays where it was. A required value cannot be emptied; an item without a
 * value (the property became required later) stays valid and says the value is missing.
 */

import { useState } from 'react';
import { ApiError } from '@/api/client';
import { useSettle } from '@/hooks/mutation';
import { useUpdateWorkItem } from '@/hooks/workItems';
import { t } from '@/lib/i18n';
import type { ListedItem, Property, PropertyValue } from '@/types';
import { useEditReason } from '../itemData';
import { isEmptyValue, sameValue } from './parse';
import { PropertyValueInput } from './PropertyValueInput';

type PropertyFieldProps = {
  item: ListedItem;
  property: Property;
  /** Required for the item's type. */
  required: boolean;
  /** In a grid that shows the label itself (detail panel). */
  hideLabel?: boolean;
};

export function PropertyField({ item, property, required, hideLabel }: PropertyFieldProps) {
  const settle = useSettle();
  const reason = useEditReason(item);
  const update = useUpdateWorkItem();
  const [refusal, setRefusal] = useState<string | null>(null);
  const value = item.values[property.key];

  function save(next: PropertyValue) {
    if (sameValue(next, value)) return;
    setRefusal(null);
    settle(update.mutateAsync({ id: item.id, patch: { values: { [property.key]: next } } }), {
      // the toast names the cause too; the field shows the server's words where the change was made
      onError: (failure) => {
        const message = failure instanceof ApiError ? failure.errors?.[`values.${property.key}`]?.[0] : undefined;
        if (message) setRefusal(message);
      },
    });
  }

  return (
    <PropertyValueInput
      property={property}
      value={value}
      onChange={() => undefined}
      onCommit={save}
      projectId={item.project_id}
      required={required}
      error={refusal}
      // a yes/no field that is off reads "Nein", never "missing" (A89)
      hint={required && isEmptyValue(value) && property.field_type !== 'boolean' ? t('items.fields.property.required_missing') : undefined}
      hideLabel={hideLabel}
      disabledReason={reason}
      pending={update.isPending}
    />
  );
}
