/*
 * The sub-lists of the item commands in the palette: status, assignee, priority, labels, type, the two dates and the
 * parent. Each option changes the target with its own mutation (`apply`) and confirms it in a toast; a move into a
 * closed state asks for the resolution first, a type change that costs values or breaks the two levels opens the type
 * dialog (both through `ItemDialogsHost`).
 */

import { UserRoundCheck } from 'lucide-react';
import { createElement } from 'react';
import { UnassignedAvatar } from '@/components/ui/Avatar';
import { PRIORITIES, PriorityIcon, priorityName } from '@/components/ui/PriorityIcon';
import { toast } from '@/components/ui/toast';
import { canHaveParent, typeChangeRefusal } from '@/domain/hierarchy';
import { endOfMonth, weekdayOf } from '@/domain/tz';
import { allowedTargets, isClosedCategory } from '@/domain/workflow';
import type { CommandOption } from '@/lib/commands';
import { notifyError } from '@/lib/errors';
import { intlLocale, t } from '@/lib/i18n';
import type { State, User, WorkItem } from '@/types';
import { personOption } from '../AssigneePicker';
import { addDays, formatDay, formatWeekdayDay } from '../format';
import { askResolution, askTypeChange } from '../ItemDialogs';
import { labelOption } from '../LabelsPicker';
import { NO_PARENT_OPTION, noParentText, parentCandidates, parentOption } from '../ParentPicker';
import type { PickerOption } from '../Picker';
import { stateOption } from '../StatePicker';
import { typeChangeOf, typeOption } from '../TypePicker';
import { apply } from './actions';
import { stateOf, workflowOf, type ItemCommandContext } from './context';

/** The one target of Phase 4 (K17); the commands only offer their lists while there is one. */
const targetOf = (ctx: ItemCommandContext) => ctx.targets[0]!;

const option = (picker: PickerOption, run: () => void): CommandOption => ({
  id: picker.value || 'none',
  label: picker.label,
  icon: picker.icon,
  hint: picker.hint,
  keywords: picker.keywords,
  run,
});

/* ------------------------------------------------------------------------------- status */

export function stateOptions(ctx: ItemCommandContext): CommandOption[] {
  const item = targetOf(ctx);
  const what = (state: State) => t('items.commands.what.state', { state: state.name });
  const move = (state: State) => {
    if (isClosedCategory(state.category)) {
      const from = stateOf(ctx, item);
      askResolution({
        subject: item.key,
        target: state,
        from: from && { category: from.category, resolutionId: item.resolution_id },
        onConfirm: (resolutionId) => apply(ctx, what(state), (target) => ctx.transition.mutateAsync({ id: target.id, to_state_id: state.id, resolution_id: resolutionId })),
      });
      return;
    }
    apply(ctx, what(state), (target) => ctx.transition.mutateAsync({ id: target.id, to_state_id: state.id }));
  };
  const workflow = workflowOf(ctx, item);
  return workflow ? allowedTargets(workflow, item.state_id).map((state) => option(stateOption(state), () => move(state))) : [];
}

/** What the status list says when the workflow leads nowhere from here. */
export function stateEmptyText(ctx: ItemCommandContext): string {
  const item = targetOf(ctx);
  return t('items.fields.state.no_transition', { state: stateOf(ctx, item)?.name ?? '', workflow: workflowOf(ctx, item)?.name ?? '' });
}

/* ----------------------------------------------------------------------------- assignee */

export function assign(ctx: ItemCommandContext, user: User | null): void {
  const what = user ? t('items.commands.what.assigned', { name: user.name }) : t('items.commands.what.unassigned');
  apply(ctx, what, (item) => ctx.update.mutateAsync({ id: item.id, patch: { assignee_id: user?.id ?? null } }));
}

/** Whether the signed-in person can take the target: one of the people of its project. */
export const canTakeIt = (ctx: ItemCommandContext): boolean => ctx.people!.some((user) => user.id === ctx.me?.id);

export function assigneeOptions(ctx: ItemCommandContext): CommandOption[] {
  const people = ctx.people!;
  const me = canTakeIt(ctx) ? ctx.me! : undefined;
  return [
    ...(me ? [{ id: 'me', label: t('items.fields.assignee.me'), keywords: [me.name], icon: createElement(UserRoundCheck), run: () => assign(ctx, me) }] : []),
    {
      id: 'nobody',
      label: t('items.fields.assignee.nobody'),
      keywords: [t('items.fields.assignee.nobody_keywords')],
      icon: createElement(UnassignedAvatar),
      run: () => assign(ctx, null),
    },
    ...people.map((user) => option(personOption(user), () => assign(ctx, user))),
  ];
}

/* ------------------------------------------------------------------------- priority, labels */

export function priorityOptions(ctx: ItemCommandContext): CommandOption[] {
  return PRIORITIES.map((priority) => ({
    id: priority,
    label: priorityName(priority),
    icon: createElement(PriorityIcon, { priority }),
    run: () => apply(ctx, t('items.commands.what.priority', { priority: priorityName(priority) }), (item) => ctx.update.mutateAsync({ id: item.id, patch: { priority } })),
  }));
}

export function labelOptions(ctx: ItemCommandContext): CommandOption[] {
  const item = targetOf(ctx);
  const collator = new Intl.Collator(intlLocale());
  return [...ctx.labels]
    .sort((a, b) => collator.compare(a.name, b.name))
    .map((label) => {
      // a label the item has comes off, any other goes on
      const set = item.label_ids.includes(label.id);
      const what = t(set ? 'items.commands.what.label_removed' : 'items.commands.what.label_added', { label: label.name });
      return {
        ...option(labelOption(label), () =>
          apply(ctx, what, (target) =>
            ctx.update.mutateAsync({ id: target.id, patch: { label_ids: set ? target.label_ids.filter((id) => id !== label.id) : [...target.label_ids, label.id] } }),
          ),
        ),
        hint: set ? t('items.commands.label_set') : undefined,
      };
    });
}

/* ---------------------------------------------------------------------------------- type */

export function typeOptions(ctx: ItemCommandContext): CommandOption[] {
  const item = targetOf(ctx);
  const project = ctx.projects.find((entry) => entry.id === item.project_id);
  return ctx.types
    .filter((type) => type.archived_at === null && project?.enabled_type_ids.includes(type.id) && type.id !== item.type_id)
    .map((type) =>
      option(typeOption(type), () => {
        const { lost, missing } = typeChangeOf(item, type, ctx.properties, ctx.types);
        // the two levels: the dialog says why, from what the items of the project say (the command waits for them)
        const hasChildren = ctx.projectItems!.some((entry) => entry.parent_id === item.id);
        if (lost.length > 0 || missing.length > 0 || typeChangeRefusal(hasChildren, item.parent_id !== null, type)) {
          askTypeChange(item, type, hasChildren);
          return;
        }
        ctx.settle(ctx.changeType.mutateAsync({ id: item.id, type_id: type.id }), {
          onSuccess: () => toast({ title: t('items.fields.type.changed', { key: item.key, type: type.name }), tone: 'success' }),
          onError: (error) => notifyError(t('items.fields.type.failed'), error),
        });
      }),
    );
}

/* --------------------------------------------------------------------------------- dates */

/** The days a date command offers, counted from today in the organisation's time zone. */
export function datePresets(today: string): { id: string; label: string; date: string }[] {
  const weekday = weekdayOf(today);
  return [
    { id: 'today', label: t('items.commands.date.today'), date: today },
    { id: 'tomorrow', label: t('items.commands.date.tomorrow'), date: addDays(today, 1) },
    { id: 'friday', label: t('items.commands.date.friday'), date: addDays(today, (5 - weekday + 7) % 7) },
    { id: 'monday', label: t('items.commands.date.monday'), date: addDays(today, (1 - weekday + 7) % 7 || 7) },
    { id: 'week', label: t('items.commands.date.week'), date: addDays(today, 7) },
    { id: 'two_weeks', label: t('items.commands.date.two_weeks'), date: addDays(today, 14) },
    { id: 'month', label: t('items.commands.date.month'), date: endOfMonth(today) },
  ];
}

export function dateOptions(ctx: ItemCommandContext, field: 'start_date' | 'due_date'): CommandOption[] {
  const item = targetOf(ctx);
  const name = t(field === 'due_date' ? 'items.fields.date.due' : 'items.fields.date.start');
  const set = (date: string | null) => {
    // a start after the due date (or a due date before the start) is refused here, with the fix
    const conflict = date !== null && (field === 'start_date' ? item.due_date !== null && date > item.due_date : item.start_date !== null && date < item.start_date);
    if (conflict) {
      toast({
        title: t('items.commands.date.not_set', { field: name }),
        description:
          field === 'start_date'
            ? t('items.commands.date.start_after_due', { day: formatDay(item.due_date!) })
            : t('items.commands.date.due_before_start', { day: formatDay(item.start_date!) }),
        tone: 'error',
      });
      return;
    }
    const what = date ? t('items.commands.what.date_set', { field: name, day: formatDay(date) }) : t('items.commands.what.date_removed', { field: name });
    apply(ctx, what, (target) => ctx.update.mutateAsync({ id: target.id, patch: { [field]: date } }));
  };
  const presets = datePresets(ctx.today).map((preset) => ({
    id: preset.id,
    label: preset.label,
    hint: formatWeekdayDay(preset.date),
    keywords: [formatDay(preset.date)],
    run: () => set(preset.date),
  }));
  const clear =
    item[field] !== null
      ? [{ id: 'none', label: t('items.commands.date.clear', { field: name }), keywords: [t('items.commands.date.clear_keywords')], run: () => set(null) }]
      : [];
  return [...presets, ...clear];
}

/* -------------------------------------------------------------------------------- parent */

const typeIn = (ctx: ItemCommandContext) => (typeId: string) => ctx.types.find((type) => type.id === typeId);

/** The epics the target can hang under (`parentCandidates`). */
const candidatesOf = (ctx: ItemCommandContext) => parentCandidates(targetOf(ctx), ctx.projectItems!, typeIn(ctx));

/** Why the target takes no parent: an epic stands at the top (two levels, `domain/hierarchy`). */
export function parentReason(ctx: ItemCommandContext): string | null {
  return canHaveParent(typeIn(ctx)(targetOf(ctx).type_id)) ? null : t('problem.reason.epic_has_no_parent');
}

export function parentOptions(ctx: ItemCommandContext): CommandOption[] {
  const item = targetOf(ctx);
  const setParent = (parent: WorkItem | null) =>
    apply(ctx, parent ? t('items.commands.what.parent', { parent: parent.key }) : t('items.commands.what.no_parent'), (target) =>
      ctx.update.mutateAsync({ id: target.id, patch: { parent_id: parent?.id ?? null } }),
    );
  const candidates = candidatesOf(ctx).map((candidate) => option(parentOption(candidate, typeIn(ctx)(candidate.type_id)), () => setParent(candidate)));
  return [...(item.parent_id ? [option(NO_PARENT_OPTION(), () => setParent(null))] : []), ...candidates];
}

export const parentEmptyText = (ctx: ItemCommandContext): string => noParentText(candidatesOf(ctx));
