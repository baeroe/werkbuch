/*
 * The cells of the core fields that are more than their picker: the labels (a dash instead of "+ Label" for someone
 * who may not add one), the start and due date (the calendar of the date fields with a dash for no day: the field's own
 * "Kein Due-Date" is too long for a column) and the project (only shown). Status, assignee and priority are their
 * pickers as they are (`Cell`).
 */

import { useEditReason, useItemWorkflow, useToday } from '@/components/fields/itemData';
import { DatePopover, DayValue, dayText, useOverdue } from '@/components/fields/DateField';
import { formatDay } from '@/components/fields/format';
import { LabelsPicker } from '@/components/fields/LabelsPicker';
import { ProjectBadge } from '@/components/ui/ProjectBadge';
import { useUpdateWorkItem } from '@/hooks/workItems';
import { t } from '@/lib/i18n';
import type { ListedItem } from '@/types';

/** What the table hands a cell that edits: whether its editor is open, and the way to say it closed or opens. */
export type EditProps = { editing: boolean; onEditingChange: (editing: boolean) => void };

export function LabelsCell({ item, editing, onEditingChange }: { item: ListedItem } & EditProps) {
  const reason = useEditReason(item);
  if (reason && item.label_ids.length === 0) return <span className="px-1 text-muted">—</span>;
  return <LabelsPicker item={item} look="bare" tabIndex={-1} open={editing} onOpenChange={onEditingChange} />;
}

const DATE_LABELS = { start_date: 'items.fields.date.start', due_date: 'items.fields.date.due' } as const;

/** Start and due date, with the rule of the date fields: the start must not lie after the due date. */
export function CoreDateCell({ item, field, editing, onEditingChange }: { item: ListedItem; field: 'start_date' | 'due_date' } & EditProps) {
  const { today } = useToday();
  const reason = useEditReason(item);
  const update = useUpdateWorkItem();
  const overdue = useOverdue(item) && field === 'due_date';
  const value = item[field];

  function choose(next: string | null): string | null {
    if (next === value) return null;
    if (next && field === 'start_date' && item.due_date && next > item.due_date) return t('items.fields.date.start_after_due', { day: formatDay(item.due_date) });
    if (next && field === 'due_date' && item.start_date && next < item.start_date) return t('items.fields.date.due_before_start', { day: formatDay(item.start_date) });
    update.mutate({ id: item.id, patch: { [field]: next } });
    return null;
  }

  return (
    <DatePopover
      look="bare"
      className="w-full px-1"
      label={t(DATE_LABELS[field])}
      value={value}
      onChoose={choose}
      display={value ? <DayValue value={value} today={today} overdue={overdue} short empty="" /> : <span className="text-muted">—</span>}
      displayText={value ? dayText({ value, today, overdue, short: true, empty: '' }) : t('items.fields.date.unset')}
      disabledReason={reason}
      pending={update.isPending}
      tabIndex={-1}
      open={editing}
      onOpenChange={onEditingChange}
    />
  );
}

export function ProjectCell({ item }: { item: ListedItem }) {
  const { project } = useItemWorkflow(item);
  if (!project) return null;
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5 px-1">
      <ProjectBadge project={project} className="size-4" />
      <span translate="no" className="truncate font-semibold tabular-nums">
        {project.identifier}
      </span>
    </span>
  );
}
