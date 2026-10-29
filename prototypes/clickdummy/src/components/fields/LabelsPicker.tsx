/*
 * The labels of an item: several at once. Enter or a click switches a label on or off and the list stays open for the
 * next one; Escape closes it. Every switch is saved at once (optimistic).
 */

import { Plus } from 'lucide-react';
import { Chip, ToneDot } from '@/components/ui/Chip';
import { useLabels } from '@/hooks/catalog';
import { useUpdateWorkItem } from '@/hooks/workItems';
import type { Label, WorkItem } from '@/types';
import { useEditReason } from './itemData';
import { Picker, type PickerExtras, type PickerOption } from './Picker';

const COLLATOR = new Intl.Collator('de-DE');

export const labelOption = (label: Label): PickerOption => ({ value: label.id, label: label.name, icon: <ToneDot tone={label.color} className="size-2" /> });

type LabelsPickerProps = PickerExtras & { item: WorkItem };

export function LabelsPicker({ item, look = 'field', shortcut, ...extras }: LabelsPickerProps) {
  const labels = useLabels();
  const update = useUpdateWorkItem();
  const reason = useEditReason(item);
  const all = [...(labels.data?.items ?? [])].sort((a, b) => COLLATOR.compare(a.name, b.name));
  const chosen = item.label_ids.flatMap((id) => all.find((label) => label.id === id) ?? []);
  const inRow = look !== 'field' && look !== 'form';

  const display =
    chosen.length > 0 ? (
      <span className="flex min-w-0 flex-wrap items-center gap-1">
        {chosen.map((label) => (
          <Chip key={label.id} dot={label.color} className={inRow ? undefined : 'bg-transparent'}>
            {label.name}
          </Chip>
        ))}
      </span>
    ) : (
      <>
        <Plus className="size-4 shrink-0 text-muted" aria-hidden="true" />
        <span className="truncate text-muted">{inRow ? 'Label' : 'Keine Labels'}</span>
      </>
    );

  return (
    <Picker
      {...extras}
      look={inRow ? 'bare' : look}
      className={look === 'field' ? 'h-auto min-h-11 flex-wrap py-1 md:min-h-7' : undefined}
      shortcut={shortcut ?? (look === 'field' ? 'l' : undefined)}
      label="Labels"
      display={display}
      displayText={chosen.map((label) => label.name).join(', ') || 'keine'}
      multiple
      options={all.map(labelOption)}
      value={item.label_ids}
      onValueChange={(ids) => update.mutate({ id: item.id, patch: { label_ids: ids } })}
      placeholder="Label suchen …"
      emptyText="Kein Label heißt so. Labels legen Org-Admins in den Einstellungen an."
      load={{ isLoading: labels.isPending, error: labels.error, retry: () => void labels.refetch(), retrying: labels.isFetching }}
      disabledReason={reason}
      pending={update.isPending}
    />
  );
}
