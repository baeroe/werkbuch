/*
 * The item lists (spec 4.11, 5.2): the items of a project, "Meine Items" (assigned, created, watched) and the team's
 * views. One screen for all of them, ported from the clickdummy (13b: split into the state, the data, the header, the
 * states and the announcer):
 *
 * - The header names the list (with the star of a project or view, the tabs of Meine Items) and switches the layout
 *   (1–4). Below it the toolbar sticks to the top: the filter bar (`filter/FilterBar.tsx`: "Filter", the title search,
 *   the conditions) with "Anzeige" (`display/DisplayMenu.tsx`) and "Neues Item". While items are selected the bulk bar
 *   stands below them (`selection/BulkBar.tsx`).
 * - Unsaved changes (spec 4.11): a view that differs from what is saved, a built-in list whose filter differs, shows
 *   the bar below the toolbar (`save/UnsavedBar.tsx`): "Verwerfen" (with undo), "Als neue View speichern …" (with the
 *   scope of a built-in list, P28) and, for a view, "Speichern" (its creator and org admins). A built-in list saves a
 *   change of its display alone from the display menu (13c).
 * - The state (filter and display) is in the address (`useListState`), the groups and their pages come from the server
 *   (`useListData`); a new filter keeps the old rows until its answer is there.
 * - Below: a hint when the status grouping fell back to the categories, a banner on an archived project (read-only),
 *   then the layout (layouts.ts) or the empty, loading or error state (ListStates.tsx). An empty timeline is the
 *   timeline's own: it says that only epics stand on it.
 * - One polite status region announces what changes without the focus moving (`ListAnnouncer`).
 * - Cursor and selection: the cursor is the item under the keyboard; the selection lives in the UI store and is
 *   emptied when the list goes, so no other screen acts on it. A click on a title and the space bar open the preview
 *   beside the list; an open preview follows the cursor. Enter opens the item's page.
 * - The item commands of the list (`useItemCommands({ scope: 'list', current })`) act on the selection, else on the
 *   item under the cursor; an item page or the preview with the focus outranks them.
 *
 * Every list mounts anew (another page, another project, another view): cursor, selection and the groups that loaded
 * never leak into the next one.
 */

import { router, usePage } from '@inertiajs/react';
import { Archive, Info, SquarePen } from 'lucide-react';
import { Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';
import { ApiError } from '@/api/client';
import { archiveTargets, useItemCommands, useRemovalDeps } from '@/components/fields/commands';
import { Banner } from '@/components/ui/Banner';
import { Button } from '@/components/ui/Button';
import { cx } from '@/components/ui/cx';
import { ErrorState } from '@/components/ui/ErrorState';
import { toast } from '@/components/ui/toast';
import { sameFilter, scopeConditions, type ItemsPreset } from '@/domain/viewState';
import { copyName } from '@/features/views/viewForm';
import { useSettle } from '@/hooks/mutation';
import { useProject } from '@/hooks/projects';
import { useProperties } from '@/hooks/properties';
import { useAllUsers, useCurrentUser } from '@/hooks/users';
import { useView } from '@/hooks/views';
import { ListGoneError } from '@/hooks/workItems';
import { notifyError } from '@/lib/errors';
import { t } from '@/lib/i18n';
import { paths } from '@/lib/links';
import { usePermissions } from '@/lib/permissions';
import { undoLabel } from '@/lib/undo';
import { SHORTCUTS } from '@/lib/shortcuts/catalog';
import { useDocumentTitle } from '@/lib/useDocumentTitle';
import { NotFound } from '@/shell/PageStates';
import { useUiStore, type CreateDefaults } from '@/store/ui';
import type { Display, ListedItem, Project, View } from '@/types';
import { DisplayMenu } from './display/DisplayMenu';
import { layouts, type LayoutProps } from './layouts';
import { ListAnnouncer } from './ListAnnouncer';
import { ListHeader } from './ListHeader';
import { FilterBar } from './filter/FilterBar';
import { isComplete } from './filter/fieldOps';
import { LayoutBoundary, ListEmpty, ListError, ListSkeleton, ScreenSkeleton } from './ListStates';
import { MY_TABS } from './MyTabs';
import { SaveAsDialog } from './save/SaveAsDialog';
import { UnsavedBar } from './save/UnsavedBar';
import { useListSave } from './save/useListSave';
import { BulkBar } from './selection/BulkBar';
import { useListData } from './useListData';
import { useListState } from './useListState';

export type ItemsScreenProps = {
  preset: ItemsPreset;
  /** `/projects/{identifier}`: the identifier the project has. */
  projectIdentifier?: string;
  /** `/views/{viewId}`. */
  viewId?: string;
};

/** How many frames the focus waits for a layout that is still loading (about five seconds). */
const RESCUE_FRAMES = 300;

/** What takes the focus when the element that had it went away: the list's tab stop, else the toolbar. */
const FOCUS_TARGETS = '[data-nav-target][tabindex="0"], [data-group-key][tabindex="0"]';

/**
 * When something goes away under the keyboard focus (a bar, or the layout when 1–4 switch it), the focus would fall
 * back to the page. It goes to the list's tab stop instead, or else to the toolbar. A row that goes away within the
 * same layout is the layout's business (its selection hands the focus on).
 */
function useFocusRescue(root: RefObject<HTMLElement | null>, layout: Display['layout']) {
  const last = useRef<Element | null>(null);
  const shownLayout = useRef(layout);
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
    const switched = shownLayout.current !== layout;
    shownLayout.current = layout;
    const lost = document.activeElement === null || document.activeElement === document.body;
    if (!lost || !last.current || last.current.isConnected) return;
    const fromRow = last.current.closest('[data-nav-target]') !== null;
    last.current = null;
    if (fromRow && !switched) return;
    // the rows of a layout render a frame later (they measure themselves): wait a few frames for the list's tab stop,
    // and as long as the outline of a loading layout stands for it (a chunk of its own, the timeline before its epics)
    let attempts = 0;
    const rescue = () => {
      if (document.activeElement !== null && document.activeElement !== document.body) return;
      const target = root.current?.querySelector<HTMLElement>(FOCUS_TARGETS);
      const loading = root.current?.querySelector('[data-layout-skeleton]') != null;
      if (target) target.focus({ preventScroll: true });
      else if (attempts++ < 5 || (loading && attempts < RESCUE_FRAMES)) requestAnimationFrame(rescue);
      else root.current?.querySelector<HTMLElement>('[data-items-toolbar] button:not([disabled])')?.focus({ preventScroll: true });
    };
    rescue();
  });
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
    const observer = new IntersectionObserver(([entry]) => setStuck(!entry!.isIntersecting), { rootMargin: `-${top + 1}px 0px 0px 0px` });
    observer.observe(mark);
    return () => observer.disconnect();
  }, []);
  return (
    <>
      <div ref={sentinel} aria-hidden="true" className="h-px" />
      <div ref={bar} data-items-toolbar="" className={cx('sticky top-14 z-10 -mx-4 px-4 py-2 md:top-0', stuck && 'bg-paper [box-shadow:0_1px_0_var(--border)]')}>
        {children}
      </div>
    </>
  );
}

/* ------------------------------------------------------------------------- the list */

function ItemsList({ preset, project, view }: { preset: ItemsPreset; project?: Project; view?: View }) {
  const me = useCurrentUser();
  const { reason, loading: rightsLoading, failed: rightsFailed } = usePermissions();
  const { base, state, setState, clearChanges, unsaved } = useListState({ preset, project, view });
  const scope = useMemo(() => scopeConditions(preset, project?.id), [preset, project?.id]);
  const data = useListData(state, scope);

  const title = view?.name ?? project?.name ?? t(MY_TABS.find((tab) => tab.preset === preset)!.title);
  useDocumentTitle(title);

  /* ------------------------------------------------------------ cursor and selection */

  const selection = useUiStore((ui) => ui.selection);
  const setSelection = useUiStore((ui) => ui.setSelection);
  const [cursorId, setCursorId] = useState<string | null>(null);
  useItemCommands({ scope: 'list', current: () => cursorId });
  // no other screen may act on a selection that is no longer on screen
  useEffect(() => () => useUiStore.getState().setSelection([]), []);
  // what leaves the list leaves the selection
  useEffect(() => {
    if (!data.current) return;
    const shown = new Set(data.items.map((item) => item.id));
    if (selection.some((id) => !shown.has(id))) setSelection(selection.filter((id) => shown.has(id)));
  }, [data.current, data.items, selection, setSelection]);

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
  const itemsRef = useRef(data.items);
  useLayoutEffect(() => {
    itemsRef.current = data.items;
  });
  const onOpen = useCallback((id: string) => router.visit(paths.item(itemsRef.current.find((item) => item.id === id)?.key ?? id)), []);

  /** ⌘A: every item of the list, also those of pages not loaded yet (they load first). */
  const { loadAll } = data;
  const selectAll = useCallback(async () => {
    try {
      const all = await loadAll();
      useUiStore.getState().setSelection(all.map((item) => item.id));
    } catch (error) {
      // the list changed meanwhile: what was asked for is gone, nothing to say
      if (error instanceof ListGoneError) return;
      notifyError(t('items.screen.select_all_failed'), error, () => void selectAll());
    }
  }, [loadAll]);

  /* --------------------------------------------------------------------- the actions */

  const selected = useMemo(() => data.items.filter((item) => selection.includes(item.id)), [data.items, selection]);
  const removal = useRemovalDeps();
  // the bar offers it only when every selected item is closed (A198): they all leave the list at once
  const archive = (targets: ListedItem[]) => archiveTargets(removal, targets);

  const setLayout = (layout: Display['layout']) => setState({ ...state, display: { ...state.display, layout } });
  const createDefaults: CreateDefaults | undefined = project ? { project_id: project.id } : preset === 'my' && me ? { assignee_id: me.id } : undefined;
  const createReason = reason('item.create', project?.id);
  const create = () => useUiStore.getState().openCreate(createDefaults);

  /* ------------------------------------------------------------------------- saving */

  const settle = useSettle();
  const propertyList = useProperties();
  // unknown while they load: a sort on a property is then neither unknown nor named (T17-M3); after a failure as before
  const properties = propertyList.data?.items ?? (propertyList.isError ? [] : undefined);
  const users = useAllUsers();
  const saving = useListSave({ view, state, scope });
  const [savingAs, setSavingAs] = useState(false);
  const creatorName = users.data?.items.find((user) => user.id === view?.created_by)?.name ?? t('items.save.creator');
  // while the rights load (or failed to), their reason says so: who may save it is known only with them (T17-M7)
  const manageReason = view && view.created_by !== me?.id ? reason('view.manage_any') : null;
  // a condition on a field that is gone blocks both: the server would refuse the filter
  const saveReason =
    saving.blocked ??
    (manageReason !== null && view
      ? rightsLoading || rightsFailed
        ? manageReason
        : `${t('problem.detail.view_creator_only', { name: creatorName, view: view.name })} ${t('items.save.copy_instead')}`
      : null);
  const saveAsReason = saving.blocked ?? reason('view.create');
  /** Back to what is saved: a view drops every change, a built-in list its filter (its display was no unsaved change). */
  const discard = () => {
    const before = state;
    if (view) clearChanges();
    else setState({ ...state, filter: base.filter });
    toast({ title: t('items.save.discarded'), keep: true, action: { label: undoLabel(), onClick: () => setState(before) } });
  };
  const save = () =>
    settle(saving.save(), {
      // the view holds what is shown now (it has loaded again by now): the address needs no changes any more
      onSuccess: (saved) => {
        clearChanges();
        toast({ title: t('items.save.saved', { name: saved.name }), tone: 'success' });
      },
      onError: (error) => notifyError(t('items.save.save_failed'), error, save),
    });
  const scopeText = project
    ? t('items.save.scope.project', { name: project.name })
    : preset === 'my'
      ? t('items.save.scope.my')
      : preset === 'created'
        ? t('items.save.scope.created')
        : preset === 'subscribed'
          ? t('items.save.scope.subscribed')
          : null;

  /* --------------------------------------------------------------------- the content */

  // what is unfinished does not filter (it never goes to the server)
  const sent = useMemo(() => state.filter.conditions.filter(isComplete), [state.filter.conditions]);
  const filterChanged = !sameFilter(base.filter, { version: 1, conditions: sent });
  const filtered = sent.length > 0;
  const Layout = layouts[state.display.layout];
  // an empty list because of its filter offers the way back to all of it (ListEmpty, the timeline's own empty state)
  const hidesItems = filtered && (filterChanged || preset === 'view');
  const resetFilter = () => setState({ ...state, filter: filterChanged ? base.filter : { version: 1, conditions: [] } });

  let content: ReactNode;
  if (data.status === 'error') {
    content = <ListError error={data.error} onRetry={data.retry} retrying={data.retrying} />;
  } else if (data.status === 'pending') {
    content = <ListSkeleton layout={state.display.layout} />;
  } else if (data.total === 0 && data.items.length === 0 && state.display.layout !== 'timeline') {
    content = (
      <ListEmpty
        preset={preset}
        project={project}
        view={view}
        filtered={filtered}
        filterChanged={filterChanged}
        onResetFilter={resetFilter}
        createReason={createReason}
        onCreate={create}
      />
    );
  } else {
    const props: LayoutProps = {
      groups: data.groups,
      groupBy: data.groupBy,
      display: { ...state.display, group_by: data.groupBy },
      total: data.total,
      ...(project && { project }),
      ...(createDefaults && { createDefaults }),
      filtered: hidesItems,
      filterChanged,
      ...(view && { view }),
      onResetFilter: resetFilter,
      selection,
      onSelect: setSelection,
      onSelectAll: () => void selectAll(),
      onOpen,
      onPeek,
      cursorId,
      onCursor,
    };
    // a layout of its own chunk that did not load shows the error with "Erneut versuchen"; another layout starts afresh
    content = (
      <LayoutBoundary key={state.display.layout}>
        <Suspense fallback={<ListSkeleton layout={state.display.layout} loadingLayout />}>
          <Layout {...props} />
        </Suspense>
      </LayoutBoundary>
    );
  }

  const peekOpen = useUiStore((ui) => ui.peekItemId !== null);
  const screen = useRef<HTMLDivElement>(null);
  useFocusRescue(screen, state.display.layout);

  return (
    <div ref={screen} className={cx('min-w-0', peekOpen && 'lg:pr-[calc(var(--panel-w)+0.5rem)]')}>
      <ListAnnouncer
        selection={selection}
        items={data.items}
        total={data.total}
        resultKey={JSON.stringify([sent, state.display.show_sub_items])}
        ready={data.current && data.status === 'success'}
        filtered={filtered}
        unsaved={unsaved}
      />
      <ListHeader preset={preset} project={project} view={view} layout={state.display.layout} onLayout={setLayout} />

      <StickyToolbar>
        <FilterBar
          filter={state.filter}
          onChange={(filter) => setState({ ...state, filter })}
          project={project}
          actions={
            <>
              <DisplayMenu
                display={state.display}
                onChange={(display) => setState({ ...state, display })}
                fellBack={data.fellBack}
                properties={properties}
                {...(!view && { onSaveAs: () => setSavingAs(true), saveAsReason })}
              />
              <Button variant="primary" size="sm" icon={SquarePen} shortcut={SHORTCUTS['item.create'].keys} disabledReason={createReason} onClick={create} className="max-sm:[&_kbd]:hidden">
                <span className="max-sm:sr-only">{t('commands.create.label')}</span>
              </Button>
            </>
          }
        />
        {selected.length > 0 && (
          <div className="mt-2">
            <BulkBar items={selected} total={data.total} onSelectAll={() => void selectAll()} onClear={() => setSelection([])} onArchive={archive} />
          </div>
        )}
      </StickyToolbar>

      {/* the list's one status region says that it now differs from what is saved (ListAnnouncer) */}
      {unsaved && (
        <div className="mt-2">
          <UnsavedBar
            view={view}
            saveReason={saveReason}
            saveAsReason={saveAsReason}
            saving={saving.saving}
            onDiscard={discard}
            onSave={save}
            onSaveAs={() => setSavingAs(true)}
          />
        </div>
      )}
      <SaveAsDialog
        open={savingAs}
        onOpenChange={setSavingAs}
        saveAs={saving.saveAs}
        pending={saving.creating}
        blocked={saving.blocked}
        scopeText={scopeText}
        defaultName={view ? copyName(view.name) : title}
        defaultIcon={view?.icon ?? 'layers'}
      />

      {project?.archived_at && (
        <Banner tone="info" icon={Archive} title={t('items.screen.archived.title')} className="mt-2">
          {t('items.screen.archived.description', { name: project.name })}
        </Banner>
      )}
      {data.fellBack && (
        <p className="mt-2 flex items-start gap-2 px-2 text-sm text-pretty text-muted">
          <Info className="mt-px size-3.5 shrink-0" aria-hidden="true" />
          {t('items.screen.fell_back')}
        </p>
      )}

      <div className="mt-2" aria-busy={data.status === 'success' && !data.current ? true : undefined}>
        {content}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------------ the screen */

function ScreenError({ title, error, onRetry, retrying }: { title: string; error: Error | null; onRetry(): void; retrying: boolean }) {
  useDocumentTitle(t('items.screen.error_tab'));
  return <ErrorState title={title} description={error?.message ?? t('items.screen.load_failed.description')} onRetry={onRetry} retrying={retrying} />;
}

const isGone = (error: unknown) => error instanceof ApiError && error.status === 404;

/** A project list: the project first (404 for one that does not exist or is not visible), then its items. */
function ProjectItems({ identifier }: { identifier: string }) {
  const project = useProject(identifier);
  const known = project.data;

  // renamed meanwhile: the address of the identifier the project has now, with the state of the list
  const { url } = usePage();
  const query = url.includes('?') ? url.slice(url.indexOf('?')) : '';
  const moved = known !== undefined && known.identifier !== identifier;
  useEffect(() => {
    if (moved) router.visit(`${paths.project(known.identifier)}${query}`, { replace: true, preserveState: false });
  }, [moved, known?.identifier, query]);
  // another spelling in the address (`/projects/web`): the identifier's own, so the sidebar finds the page
  const canonical = url.replace(/^\/projects\/[^/?#]+/, `/projects/${encodeURIComponent(identifier)}`);
  useEffect(() => {
    if (canonical !== url) router.replace({ url: canonical, preserveState: true, preserveScroll: true });
  }, [canonical, url]);

  if (isGone(project.error)) {
    return <NotFound title={t('items.screen.project_not_found.title', { identifier })} description={t('items.screen.project_not_found.description')} />;
  }
  if (!known && project.isError) {
    return <ScreenError title={t('items.screen.project_failed')} error={project.error} onRetry={() => void project.refetch()} retrying={project.isFetching} />;
  }
  if (!known || moved) return <ScreenSkeleton />;
  return <ItemsList key={known.id} preset="project" project={known} />;
}

/** A view: the view first (404 for one that is gone), then its items. */
function ViewItems({ id }: { id: string }) {
  const view = useView(id);
  if (isGone(view.error)) return <NotFound title={t('items.screen.view_not_found.title')} description={t('items.screen.view_not_found.description')} />;
  if (!view.data && view.isError) {
    return <ScreenError title={t('items.screen.view_failed')} error={view.error} onRetry={() => void view.refetch()} retrying={view.isFetching} />;
  }
  if (!view.data) return <ScreenSkeleton />;
  return <ItemsList key={view.data.id} preset="view" view={view.data} />;
}

export function ItemsScreen({ preset, projectIdentifier, viewId }: ItemsScreenProps) {
  if (preset === 'project') return <ProjectItems identifier={projectIdentifier ?? ''} />;
  if (preset === 'view') return <ViewItems id={viewId ?? ''} />;
  return <ItemsList preset={preset} />;
}
