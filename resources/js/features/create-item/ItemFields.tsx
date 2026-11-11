/*
 * The fields of the new item, as in the item's panel: status, priority, assignee, labels, start, due and, below an
 * epic's level, the parent. The status offers the workflow's start state and the states it may move to from there
 * (the server creates the item in the start state and moves it). A refusal of the server stands under its field.
 */

import { CircleAlert } from 'lucide-react';
import { useId, useState, type ReactNode } from 'react';
import { personOption } from '@/components/fields/AssigneePicker';
import { DatePopover, DayValue, dayText } from '@/components/fields/DateField';
import { formatDay } from '@/components/fields/format';
import { useProjectPeople, useToday } from '@/components/fields/itemData';
import { labelOption } from '@/components/fields/LabelsPicker';
import { noParentText, NO_PARENT_OPTION, parentCandidates, parentOption, useProjectItems } from '@/components/fields/ParentPicker';
import { Picker, type PickerOption } from '@/components/fields/Picker';
import { PRIORITY_OPTIONS } from '@/components/fields/PriorityPicker';
import { stateOption } from '@/components/fields/StatePicker';
import { UnassignedAvatar } from '@/components/ui/Avatar';
import { Chip } from '@/components/ui/Chip';
import { canHaveParent } from '@/domain/hierarchy';
import { allowedTargets } from '@/domain/workflow';
import { useLabels } from '@/hooks/catalog';
import { useWorkItem } from '@/hooks/workItems';
import { useWorkItemTypes } from '@/hooks/workItemTypes';
import { intlLocale, t } from '@/lib/i18n';
import type { Priority, State, Workflow } from '@/types';
import type { Draft } from './draft';

/** Field errors of the form, by the paths of the API (`title`, `values.customer` …), the first message each. */
export type Errors = Record<string, string>;

/** The start state of the workflow, then the states an item may move to from it. */
export function startStates(workflow: Workflow | undefined): State[] {
  const initial = workflow?.states.find((state) => state.id === workflow.initial_state_id);
  return workflow && initial ? [initial, ...allowedTargets(workflow, initial.id)] : [];
}

type ItemFieldsProps = {
  draft: Draft;
  update: (patch: Partial<Draft>) => void;
  errors: Errors;
  clearError: (...paths: string[]) => void;
  workflow: Workflow | undefined;
};

/** A label and its value in the grid; the server's refusal of the field stands under the value. */
function FieldRow({ label, error, errorId, children }: { label: string; error?: string; errorId: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-muted">{label}</dt>
      <dd className="min-w-0">
        {children}
        <div aria-live="polite">
          {error && (
            <p id={errorId} className="mb-1 flex items-start gap-1.5 text-sm font-medium text-pretty text-danger">
              <CircleAlert className="mt-px size-3.5 shrink-0" aria-hidden="true" />
              {error}
            </p>
          )}
        </div>
      </dd>
    </>
  );
}

export function ItemFields({ draft, update, errors, clearError, workflow }: ItemFieldsProps) {
  const ids = useId();
  const errorId = (path: string) => `${ids}-${path}`;
  const describe = (path: string) => (errors[path] ? errorId(path) : undefined);
  const { people, isLoading, error, retry, retrying } = useProjectPeople(draft.projectId);
  // the items of the project only while the parent list is open (A153); a parent set before (Kind-Item) is its detail
  const [parentOpen, setParentOpen] = useState(false);
  const projectItems = useProjectItems(draft.projectId, parentOpen);
  const listed = projectItems.data?.items.some((entry) => entry.id === draft.parentId) ?? false;
  const presetParent = useWorkItem(draft.parentId, { enabled: !listed }).data?.item;
  const types = useWorkItemTypes().data?.items;
  const labels = useLabels();
  const { today } = useToday();

  const states = startStates(workflow);
  const state = states.find((entry) => entry.id === draft.stateId) ?? states[0];

  const assignee = people?.find((user) => user.id === draft.assigneeId);
  const collator = new Intl.Collator(intlLocale());
  const sortedLabels = [...(labels.data?.items ?? [])].sort((a, b) => collator.compare(a.name, b.name));
  const chosenLabels = sortedLabels.filter((label) => draft.labelIds.includes(label.id));
  const items = projectItems.data?.items ?? [];
  const parent = items.find((entry) => entry.id === draft.parentId) ?? (presetParent?.id === draft.parentId ? presetParent : undefined);
  const typeOf = (typeId: string) => types?.find((type) => type.id === typeId);
  // two levels: the epics of the project are the parents, and an epic has none (the field hides)
  const takesParent = canHaveParent(typeOf(draft.typeId));
  const candidates = parentCandidates({ id: null, project_id: draft.projectId }, items, typeOf);
  const parentOptions: PickerOption[] = [...(draft.parentId ? [NO_PARENT_OPTION()] : []), ...candidates.map((candidate) => parentOption(candidate, typeOf(candidate.type_id)))];
  const priority = PRIORITY_OPTIONS().find((option) => option.value === draft.priority)!;
  const nobody = t('items.fields.assignee.nobody');

  const date = (field: 'startDate' | 'dueDate') => {
    const path = field === 'startDate' ? 'start_date' : 'due_date';
    const value = draft[field];
    const shown = { value, today, overdue: false, empty: t(field === 'startDate' ? 'items.fields.date.no_start' : 'items.fields.date.no_due') };
    return (
      <FieldRow label={t(field === 'startDate' ? 'items.detail.fields.start' : 'items.detail.fields.due')} error={errors[path]} errorId={errorId(path)}>
        <DatePopover
          label={t(field === 'startDate' ? 'items.fields.date.start' : 'items.fields.date.due')}
          value={value}
          invalid={Boolean(errors[path])}
          describedBy={describe(path)}
          display={<DayValue {...shown} />}
          displayText={dayText(shown)}
          onChoose={(next) => {
            const other = field === 'startDate' ? draft.dueDate : draft.startDate;
            if (next && other && (field === 'startDate' ? next > other : next < other)) {
              return t(field === 'startDate' ? 'items.commands.date.start_after_due' : 'items.commands.date.due_before_start', { day: formatDay(other) });
            }
            update({ [field]: next });
            // the server names a start after the due date at the due date
            clearError('start_date', 'due_date');
            return null;
          }}
        />
      </FieldRow>
    );
  };

  return (
    <dl className="grid grid-cols-[5.5rem_minmax(0,1fr)] items-center gap-x-2 gap-y-0.5 text-ui md:grid-cols-[5.5rem_minmax(0,1fr)_5.5rem_minmax(0,1fr)]">
      <FieldRow label={t('items.detail.fields.state')} error={errors.state_id} errorId={errorId('state_id')}>
        {state && (
          <Picker
            label={t('items.fields.state.label')}
            display={
              <>
                {stateOption(state).icon}
                <span className="truncate">{state.name}</span>
              </>
            }
            displayText={state.name}
            options={states.map(stateOption)}
            value={state.id}
            onValueChange={(next) => {
              update({ stateId: next === states[0]!.id ? null : next });
              clearError('state_id');
            }}
            placeholder={t('items.fields.state.placeholder')}
            emptyText={t('items.fields.state.no_match')}
            invalid={Boolean(errors.state_id)}
            describedBy={describe('state_id')}
          />
        )}
      </FieldRow>
      <FieldRow label={t('items.detail.fields.priority')} error={errors.priority} errorId={errorId('priority')}>
        <Picker
          label={t('items.fields.priority.label')}
          display={
            <>
              {priority.icon}
              <span className={draft.priority === 'none' ? 'truncate text-muted' : 'truncate'}>{priority.label}</span>
            </>
          }
          displayText={priority.label}
          options={PRIORITY_OPTIONS()}
          value={draft.priority}
          onValueChange={(next) => {
            update({ priority: next as Priority });
            clearError('priority');
          }}
          placeholder={t('items.fields.priority.placeholder')}
          invalid={Boolean(errors.priority)}
          describedBy={describe('priority')}
        />
      </FieldRow>
      <FieldRow label={t('items.detail.fields.assignee')} error={errors.assignee_id} errorId={errorId('assignee_id')}>
        <Picker
          label={t('items.fields.assignee.label')}
          display={
            assignee ? (
              <>
                {personOption(assignee).icon}
                <span className="truncate">{assignee.name}</span>
              </>
            ) : (
              <>
                <UnassignedAvatar />
                <span className="truncate text-muted">{nobody}</span>
              </>
            )
          }
          displayText={assignee?.name ?? nobody}
          options={[{ value: '', label: nobody, keywords: [t('items.fields.assignee.nobody_keywords')], icon: <UnassignedAvatar /> }, ...(people ?? []).map(personOption)]}
          value={draft.assigneeId ?? ''}
          onValueChange={(next) => {
            update({ assigneeId: next || null });
            clearError('assignee_id');
          }}
          placeholder={t('items.fields.assignee.placeholder')}
          emptyText={t('items.fields.assignee.empty')}
          load={{ isLoading, error, retry, retrying }}
          invalid={Boolean(errors.assignee_id)}
          describedBy={describe('assignee_id')}
        />
      </FieldRow>
      <FieldRow label={t('items.detail.fields.labels')} error={errors.label_ids} errorId={errorId('label_ids')}>
        <Picker
          multiple
          label={t('items.fields.labels.label')}
          display={
            chosenLabels.length > 0 ? (
              <span className="flex min-w-0 flex-wrap items-center gap-1">
                {chosenLabels.map((label) => (
                  <Chip key={label.id} dot={label.color} className="bg-transparent">
                    {label.name}
                  </Chip>
                ))}
              </span>
            ) : (
              <span className="truncate text-muted">{t('items.fields.labels.none')}</span>
            )
          }
          displayText={chosenLabels.map((label) => label.name).join(', ') || t('items.fields.labels.none_text')}
          options={sortedLabels.map(labelOption)}
          value={draft.labelIds}
          onValueChange={(next) => {
            update({ labelIds: next });
            clearError('label_ids');
          }}
          placeholder={t('items.fields.labels.placeholder')}
          emptyText={t('items.fields.labels.empty')}
          load={{ isLoading: labels.isPending, error: labels.error, retry: () => void labels.refetch(), retrying: labels.isFetching }}
          invalid={Boolean(errors.label_ids)}
          describedBy={describe('label_ids')}
        />
      </FieldRow>
      {date('startDate')}
      {date('dueDate')}
      {takesParent && (
        <FieldRow label={t('items.detail.fields.parent')} error={errors.parent_id} errorId={errorId('parent_id')}>
          <Picker
            label={t('items.fields.parent.label')}
            display={
              parent ? (
                <span className="flex min-w-0 items-center gap-1.5">
                  <span className="shrink-0 font-semibold text-muted tabular-nums">{parent.key}</span>
                  <span className="truncate">{parent.title}</span>
                </span>
              ) : (
                <span className="truncate text-muted">{t('items.fields.parent.none')}</span>
              )
            }
            displayText={parent ? `${parent.key} ${parent.title}` : t('items.fields.parent.none_text')}
            options={parentOptions}
            value={draft.parentId ?? ''}
            onValueChange={(next) => {
              update({ parentId: next || null });
              clearError('parent_id');
            }}
            placeholder={t('items.fields.parent.placeholder')}
            emptyText={noParentText(candidates)}
            onOpenChange={setParentOpen}
            load={{ isLoading: projectItems.isPending, error: projectItems.error, retry: () => void projectItems.refetch(), retrying: projectItems.isFetching }}
            invalid={Boolean(errors.parent_id)}
            describedBy={describe('parent_id')}
          />
        </FieldRow>
      )}
    </dl>
  );
}
