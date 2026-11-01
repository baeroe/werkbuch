/*
 * The data of an item list: its groups from the server and the pages of each group, in the shape the layouts read
 * (`GroupData`, layouts.ts). The server filters, sorts, groups and counts (P1, P14):
 *
 * - Grouped: `/groups` (`useWorkItemGroups`) answers the keys in their order, the counts and the grouping that holds
 *   (`state` became `category` when the items span several workflows). The pages of each group ask for that grouping,
 *   never the chosen one (K17), and wait for it. Without grouping there is one group, `all`, its count the `total` of
 *   its first page; no `/groups` for it.
 * - A group loads its pages once the layout enables it (its heading or column came into view, `enable()`), lean
 *   (`ListedItem`) and with the sub-items of the state. `placeItems` puts the loaded items where they belong after an
 *   optimistic change and corrects the counts of the server by the difference (P24).
 * - The order of the groups is the server's. Without a named project a grouping by type has only the types that occur
 *   (not every active type, as in the clickdummy): the list shows the groups the server answered, in its order (T8-M6).
 * - The names of the groups come from the catalogs (`groupLabel`); the list waits for them, so no group is named
 *   "Unknown" for a moment (T13-M6).
 * - A new filter, sort or grouping keeps the groups of the old one until its own answer is there: the groups, and the
 *   first page of every group that was loading before (a group stays enabled by its key). No flash of the loading
 *   state. An error of a later page or of a refetch keeps what is loaded (13c); only a list without an answer at all
 *   shows the error.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ApiError } from '@/api/client';
import type { ListWorkItemsArgs } from '@/api/workItems';
import { placeItems } from '@/domain/grouping';
import type { ItemsPreset, ViewState } from '@/domain/viewState';
import { useLabels } from '@/hooks/catalog';
import { useProjects } from '@/hooks/projects';
import { useAllUsers } from '@/hooks/users';
import { ALL_GROUP, ListGoneError, useGroupedWorkItems, useWorkItemGroups, type InfiniteWorkItems } from '@/hooks/workItems';
import { useWorkflows } from '@/hooks/workflows';
import { useWorkItemTypes } from '@/hooks/workItemTypes';
import type { Condition, GroupBy, GroupCount, ListedItem, Project, StateCategory } from '@/types';
import { groupLabel, type GroupCatalogs } from './display/groupLabels';
import { isComplete } from './filter/fieldOps';
import type { GroupData } from './layouts';

export interface ListData {
  groups: GroupData[];
  /** The grouping that holds (the server's), `none` without grouping. */
  groupBy: GroupBy;
  /** Grouped by category although the list asked for the status: the items have several workflows. */
  fellBack: boolean;
  /** Every match of the list, also of the pages not loaded yet. */
  total: number;
  status: 'pending' | 'error' | 'success';
  error: ApiError | null;
  retry(): void;
  /** Every item of the list (⌘A); rejects with `ListGoneError` when the list changed or unmounted meanwhile. */
  loadAll(): Promise<ListedItem[]>;
  /** The loaded items, each once. */
  items: ListedItem[];
  /** What shows is the answer of the current state (not the groups of the old one, kept until the new answer is there). */
  current: boolean;
}

type Shown = Omit<ListData, 'retry' | 'loadAll' | 'current'>;

const EMPTY: Shown = { groups: [], groupBy: 'none', fellBack: false, total: 0, status: 'pending', error: null, items: [] };

export function useListData(state: ViewState, scope: Condition[], _options: { preset: ItemsPreset; project?: Project }): ListData {
  const { display } = state;
  const chosen = display.group_by;
  const grouped = chosen !== 'none';
  const common = useMemo(
    // an unfinished condition of the filter bar (a chip still without its value) never goes to the server
    () => ({ filter: { version: 1 as const, conditions: [...scope, ...state.filter.conditions.filter(isComplete)] }, sort: display.sort, show_sub_items: display.show_sub_items }),
    [scope, state.filter.conditions, display.sort, display.show_sub_items],
  );
  const argsKey = JSON.stringify([common, chosen]);

  /* ----------------------------------------------------------------------- groups */

  const answer = useWorkItemGroups(grouped ? { ...common, group_by: chosen } : null);
  const effective: GroupBy | undefined = grouped ? answer.data?.group_by : 'none';

  // the groups that may load, by key: a group the layout enabled stays so for the next state (its rows stay until then)
  const [enabled, setEnabled] = useState<ReadonlySet<string>>(() => new Set());
  const enable = useCallback((key: string) => setEnabled((current) => (current.has(key) ? current : new Set([...current, key]))), []);

  const listArgs = useMemo<ListWorkItemsArgs>(
    () => ({ ...common, lean: true, ...(effective !== undefined && effective !== 'none' ? { group_by: effective } : {}) }),
    [common, effective],
  );
  const keys = grouped ? (answer.data?.groups.map((group) => group.key) ?? null) : [ALL_GROUP];
  const pages = useGroupedWorkItems(listArgs, keys, grouped ? enabled : 'all');

  /* --------------------------------------------------------------------- catalogs */

  const workflows = useWorkflows();
  const projects = useProjects({ include_archived: true });
  const types = useWorkItemTypes();
  const labels = useLabels();
  const users = useAllUsers();
  const catalogs = [workflows, projects, types, labels, users];
  const catalogsReady = catalogs.every((query) => query.data !== undefined);

  const categories = useMemo(() => {
    const map = new Map<string, StateCategory>();
    for (const workflow of workflows.data?.items ?? []) for (const state of workflow.states) map.set(state.id, state.category);
    return map;
  }, [workflows.data]);
  const names = useMemo<GroupCatalogs>(
    () => ({
      workflows: workflows.data?.items ?? [],
      projects: projects.data?.items ?? [],
      types: types.data?.items ?? [],
      labels: labels.data?.items ?? [],
      users: users.data?.items ?? [],
    }),
    [workflows.data, projects.data, types.data, labels.data, users.data],
  );

  /* ------------------------------------------------------------------- the result */

  const all = pages[ALL_GROUP];
  const served: GroupCount[] | undefined = grouped ? answer.data?.groups : all?.data ? [{ key: ALL_GROUP, count: all.data.total }] : undefined;

  const fresh = useMemo<Shown>(() => {
    if (served === undefined || effective === undefined || !catalogsReady) return EMPTY;
    const listOf = (key: string): InfiniteWorkItems | undefined => pages[key];
    const placement = placeItems(
      served.map((group) => ({ key: group.key, items: listOf(group.key)?.data?.items ?? [] })),
      effective,
      display.sort,
      { stateCategory: (stateId) => categories.get(stateId) ?? 'backlog' },
    );
    const groups = served.map((group): GroupData => {
      const list = listOf(group.key);
      const on = !grouped || enabled.has(group.key);
      return {
        key: group.key,
        label: groupLabel(effective, group.key, names, group.item),
        count: Math.max(0, group.count + (placement.delta.get(group.key) ?? 0)),
        ...(group.item !== undefined && { item: group.item }),
        items: placement.items.get(group.key) ?? [],
        status: !on ? 'idle' : list?.data ? 'success' : list?.isError ? 'error' : 'pending',
        hasMore: list?.hasMore ?? false,
        loadingMore: list?.loadingMore ?? false,
        moreError: (list?.moreError ?? null) as ApiError | null,
        enable: () => enable(group.key),
        loadMore: () => list?.loadMore(),
        retry: () => {
          if (list?.data) list.loadMore();
          else void list?.refetch();
        },
      };
    });
    const seen = new Set<string>();
    const items = groups.flatMap((group) => group.items).filter((item) => !seen.has(item.id) && seen.add(item.id));
    return {
      groups,
      groupBy: effective,
      fellBack: chosen === 'state' && effective === 'category',
      total: grouped ? answer.data!.total : all!.data!.total,
      status: 'success',
      error: null,
      items,
    };
  }, [served, effective, catalogsReady, pages, display.sort, categories, grouped, enabled, names, enable, chosen, answer.data, all]);

  // the answer of the current state is there: the groups, and the first page of each group that loads
  const settled = fresh.status === 'success' && fresh.groups.every((group) => group.status !== 'pending' || group.count === 0);
  const failure = (grouped && !answer.data ? answer.error : null) ?? (!grouped && !all?.data ? all?.error : null) ?? catalogs.find((query) => query.isError && !query.data)?.error ?? null;

  const last = useRef<{ shown: Shown; key: string } | null>(null);
  let shown: Shown;
  if (failure) shown = { ...EMPTY, status: 'error', error: failure as ApiError };
  else if (settled) {
    shown = fresh;
    last.current = { shown, key: argsKey };
  } else shown = last.current?.shown ?? EMPTY;
  const current = !failure && settled;

  /* ------------------------------------------------------------------------ acting */

  const latestKey = useRef(argsKey);
  latestKey.current = argsKey;
  // a list that unmounted while ⌘A loaded: its items must not reach the selection of whatever screen comes next
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const retry = () => {
    if (answer.isError) void answer.refetch();
    if (all?.isError && !all.data) void all.refetch();
    catalogs.filter((query) => query.isError).forEach((query) => void query.refetch());
  };

  const loadAll = useCallback(async () => {
    const asked = argsKey;
    const lists = (served ?? []).filter((group) => group.count > 0).flatMap((group) => (pages[group.key] ? [pages[group.key]!] : []));
    const loaded = await Promise.all(lists.map((list) => list.loadAll()));
    // the list changed or went away meanwhile: its items are of no use
    if (!mounted.current || latestKey.current !== asked) throw new ListGoneError();
    const seen = new Set<string>();
    return loaded.flat().filter((item) => !seen.has(item.id) && seen.add(item.id));
  }, [argsKey, served, pages]);

  return { ...shown, current, retry, loadAll };
}
