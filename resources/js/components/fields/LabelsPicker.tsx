/*
 * The labels of an item: several at once. Enter or a click switches a label on or off and the list stays open for the
 * next one; Escape closes it. Every switch is saved at once (optimistic, `useUpdateWorkItem`).
 */

import { Plus } from 'lucide-react';
import { Chip, ToneDot } from '@/components/ui/Chip';
import { useLabels } from '@/hooks/catalog';
import { useUpdateWorkItem } from '@/hooks/workItems';
import { intlLocale, t } from '@/lib/i18n';
import { SHORTCUTS } from '@/lib/shortcuts/catalog';
import type { Label, WorkItem } from '@/types';
import { useEditReason } from './itemData';
import { Picker, type PickerExtras, type PickerOption } from './Picker';

export const labelOption = (label: Label): PickerOption => ({ value: label.id, label: label.name, icon: <ToneDot tone={label.color} className="size-2" /> });

type LabelsPickerProps = PickerExtras & { item: WorkItem };

export function LabelsPicker({ item, look = 'field', shortcut, ...extras }: LabelsPickerProps) {
  const labels = useLabels();
  const update = useUpdateWorkItem();
  const reason = useEditReason(item);
  const collator = new Intl.Collator(intlLocale());
  const all = [...(labels.data?.items ?? [])].sort((a, b) => collator.compare(a.name, b.name));
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
        <span className="truncate text-muted">{inRow ? t('items.fields.labels.add') : t('items.fields.labels.none')}</span>
      </>
    );

  return (
    <Picker
      {...extras}
      look={inRow ? 'bare' : look}
      className={look === 'field' ? 'h-auto min-h-11 flex-wrap py-1 md:min-h-7' : undefined}
      shortcut={shortcut ?? (look === 'field' ? SHORTCUTS['item.labels'].keys : undefined)}
      label={t('items.fields.labels.label')}
      display={display}
      displayText={chosen.map((label) => label.name).join(', ') || t('items.fields.labels.none_text')}
      multiple
      options={all.map(labelOption)}
      value={item.label_ids}
      onValueChange={(ids) => update.mutate({ id: item.id, patch: { label_ids: ids } })}
      placeholder={t('items.fields.labels.placeholder')}
      emptyText={t('items.fields.labels.empty')}
      load={{ isLoading: labels.isPending, error: labels.error, retry: () => void labels.refetch(), retrying: labels.isFetching }}
      disabledReason={reason}
      pending={update.isPending}
    />
  );
}
