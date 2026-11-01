/*
 * The item lists (spec 4.11, 5.2): the items of a project, "Meine Items" (assigned, created, watched) and the team's
 * views. One screen for all of them, ported from the clickdummy (13b: split into the state, the data, the header, the
 * states and the announcer):
 *
 * - The header names the list (with the star of a project or view, the tabs of Meine Items) and switches the layout
 *   (1–4). Below it the toolbar sticks to the top with "Neues Item"; the filter bar (Task 16) and the display menu
 *   (Task 17) join it there. While items are selected the bulk bar stands below them (`selection/BulkBar.tsx`).
 * - The state (filter and display) is in the address (`useListState`), the groups and their pages come from the server
 *   (`useListData`); a new filter keeps the old rows until its answer is there.
 * - Below: a hint when the status grouping fell back to the categories, a banner on an archived project (read-only),
 *   then the layout (layouts.ts) or the empty, loading or error state (ListStates.tsx).
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
import { archiveTargets, closedIn, useItemCommands, useRemovalDeps } from '@/components/fields/commands';
import { Banner } from '@/components/ui/Banner';
import { Button } from '@/components/ui/Button';
import { cx } from '@/components/ui/cx';
import { ErrorState } from '@/components/ui/ErrorState';
import { sameFilter, scopeConditions, type ItemsPreset } from '@/domain/viewState';
import { useProject, useProjects } from '@/hooks/projects';
import { useCurrentUser } from '@/hooks/users';
import { useView } from '@/hooks/views';
import { useWorkflows } from '@/hooks/workflows';
import { ListGoneError } from '@/hooks/workItems';
import { notifyError } from '@/lib/errors';
import { t } from '@/lib/i18n';
import { paths } from '@/lib/links';
import { usePermissions } from '@/lib/permissions';
import { SHORTCUTS } from '@/lib/shortcuts/catalog';
import { useDocumentTitle } from '@/lib/useDocumentTitle';
import { NotFound } from '@/shell/PageStates';
import { useUiStore, type CreateDefaults } from '@/store/ui';
import type { Display, ListedItem, Project, View } from '@/types';
import { layouts, type LayoutProps } from './layouts';
import { ListAnnouncer } from './ListAnnouncer';
import { ListHeader } from './ListHeader';
import { DelayedSkeleton, ListEmpty, ListError, ListSkeleton, ScreenSkeleton } from './ListStates';
import { MY_TABS } from './MyTabs';
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
    // the rows of a layout render a frame later (they measure themselves): wait a few frames for the list's tab stop
    let attempts = 0;
    const rescue = () => {
      if (document.activeElement !== null && document.activeElement !== document.body) return;
      const target = root.current?.querySelector<HTMLElement>(FOCUS_TARGETS);
      if (target) target.focus({ preventScroll: true });
      else if (attempts++ < 5) requestAnimationFrame(rescue);
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
  const { reason } = usePermissions();
  const { base, state, setState } = useListState({ preset, project, view });
  const scope = useMemo(() => scopeConditions(preset, project?.id), [preset, project?.id]);
  const data = useListData(state, scope, { preset, project });

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
  const projects = useProjects({ include_archived: true }).data?.items ?? [];
  const workflows = useWorkflows().data?.items ?? [];
  // the closed ones leave the list at once, the open ones stay and the toast names them
  const archive = (targets: ListedItem[]) =>
    archiveTargets(
      removal,
      targets,
      targets.filter((item) => closedIn(projects, workflows, item)),
    );

  const setLayout = (layout: Display['layout']) => setState({ ...state, display: { ...state.display, layout } });
  const createDefaults: CreateDefaults | undefined = project ? { project_id: project.id } : preset === 'my' && me ? { assignee_id: me.id } : undefined;
  const createReason = reason('item.create', project?.id);
  const create = () => useUiStore.getState().openCreate(createDefaults);

  /* --------------------------------------------------------------------- the content */

  const filterChanged = !sameFilter(base.filter, state.filter);
  const filtered = state.filter.conditions.length > 0;
  const Layout = layouts[state.display.layout];

  let content: ReactNode;
  if (data.status === 'error') {
    content = <ListError error={data.error} onRetry={data.retry} retrying={false} />;
  } else if (data.status === 'pending') {
    content = <DelayedSkeleton layout={state.display.layout} />;
  } else if (data.total === 0 && data.items.length === 0) {
    content = (
      <ListEmpty
        preset={preset}
        project={project}
        view={view}
        filtered={filtered}
        filterChanged={filterChanged}
        onResetFilter={() => setState({ ...state, filter: filterChanged ? base.filter : { version: 1, conditions: [] } })}
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
      selection,
      onSelect: setSelection,
      onSelectAll: () => void selectAll(),
      onOpen,
      onPeek,
      cursorId,
      onCursor,
    };
    content = (
      <Suspense fallback={<ListSkeleton layout={state.display.layout} />}>
        <Layout {...props} />
      </Suspense>
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
        resultKey={JSON.stringify([state.filter.conditions, state.display.show_sub_items])}
        ready={data.current && data.status === 'success'}
        filtered={filtered}
      />
      <ListHeader preset={preset} project={project} view={view} layout={state.display.layout} onLayout={setLayout} />

      <StickyToolbar>
        <div className="flex items-center justify-end gap-2">
          <Button variant="primary" size="sm" icon={SquarePen} shortcut={SHORTCUTS['item.create'].keys} disabledReason={createReason} onClick={create} className="max-sm:[&_kbd]:hidden">
            <span className="max-sm:sr-only">{t('commands.create.label')}</span>
          </Button>
        </div>
        {selected.length > 0 && (
          <div className="mt-2">
            <BulkBar items={selected} total={data.total} onSelectAll={() => void selectAll()} onClear={() => setSelection([])} onArchive={archive} />
          </div>
        )}
      </StickyToolbar>

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
