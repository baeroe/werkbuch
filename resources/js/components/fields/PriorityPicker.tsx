/*
 * The priority of an item (spec 4.8): Urgent, High, Medium, Low or None, as pen strokes (Urgent: the red square). The
 * change is optimistic (`useUpdateWorkItem`).
 */

import { PRIORITIES, PriorityIcon, priorityName } from '@/components/ui/PriorityIcon';
import { useUpdateWorkItem } from '@/hooks/workItems';
import { t } from '@/lib/i18n';
import { SHORTCUTS } from '@/lib/shortcuts/catalog';
import type { ListedItem, Priority } from '@/types';
import { useEditReason } from './itemData';
import { Picker, type PickerExtras, type PickerOption } from './Picker';

/** The priorities from Urgent to None, as options; a function, so the names follow the language of the page. */
export const PRIORITY_OPTIONS = (): PickerOption[] =>
  PRIORITIES.map((priority) => ({ value: priority, label: priorityName(priority), icon: <PriorityIcon priority={priority} /> }));

type PriorityPickerProps = PickerExtras & { item: ListedItem };

export function PriorityPicker({ item, look = 'field', shortcut, ...extras }: PriorityPickerProps) {
  const update = useUpdateWorkItem();
  const reason = useEditReason(item);
  return (
    <Picker
      {...extras}
      look={look}
      shortcut={shortcut ?? (look === 'field' ? SHORTCUTS['item.priority'].keys : undefined)}
      label={t('items.fields.priority.label')}
      display={
        <>
          <PriorityIcon priority={item.priority} />
          <span className={item.priority === 'none' ? 'text-muted' : undefined}>{priorityName(item.priority)}</span>
        </>
      }
      displayText={priorityName(item.priority)}
      options={PRIORITY_OPTIONS()}
      value={item.priority}
      onValueChange={(value) => update.mutate({ id: item.id, patch: { priority: value as Priority } })}
      placeholder={t('items.fields.priority.placeholder')}
      disabledReason={reason}
      pending={update.isPending}
    />
  );
}
