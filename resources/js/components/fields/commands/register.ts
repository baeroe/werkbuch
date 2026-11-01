/*
 * The item commands of the palette and their shortcuts (spec 5.3), bound only through their catalog ids:
 *   s Status, a Assignee, i Mir zuweisen, p Priorität, l Labels, t Typ, d Due-Date, shift+d Start-Date,
 *   shift+p Eltern-Item, mod+backspace Archivieren (closed items) bzw. Löschen, both with 5 s Rückgängig.
 * A shortcut of a command with a sub-list opens the palette right in it (`openPalette`); `i` and `mod+backspace` act at
 * once. Without the right a shortcut says why in a toast and the palette leaves the command out. While the catalogs a
 * command needs still load, its shortcut says so instead of acting, and the palette leaves it out.
 * Several targets (a selection) change together; type and parent change for one item alone. `mod+backspace` archives
 * when some of them are closed (the open ones stay and are named) and deletes otherwise.
 */

import type { LucideIcon } from 'lucide-react';
import { Archive, CalendarArrowUp, CalendarClock, CircleDashed, CornerLeftUp, Shapes, Signal, Tag, Trash2, UserRoundCheck, UserRoundPlus } from 'lucide-react';
import { createElement } from 'react';
import { toast } from '@/components/ui/toast';
import { registerCommand, type CommandDef, type CommandOption } from '@/lib/commands';
import { t, type TranslationKey } from '@/lib/i18n';
import { SHORTCUTS, type ShortcutId } from '@/lib/shortcuts/catalog';
import { registerShortcut } from '@/lib/shortcuts/registry';
import { useUiStore } from '@/store/ui';
import { archiveTargets, deleteManyWithUndo, deleteWithUndo } from './actions';
import { archivesNow, editReason, isClosed, type ItemCommandContext, type ItemCommandSource } from './context';
import {
  assign,
  assigneeOptions,
  canTakeIt,
  dateOptions,
  labelOptions,
  parentEmptyText,
  parentOptions,
  parentReason,
  priorityOptions,
  stateEmptyText,
  stateOptions,
  typeOptions,
} from './options';

type Wait = 'loading' | 'failed' | null;

interface ItemCommand {
  id: ShortcutId;
  icon: LucideIcon;
  /** More words that find it, as one text. */
  keywords?: TranslationKey;
  /** Whether what it reads besides the catalogs is still on its way (or failed); then it waits instead of acting on gaps. */
  loading?: (ctx: ItemCommandContext) => Wait;
  /** Its data load when the palette opens (A153): while they are on their way, it opens its sub-list, which fills then. */
  opensWhileLoading?: boolean;
  /** Why it is not possible for the target, or null. */
  denied: (ctx: ItemCommandContext) => string | null;
  /** Either a sub-list or an action. */
  options?: (ctx: ItemCommandContext) => CommandOption[];
  placeholder?: TranslationKey;
  /** What the sub-list says when nothing matches (or there is nothing to choose). */
  emptyText?: (ctx: ItemCommandContext) => string;
  act?: (ctx: ItemCommandContext) => void;
}

const waitFor = (data: unknown, failed: boolean): Wait => (data !== undefined ? null : failed ? 'failed' : 'loading');
const people = (ctx: ItemCommandContext) => waitFor(ctx.people, ctx.peopleFailed);
const projectItems = (ctx: ItemCommandContext) => waitFor(ctx.projectItems, ctx.projectItemsFailed);
const children = (ctx: ItemCommandContext) => waitFor(ctx.hasChildren, false);
const edit = (ctx: ItemCommandContext) => editReason(ctx);
/** Type and parent change for one item alone. */
const single = (ctx: ItemCommandContext) => (ctx.targets.length > 1 ? t('items.commands.one_only') : editReason(ctx));

const LOADING = () => t('items.commands.wait.description');
const FAILED = () => t('items.commands.failed.description');

/**
 * What keeps a command from acting now, or null. The catalogs come first: without them no reason can be told. Then the
 * command's own reason (a missing right), and only then the data the command reads besides, so the person hears the
 * reason that holds and is not told to wait for data that would change nothing.
 */
function blocker(command: ItemCommand, ctx: ItemCommandContext): Wait | { denied: string } {
  if (!ctx.ready) return ctx.failed ? 'failed' : 'loading';
  const denied = command.denied(ctx);
  if (denied) return { denied };
  const wait = command.loading?.(ctx) ?? null;
  return wait === 'loading' && command.opensWhileLoading ? null : wait;
}

const COMMANDS: ItemCommand[] = [
  { id: 'item.state', icon: CircleDashed, denied: edit, options: stateOptions, placeholder: 'items.commands.placeholder.state', emptyText: stateEmptyText },
  {
    id: 'item.assignee',
    icon: UserRoundPlus,
    keywords: 'items.commands.keywords.assignee',
    loading: people,
    denied: edit,
    options: assigneeOptions,
    placeholder: 'items.commands.placeholder.assignee',
  },
  {
    id: 'item.assign_me',
    icon: UserRoundCheck,
    keywords: 'items.commands.keywords.assignee',
    loading: people,
    // whether the person belongs to the project is known once its people have loaded
    denied: (ctx) => edit(ctx) ?? (ctx.people && !canTakeIt(ctx) ? t('items.commands.not_member') : null),
    act: (ctx) => assign(ctx, ctx.me!),
  },
  { id: 'item.priority', icon: Signal, denied: edit, options: priorityOptions, placeholder: 'items.commands.placeholder.priority' },
  { id: 'item.labels', icon: Tag, denied: edit, options: labelOptions, placeholder: 'items.commands.placeholder.labels' },
  {
    id: 'item.type',
    icon: Shapes,
    // whether the item has children: the two levels decide what it may become
    loading: children,
    denied: single,
    options: typeOptions,
    placeholder: 'items.commands.placeholder.type',
    emptyText: () => t('items.commands.empty.type'),
  },
  {
    id: 'item.due',
    icon: CalendarClock,
    keywords: 'items.commands.keywords.due',
    denied: edit,
    options: (ctx) => dateOptions(ctx, 'due_date'),
    placeholder: 'items.commands.placeholder.due',
  },
  {
    id: 'item.start',
    icon: CalendarArrowUp,
    keywords: 'items.commands.keywords.start',
    denied: edit,
    options: (ctx) => dateOptions(ctx, 'start_date'),
    placeholder: 'items.commands.placeholder.start',
  },
  {
    id: 'item.parent',
    icon: CornerLeftUp,
    keywords: 'items.commands.keywords.parent',
    // the candidates are the epics of the project
    loading: projectItems,
    opensWhileLoading: true,
    denied: (ctx) => single(ctx) ?? parentReason(ctx),
    options: parentOptions,
    placeholder: 'items.fields.parent.placeholder',
    emptyText: parentEmptyText,
  },
];

/** Whether `mod+backspace` archives (see `archivesNow`), else it deletes. */
const archivable = (ctx: ItemCommandContext) => archivesNow(ctx.projects, ctx.workflows, ctx.targets);

/** Why the targets cannot be deleted (project admins only; an archived item can). */
const deleteReason = (ctx: ItemCommandContext) => ctx.targets.map((item) => ctx.reason('item.delete', item.project_id)).find(Boolean) ?? null;

/** Archives the targets: one alone, several with the closed ones leaving the screen at once. */
const archive = (ctx: ItemCommandContext) =>
  archiveTargets(
    ctx.removal,
    ctx.targets,
    ctx.targets.filter((target) => isClosed(ctx, target)),
  );

/** Deletes the targets: one alone (leaving its page), several item by item. */
function remove(ctx: ItemCommandContext): void {
  if (ctx.targets.length === 1) deleteWithUndo(ctx.removal, ctx.targets[0]!);
  else deleteManyWithUndo(ctx.removal, ctx.targets);
}

/** What `mod+backspace` does now: archive closed items, delete others; or why it can do neither. */
function removal(ctx: ItemCommandContext): { run: () => void } | { reason: Exclude<ReturnType<typeof blocker>, null> } {
  if (!ctx.ready) return { reason: ctx.failed ? 'failed' : 'loading' };
  if (archivable(ctx)) {
    const denied = editReason(ctx);
    return denied ? { reason: { denied } } : { run: () => archive(ctx) };
  }
  const denied = deleteReason(ctx);
  return denied ? { reason: { denied } } : { run: () => remove(ctx) };
}

/** Says why a shortcut does nothing now. */
function explain(reason: Exclude<ReturnType<typeof blocker>, null>, retry: () => void): void {
  if (reason === 'loading') toast({ title: t('items.commands.wait.title'), description: LOADING() });
  else if (reason === 'failed')
    toast({ title: t('items.commands.failed.title'), description: FAILED(), tone: 'error', action: { label: t('common.retry'), onClick: retry } });
  else toast({ title: t('items.commands.denied'), description: reason.denied, tone: 'error' });
}

/** A shortcut of the catalog, bound to the item commands of one source. */
function bind(id: ShortcutId, source: ItemCommandSource, run: () => void): () => void {
  const { keys, label, group } = SHORTCUTS[id];
  return registerShortcut({ id, keys, scope: source.scope, label, group, when: () => source.context().targets.length > 0, run });
}

/** The palette commands and shortcuts of one source; answers the function that takes them out again. */
export function registerItemCommands(source: ItemCommandSource): () => void {
  const ctx = () => source.context();
  const offs: (() => void)[] = [];

  for (const command of COMMANDS) {
    const { options, act } = command;
    const def: CommandDef = {
      id: command.id,
      label: t(SHORTCUTS[command.id].label),
      group: source.group,
      keys: SHORTCUTS[command.id].keys,
      icon: createElement(command.icon),
      keywords: command.keywords && [t(command.keywords)],
      when: () => {
        const c = ctx();
        return c.targets.length > 0 && blocker(command, c) === null;
      },
      run: () => act?.(ctx()),
      subpage: options
        ? () => {
            const c = ctx();
            return { placeholder: command.placeholder && t(command.placeholder), emptyText: command.emptyText?.(c), options: options(c) };
          }
        : undefined,
    };
    offs.push(
      registerCommand(def),
      bind(command.id, source, () => {
        const c = ctx();
        const reason = blocker(command, c);
        if (reason) explain(reason, c.retry);
        else if (act) act(c);
        else useUiStore.getState().openPalette(command.id);
      }),
    );
  }

  // archive (closed item) or delete: one key; the palette shows it on the command it does
  offs.push(
    registerCommand({
      id: 'item.archive',
      label: t('items.commands.archive'),
      group: source.group,
      keys: source.archives ? SHORTCUTS['item.remove'].keys : undefined,
      icon: createElement(Archive),
      when: () => {
        const c = ctx();
        return c.ready && c.targets.length > 0 && archivable(c) && editReason(c) === null;
      },
      run: () => archive(ctx()),
    }),
    registerCommand({
      id: 'item.delete',
      label: t('items.commands.delete'),
      group: source.group,
      keys: source.archives ? undefined : SHORTCUTS['item.remove'].keys,
      icon: createElement(Trash2),
      keywords: [t('items.commands.keywords.delete')],
      when: () => {
        const c = ctx();
        return c.ready && c.targets.length > 0 && deleteReason(c) === null;
      },
      run: () => remove(ctx()),
    }),
    bind('item.remove', source, () => {
      const c = ctx();
      const next = removal(c);
      if ('run' in next) next.run();
      else explain(next.reason, c.retry);
    }),
  );

  return () => offs.forEach((off) => off());
}
