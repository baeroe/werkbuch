/*
 * What the item commands work with: the items they act on (the targets) and the data they read when they run.
 *
 * The targets, decided when a shortcut is pressed or the palette opens; while the palette is open (it holds the focus)
 * they stay as they were when it opened:
 *   1. the focus is inside the preview panel: the previewed item (`peekItemId`)
 *   2. an item page is mounted: its item
 *   3. the selection of a list (`useUiStore.selection`), when there is one and a list is mounted
 *   4. the item under a list's keyboard cursor (`current`)
 *   5. the previewed item
 * So the keys the preview's fields advertise change the item it shows, and a selection changes as a whole from the list.
 */

import type { QueryClient } from '@tanstack/react-query';
import type { Page } from '@/api/client';
import type { RefObject } from 'react';
import { isClosedCategory } from '@/domain/workflow';
import { qk } from '@/hooks/keys';
import type { Settle } from '@/hooks/mutation';
import type { useChangeWorkItemType, useTransitionWorkItem, useUpdateWorkItem } from '@/hooks/workItems';
import type { Permission } from '@/lib/permissions';
import { useUiStore } from '@/store/ui';
import type { Label, ListedItem, Project, Property, User, Workflow, WorkItemDetail, WorkItemType } from '@/types';
import { archivedReason } from '../itemData';
import type { RemovalDeps } from './actions';

/** The shortcut scope of the item commands: `detail` (item page, preview) beats `list`. */
export type ItemCommandScope = 'detail' | 'list';

export interface ItemCommandsOptions {
  scope: ItemCommandScope;
  /** The item page: its item, by id or key (rule 2 at the top). */
  itemId?: string | null;
  /** The preview: its panel; while the focus is inside, the commands act on the previewed item (rule 1). */
  panel?: RefObject<HTMLElement | null>;
  /**
   * A list: the item under its keyboard cursor (rule 4), or null. It reads React state of the screen, not a ref that
   * changes without a render: the hook calls it while rendering and again whenever a command runs.
   */
  current?: () => string | null;
}

/** What the commands read and do when they run; the hook hands in the latest of it. */
export interface ItemCommandContext {
  /** The items to act on: none, one, or the selection of a list. */
  targets: ListedItem[];
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
  /** Who can take every target (`projectPeople` of each of their projects), once loaded. */
  people: User[] | undefined;
  /** They failed to load. */
  peopleFailed: boolean;
  /** Whether the target has children (archived ones too, as the server counts them), from its detail. */
  hasChildren: boolean | undefined;
  /** The items of the target's project, for the parent, once loaded (only while the palette is open). */
  projectItems: ListedItem[] | undefined;
  /** They failed to load. */
  projectItemsFailed: boolean;
  reason: (permission: Permission, projectId: string) => string | null;
  update: ReturnType<typeof useUpdateWorkItem>;
  transition: ReturnType<typeof useTransitionWorkItem>;
  changeType: ReturnType<typeof useChangeWorkItemType>;
  /** Archiving and deleting with undo, and the bulk edit of several targets (`actions.ts`). */
  removal: RemovalDeps;
  /** The answer of one call (`mutateAsync`), also when several overlap (see `useSettle`). */
  settle: Settle;
}

/** One mount of the commands, as the registration sees it. */
export interface ItemCommandSource {
  scope: ItemCommandScope;
  /** Heading in the palette, e.g. "Aktionen für WEB-47". */
  group: string;
  /** Whether `mod+backspace` archives (`archivesNow`) rather than deletes; it decides which command shows the key. */
  archives: boolean;
  context: () => ItemCommandContext;
}

/* ------------------------------------------------------------------- rules on the targets */

/** The state of an item in the workflow of its project. */
export function stateIn(projects: readonly Project[], workflows: readonly Workflow[], item: ListedItem) {
  const project = projects.find((entry) => entry.id === item.project_id);
  return workflows.find((workflow) => workflow.id === project?.workflow_id)?.states.find((state) => state.id === item.state_id);
}

export const workflowOf = (ctx: ItemCommandContext, item: ListedItem) => {
  const project = ctx.projects.find((entry) => entry.id === item.project_id);
  return ctx.workflows.find((workflow) => workflow.id === project?.workflow_id);
};
export const stateOf = (ctx: ItemCommandContext, item: ListedItem) => stateIn(ctx.projects, ctx.workflows, item);
/** Whether the item stands in a Completed or Canceled state (it archives rather than deletes). */
export const isClosed = (ctx: ItemCommandContext, item: ListedItem) => closedIn(ctx.projects, ctx.workflows, item);
export function closedIn(projects: readonly Project[], workflows: readonly Workflow[], item: ListedItem): boolean {
  const state = stateIn(projects, workflows, item);
  return state !== undefined && isClosedCategory(state.category);
}

/**
 * Whether `mod+backspace` archives rather than deletes: one target that is closed and not archived; of several, none is
 * archived and some are closed (the open ones stay, and the toast names them).
 */
export function archivesNow(projects: readonly Project[], workflows: readonly Workflow[], targets: readonly ListedItem[]): boolean {
  if (targets.length === 0 || targets.some((item) => item.archived_at !== null)) return false;
  const closed = targets.filter((item) => closedIn(projects, workflows, item));
  return targets.length === 1 ? closed.length === 1 : closed.length > 0;
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
  scope: ItemCommandScope;
  options: () => ItemCommandsOptions;
}

let mounts: Mount[] = [];
let mountCounter = 0;
const mountListeners = new Set<() => void>();
const mountsChanged = () => mountListeners.forEach((listener) => listener());

/** A new mount id, taken when the screen first renders. */
export const nextMountId = (): number => ++mountCounter;

/** Adds a mount; answers the function that takes it out again. */
export function addMount(id: number, scope: ItemCommandScope, options: () => ItemCommandsOptions): () => void {
  mounts = [...mounts, { id, scope, options }];
  mountsChanged();
  return () => {
    mounts = mounts.filter((mount) => mount.id !== id);
    mountsChanged();
  };
}

const SCOPE_RANK: Record<ItemCommandScope, number> = { list: 1, detail: 2 };

/**
 * The mount that registers the palette commands and shortcuts: the innermost scope (`detail` before `list`), within a
 * scope the one mounted last (the preview over the item page).
 */
export function activeMount(): number | null {
  const best = mounts.reduce<Mount | null>((winner, mount) => (!winner || SCOPE_RANK[mount.scope] >= SCOPE_RANK[winner.scope] ? mount : winner), null);
  return best?.id ?? null;
}

export function subscribeMounts(listener: () => void): () => void {
  mountListeners.add(listener);
  return () => {
    mountListeners.delete(listener);
  };
}

/** The ids the commands act on, and whether a list gave them (rules 3 and 4: no detail is loaded for them). */
export interface Targets {
  ids: string[];
  fromList: boolean;
}

/**
 * The targets right now, by the rules at the top of this file. A mount that is rendering passes its options of this
 * render as `own`: its ref takes them only after the render.
 */
function currentTargets(own?: { id: number; options: ItemCommandsOptions }): Targets {
  const ui = useUiStore.getState();
  const focus = document.activeElement;
  const newestFirst = [...mounts].reverse().map((mount) => (mount.id === own?.id ? own.options : mount.options()));
  if (ui.peekItemId && newestFirst.some((options) => options.panel?.current?.contains(focus) ?? false)) return { ids: [ui.peekItemId], fromList: false };
  const page = newestFirst.find((options) => options.itemId)?.itemId;
  if (page) return { ids: [page], fromList: false };
  // only the selection of a list on screen (the list empties it when it goes)
  if (ui.selection.length > 0 && newestFirst.some((options) => options.scope === 'list')) return { ids: ui.selection, fromList: true };
  for (const options of newestFirst) {
    const cursor = options.current?.();
    if (cursor) return { ids: [cursor], fromList: true };
  }
  return { ids: ui.peekItemId ? [ui.peekItemId] : [], fromList: false };
}

/**
 * Whether the preview's own keys (`e`) act now, by the rules at the top: the focus inside the panel always (rule 1);
 * otherwise only when no item page (rule 2), no selection (rule 3) and no list's cursor (rule 4) outranks the previewed
 * item and the focus is nowhere in particular (rule 5), so the screen beside the preview keeps its keys.
 */
export function previewKeysAct(panel: RefObject<HTMLElement | null> | undefined): boolean {
  const focus = document.activeElement;
  if (panel?.current && focus && panel.current.contains(focus)) return true;
  const outranked = mounts.some((mount) => {
    const options = mount.options();
    return Boolean(options.itemId) || Boolean(options.current?.());
  });
  if (outranked || useUiStore.getState().selection.length > 0) return false;
  return !focus || focus === document.body || focus.id === 'main';
}

/** The targets of the moment the palette opened: it takes the focus, so asking again would lose the preview. */
let paletteTargets: Targets | null = null;
useUiStore.subscribe((state, previous) => {
  if (state.paletteOpen && !previous.paletteOpen) paletteTargets = currentTargets();
  else if (!state.paletteOpen) paletteTargets = null;
});

/** The targets now: those of the open palette, or by the rules (with the options of a mount that is rendering). */
export const targetsNow = (own?: { id: number; options: ItemCommandsOptions }): Targets => paletteTargets ?? currentTargets(own);

/** The ids of the targets now. */
const targetIds = (own?: { id: number; options: ItemCommandsOptions }): string[] => targetsNow(own).ids;

/** The targets as one value, for `useSyncExternalStore`: a mount renders again when they change. */
export const targetSnapshot = (): string => targetIds().join(' ');

const targetListeners = new Set<() => void>();
let announced = '';

/**
 * A mount rendered with new options (a list's cursor moved): the other mounts hear of it at once when that changed the
 * targets, so the one that registers loads what the new target needs now and not one render late (13c: ⇧P on a board).
 */
export function announceTargets(): void {
  const now = targetSnapshot();
  if (now === announced) return;
  announced = now;
  targetListeners.forEach((listener) => listener());
}

/**
 * Calls back when the targets may have changed: the focus moved (in, and out once it has settled, which a focusout does
 * not see yet), or a mount announced new options.
 */
export function subscribeTargets(listener: () => void): () => void {
  const settled = () => queueMicrotask(listener);
  document.addEventListener('focusin', listener);
  document.addEventListener('focusout', settled);
  targetListeners.add(listener);
  return () => {
    document.removeEventListener('focusin', listener);
    document.removeEventListener('focusout', settled);
    targetListeners.delete(listener);
  };
}

/* ---------------------------------------------------------------------------- the cache */

const isDetail = (data: unknown): data is WorkItemDetail => typeof data === 'object' && data !== null && 'item' in data && 'workflow' in data;

const isPage = (data: unknown): data is Page<ListedItem> => typeof data === 'object' && data !== null && Array.isArray((data as Page<ListedItem>).items);

/**
 * An item from the cache, by id or key: its detail (which the mount loads for an item page or the preview), else the
 * pages of the lists it is in, so a selection or a list's cursor acts without loading a detail.
 */
export function cachedItem(queryClient: QueryClient, ref: string): ListedItem | undefined {
  const cached = queryClient.getQueriesData<unknown>({ queryKey: qk.workItems.all }).map(([, data]) => data);
  const matches = (item: ListedItem) => item.id === ref || item.key === ref;
  return cached.flatMap((data) => (isDetail(data) ? [data.item] : [])).find(matches) ?? cached.flatMap((data) => (isPage(data) ? data.items : [])).find(matches);
}
