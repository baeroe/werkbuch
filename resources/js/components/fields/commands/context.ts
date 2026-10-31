/*
 * What the item commands work with: the items they act on (the targets) and the data they read when they run.
 *
 * The targets, decided when a shortcut is pressed or the palette opens; while the palette is open (it holds the focus)
 * they stay as they were when it opened:
 *   1. the focus is inside the preview panel: the previewed item (`peekItemId`)
 *   2. an item page is mounted: its item
 *   3. the selection of a list (`useUiStore.selection`), when there is one        — with the lists (Phase 5)
 *   4. the item under a list's keyboard cursor (`current`)                       — with the lists (Phase 5)
 *   5. the previewed item
 * So the keys the preview's fields advertise change the item it shows. In Phase 4 there is at most one target (K17);
 * `targets` stays a list, so the selection of Phase 5 fits in.
 */

import type { QueryClient } from '@tanstack/react-query';
import type { RefObject } from 'react';
import { isClosedCategory } from '@/domain/workflow';
import { qk } from '@/hooks/keys';
import type { Settle } from '@/hooks/mutation';
import type { useChangeWorkItemType, useTransitionWorkItem, useUpdateWorkItem } from '@/hooks/workItems';
import type { Permission } from '@/lib/permissions';
import { useUiStore } from '@/store/ui';
import type { Label, Project, Property, User, Workflow, WorkItem, WorkItemDetail, WorkItemType } from '@/types';
import { archivedReason } from '../itemData';
import type { RemovalDeps } from './actions';

/** The shortcut scope of the item commands; the lists of Phase 5 add `list`, which `detail` beats. */
export type ItemCommandScope = 'detail';

export interface ItemCommandsOptions {
  scope: ItemCommandScope;
  /** The item page: its item, by id or key (rule 2 at the top). */
  itemId?: string | null;
  /** The preview: its panel; while the focus is inside, the commands act on the previewed item (rule 1). */
  panel?: RefObject<HTMLElement | null>;
}

/** What the commands read and do when they run; the hook hands in the latest of it. */
export interface ItemCommandContext {
  /** The items to act on: none or one in Phase 4. */
  targets: WorkItem[];
  /** The catalogs the commands read have loaded (projects, workflows, labels, types, properties, rights, me). */
  ready: boolean;
  /** One of them failed to load; `retry` asks for it again (and for what the target's project failed to give). */
  failed: boolean;
  retry: () => void;
  me: User | undefined;
  /** Today in the organisation's time zone. */
  today: string;
  projects: Project[];
  workflows: Workflow[];
  labels: Label[];
  types: WorkItemType[];
  properties: Property[];
  /** Who can take the target (`projectPeople` of its project), once loaded. */
  people: User[] | undefined;
  /** They failed to load. */
  peopleFailed: boolean;
  /** The items of the target's project, for the parent and the two levels, once loaded. */
  projectItems: WorkItem[] | undefined;
  /** They failed to load. */
  projectItemsFailed: boolean;
  reason: (permission: Permission, projectId: string) => string | null;
  update: ReturnType<typeof useUpdateWorkItem>;
  transition: ReturnType<typeof useTransitionWorkItem>;
  changeType: ReturnType<typeof useChangeWorkItemType>;
  /** Archiving and deleting with undo (`actions.ts`). */
  removal: RemovalDeps;
  /** The answer of one call (`mutateAsync`), also when several overlap (see `useSettle`). */
  settle: Settle;
}

/** One mount of the commands, as the registration sees it. */
export interface ItemCommandSource {
  scope: ItemCommandScope;
  /** Heading in the palette, e.g. "Aktionen für WEB-47". */
  group: string;
  /** Whether `mod+backspace` archives (the target is closed) rather than deletes; it decides which command shows the key. */
  archives: boolean;
  context: () => ItemCommandContext;
}

/* ------------------------------------------------------------------- rules on the targets */

/** The state of an item in the workflow of its project. */
export function stateIn(projects: readonly Project[], workflows: readonly Workflow[], item: WorkItem) {
  const project = projects.find((entry) => entry.id === item.project_id);
  return workflows.find((workflow) => workflow.id === project?.workflow_id)?.states.find((state) => state.id === item.state_id);
}

export const workflowOf = (ctx: ItemCommandContext, item: WorkItem) => {
  const project = ctx.projects.find((entry) => entry.id === item.project_id);
  return ctx.workflows.find((workflow) => workflow.id === project?.workflow_id);
};
export const stateOf = (ctx: ItemCommandContext, item: WorkItem) => stateIn(ctx.projects, ctx.workflows, item);
/** Whether the item stands in a Completed or Canceled state (it archives rather than deletes). */
export const isClosed = (ctx: ItemCommandContext, item: WorkItem) => closedIn(ctx.projects, ctx.workflows, item);
export function closedIn(projects: readonly Project[], workflows: readonly Workflow[], item: WorkItem): boolean {
  const state = stateIn(projects, workflows, item);
  return state !== undefined && isClosedCategory(state.category);
}

/** Why the targets cannot be changed: one is archived, or a right is missing in its project. */
export function editReason(ctx: ItemCommandContext, permission: Permission = 'item.edit'): string | null {
  for (const item of ctx.targets) {
    if (item.archived_at !== null) return archivedReason(item.key);
    const denied = ctx.reason(permission, item.project_id);
    if (denied) return denied;
  }
  return null;
}

/* --------------------------------------------------------------------------- the mounts */

/** A screen that mounts the commands, with the latest options it rendered. */
interface Mount {
  id: number;
  options: () => ItemCommandsOptions;
}

let mounts: Mount[] = [];
let mountCounter = 0;
const mountListeners = new Set<() => void>();
const mountsChanged = () => mountListeners.forEach((listener) => listener());

/** A new mount id, taken when the screen first renders. */
export const nextMountId = (): number => ++mountCounter;

/** Adds a mount; answers the function that takes it out again. */
export function addMount(id: number, options: () => ItemCommandsOptions): () => void {
  mounts = [...mounts, { id, options }];
  mountsChanged();
  return () => {
    mounts = mounts.filter((mount) => mount.id !== id);
    mountsChanged();
  };
}

/**
 * The mount that registers the palette commands and shortcuts: the one mounted last (the preview over the item page).
 * The lists of Phase 5 rank below them (`detail` before `list`).
 */
export function activeMount(): number | null {
  return mounts.at(-1)?.id ?? null;
}

export function subscribeMounts(listener: () => void): () => void {
  mountListeners.add(listener);
  return () => {
    mountListeners.delete(listener);
  };
}

/**
 * The ids the commands act on right now, by the rules at the top of this file. A mount that is rendering passes its
 * options of this render as `own`: its ref takes them only after the render.
 */
function currentTargetIds(own?: { id: number; options: ItemCommandsOptions }): string[] {
  const ui = useUiStore.getState();
  const focus = document.activeElement;
  const newestFirst = [...mounts].reverse().map((mount) => (mount.id === own?.id ? own.options : mount.options()));
  if (ui.peekItemId && newestFirst.some((options) => options.panel?.current?.contains(focus) ?? false)) return [ui.peekItemId];
  const page = newestFirst.find((options) => options.itemId)?.itemId;
  if (page) return [page];
  return ui.peekItemId ? [ui.peekItemId] : [];
}

/** The targets of the moment the palette opened: it takes the focus, so asking again would lose the preview. */
let paletteTargets: string[] | null = null;
useUiStore.subscribe((state, previous) => {
  if (state.paletteOpen && !previous.paletteOpen) paletteTargets = currentTargetIds();
  else if (!state.paletteOpen) paletteTargets = null;
});

/** The targets now: those of the open palette, or by the rules (with the options of a mount that is rendering). */
export const targetIds = (own?: { id: number; options: ItemCommandsOptions }): string[] => paletteTargets ?? currentTargetIds(own);

/** The targets as one value, for `useSyncExternalStore`: a mount renders again when they change with the focus. */
export const targetSnapshot = (): string => targetIds().join(' ');

/** Calls back when the focus moved: in, and out (once the focus has settled, which a focusout does not see yet). */
export function subscribeFocus(listener: () => void): () => void {
  const settled = () => queueMicrotask(listener);
  document.addEventListener('focusin', listener);
  document.addEventListener('focusout', settled);
  return () => {
    document.removeEventListener('focusin', listener);
    document.removeEventListener('focusout', settled);
  };
}

/* ---------------------------------------------------------------------------- the cache */

const isDetail = (data: unknown): data is WorkItemDetail => typeof data === 'object' && data !== null && 'item' in data && 'workflow' in data;

/**
 * An item from the cache, by id or key: its detail, which the mount loads (`useWorkItem`). The lists of Phase 5 add
 * the items of a list, so a selection acts before its details load.
 */
export function cachedItem(queryClient: QueryClient, ref: string): WorkItem | undefined {
  const details = queryClient.getQueriesData<unknown>({ queryKey: qk.workItems.all }).flatMap(([, data]) => (isDetail(data) ? [data.item] : []));
  return details.find((item) => item.id === ref || item.key === ref);
}
