/*
 * The item lists (spec 4.11, 5.2): the items of a project, "Meine Items" (zugewiesen, erstellt, beobachtet) and the
 * team's views. One screen for all of them:
 * - The header names the list (with the star of a project or view) and switches the layout (1–4).
 * - The toolbar sticks to the top: the filter bar, and below it the bulk bar while items are selected (so `/`, `f`,
 *   "Anzeige" and "Neues Item" stay within reach during a selection).
 * - Below it: "Ungespeicherte Änderungen" when the list differs from its base, a hint when the status grouping fell
 *   back to the categories, then the layout (display/layouts.ts) or the empty, loading or error state.
 *
 * One polite status region ("Mitteilungen der Liste") announces what changes without the focus moving: the selection
 * ("WEB-47 ausgewählt, 3 von 21", "Auswahl aufgehoben") and the results of a new filter ("2 Items", "Kein Item passt
 * zum Filter"). Spec 5.1, WCAG 4.1.3.
 *
 * The state (filter and display) is in the URL (viewState.ts), so links share it and Back restores it. The router
 * mounts the screen anew for every list (routes.tsx), so cursor and selection never leak into the next one.
 * The list instance of the item commands is mounted here, for every layout: `useItemCommands({ scope: 'list',
 * current })` with the cursor as React state; the selection (`useUiStore.selection`) is emptied when the screen goes.
 */

import { ChartGantt, ChevronRight, FunnelX, Info, List, Plus, SquareKanban, Star, Table2 } from 'lucide-react';
import { Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { NotFound } from '@/app/PageStates';
import { useItemCommands } from '@/components/fields/commands';
import { Button, buttonClass } from '@/components/ui/Button';
import { cx } from '@/components/ui/cx';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { IconButton } from '@/components/ui/IconButton';
import { ProjectBadge } from '@/components/ui/ProjectBadge';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { Skeleton, SkeletonGroup } from '@/components/ui/Skeleton';
import { toast } from '@/components/ui/toast';
import { ViewIcon } from '@/components/ui/ViewIcon';
import { groupItems } from '@/domain/grouping';
import { isClosedCategory } from '@/domain/workflow';
import { useLabels } from '@/hooks/catalog';
import { useOrganization } from '@/hooks/organization';
import { useProjects } from '@/hooks/projects';
import { useProperties } from '@/hooks/properties';
import { useUsers } from '@/hooks/users';
import { useFavorites, useSaveView, useToggleFavorite, useViews } from '@/hooks/views';
import { useWorkflows } from '@/hooks/workflows';
import { useBulkUpdateWorkItems, useFilterContext, useWorkItemMeta, useWorkItems } from '@/hooks/workItems';
import { useWorkItemTypes } from '@/hooks/workItemTypes';
import { notifyError } from '@/lib/errors';
import { usePermissions } from '@/lib/permissions';
import { registerShortcut } from '@/lib/shortcuts/registry';
import { useShortcut } from '@/lib/shortcuts/useShortcut';
import { runWithUndo, UNDO_LABEL } from '@/lib/undo';
import { useDocumentTitle } from '@/lib/useDocumentTitle';
import { useSession } from '@/store/session';
import { useUiStore, type CreateDefaults } from '@/store/ui';
import type { Display, Filter, Project, View, WorkItem } from '@/types';
import { DisplayMenu } from './display/DisplayMenu';
import { effectiveGrouping, groupContext } from './display/grouping';
import { LAYOUT_OPTIONS, layouts, type LayoutProps } from './display/layouts';
import { FilterBar } from './filter/FilterBar';
import { isComplete } from './filter/fieldOps';
import { SaveAsDialog, UnsavedBar } from './SaveView';
import { BulkBar, bulkToast, subjectOf } from './selection/BulkBar';
import {
  applyViewState,
  decodeViewState,
  encodeViewState,
  hasUnsavedChanges,
  presetState,
  sameFilter,
  scopeConditions,
  VIEW_STATE_PARAMS,
  viewStateOf,
  type ItemsPreset,
  type ViewState,
} from './viewState';

export type ItemsScreenProps = {
  preset: ItemsPreset;
  /** `/projects/:identifier`. */
  projectIdentifier?: string;
  /** `/views/:viewId`. */
  viewId?: string;
};

const LAYOUT_ICONS = { list: List, board: SquareKanban, table: Table2, timeline: ChartGantt };

/** The three lists of "Meine Items" share the sidebar entry; tabs switch between them. */
const MY_TABS: { preset: ItemsPreset; to: string; label: string; title: string }[] = [
  { preset: 'my', to: '/my-items', label: 'Zugewiesen', title: 'Meine Items' },
  { preset: 'created', to: '/created', label: 'Erstellt', title: 'Von mir erstellt' },
  { preset: 'subscribed', to: '/subscribed', label: 'Beobachtet', title: 'Beobachtet' },
];

const count = new Intl.NumberFormat('de-DE');

/** What a change of the selection says: "WEB-47 ausgewählt, 3 von 21", "Auswahl aufgehoben"; null for no change. */
export function selectionMessage(before: readonly string[], after: readonly string[], items: readonly WorkItem[]): string | null {
  const keyOf = (id: string) => items.find((item) => item.id === id)?.key ?? 'Ein Item';
  const added = after.filter((id) => !before.includes(id));
  const removed = before.filter((id) => !after.includes(id));
  const of = `${count.format(after.length)} von ${count.format(items.length)}`;
  if (added.length === 0 && removed.length === 0) return null;
  if (after.length === 0) return 'Auswahl aufgehoben';
  if (added.length === 1 && removed.length === 0) return `${keyOf(added[0])} ausgewählt, ${of}`;
  if (removed.length === 1 && added.length === 0) return `${keyOf(removed[0])} abgewählt, ${of}`;
  if (after.length === items.length && added.length > 0) return `Alle ${count.format(items.length)} Items ausgewählt`;
  if (added.length > 0) return `${count.format(added.length)} Items ausgewählt, ${of}`;
  return `${count.format(removed.length)} Items abgewählt, ${of}`;
}

/** What a new result says: "2 Items", "Ein Item", "Kein Item passt zum Filter". */
const resultMessage = (shown: number, filtered: boolean) =>
  shown === 0 ? (filtered ? 'Kein Item passt zum Filter' : 'Keine Items') : shown === 1 ? 'Ein Item' : `${count.format(shown)} Items`;

/* ------------------------------------------------------------------------ the parts */

/** Rows in the shape of the list, while it loads. */
function ListSkeleton() {
  const widths = ['w-2/5', 'w-1/3', 'w-1/2', 'w-1/4', 'w-2/5', 'w-1/3', 'w-1/2', 'w-1/4'];
  return (
    <SkeletonGroup label="Items werden geladen …" className="flex flex-col gap-0.5">
      <Skeleton className="mb-2 ml-2 h-4 w-32" />
      {widths.map((width, index) => (
        <div key={index} className="flex h-11 items-center gap-2 px-2 sm:h-9">
          <Skeleton className="size-4" />
          <Skeleton className="size-4" />
          <Skeleton className="h-3.5 w-14" />
          <Skeleton className={cx('h-3.5', width)} />
          <span className="ml-auto flex items-center gap-1.5">
            <Skeleton className="h-6 w-20 max-sm:hidden" />
            <Skeleton className="size-5 rounded-full" />
          </span>
        </div>
      ))}
    </SkeletonGroup>
  );
}

/** The rows in outline, but only after a moment: an answer within 300 ms shows without a flash of the skeleton. */
function DelayedSkeleton() {
  const [late, setLate] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setLate(true), 300);
    return () => clearTimeout(timer);
  }, []);
  return late ? <ListSkeleton /> : <div className="h-40" aria-busy="true" />;
}

/**
 * When a bar goes away under the keyboard focus (the bulk bar after archiving, the unsaved bar after saving), the focus
 * would fall back to the page. It goes to the cursor's row instead, or else to the toolbar.
 */
function useFocusRescue(root: RefObject<HTMLElement | null>) {
  const last = useRef<Element | null>(null);
  useEffect(() => {
    const element = root.current;
    if (!element) return;
    const remember = (event: FocusEvent) => {
      last.current = event.target as Element;
    };
    element.addEventListener('focusin', remember);
    return () => element.removeEventListener('focusin', remember);
  }, [root]);
  useLayoutEffect(() => {
    const lost = document.activeElement === null || document.activeElement === document.body;
    if (!lost || !last.current || last.current.isConnected) return;
    // a row or cell that went away: its layout gives the focus to the row that takes its place (useSelection)
    const fromRow = last.current.closest('[data-nav-target]') !== null;
    last.current = null;
    if (fromRow) return;
    const target =
      root.current?.querySelector<HTMLElement>('[data-nav-target][tabindex="0"]') ?? root.current?.querySelector<HTMLElement>('[data-items-toolbar] button:not([disabled])');
    target?.focus({ preventScroll: true });
  });
}

/** The whole screen in outline, while the project or view it belongs to loads. */
function ScreenSkeleton() {
  return (
    <SkeletonGroup label="Wird geladen …">
      <div className="flex h-8 items-center gap-2">
        <Skeleton className="size-5" />
        <Skeleton className="h-5 w-48" />
        <Skeleton className="ml-auto h-8 w-64 max-sm:w-28" />
      </div>
      <div className="mt-3 flex h-7 items-center gap-2">
        <Skeleton className="h-7 w-20" />
        <Skeleton className="h-7 w-56" />
      </div>
      <div className="mt-4">
        <ListSkeleton />
      </div>
    </SkeletonGroup>
  );
}

/** The star of a project or view: puts it into the sidebar. */
function FavoriteStar({ kind, id }: { kind: 'project' | 'view'; id: string }) {
  const favorites = useFavorites();
  const toggle = useToggleFavorite();
  const on = favorites.data?.items.some((favorite) => favorite.kind === kind && favorite.id === id) ?? false;
  return (
    <IconButton
      icon={Star}
      label="Favorit in der Seitenleiste"
      aria-pressed={on}
      // busy, not disabled: a disabled button would drop the keyboard focus
      aria-busy={toggle.isPending || undefined}
      className={cx(on && '[&>svg]:fill-current')}
      onClick={() => {
        if (!favorites.data || toggle.isPending) return;
        toggle.mutate(
          { kind, id },
          {
            onSuccess: (result) => toast({ title: result.favorite ? 'Steht jetzt in der Seitenleiste' : 'Aus der Seitenleiste genommen', tone: 'success' }),
            onError: (error) => notifyError('Favorit nicht geändert', error, () => toggle.mutate({ kind, id })),
          },
        );
      }}
    />
  );
}

/** The toolbar sticks below the top edge; once it does, it gets the paper and a line, so the rows pass beneath. */
function StickyToolbar({ children }: { children: ReactNode }) {
  const sentinel = useRef<HTMLDivElement>(null);
  const bar = useRef<HTMLDivElement>(null);
  const [stuck, setStuck] = useState(false);
  useEffect(() => {
    const mark = sentinel.current;
    const toolbar = bar.current;
    if (!mark || !toolbar || typeof IntersectionObserver === 'undefined') return;
    const top = Number.parseFloat(getComputedStyle(toolbar).top) || 0;
    const observer = new IntersectionObserver(([entry]) => setStuck(!entry.isIntersecting), { rootMargin: `-${top + 1}px 0px 0px 0px` });
    observer.observe(mark);
    return () => observer.disconnect();
  }, []);
  return (
    <>
      <div ref={sentinel} aria-hidden="true" className="h-px" />
      <div
        ref={bar}
        data-items-toolbar=""
        className={cx('sticky top-14 z-10 -mx-4 px-4 py-2 md:top-0', stuck && 'bg-paper [box-shadow:0_1px_0_var(--border)]')}
      >
        {children}
      </div>
    </>
  );
}

/** `c` on a project list: a new item in this project (wins over the shell's `c`). */
function ProjectCreateKey({ project, onCreate }: { project: Project; onCreate: () => void }) {
  useShortcut({ id: 'list.create', keys: 'c', scope: 'list', label: `Neues Item in ${project.identifier}`, group: 'Liste', run: onCreate }, [project.identifier]);
  return null;
}

/* ------------------------------------------------------------------------- the list */

type ItemsListProps = {
  preset: ItemsPreset;
  project?: Project;
  view?: View;
};

function ItemsList({ preset, project, view }: ItemsListProps) {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const me = useSession((state) => state.userId);
  const { reason, can } = usePermissions();

  /* ------------------------------------------------------------ state: base and URL */

  const base = useMemo<ViewState>(() => (view ? viewStateOf(view) : presetState(preset === 'view' ? 'project' : preset)), [view, preset]);
  const search = searchParams.toString();
  const state = useMemo(() => applyViewState(base, decodeViewState(search)), [base, search]);
  // a saved view is changed by any difference; a built-in list only by its filter (layout, grouping and fields are
  // how one looks at it, nothing to save there)
  const dirty = view ? hasUnsavedChanges(base, state) : !sameFilter(base.filter, state.filter);

  const setState = useCallback(
    (next: ViewState) =>
      setSearchParams(
        (previous) => {
          const params = new URLSearchParams(previous);
          VIEW_STATE_PARAMS.forEach((key) => params.delete(key));
          new URLSearchParams(encodeViewState(next, base)).forEach((value, key) => params.set(key, value));
          return params;
        },
        { replace: true },
      ),
    [base, setSearchParams],
  );
  const setFilter = (filter: Filter) => setState({ ...state, filter });
  const setDisplay = (display: Display) => setState({ ...state, display });

  /* --------------------------------------------------------------------------- data */

  const scope = useMemo(() => scopeConditions(preset, project?.id), [preset, project?.id]);
  const query = useWorkItems({ filter: { version: 1, conditions: [...scope, ...state.filter.conditions.filter(isComplete)] }, sort: state.display.sort, per_page: 100 });
  // a new filter keeps the old rows until its answer is there (no flash of the loading state)
  const [lastPage, setLastPage] = useState(query.data);
  if (query.data && query.data !== lastPage) setLastPage(query.data);
  const page = query.data ?? (query.isError ? undefined : lastPage);

  const ctx = useFilterContext();
  const organization = useOrganization();
  const projects = useProjects({ include_archived: true });
  const workflows = useWorkflows();
  const types = useWorkItemTypes();
  const properties = useProperties();
  const users = useUsers();
  const labels = useLabels();
  const meta = useWorkItemMeta();
  const support = [query, organization, projects, workflows, types, properties, users, labels, meta];
  const failed = support.find((entry) => entry.isError);
  const retry = () => support.filter((entry) => entry.isError).forEach((entry) => void entry.refetch());

  /** Items on their way to the archive: hidden while the undo toast runs. */
  const [hidden, setHidden] = useState<ReadonlySet<string>>(() => new Set());
  const items = useMemo(() => {
    let list = page?.items ?? [];
    // "Beobachtet" has no filter field: the screen narrows it (a gap of the filter engine)
    if (preset === 'subscribed') list = list.filter((item) => item.subscriber_ids.includes(me));
    if (!state.display.show_sub_items) list = list.filter((item) => item.parent_id === null);
    return list.filter((item) => !hidden.has(item.id));
  }, [page, preset, me, state.display.show_sub_items, hidden]);

  const projectList = projects.data?.items;
  const groupBy = effectiveGrouping(state.display.group_by, items, projectList ?? []);
  const parents = useWorkItems({ filter: { version: 1, conditions: [{ field: 'has_children', op: 'is', value: true }] }, per_page: 100 }, { enabled: groupBy === 'parent' });
  const groups = useMemo(() => {
    if (!ctx) return [];
    const catalogs = {
      workflows: workflows.data?.items ?? [],
      projects: projectList ?? [],
      types: types.data?.items ?? [],
      labels: labels.data?.items ?? [],
      users: users.data?.items ?? [],
      parents: parents.data?.items ?? [],
    };
    return groupItems(items, groupBy, groupContext(ctx, catalogs, { items, project }));
  }, [ctx, items, groupBy, workflows.data, projectList, types.data, labels.data, users.data, parents.data, project]);
  const display = useMemo<Display>(() => ({ ...state.display, group_by: groupBy }), [state.display, groupBy]);

  /* ------------------------------------------------------------ cursor and selection */

  const selection = useUiStore((ui) => ui.selection);
  const setSelection = useUiStore((ui) => ui.setSelection);
  const [cursorId, setCursorId] = useState<string | null>(null);
  useItemCommands({ scope: 'list', current: () => cursorId });
  // no other screen may act on a selection that is no longer on screen
  useEffect(() => () => useUiStore.getState().setSelection([]), []);
  // what leaves the list leaves the selection
  useEffect(() => {
    if (!page) return;
    const shown = new Set(items.map((item) => item.id));
    if (selection.some((id) => !shown.has(id))) setSelection(selection.filter((id) => shown.has(id)));
  }, [page, items, selection, setSelection]);

  /** The last thing the status region said. */
  const [announcement, setAnnouncement] = useState('');
  const previousSelection = useRef(selection);
  useEffect(() => {
    const before = previousSelection.current;
    previousSelection.current = selection;
    const message = before === selection ? null : selectionMessage(before, selection, items);
    if (message) setAnnouncement(message);
  }, [selection, items]);
  // a new filter (or sub-items shown or not): the number of results, once its answer is there; not on the first load
  const resultKey = JSON.stringify([state.filter.conditions.filter(isComplete), state.display.show_sub_items]);
  const announcedResult = useRef<string | null>(null);
  useEffect(() => {
    if (!query.data || !ctx) return;
    if (announcedResult.current === null) announcedResult.current = resultKey;
    if (announcedResult.current === resultKey) return;
    announcedResult.current = resultKey;
    setAnnouncement(resultMessage(items.length, state.filter.conditions.length > 0));
  }, [query.data, ctx, resultKey, items.length, state.filter.conditions.length]);

  const onCursor = useCallback((id: string | null) => {
    setCursorId(id);
    // an open preview follows the cursor
    const ui = useUiStore.getState();
    if (id && ui.peekItemId && ui.peekItemId !== id) ui.openPeek(id);
  }, []);
  const onPeek = useCallback((id: string) => {
    setCursorId(id);
    useUiStore.getState().openPeek(id);
  }, []);
  const itemsRef = useRef(items);
  useLayoutEffect(() => {
    itemsRef.current = items;
  });
  const onOpen = useCallback((id: string) => navigate(`/items/${itemsRef.current.find((item) => item.id === id)?.key ?? id}`), [navigate]);

  /* --------------------------------------------------------------------- the actions */

  const setLayout = (layout: Display['layout']) => setState({ ...state, display: { ...state.display, layout } });
  const setLayoutRef = useRef(setLayout);
  useLayoutEffect(() => {
    setLayoutRef.current = setLayout;
  });
  useEffect(() => {
    const offs = LAYOUT_OPTIONS.map((option) =>
      registerShortcut({ id: `list.layout.${option.value}`, keys: option.shortcut, scope: 'list', label: option.label, group: 'Ansicht', run: () => setLayoutRef.current(option.value) }),
    );
    return () => offs.forEach((off) => off());
  }, []);

  const createDefaults: CreateDefaults | undefined = project ? { project_id: project.id } : preset === 'my' ? { assignee_id: me } : undefined;
  const createReason = reason('item.create', project?.id);
  const create = () => {
    if (createReason) toast({ title: 'Kein neues Item möglich', description: createReason, tone: 'error' });
    else useUiStore.getState().openCreate(createDefaults);
  };

  const bulk = useBulkUpdateWorkItems();
  const stateCategory = (item: WorkItem) => ctx?.stateCategory(item.state_id);
  function archive(targets: WorkItem[]) {
    // the closed ones go at once; open ones stay, and the server's answer names them
    const going = targets.filter((item) => {
      const category = stateCategory(item);
      return item.archived_at === null && category !== undefined && isClosedCategory(category);
    });
    const goingIds = going.map((item) => item.id);
    const without = (ids: string[]) => setHidden((current) => new Set([...current].filter((id) => !ids.includes(id))));
    setHidden((current) => new Set([...current, ...goingIds]));
    setSelection([]);
    runWithUndo({
      label: `${subjectOf(going)} archiviert`,
      undo: () => without(goingIds),
      run: async () => {
        try {
          const result = await bulk.mutateAsync({ ids: targets.map((item) => item.id), patch: { archived: true } });
          // the list has loaded again by now (without the archived ones): nothing needs hiding any more, so a filter
          // "Archiviert: ja" or a restore elsewhere shows them again
          without(goingIds);
          if (result.rejected.length > 0) bulkToast(targets, result, 'archiviert', 'archiviert');
        } catch {
          // the mutation says what failed (with "Erneut versuchen"); the rows come back
          without(goingIds);
        }
      },
    });
  }

  const saveView = useSaveView();
  const [savingAs, setSavingAs] = useState(false);
  const creatorName = users.data?.items.find((user) => user.id === view?.created_by)?.name ?? 'der Ersteller';
  const saveReason = view && view.created_by !== me && !can('view.manage_any') ? `Nur ${creatorName} und Org-Admins dürfen „${view.name}“ ändern. Speichere deine Änderungen als neue View.` : null;
  const saveAsReason =
    preset === 'subscribed' ? '„Beobachtet“ lässt sich noch nicht als View speichern: Der Filter kennt kein Feld für beobachtete Items.' : reason('view.create');
  /** The URL without the view state: the list shows its base again. */
  const clearChanges = () =>
    setSearchParams(
      (previous) => {
        const params = new URLSearchParams(previous);
        VIEW_STATE_PARAMS.forEach((key) => params.delete(key));
        return params;
      },
      { replace: true },
    );
  /**
   * Back to the saved state: a view drops every change, a built-in list its filter (its layout stays, as it was no
   * unsaved change). Toast with "Rückgängig" (also ⌘Z): the changes lived only in the URL.
   */
  function discard() {
    const before = state;
    if (view) clearChanges();
    else setFilter(base.filter);
    toast({ title: 'Änderungen verworfen', action: { label: UNDO_LABEL, onClick: () => setState(before) } });
  }
  function save() {
    if (!view) return;
    saveView.mutate(
      { id: view.id, name: view.name, icon: view.icon, filter: state.filter, display: state.display },
      {
        onSuccess: () => {
          // the view now holds what is shown (it has loaded again by now): the URL needs no changes any more
          clearChanges();
          toast({ title: `„${view.name}“ gespeichert`, tone: 'success' });
        },
        onError: (error) => notifyError('View nicht gespeichert', error, save),
      },
    );
  }
  const scopeText = project ? `Projekt ist ${project.name}` : preset === 'my' ? 'Assignee ist ich' : preset === 'created' ? 'Ersteller ist ich' : null;

  /* --------------------------------------------------------------------- the content */

  const filterChanged = !sameFilter(base.filter, state.filter);
  const resetFilter = () => setFilter(filterChanged ? base.filter : { version: 1, conditions: [] });
  const fellBack = state.display.group_by === 'state' && groupBy === 'category';
  const Layout = layouts[state.display.layout];

  let content: ReactNode;
  if (failed) {
    content = (
      <ErrorState
        title="Die Items konnten nicht geladen werden"
        description={`${failed.error?.message ?? 'Unbekannter Fehler.'} Die Liste erscheint, sobald der Server wieder antwortet.`}
        onRetry={retry}
        retrying={support.some((entry) => entry.isFetching)}
      />
    );
  } else if (!page || !ctx) {
    content = <DelayedSkeleton />;
  } else if (items.length === 0) {
    const hasConditions = state.filter.conditions.length > 0;
    if (hasConditions && (filterChanged || preset === 'view')) {
      content = (
        <EmptyState
          icon={FunnelX}
          title={view ? `Keine Treffer in „${view.name}“` : 'Kein Item passt zum Filter'}
          description={filterChanged ? 'Ändere die Bedingungen oder setze den Filter zurück.' : 'Gerade passt kein Item zu den Bedingungen dieser View. Ohne Bedingungen zeigt sie alle Items.'}
          actions={
            <Button variant="secondary" icon={FunnelX} onClick={resetFilter}>
              Filter zurücksetzen
            </Button>
          }
        />
      );
    } else {
      const newItem = (
        <Button variant="primary" icon={Plus} shortcut="c" disabledReason={createReason} onClick={create}>
          Neues Item
        </Button>
      );
      const projectsLink = (
        <Link to="/projects" className={buttonClass({ variant: 'secondary' })}>
          Projekte ansehen
        </Link>
      );
      const empty: Record<ItemsPreset, { title: string; description: string; actions?: ReactNode }> = {
        project: { title: `Noch keine Items in ${project?.name ?? 'diesem Projekt'}`, description: 'Lege das erste Item an. Mit C geht das von überall.', actions: newItem },
        my: {
          title: 'Dir ist nichts Offenes zugewiesen',
          description: 'Was dir jemand zuweist oder du dir selbst nimmst, steht hier, bis es erledigt ist. Offene Items findest du in den Projekten.',
          actions: projectsLink,
        },
        created: { title: 'Du hast noch keine Items angelegt', description: 'Was du anlegst, findest du hier wieder.', actions: newItem },
        subscribed: {
          title: 'Du beobachtest noch keine Items',
          description: 'Wer ein Item anlegt, zugewiesen bekommt, kommentiert oder erwähnt wird, beobachtet es. In jedem Item geht das auch von Hand.',
          actions: projectsLink,
        },
        view: {
          title: `„${view?.name ?? 'Diese View'}“ zeigt noch nichts`,
          description: 'Sobald Items zur View passen, stehen sie hier. Die übrigen Views des Teams stehen unter Views.',
          actions: (
            <Link to="/views" className={buttonClass({ variant: 'secondary' })}>
              Alle Views
            </Link>
          ),
        },
      };
      const { title, description, actions } = empty[preset];
      content = <EmptyState icon={preset === 'project' ? SquareKanban : List} title={title} description={description} actions={actions} />;
    }
  } else {
    const props: LayoutProps = { items, groups, display, ctx, selection, onSelect: setSelection, onOpen, onPeek, cursorId, onCursor };
    content = (
      <Suspense fallback={<ListSkeleton />}>
        <Layout {...props} />
      </Suspense>
    );
  }

  /* -------------------------------------------------------------------------- header */

  const title = view?.name ?? project?.name ?? MY_TABS.find((tab) => tab.preset === preset)?.title ?? 'Items';
  useDocumentTitle(title);
  const selected = items.filter((item) => selection.includes(item.id));
  const peekOpen = useUiStore((ui) => ui.peekItemId !== null);
  const myGroup = preset === 'my' || preset === 'created' || preset === 'subscribed';
  const screen = useRef<HTMLDivElement>(null);
  useFocusRescue(screen);

  return (
    <div ref={screen} className={cx('min-w-0', peekOpen && 'lg:pr-[calc(var(--panel-w)+0.5rem)]')}>
      {project && <ProjectCreateKey project={project} onCreate={create} />}
      <div role="status" aria-label="Mitteilungen der Liste" className="sr-only">
        {announcement}
      </div>
      <header className="flex min-h-8 flex-wrap items-center gap-x-3 gap-y-2">
        <div className="flex min-w-0 items-center gap-2">
          {project && (
            <>
              <ProjectBadge project={project} />
              <h1 className="truncate font-display text-lg font-bold tracking-title text-ink">{project.name}</h1>
              <ChevronRight className="size-3.5 shrink-0 text-faint" aria-hidden="true" />
              <span className="shrink-0 text-ui font-medium text-muted">Items</span>
              <FavoriteStar kind="project" id={project.id} />
            </>
          )}
          {view && (
            <>
              <Link to="/views" className="shrink-0 text-ui font-medium text-muted underline-offset-2 hover:text-ink hover:underline">
                Views
              </Link>
              <ChevronRight className="size-3.5 shrink-0 text-faint" aria-hidden="true" />
              <ViewIcon icon={view.icon} className="text-muted" />
              <h1 className="truncate font-display text-lg font-bold tracking-title text-ink">{view.name}</h1>
              <FavoriteStar kind="view" id={view.id} />
            </>
          )}
          {myGroup && <h1 className="truncate font-display text-lg font-bold tracking-title text-ink">Meine Items</h1>}
        </div>
        <div className="ml-auto">
          <SegmentedControl
            label="Layout"
            size="sm"
            value={state.display.layout}
            onValueChange={setLayout}
            options={LAYOUT_OPTIONS.map((option) => ({ ...option, icon: LAYOUT_ICONS[option.value] }))}
            className="max-sm:hidden"
          />
          <SegmentedControl
            label="Layout"
            size="sm"
            iconOnly
            value={state.display.layout}
            onValueChange={setLayout}
            options={LAYOUT_OPTIONS.map((option) => ({ ...option, icon: LAYOUT_ICONS[option.value] }))}
            className="sm:hidden"
          />
        </div>
      </header>

      {myGroup && (
        <nav aria-label="Meine Items" className="mt-2">
          <ul className="flex gap-1 overflow-x-auto border-b border-line">
            {MY_TABS.map((tab) => (
              <li key={tab.preset}>
                <Link
                  to={tab.to}
                  aria-current={tab.preset === preset ? 'page' : undefined}
                  className="-mb-px inline-flex h-11 items-center border-b-2 border-transparent px-2.5 text-ui font-medium whitespace-nowrap text-muted transition-colors duration-120 [--focus-offset:-2px] hover:text-ink aria-[current=page]:border-accent aria-[current=page]:text-ink md:h-9"
                >
                  {tab.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      )}

      <StickyToolbar>
        <FilterBar
          filter={state.filter}
          onChange={setFilter}
          project={project}
          actions={
            <>
              <DisplayMenu display={state.display} onChange={setDisplay} fellBack={fellBack} />
              <Button variant="primary" size="sm" icon={Plus} shortcut="c" disabledReason={createReason} onClick={create} className="max-sm:[&_kbd]:hidden">
                <span className="max-sm:sr-only">Neues Item</span>
              </Button>
            </>
          }
        />
        {selected.length > 0 && (
          <div className="mt-2">
            <BulkBar items={selected} total={items.length} onSelectAll={() => setSelection(items.map((item) => item.id))} onClear={() => setSelection([])} onArchive={archive} />
          </div>
        )}
      </StickyToolbar>

      {/* polite and always there: a change of filter or display announces that the list now differs from what is saved */}
      <div aria-live="polite">
        {dirty && (
          <UnsavedBar
            view={view}
            saveReason={saveReason}
            saveAsReason={saveAsReason}
            saving={saveView.isPending}
            onDiscard={discard}
            onSave={save}
            onSaveAs={() => setSavingAs(true)}
          />
        )}
      </div>
      <SaveAsDialog
        open={savingAs}
        onOpenChange={setSavingAs}
        state={state}
        scope={scope}
        scopeText={scopeText}
        defaultName={view ? `${view.name} (Kopie)` : title}
        defaultIcon={view?.icon ?? 'layers'}
      />

      {(fellBack || (page && page.total > page.items.length)) && (
        <div className="mt-2 flex flex-col gap-1 px-2 text-sm text-pretty text-muted">
          {fellBack && (
            <p className="flex items-start gap-2">
              <Info className="mt-px size-3.5 shrink-0" aria-hidden="true" />
              Die Items haben verschiedene Workflows. Darum sind sie nach Kategorie gruppiert statt nach Status.
            </p>
          )}
          {page && page.total > page.items.length && (
            <p className="flex items-start gap-2">
              <Info className="mt-px size-3.5 shrink-0" aria-hidden="true" />
              Es stehen die ersten {count.format(page.items.length)} von {count.format(page.total)} Items hier. Ein engerer Filter zeigt die übrigen.
            </p>
          )}
        </div>
      )}

      <div className="mt-2" aria-busy={query.isFetching && Boolean(page) ? true : undefined}>
        {content}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------------ the screen */

/** Finds the project or view the list belongs to, then shows it; 404 for one that does not exist (or is not visible). */
export function ItemsScreen({ preset, projectIdentifier, viewId }: ItemsScreenProps) {
  const projects = useProjects({ include_archived: true });
  const views = useViews();

  if (preset === 'project') {
    const project = projects.data?.items.find((entry) => entry.identifier === projectIdentifier);
    if (projects.isError) return <ScreenError onRetry={() => void projects.refetch()} retrying={projects.isFetching} what="Das Projekt" error={projects.error} />;
    if (!projects.data) return <ScreenSkeleton />;
    if (!project) {
      return <NotFound title={`Das Projekt ${projectIdentifier ?? ''} gibt es nicht`} description="Vielleicht hat es einen anderen Kürzel bekommen, oder du siehst es nicht. Alle Projekte, die du sehen darfst, findest du unter Projekte." />;
    }
    return <ItemsList preset={preset} project={project} />;
  }

  if (preset === 'view') {
    const view = views.data?.items.find((entry) => entry.id === viewId);
    if (views.isError) return <ScreenError onRetry={() => void views.refetch()} retrying={views.isFetching} what="Die View" error={views.error} />;
    if (!views.data) return <ScreenSkeleton />;
    if (!view) return <NotFound title="Diese View gibt es nicht" description="Sie wurde gelöscht, oder der Link ist unvollständig. Unter Views stehen alle Views des Teams." />;
    return <ItemsList preset={preset} view={view} />;
  }

  return <ItemsList preset={preset} />;
}

function ScreenError({ what, error, onRetry, retrying }: { what: string; error: Error | null; onRetry: () => void; retrying: boolean }) {
  useDocumentTitle('Fehler');
  return <ErrorState title={`${what} konnte nicht geladen werden`} description={error?.message ?? 'Der Server hat nicht geantwortet.'} onRetry={onRetry} retrying={retrying} />;
}
