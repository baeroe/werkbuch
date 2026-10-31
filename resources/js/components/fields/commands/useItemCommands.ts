/*
 * Mounting contract. A screen mounts the item commands with `useItemCommands`; there are no global item shortcuts.
 *   the preview      mounted by `PeekHost`: <PreviewItemCommands panel={panelRef} />
 *   the item page    useItemCommands({ scope: 'detail', itemId: item.id })
 *   a list or board  useItemCommands({ scope: 'list', current: () => cursorItemId })   — Phase 5
 *
 * Several screens may mount the commands at once (the item page and the preview over it). Only one of them registers
 * the palette commands and shortcuts: the one mounted last (`activeMount`); when it unmounts the next one takes over.
 * The targets (`context.ts`) take every mount into account. So the palette lists the item commands once and the help
 * shows each key once.
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
import { useProjectPeople, useToday } from '../itemData';
import { useProjectItems } from '../ParentPicker';
import { useRemovalDeps } from './actions';
import {
  activeMount,
  addMount,
  cachedItem,
  closedIn,
  nextMountId,
  subscribeFocus,
  subscribeMounts,
  targetIds,
  targetSnapshot,
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
  });
  useEffect(() => addMount(mountId, () => latestOptions.current), [mountId]);
  const active = useSyncExternalStore(subscribeMounts, activeMount, activeMount) === mountId;

  const queryClient = useQueryClient();
  // subscribed, so the palette's heading follows the preview and the targets of an opening palette
  useUiStore((state) => state.peekItemId);
  useUiStore((state) => state.paletteOpen);
  // and the focus: with it inside the preview the targets are the previewed item (rule 1), which may be of another
  // project than what the last render loaded for (the people and the parent's candidates come from the target's project)
  useSyncExternalStore(subscribeFocus, targetSnapshot, targetSnapshot);
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
  const ids = targetIds({ id: mountId, options });
  // the target is loaded here, so the commands know it even before its screen has
  const single = useWorkItem(ids[0] ?? null).data?.item;
  const projectId = single?.project_id ?? '';
  const peopleQuery = useProjectPeople(projectId);
  const projectItemsQuery = useProjectItems(projectId, single !== undefined);
  const people = peopleQuery.people;
  const projectItems = projectItemsQuery.data?.items;
  const retry = () => {
    failedCatalogs.forEach((query) => void query.refetch());
    if (peopleQuery.error) peopleQuery.retry();
    if (projectItemsQuery.isError) void projectItemsQuery.refetch();
  };

  const context = (): ItemCommandContext => {
    const now = targetIds().flatMap((id) => cachedItem(queryClient, id) ?? []);
    // only the data of the target's own project (another target loads its project on the next render)
    const own = now.length === 1 && now[0]!.project_id === projectId;
    return {
      targets: now,
      ready,
      failed: failedCatalogs.length > 0,
      retry,
      me,
      today,
      projects: projects ?? [],
      workflows: workflows ?? [],
      labels: labels ?? [],
      types: types ?? [],
      properties: properties ?? [],
      people: own ? people : undefined,
      peopleFailed: own && peopleQuery.error !== null && people === undefined,
      projectItems: own ? projectItems : undefined,
      projectItemsFailed: own && projectItemsQuery.isError && projectItems === undefined,
      reason: (permission, project) => reason(permission, project),
      ...mutations,
      settle,
    };
  };
  const latest = useRef(context);
  useLayoutEffect(() => {
    latest.current = context;
  });

  const group = single ? t('items.commands.group', { key: single.key }) : t('items.commands.group_none');
  const archives = single !== undefined && single.archived_at === null && closedIn(projects ?? [], workflows ?? [], single);

  // registered anew when the data a command waits for arrive (or fail), so an open palette shows it then
  const loaded = [ready, failedCatalogs.length, projectId, people !== undefined, peopleQuery.error !== null, projectItems !== undefined, projectItemsQuery.isError].join(':');
  const { scope } = options;
  useEffect(() => {
    if (!active) return;
    return registerItemCommands({ scope, group, archives, context: () => latest.current() });
  }, [active, scope, group, archives, loaded]);
}
