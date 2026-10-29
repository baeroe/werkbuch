/*
 * The item commands of the palette and their shortcuts (spec 5.3):
 *   s Status, a Assignee, i Mir zuweisen, p Priorität, l Labels, t Typ, d Due-Date, shift+d Start-Date,
 *   shift+p Eltern-Item, mod+backspace Archivieren (closed items) bzw. Löschen, both with 5 s Rückgängig.
 * A shortcut of a command with a sub-list opens the palette right in it (`openPalette`); `i` and `mod+backspace` act at
 * once. Without the right a shortcut says why in a toast (as `c` does) and the palette leaves the command out. While
 * the catalogs a command needs still load, its shortcut says so instead of acting, and the palette leaves it out.
 *
 * Mounting contract. A screen mounts the commands with `useItemCommands`; there are no global item shortcuts.
 *   the preview      mounted by `PeekHost` (src/app): useItemCommands({ scope: 'detail', panel })
 *   the item page    useItemCommands({ scope: 'detail', itemId: item.id })
 *   a list or board  useItemCommands({ scope: 'list', current: () => cursorItemId })
 * - `current` answers the id of the item under the screen's keyboard cursor, or null. It must read React state of that
 *   screen (`const [cursor, setCursor] = useState(…)` and `current: () => cursor`), not a ref that changes without a
 *   render: the hook calls it while rendering (the palette's heading) and again whenever a command runs.
 * - A screen that fills `useUiStore.selection` empties it when it unmounts
 *   (`useEffect(() => () => useUiStore.getState().setSelection([]), [])`), so no other screen acts on a selection that
 *   is no longer on screen.
 *
 * The items the commands act on (the targets), decided when a shortcut is pressed or the palette opens; while the
 * palette is open (it holds the focus) they stay as they were when it opened:
 *   1. the focus is inside the preview panel: the previewed item (`peekItemId`)
 *   2. an item page is mounted: its item
 *   3. the selection (`useUiStore.selection`), when there is one
 *   4. the item under a list's cursor (`current`)
 *   5. the previewed item
 * So the keys the preview's fields advertise change the item it shows, and a selection changes as a whole from the list.
 *
 * Several screens may mount the commands at once (a list and the preview beside it). Only one of them registers the
 * palette commands and shortcuts: the innermost scope (detail before list), within a scope the one mounted last, as the
 * shortcut registry decides; when it unmounts the next one takes over. The targets above take every mount into account.
 * So the palette lists the item commands once and the help shows each key once.
 */

import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import type { LucideIcon } from 'lucide-react';
import { Archive, CalendarArrowUp, CalendarClock, CircleDashed, CornerLeftUp, Shapes, Signal, Tag, Trash2, UserRoundCheck, UserRoundPlus } from 'lucide-react';
import { createElement, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type RefObject } from 'react';
import { reasonText, type Page } from '@/api/client';
import type { BulkPatch } from '@/api/workItems';
import { UnassignedAvatar } from '@/components/ui/Avatar';
import { PRIORITY_LABELS } from '@/components/ui/PriorityIcon';
import { toast } from '@/components/ui/toast';
import { canHaveParent, typeChangeRefusal } from '@/domain/hierarchy';
import { allowedTargets, isClosedCategory, statesInOrder } from '@/domain/workflow';
import { useLabels, useResolutions } from '@/hooks/catalog';
import { qk } from '@/hooks/keys';
import { useSettle, type Settle } from '@/hooks/mutation';
import { useMembers, useProjects } from '@/hooks/projects';
import { useProperties } from '@/hooks/properties';
import { useCurrentUser, useUsers } from '@/hooks/users';
import { useWorkflows } from '@/hooks/workflows';
import {
  useArchiveWorkItem,
  useBulkUpdateWorkItems,
  useChangeWorkItemType,
  useDeleteWorkItem,
  useTransitionWorkItem,
  useUpdateWorkItem,
  useWorkItem,
} from '@/hooks/workItems';
import { useWorkItemTypes } from '@/hooks/workItemTypes';
import { registerCommand, type CommandDef, type CommandOption } from '@/lib/commands';
import { notifyError } from '@/lib/errors';
import { usePermissions, type Permission } from '@/lib/permissions';
import { registerShortcut } from '@/lib/shortcuts/registry';
import { runWithUndo } from '@/lib/undo';
import { useUiStore } from '@/store/ui';
import type { BulkResult, Label, Priority, Project, Property, State, User, Workflow, WorkItem, WorkItemDetail, WorkItemType } from '@/types';
import { personOption } from './AssigneePicker';
import { addDays, formatDay, formatWeekdayDay, weekdayOf } from './format';
import { askResolution, askTypeChange } from './ItemDialogs';
import { archivedReason, projectPeople, useToday } from './itemData';
import { labelOption } from './LabelsPicker';
import { noParentText, NO_PARENT_OPTION, parentCandidates, parentOption, useProjectItems } from './ParentPicker';
import type { PickerOption } from './Picker';
import { PRIORITY_OPTIONS } from './PriorityPicker';
import { stateOption } from './StatePicker';
import { typeChangeOf, typeOption } from './TypePicker';

export type ItemCommandScope = 'list' | 'detail';

export interface ItemCommandsOptions {
  /** The shortcut scope: `detail` (item page, preview) wins over `list`. */
  scope: ItemCommandScope;
  /** The item page: its item (rule 2 at the top). */
  itemId?: string | null;
  /** The preview: its panel; while the focus is inside, the commands act on the previewed item (rule 1). */
  panel?: RefObject<HTMLElement | null>;
  /** A list or board: the item under its keyboard cursor, from the screen's state (rule 4). */
  current?: () => string | null;
}

/** Group of the shortcuts in the help overlay. */
const HELP_GROUP = 'Item';

/* ------------------------------------------------------------------ what the commands work with */

/** What the commands read and do when they run; the hook hands in the latest of it. */
export interface ItemCommandContext {
  targets: WorkItem[];
  /** The catalogs the commands read have loaded (projects, workflows, people, labels, types, properties, rights). */
  ready: boolean;
  /** One of them (or the items of the target's project) failed to load; `retry` asks for it again. */
  failed: boolean;
  retry: () => void;
  me: User | undefined;
  today: string;
  projects: Project[];
  workflows: Workflow[];
  /** Who can take an item of a project (`projectPeople`). */
  peopleOf: (projectId: string) => User[];
  labels: Label[];
  types: WorkItemType[];
  properties: Property[];
  /** The items of the target's project, for the parent (single target only). */
  projectItems: WorkItem[] | undefined;
  /** They failed to load. */
  projectItemsFailed: boolean;
  reason: (permission: Permission, projectId: string) => string | null;
  update: ReturnType<typeof useUpdateWorkItem>;
  transition: ReturnType<typeof useTransitionWorkItem>;
  bulk: ReturnType<typeof useBulkUpdateWorkItems>;
  changeType: ReturnType<typeof useChangeWorkItemType>;
  archive: ReturnType<typeof useArchiveWorkItem>;
  remove: ReturnType<typeof useDeleteWorkItem>;
  /** The answer of one call (`mutateAsync`), also when several overlap (see `useSettle`). */
  settle: Settle;
  queryClient: QueryClient;
}

export interface ItemCommandSource {
  scope: ItemCommandScope;
  /** Heading in the palette, e.g. "Aktionen für WEB-47". */
  group: string;
  /** Whether `mod+backspace` archives (all targets closed) rather than deletes; it decides which command shows the key. */
  archives: boolean;
  context: () => ItemCommandContext;
}

const workflowOf = (ctx: ItemCommandContext, item: WorkItem) => {
  const project = ctx.projects.find((entry) => entry.id === item.project_id);
  return ctx.workflows.find((workflow) => workflow.id === project?.workflow_id);
};
const stateOf = (ctx: ItemCommandContext, item: WorkItem) => workflowOf(ctx, item)?.states.find((state) => state.id === item.state_id);
const isClosed = (ctx: ItemCommandContext, item: WorkItem) => {
  const state = stateOf(ctx, item);
  return state !== undefined && isClosedCategory(state.category);
};
const subjectOf = (targets: WorkItem[]) => (targets.length === 1 ? targets[0].key : `${targets.length} Items`);

/** Why the targets cannot be changed: one is archived, or a right is missing in one of their projects. */
function editReason(ctx: ItemCommandContext, permission: Permission = 'item.edit'): string | null {
  for (const item of ctx.targets) {
    if (item.archived_at !== null) return archivedReason(item.key);
    const denied = ctx.reason(permission, item.project_id);
    if (denied) return denied;
  }
  return null;
}

const ONE_ONLY = 'Typ und Eltern-Item ändern sich nur für ein Item allein.';

/* ------------------------------------------------------------------------------ feedback */

const done = (title: string) => toast({ title, tone: 'success' });

/**
 * One item changes with its own mutation (optimistic), several with one bulk edit. The toast confirms what happened
 * once the server agreed; for a bulk edit it also names what each item's rules refused.
 */
function apply(ctx: ItemCommandContext, what: string, single: (item: WorkItem, onSuccess: () => void) => void, patch: BulkPatch) {
  const targets = ctx.targets;
  if (targets.length === 1) {
    single(targets[0], () => done(`${targets[0].key}: ${what}`));
    return;
  }
  ctx.settle(ctx.bulk.mutateAsync({ ids: targets.map((item) => item.id), patch }), { onSuccess: (result) => bulkToast(targets, result, what) });
}

function bulkToast(targets: WorkItem[], result: BulkResult, what: string) {
  const keyOf = (id: string) => targets.find((item) => item.id === id)?.key ?? id;
  if (result.rejected.length === 0) {
    done(`${result.updated.length} Items: ${what}`);
    return;
  }
  toast({
    title: `${result.updated.length} von ${targets.length} Items geändert`,
    description: result.rejected.map((entry) => `${keyOf(entry.id)}: ${reasonText(entry.reason)}`).join(' '),
  });
}

/* --------------------------------------------------------------------------- sub-lists */

const option = (picker: PickerOption, run: () => void): CommandOption => ({
  id: picker.value || 'none',
  label: picker.label,
  icon: picker.icon,
  hint: picker.hint,
  keywords: picker.keywords,
  run,
});

function stateOptions(ctx: ItemCommandContext): CommandOption[] {
  const targets = ctx.targets;
  const move = (state: State) => {
    if (isClosedCategory(state.category)) {
      const from = targets.length === 1 ? stateOf(ctx, targets[0]) : undefined;
      askResolution({
        subject: subjectOf(targets),
        target: state,
        from: from ? { category: from.category, resolutionId: targets[0].resolution_id } : undefined,
        onConfirm: (resolutionId) =>
          apply(ctx, `Status ${state.name}`, (item, onSuccess) => ctx.settle(ctx.transition.mutateAsync({ id: item.id, to_state_id: state.id, resolution_id: resolutionId }), { onSuccess }), {
            state_id: state.id,
            resolution_id: resolutionId,
          }),
      });
      return;
    }
    apply(ctx, `Status ${state.name}`, (item, onSuccess) => ctx.settle(ctx.transition.mutateAsync({ id: item.id, to_state_id: state.id }), { onSuccess }), { state_id: state.id });
  };

  if (targets.length === 1) {
    const workflow = workflowOf(ctx, targets[0]);
    return workflow ? allowedTargets(workflow, targets[0].state_id).map((state) => option(stateOption(state), () => move(state))) : [];
  }
  // several items: the states of their workflows; each item's own rules decide (the toast names refusals)
  const workflows = [...new Map(ctx.targets.flatMap((item) => workflowOf(ctx, item) ?? []).map((workflow) => [workflow.id, workflow])).values()];
  return workflows.flatMap((workflow) =>
    statesInOrder(workflow).map((state) => ({ ...option(stateOption(state), () => move(state)), id: state.id, hint: workflows.length > 1 ? workflow.name : undefined })),
  );
}

/** The people every target's project has. */
function commonPeople(ctx: ItemCommandContext): User[] {
  const [first, ...rest] = [...new Set(ctx.targets.map((item) => item.project_id))].map((projectId) => ctx.peopleOf(projectId));
  return (first ?? []).filter((user) => rest.every((people) => people.some((other) => other.id === user.id)));
}

function assign(ctx: ItemCommandContext, user: User | null) {
  apply(ctx, user ? `zugewiesen an ${user.name}` : 'nicht mehr zugewiesen', (item, onSuccess) => ctx.settle(ctx.update.mutateAsync({ id: item.id, patch: { assignee_id: user?.id ?? null } }), { onSuccess }), {
    assignee_id: user?.id ?? null,
  });
}

function assigneeOptions(ctx: ItemCommandContext): CommandOption[] {
  const people = commonPeople(ctx);
  const me = ctx.me && people.some((user) => user.id === ctx.me?.id) ? ctx.me : undefined;
  return [
    ...(me ? [{ id: 'me', label: 'Mir zuweisen', keywords: [me.name], icon: createElement(UserRoundCheck), run: () => assign(ctx, me) }] : []),
    { id: 'nobody', label: 'Nicht zugewiesen', keywords: ['niemand', 'entfernen'], icon: createElement(UnassignedAvatar), run: () => assign(ctx, null) },
    ...people.map((user) => option(personOption(user), () => assign(ctx, user))),
  ];
}

function priorityOptions(ctx: ItemCommandContext): CommandOption[] {
  return PRIORITY_OPTIONS.map((picker) => {
    const priority = picker.value as Priority;
    return option(picker, () =>
      apply(ctx, `Priorität ${PRIORITY_LABELS[priority]}`, (item, onSuccess) => ctx.settle(ctx.update.mutateAsync({ id: item.id, patch: { priority } }), { onSuccess }), { priority }),
    );
  });
}

function labelOptions(ctx: ItemCommandContext): CommandOption[] {
  return [...ctx.labels]
    .sort((a, b) => a.name.localeCompare(b.name, 'de-DE'))
    .map((label) => {
      // a label all of them have comes off, any other goes on
      const all = ctx.targets.every((item) => item.label_ids.includes(label.id));
      return {
        ...option(labelOption(label), () =>
          apply(
            ctx,
            `Label ${label.name} ${all ? 'entfernt' : 'gesetzt'}`,
            (item, onSuccess) =>
              ctx.settle(ctx.update.mutateAsync({ id: item.id, patch: { label_ids: all ? item.label_ids.filter((id) => id !== label.id) : [...item.label_ids, label.id] } }), { onSuccess }),
            all ? { remove_label_ids: [label.id] } : { add_label_ids: [label.id] },
          ),
        ),
        hint: all ? 'gesetzt' : undefined,
      };
    });
}

function typeOptions(ctx: ItemCommandContext): CommandOption[] {
  const [item] = ctx.targets;
  const project = ctx.projects.find((entry) => entry.id === item.project_id);
  return ctx.types
    .filter((type) => type.archived_at === null && project?.enabled_type_ids.includes(type.id) && type.id !== item.type_id)
    .map((type) =>
      option(typeOption(type), () => {
        const { lost, missing } = typeChangeOf(item, type, ctx.properties, ctx.types);
        // the two levels: the dialog says why (unknown children leave it to the server, whose toast says it)
        const hasChildren = (ctx.projectItems ?? []).some((entry) => entry.parent_id === item.id);
        if (lost.length > 0 || missing.length > 0 || typeChangeRefusal(item.key, { hasChildren, hasParent: item.parent_id !== null }, type)) {
          askTypeChange(item, type);
          return;
        }
        ctx.settle(ctx.changeType.mutateAsync({ id: item.id, type_id: type.id }), {
          onSuccess: () => done(`${item.key} hat jetzt den Typ ${type.name}`),
          onError: (error) => notifyError('Typ nicht geändert', error),
        });
      }),
    );
}

/** The days a date command offers, counted from today in the organisation's time zone. */
export function datePresets(today: string): { id: string; label: string; date: string }[] {
  const weekday = weekdayOf(today);
  const [year, month] = today.split('-').map(Number);
  const endOfMonth = new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
  return [
    { id: 'today', label: 'Heute', date: today },
    { id: 'tomorrow', label: 'Morgen', date: addDays(today, 1) },
    { id: 'friday', label: 'Ende der Woche', date: addDays(today, (5 - weekday + 7) % 7) },
    { id: 'monday', label: 'Nächster Montag', date: addDays(today, (1 - weekday + 7) % 7 || 7) },
    { id: 'week', label: 'In einer Woche', date: addDays(today, 7) },
    { id: 'two_weeks', label: 'In zwei Wochen', date: addDays(today, 14) },
    { id: 'month', label: 'Ende des Monats', date: endOfMonth },
  ];
}

function dateOptions(ctx: ItemCommandContext, field: 'start_date' | 'due_date'): CommandOption[] {
  const name = field === 'due_date' ? 'Due-Date' : 'Start-Date';
  const set = (date: string | null) => {
    // one item: refuse a start after its due date here, with the fix (several: each item's rules decide)
    const [first] = ctx.targets;
    const conflict =
      ctx.targets.length === 1 && date !== null && (field === 'start_date' ? first.due_date !== null && date > first.due_date : first.start_date !== null && date < first.start_date);
    if (conflict) {
      toast({
        title: `${name} nicht gesetzt`,
        description:
          field === 'start_date'
            ? `Der Start läge nach dem Due-Date (${formatDay(first.due_date!)}). Verschiebe zuerst das Due-Date.`
            : `Das Due-Date läge vor dem Start (${formatDay(first.start_date!)}). Verschiebe zuerst den Start.`,
        tone: 'error',
      });
      return;
    }
    apply(ctx, date ? `${name} ${formatDay(date)}` : `${name} entfernt`, (item, onSuccess) => ctx.settle(ctx.update.mutateAsync({ id: item.id, patch: { [field]: date } }), { onSuccess }), {
      [field]: date,
    });
  };
  const presets = datePresets(ctx.today).map((preset) => ({ id: preset.id, label: preset.label, hint: formatWeekdayDay(preset.date), keywords: [formatDay(preset.date)], run: () => set(preset.date) }));
  const clear = ctx.targets.some((item) => item[field] !== null) ? [{ id: 'none', label: `${name} entfernen`, keywords: ['löschen', 'leeren'], run: () => set(null) }] : [];
  return [...presets, ...clear];
}

const typeIn = (ctx: ItemCommandContext) => (typeId: string) => ctx.types.find((type) => type.id === typeId);
/** The epics the single target can hang under (`parentCandidates`). */
const candidatesOf = (ctx: ItemCommandContext) => parentCandidates(ctx.targets[0], ctx.projectItems ?? [], typeIn(ctx));

/** Why the single target takes no parent: an epic stands at the top (two levels, domain/hierarchy). */
function parentReason(ctx: ItemCommandContext): string | null {
  const [item] = ctx.targets;
  return item && !canHaveParent(typeIn(ctx)(item.type_id)) ? reasonText('epic_has_no_parent') : null;
}

function parentOptions(ctx: ItemCommandContext): CommandOption[] {
  const [item] = ctx.targets;
  const setParent = (parent: WorkItem | null) =>
    ctx.settle(ctx.update.mutateAsync({ id: item.id, patch: { parent_id: parent?.id ?? null } }), {
      onSuccess: () => done(parent ? `${item.key}: Eltern-Item ${parent.key}` : `${item.key}: kein Eltern-Item mehr`),
    });
  const candidates = candidatesOf(ctx).map((candidate) => option(parentOption(candidate, typeIn(ctx)(candidate.type_id)), () => setParent(candidate)));
  return [...(item.parent_id ? [option(NO_PARENT_OPTION, () => setParent(null))] : []), ...candidates];
}

/* ----------------------------------------------------------------------- archive, delete */

const isPage = (data: unknown): data is Page<WorkItem> => typeof data === 'object' && data !== null && Array.isArray((data as Page<WorkItem>).items);

/**
 * Takes the items out of every cached list at once, and out of the preview and the selection. Answers `restore`, which
 * puts the named items back where they were (undo, or a change that failed) and loads the lists again.
 */
function hideAtOnce(ctx: ItemCommandContext, ids: string[]): (back: string[]) => void {
  const listKey = [...qk.workItems.all, 'list'];
  const before = ctx.queryClient.getQueriesData<unknown>({ queryKey: listKey });
  ctx.queryClient.setQueriesData({ queryKey: listKey }, (data: unknown) =>
    isPage(data) ? { ...data, items: data.items.filter((item) => !ids.includes(item.id)), total: Math.max(0, data.total - ids.length) } : data,
  );
  const ui = useUiStore.getState();
  if (ui.peekItemId && ids.includes(ui.peekItemId)) ui.openPeek(null);
  if (ui.selection.some((id) => ids.includes(id))) ui.setSelection(ui.selection.filter((id) => !ids.includes(id)));

  return (back) => {
    for (const [key, snapshot] of before) {
      if (!isPage(snapshot)) continue;
      ctx.queryClient.setQueryData(key, (current: unknown) => {
        if (!isPage(current)) return current;
        const now = new Map(current.items.map((item) => [item.id, item]));
        const returning = snapshot.items.filter((item) => back.includes(item.id) && !now.has(item.id));
        if (returning.length === 0) return current;
        // the order of before, with today's version of every item that stayed, and new items at the end
        const items = [
          ...snapshot.items.flatMap((item) => (now.has(item.id) ? [now.get(item.id)!] : back.includes(item.id) ? [item] : [])),
          ...current.items.filter((item) => !snapshot.items.some((old) => old.id === item.id)),
        ];
        return { ...current, items, total: current.total + returning.length };
      });
    }
    // the server has the last word (a failed refetch keeps what is shown)
    void ctx.queryClient.invalidateQueries({ queryKey: qk.workItems.all });
  };
}

function archiveTargets(ctx: ItemCommandContext): void {
  const targets = ctx.targets;
  const ids = targets.map((item) => item.id);
  const restore = hideAtOnce(ctx, ids);
  runWithUndo({ label: `${subjectOf(targets)} archiviert`, undo: () => restore(ids), run: () => archiveEach(ctx, targets, restore) });
}

/** Archives when the undo time is up. What fails or is refused comes back on screen. */
async function archiveEach(ctx: ItemCommandContext, targets: WorkItem[], restore: (back: string[]) => void): Promise<void> {
  const ids = targets.map((item) => item.id);
  try {
    if (targets.length === 1) {
      await ctx.archive.mutateAsync(ids[0]);
      return;
    }
    const result = await ctx.bulk.mutateAsync({ ids, patch: { archived: true } });
    if (result.rejected.length > 0) {
      restore(result.rejected.map((entry) => entry.id));
      bulkToast(targets, result, 'archiviert');
    }
  } catch {
    // the item mutations toast the failure themselves (with "Erneut versuchen"); the rows come back
    restore(ids);
  }
}

function deleteTargets(ctx: ItemCommandContext): void {
  const targets = ctx.targets;
  const ids = targets.map((item) => item.id);
  const restore = hideAtOnce(ctx, ids);
  runWithUndo({ label: `${subjectOf(targets)} gelöscht`, undo: () => restore(ids), run: () => deleteEach(ctx, targets, restore) });
}

/**
 * Deletes when the undo time is up, item by item. What fails comes back on screen, and "Erneut versuchen" tries only
 * those again (the others are gone and would answer 404).
 */
async function deleteEach(ctx: ItemCommandContext, targets: WorkItem[], restore: (back: string[]) => void): Promise<void> {
  const results = await Promise.allSettled(targets.map((item) => ctx.remove.mutateAsync(item.id)));
  const failed = targets.filter((_, index) => results[index].status === 'rejected');
  if (failed.length === 0) return;
  restore(failed.map((item) => item.id));
  const cause = results.find((result): result is PromiseRejectedResult => result.status === 'rejected')?.reason;
  notifyError(`${subjectOf(failed)} nicht gelöscht`, cause, () => {
    const again = hideAtOnce(ctx, failed.map((item) => item.id));
    void deleteEach(ctx, failed, again);
  });
}

/** What `mod+backspace` does now: archive closed items, delete others; or why it can do neither. */
function removal(ctx: ItemCommandContext): { run: () => void } | { denied: string } {
  if (ctx.targets.length === 0) return { denied: 'Kein Item gewählt.' };
  if (!ctx.ready) return { denied: ctx.failed ? FAILED : LOADING };
  const archivable = ctx.targets.every((item) => item.archived_at === null && isClosed(ctx, item));
  if (archivable) {
    const denied = editReason(ctx);
    return denied ? { denied } : { run: () => archiveTargets(ctx) };
  }
  const denied = ctx.targets.map((item) => ctx.reason('item.delete', item.project_id)).find(Boolean);
  return denied ? { denied } : { run: () => deleteTargets(ctx) };
}

/* ------------------------------------------------------------------------- registration */

interface ItemCommand {
  id: string;
  label: string;
  keys: string;
  icon: LucideIcon;
  keywords?: string[];
  /** Whether what it reads besides the catalogs is still on its way (or failed); then it waits instead of acting on gaps. */
  loading?: (ctx: ItemCommandContext) => 'loading' | 'failed' | null;
  /** Why it is not possible for the current targets, or null. */
  denied: (ctx: ItemCommandContext) => string | null;
  /** Either a sub-list or an action. */
  options?: (ctx: ItemCommandContext) => CommandOption[];
  placeholder?: string;
  /** What the sub-list says when nothing matches (or there is nothing to choose). */
  emptyText?: string | ((ctx: ItemCommandContext) => string);
  act?: (ctx: ItemCommandContext) => void;
}

const SINGLE = (ctx: ItemCommandContext) => (ctx.targets.length > 1 ? ONE_ONLY : editReason(ctx));

const LOADING = 'Die Daten dafür werden noch geladen. Versuch es gleich noch einmal.';
const FAILED = 'Die Daten dafür ließen sich nicht laden.';

/**
 * What keeps a command from acting now, or null. The catalogs come first: without them no reason can be told. Then the
 * command's own reason (several items for the parent, a missing right), and only then the data the command reads
 * besides, so the person hears the reason that holds and is not told to wait for data that would change nothing.
 */
function blocker(command: ItemCommand, ctx: ItemCommandContext): string | null {
  if (!ctx.ready) return ctx.failed ? FAILED : LOADING;
  const denied = command.denied(ctx);
  if (denied) return denied;
  const loading = command.loading?.(ctx) ?? null;
  return loading === 'failed' ? FAILED : loading === 'loading' ? LOADING : null;
}

const COMMANDS: ItemCommand[] = [
  {
    id: 'item.state',
    label: 'Status ändern …',
    keys: 's',
    icon: CircleDashed,
    denied: (ctx) => editReason(ctx),
    options: stateOptions,
    placeholder: 'Status wählen …',
    emptyText: 'Von diesem Status führt im Workflow kein Übergang weiter.',
  },
  { id: 'item.assignee', label: 'Zuweisen …', keys: 'a', icon: UserRoundPlus, keywords: ['assignee'], denied: (ctx) => editReason(ctx), options: assigneeOptions, placeholder: 'Person wählen …' },
  {
    id: 'item.assign_me',
    label: 'Mir zuweisen',
    keys: 'i',
    icon: UserRoundCheck,
    keywords: ['assignee'],
    denied: (ctx) => {
      if (!ctx.me || !commonPeople(ctx).some((user) => user.id === ctx.me?.id)) return 'Du bist nicht Mitglied des Projekts.';
      return editReason(ctx);
    },
    act: (ctx) => assign(ctx, ctx.me ?? null),
  },
  { id: 'item.priority', label: 'Priorität ändern …', keys: 'p', icon: Signal, denied: (ctx) => editReason(ctx), options: priorityOptions, placeholder: 'Priorität wählen …' },
  { id: 'item.labels', label: 'Labels ändern …', keys: 'l', icon: Tag, denied: (ctx) => editReason(ctx), options: labelOptions, placeholder: 'Label wählen …' },
  { id: 'item.type', label: 'Typ ändern …', keys: 't', icon: Shapes, denied: SINGLE, options: typeOptions, placeholder: 'Typ wählen …', emptyText: 'Das Projekt hat keinen anderen Typ.' },
  {
    id: 'item.due_date',
    label: 'Due-Date setzen …',
    keys: 'd',
    icon: CalendarClock,
    keywords: ['fällig', 'datum'],
    denied: (ctx) => editReason(ctx),
    options: (ctx) => dateOptions(ctx, 'due_date'),
    placeholder: 'Due-Date wählen …',
  },
  {
    id: 'item.start_date',
    label: 'Start-Date setzen …',
    keys: 'shift+d',
    icon: CalendarArrowUp,
    keywords: ['beginn', 'datum'],
    denied: (ctx) => editReason(ctx),
    options: (ctx) => dateOptions(ctx, 'start_date'),
    placeholder: 'Start-Date wählen …',
  },
  {
    id: 'item.parent',
    label: 'Eltern-Item setzen …',
    keys: 'shift+p',
    icon: CornerLeftUp,
    keywords: ['epic', 'parent'],
    // the candidates are the epics of the project
    loading: (ctx) => (ctx.projectItems !== undefined ? null : ctx.projectItemsFailed ? 'failed' : 'loading'),
    denied: (ctx) => SINGLE(ctx) ?? parentReason(ctx),
    options: parentOptions,
    placeholder: 'Key oder Titel suchen …',
    emptyText: (ctx) => noParentText(candidatesOf(ctx)),
  },
];

/** The palette commands and shortcuts of one source; answers the function that takes them out again. */
export function registerItemCommands(source: ItemCommandSource): () => void {
  const ctx = () => source.context();
  const deniedToast = (denied: string) => {
    if (denied === LOADING) toast({ title: 'Einen Moment', description: LOADING });
    else if (denied === FAILED) toast({ title: 'Daten nicht geladen', description: FAILED, tone: 'error', action: { label: 'Erneut versuchen', onClick: () => ctx().retry() } });
    else toast({ title: 'Nicht möglich', description: denied, tone: 'error' });
  };
  const offs: (() => void)[] = [];

  for (const command of COMMANDS) {
    const def: CommandDef = {
      id: command.id,
      label: command.label,
      group: source.group,
      keys: command.keys,
      icon: createElement(command.icon),
      keywords: command.keywords,
      when: () => {
        const c = ctx();
        return c.targets.length > 0 && blocker(command, c) === null;
      },
      run: () => (command.act ? command.act(ctx()) : undefined),
      subpage: command.options
        ? () => {
            const c = ctx();
            const emptyText = typeof command.emptyText === 'function' ? command.emptyText(c) : command.emptyText;
            return { placeholder: command.placeholder, emptyText, options: command.options!(c) };
          }
        : undefined,
    };
    offs.push(registerCommand(def));
    offs.push(
      registerShortcut({
        id: command.id,
        keys: command.keys,
        scope: source.scope,
        label: command.label.replace(' …', ''),
        group: HELP_GROUP,
        when: () => ctx().targets.length > 0,
        run: () => {
          const c = ctx();
          const denied = blocker(command, c);
          if (denied) deniedToast(denied);
          else if (command.act) command.act(c);
          else useUiStore.getState().openPalette(command.id);
        },
      }),
    );
  }

  // archive (closed items) or delete: one key; the palette shows it on the command it does
  offs.push(
    registerCommand({
      id: 'item.archive',
      label: 'Archivieren',
      group: source.group,
      keys: source.archives ? 'mod+backspace' : undefined,
      icon: createElement(Archive),
      when: () => {
        const c = ctx();
        return c.ready && c.targets.length > 0 && c.targets.every((item) => item.archived_at === null && isClosed(c, item)) && editReason(c) === null;
      },
      run: () => archiveTargets(ctx()),
    }),
    registerCommand({
      id: 'item.delete',
      label: 'Löschen',
      group: source.group,
      keys: source.archives ? undefined : 'mod+backspace',
      icon: createElement(Trash2),
      keywords: ['entfernen'],
      when: () => {
        const c = ctx();
        return c.ready && c.targets.length > 0 && c.targets.every((item) => c.reason('item.delete', item.project_id) === null);
      },
      run: () => deleteTargets(ctx()),
    }),
    registerShortcut({
      id: 'item.remove',
      keys: 'mod+backspace',
      scope: source.scope,
      label: 'Archivieren bzw. löschen (mit Rückgängig)',
      group: HELP_GROUP,
      when: () => ctx().targets.length > 0,
      run: () => {
        const next = removal(ctx());
        if ('denied' in next) deniedToast(next.denied);
        else next.run();
      },
    }),
  );

  return () => offs.forEach((off) => off());
}

/* --------------------------------------------------------------------------- the hook */

/** A screen that mounts the commands, with the latest options it rendered. */
interface Mount {
  id: number;
  scope: ItemCommandScope;
  options: () => ItemCommandsOptions;
}

/** The mounted screens; the innermost scope, then the one mounted last, registers. */
let mounts: Mount[] = [];
let mountCounter = 0;
const mountListeners = new Set<() => void>();
const SCOPE_RANK: Record<ItemCommandScope, number> = { list: 1, detail: 2 };

function activeMount(): number | null {
  const best = mounts.reduce<Mount | null>((winner, mount) => {
    if (!winner) return mount;
    const rank = SCOPE_RANK[mount.scope] - SCOPE_RANK[winner.scope];
    return rank > 0 || (rank === 0 && mount.id > winner.id) ? mount : winner;
  }, null);
  return best?.id ?? null;
}

function subscribeMounts(listener: () => void): () => void {
  mountListeners.add(listener);
  return () => {
    mountListeners.delete(listener);
  };
}

/** The ids the commands act on right now, by the rules at the top of this file. */
function currentTargetIds(): string[] {
  const ui = useUiStore.getState();
  const focus = typeof document === 'undefined' ? null : document.activeElement;
  const newestFirst = [...mounts].reverse().map((mount) => mount.options());
  if (ui.peekItemId && newestFirst.some((options) => options.panel?.current?.contains(focus) ?? false)) return [ui.peekItemId];
  const page = newestFirst.find((options) => options.itemId)?.itemId;
  if (page) return [page];
  if (ui.selection.length > 0) return ui.selection;
  for (const options of newestFirst) {
    const cursor = options.current?.();
    if (cursor) return [cursor];
  }
  return ui.peekItemId ? [ui.peekItemId] : [];
}

/** The targets of the moment the palette opened: it takes the focus, so asking again would lose the preview. */
let paletteTargets: string[] | null = null;
useUiStore.subscribe((state, previous) => {
  if (state.paletteOpen && !previous.paletteOpen) paletteTargets = currentTargetIds();
  else if (!state.paletteOpen) paletteTargets = null;
});

const targetIds = (): string[] => paletteTargets ?? currentTargetIds();

/** The targets as one value, for `useSyncExternalStore`: a mount renders again when they change with the focus. */
const targetSnapshot = (): string => targetIds().join(' ');

/** Calls back when the focus moved: in, and out (once the focus has settled, which a focusout does not see yet). */
function subscribeFocus(listener: () => void): () => void {
  const settled = () => queueMicrotask(listener);
  document.addEventListener('focusin', listener);
  document.addEventListener('focusout', settled);
  return () => {
    document.removeEventListener('focusin', listener);
    document.removeEventListener('focusout', settled);
  };
}

const isDetail = (data: unknown): data is WorkItemDetail => typeof data === 'object' && data !== null && 'item' in data && 'workflow' in data;

/** An item from the cache: its detail, or any list it is in (a selection always comes from a list on screen). */
function cachedItem(queryClient: QueryClient, ref: string): WorkItem | undefined {
  const matches = (item: WorkItem) => item.id === ref || item.key === ref;
  for (const [, data] of queryClient.getQueriesData<unknown>({ queryKey: qk.workItems.all })) {
    if (isDetail(data) && matches(data.item)) return data.item;
  }
  for (const [, data] of queryClient.getQueriesData<unknown>({ queryKey: qk.workItems.all })) {
    const found = isPage(data) ? data.items.find(matches) : undefined;
    if (found) return found;
  }
  return undefined;
}

/** Mounts the item commands and their shortcuts for a screen (see the mounting contract at the top of this file). */
export function useItemCommands(options: ItemCommandsOptions): void {
  const [mountId] = useState(() => ++mountCounter);
  const latestOptions = useRef(options);
  useLayoutEffect(() => {
    latestOptions.current = options;
  });
  const { scope } = options;
  useEffect(() => {
    mounts = [...mounts, { id: mountId, scope, options: () => latestOptions.current }];
    mountListeners.forEach((listener) => listener());
    return () => {
      mounts = mounts.filter((mount) => mount.id !== mountId);
      mountListeners.forEach((listener) => listener());
    };
  }, [mountId, scope]);
  const active = useSyncExternalStore(subscribeMounts, activeMount, activeMount) === mountId;

  const queryClient = useQueryClient();
  // subscribed, so the palette's heading follows the selection, the preview and the targets of an opening palette
  useUiStore((state) => state.selection);
  useUiStore((state) => state.peekItemId);
  useUiStore((state) => state.paletteOpen);
  // and the focus: with it inside the preview the targets are the previewed item (rule 1), which may be of another
  // project than what the last render loaded for (the parent's candidates come from the target's project)
  useSyncExternalStore(subscribeFocus, targetSnapshot, targetSnapshot);
  const catalogs = {
    projects: useProjects({ include_archived: true }),
    workflows: useWorkflows(),
    users: useUsers(),
    members: useMembers(),
    labels: useLabels(),
    types: useWorkItemTypes(),
    properties: useProperties(),
  };
  const projects = catalogs.projects.data?.items;
  const workflows = catalogs.workflows.data?.items;
  const users = catalogs.users.data?.items;
  const members = catalogs.members.data?.items;
  const labels = catalogs.labels.data?.items;
  const types = catalogs.types.data?.items;
  const properties = catalogs.properties.data?.items;
  // loaded ahead, so the resolution question opens with its list
  useResolutions();
  const me = useCurrentUser();
  const { reason } = usePermissions();
  const { today } = useToday();
  const settle = useSettle();
  const mutations = {
    update: useUpdateWorkItem(),
    transition: useTransitionWorkItem(),
    bulk: useBulkUpdateWorkItems(),
    changeType: useChangeWorkItemType(),
    archive: useArchiveWorkItem(),
    remove: useDeleteWorkItem(),
  };
  // the rights come from the same people, projects and memberships
  const ready = Boolean(projects && workflows && users && members && labels && types && properties && me);
  // a catalog that failed stays failed until asked again: the shortcuts say so instead of "Einen Moment" for ever
  const failedCatalogs = Object.values(catalogs).filter((query) => query.isError && query.data === undefined);

  const ids = targetIds();
  // a single item is loaded here, so the commands know it even before its screen has
  const single = useWorkItem(ids.length === 1 ? ids[0] : null).data?.item;
  const targets = ids.flatMap((id) => (single && (single.id === id || single.key === id) ? [single] : (cachedItem(queryClient, id) ?? [])));
  const projectItemsQuery = useProjectItems(single?.project_id ?? '', single !== undefined);
  const projectItems = projectItemsQuery.data?.items;
  const projectItemsOf = projectItems ? single?.project_id : undefined;
  const retry = () => {
    failedCatalogs.forEach((query) => void query.refetch());
    if (projectItemsQuery.isError) void projectItemsQuery.refetch();
  };

  const context = (): ItemCommandContext => {
    const now = targetIds().flatMap((id) => cachedItem(queryClient, id) ?? []);
    return {
      targets: now,
      ready,
      failed: failedCatalogs.length > 0,
      retry,
      me,
      today,
      projects: projects ?? [],
      workflows: workflows ?? [],
      peopleOf: (projectId) => projectPeople(users ?? [], members ?? [], projectId),
      labels: labels ?? [],
      types: types ?? [],
      properties: properties ?? [],
      // only the items of the target's own project (another target loads its project on the next render)
      projectItems: now.length === 1 && now[0].project_id === projectItemsOf ? projectItems : undefined,
      projectItemsFailed: now.length === 1 && now[0].project_id === single?.project_id && projectItemsQuery.isError && projectItems === undefined,
      reason: (permission, projectId) => reason(permission, projectId),
      ...mutations,
      settle,
      queryClient,
    };
  };
  const latest = useRef(context);
  useLayoutEffect(() => {
    latest.current = context;
  });

  const group = targets.length === 1 ? `Aktionen für ${targets[0].key}` : targets.length > 1 ? `Aktionen für ${targets.length} Items` : 'Aktionen für das Item';
  const archives = targets.length > 0 && targets.every((item) => {
    const project = projects?.find((entry) => entry.id === item.project_id);
    const state = workflows?.find((workflow) => workflow.id === project?.workflow_id)?.states.find((entry) => entry.id === item.state_id);
    return item.archived_at === null && state !== undefined && isClosedCategory(state.category);
  });

  // registered anew when the data a command waits for arrive (or fail), so an open palette shows it then
  const loaded = `${ready}:${failedCatalogs.length}:${projectItemsOf ?? ''}`;
  useEffect(() => {
    if (!active) return;
    return registerItemCommands({ scope, group, archives, context: () => latest.current() });
  }, [active, scope, group, archives, loaded]);
}

/**
 * The item commands of the preview, as `PeekHost` mounts them (lazily, with the preview): detail scope, and the
 * previewed item while the focus is inside `panel`.
 */
export function PreviewItemCommands({ panel }: { panel: RefObject<HTMLElement | null> }): null {
  useItemCommands({ scope: 'detail', panel });
  return null;
}
