/*
 * Mounting contract. A screen mounts the item commands with `useItemCommands`; there are no global item shortcuts.
 *   the preview      mounted by `PeekHost`: <PreviewItemCommands panel={panelRef} />
 *   the item page    useItemCommands({ scope: 'detail', itemId: item.id })
 *   a list or board  useItemCommands({ scope: 'list', current: () => cursorItemId })
 * - `current` answers the item under the list's keyboard cursor, from React state of the screen (see `context.ts`).
 * - A screen that fills `useUiStore.selection` empties it when it unmounts, so no other screen acts on it.
 *
 * Several screens may mount the commands at once (a list, the preview beside it, an item page). Only one of them
 * registers the palette commands and shortcuts: the innermost scope (`detail` before `list`), within it the one mounted
 * last (`activeMount`); when it unmounts the next one takes over. The targets (`context.ts`) take every mount into
 * account. So the palette lists the item commands once and the help shows each key once.
 */

import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useLabels, useResolutions } from '@/hooks/catalog';
import { useSettle } from '@/hooks/mutation';
import { useProjects } from '@/hooks/projects';
import { useProperties } from '@/hooks/properties';
import { useCurrentUser } from '@/hooks/users';
import { useWorkflows } from '@/hooks/workflows';
import { useChangeWorkItemType, useTransitionWorkItem, useUpdateWorkItem, useWorkItem } from '@/hooks/workItems';
import { useWorkItemTypes } from '@/hooks/workItemTypes';
import { t } from '@/lib/i18n';
import { usePermissions } from '@/lib/permissions';
import { useUiStore } from '@/store/ui';
import { subjectOf } from '@/features/items/selection/bulk';
import { useCommonPeople, useToday } from '../itemData';
import { useProjectItems } from '../ParentPicker';
import { useRemovalDeps } from './actions';
import {
  activeMount,
  addMount,
  announceTargets,
  archivesNow,
  cachedItem,
  nextMountId,
  subscribeMounts,
  subscribeTargets,
  targetSnapshot,
  targetsNow,
  type ItemCommandContext,
  type ItemCommandsOptions,
} from './context';
import { registerItemCommands } from './register';

/** Mounts the item commands and their shortcuts for a screen (see the mounting contract at the top of this file). */
export function useItemCommands(options: ItemCommandsOptions): void {
  const [mountId] = useState(nextMountId);
  const latestOptions = useRef(options);
  useLayoutEffect(() => {
    latestOptions.current = options;
    // a cursor that moved changes the targets of every mount: the one that registers hears of it now (13c)
    announceTargets();
  });
  const { scope } = options;
  useEffect(() => addMount(mountId, scope, () => latestOptions.current), [mountId, scope]);
  const active = useSyncExternalStore(subscribeMounts, activeMount, activeMount) === mountId;

  const queryClient = useQueryClient();
  // subscribed, so the palette's heading follows the selection, the preview and the targets of an opening palette
  useUiStore((state) => state.selection);
  useUiStore((state) => state.peekItemId);
  const paletteOpen = useUiStore((state) => state.paletteOpen);
  // and the focus and the other mounts: with the focus inside the preview the targets are the previewed item (rule 1),
  // which may be of another project than what the last render loaded for (the people and the parent's candidates come
  // from the targets' projects); a list's cursor that moved is the target at once
  useSyncExternalStore(subscribeTargets, targetSnapshot, targetSnapshot);
  const projectsQuery = useProjects({ include_archived: true });
  const workflowsQuery = useWorkflows();
  const labelsQuery = useLabels();
  const typesQuery = useWorkItemTypes();
  const propertiesQuery = useProperties();
  const catalogs = [projectsQuery, workflowsQuery, labelsQuery, typesQuery, propertiesQuery];
  const projects = projectsQuery.data?.items;
  const workflows = workflowsQuery.data?.items;
  const labels = labelsQuery.data?.items;
  const types = typesQuery.data?.items;
  const properties = propertiesQuery.data?.items;
  // loaded ahead, so the resolution question opens with its list
  useResolutions();
  const me = useCurrentUser();
  const { reason } = usePermissions();
  const { today } = useToday();
  const settle = useSettle();
  const mutations = { update: useUpdateWorkItem(), transition: useTransitionWorkItem(), changeType: useChangeWorkItemType(), removal: useRemovalDeps() };
  // the rights come from the same projects
  const ready = Boolean(projects && workflows && labels && types && properties && me);
  // a catalog that failed stays failed until asked again: the shortcuts say so instead of "Einen Moment" for ever
  const failedCatalogs = catalogs.filter((query) => query.isError && query.data === undefined);

  // with the options of this render: a page that just got its item would be one render late otherwise
  const { ids, fromList } = targetsNow({ id: mountId, options });
  // the detail of an item page or of the preview is loaded here, so the commands know it even before its screen has;
  // the items of a list are in its pages (`cachedItem`), and their children count is on them
  const detail = useWorkItem(ids.length === 1 && !fromList ? ids[0]! : null).data;
  const shown = ids.flatMap((id) => (detail && (detail.item.id === id || detail.item.key === id) ? [detail.item] : (cachedItem(queryClient, id) ?? [])));
  const single = shown.length === 1 ? shown[0] : undefined;
  const projectIds = [...new Set(shown.map((item) => item.project_id))];
  const peopleQuery = useCommonPeople(projectIds);
  // the items of the project only while the palette is open: ⇧P chooses from them (A153); `t` reads the children of the detail
  const projectItemsQuery = useProjectItems(single?.project_id ?? '', single !== undefined && paletteOpen);
  const people = peopleQuery.people;
  const projectItems = projectItemsQuery.data?.items;
  const retry = () => {
    failedCatalogs.forEach((query) => void query.refetch());
    if (peopleQuery.error) peopleQuery.retry();
    if (projectItemsQuery.isError) void projectItemsQuery.refetch();
  };
  const projectsKey = projectIds.join(' ');

  const context = (): ItemCommandContext => {
    const { ids: now, fromList: listed } = targetsNow();
    const targets = now.flatMap((id) => cachedItem(queryClient, id) ?? []);
    // only the data of the targets' own projects (other targets load theirs on the next render)
    const own = targets.length > 0 && [...new Set(targets.map((item) => item.project_id))].join(' ') === projectsKey;
    const one = own && targets.length === 1 ? targets[0]! : undefined;
    return {
      targets,
      ready,
      failed: failedCatalogs.length > 0,
      // the queries of the latest render: a toast shown earlier also tries what failed since
      retry: () => latestRetry.current(),
      me,
      today,
      projects: projects ?? [],
      workflows: workflows ?? [],
      labels: labels ?? [],
      types: types ?? [],
      properties: properties ?? [],
      people: own ? people : undefined,
      peopleFailed: own && peopleQuery.error !== null && people === undefined,
      // the children: those of the detail of this very target (another detail may still be in `detail`), or for an item
      // of a list its count, which counts archived children too
      hasChildren: one && detail?.item.id === one.id ? detail.children.length > 0 : one && listed ? one.children_progress !== null : undefined,
      projectItems: one ? projectItems : undefined,
      projectItemsFailed: one !== undefined && projectItemsQuery.isError && projectItems === undefined,
      reason: (permission, project) => reason(permission, project),
      ...mutations,
      settle,
    };
  };
  const latest = useRef(context);
  const latestRetry = useRef(retry);
  useLayoutEffect(() => {
    latest.current = context;
    latestRetry.current = retry;
  });

  const group = shown.length > 0 ? t('items.commands.group', { key: subjectOf(shown) }) : t('items.commands.group_none');
  const archives = archivesNow(projects ?? [], workflows ?? [], shown);

  // registered anew when the data a command waits for arrive (or fail), so an open palette shows it then
  const loaded = [ready, failedCatalogs.length, projectsKey, people !== undefined, peopleQuery.error !== null, projectItems !== undefined, projectItemsQuery.isError].join(':');
  useEffect(() => {
    if (!active) return;
    return registerItemCommands({ scope, group, archives, context: () => latest.current() });
  }, [active, scope, group, archives, loaded]);
}
