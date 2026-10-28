/*
 * The priority of an item (spec 4.8): Urgent, High, Medium, Low or None, as pen strokes (Urgent: the red square). The
 * change is optimistic.
 */

import { PRIORITY_LABELS, PriorityIcon } from '@/components/ui/PriorityIcon';
import { PRIORITY_ORDER } from '@/domain/filter';
import { useUpdateWorkItem } from '@/hooks/workItems';
import type { Priority, WorkItem } from '@/types';
import { useEditReason } from './itemData';
import { Picker, type PickerExtras, type PickerOption } from './Picker';

/** The priorities from Urgent to None, as options. */
export const PRIORITY_OPTIONS: PickerOption[] = PRIORITY_ORDER.map((priority) => ({
  value: priority,
  label: PRIORITY_LABELS[priority],
  icon: <PriorityIcon priority={priority} />,
}));

type PriorityPickerProps = PickerExtras & { item: WorkItem };

export function PriorityPicker({ item, look = 'field', shortcut, ...extras }: PriorityPickerProps) {
  const update = useUpdateWorkItem();
  const reason = useEditReason(item);
  return (
    <Picker
      {...extras}
      look={look}
      shortcut={shortcut ?? (look === 'field' ? 'p' : undefined)}
      label="Priorität"
      display={
        <>
          <PriorityIcon priority={item.priority} />
          <span className={item.priority === 'none' ? 'text-muted' : undefined}>{PRIORITY_LABELS[item.priority]}</span>
        </>
      }
      displayText={PRIORITY_LABELS[item.priority]}
      options={PRIORITY_OPTIONS}
      value={item.priority}
      onValueChange={(value) => update.mutate({ id: item.id, patch: { priority: value as Priority } })}
      placeholder="Priorität suchen …"
      disabledReason={reason}
      pending={update.isPending}
    />
  );
}
