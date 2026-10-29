/*
 * The wiki of a project (spec 4.15; 5.2: "Baum links, Seite rechts"). Contract with the router (lazy-loaded, kept from
 * Task 4): the default export is the screen of /projects/:identifier/wiki/:pageId? and reads both params itself.
 *
 * - Without a page the screen shows the overview with the latest changes, with one the page itself (PageView).
 * - The tree (PageTree) stands on the left from lg on. Below that, the overview shows the tree and a page shows alone;
 *   the path in the header leads back.
 * - Moving a page (dragging in the tree, or "Verschieben nach …") shows at once; a refusal of the server takes it back.
 * - Deleting takes the page with its whole subtree and always asks first (spec 4.15 "mit Bestätigung", correction
 *   round 2026-10-29), from every entry: the page's menu, the palette, mod+backspace on the page or on a row of the tree.
 *   With subpages the question names them. After the yes the pages leave the tree at once and are deleted when the undo
 *   toast runs out (5 s); "Rückgängig" brings them back, and the page that was open with them. "Abbrechen" gives the
 *   focus back to where it was.
 * - Members and admins edit, viewers read (`wiki.edit`, spec 4.3).
 */

import { useQueryClient } from '@tanstack/react-query';
import { BookOpen, ChevronRight, FilePlus2, Plus } from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router';
import { ApiError, type Page as ListPage } from '@/api/client';
import { NotFound } from '@/app/PageStates';
import { useUserMap } from '@/components/fields/itemData';
import { AlertDialog } from '@/components/ui/AlertDialog';
import { Button } from '@/components/ui/Button';
import { cx } from '@/components/ui/cx';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { ProjectBadge } from '@/components/ui/ProjectBadge';
import { Skeleton, SkeletonGroup } from '@/components/ui/Skeleton';
import { toast } from '@/components/ui/toast';
import { qk } from '@/hooks/keys';
import { useCreatePage, useDeletePage, useMovePage, usePage, usePages } from '@/hooks/pages';
import { useMembers, useProject, useProjects } from '@/hooks/projects';
import { useUsers } from '@/hooks/users';
import { useCommand } from '@/lib/commands';
import { notifyError } from '@/lib/errors';
import { usePermissions } from '@/lib/permissions';
import { runWithUndo } from '@/lib/undo';
import { useDocumentTitle } from '@/lib/useDocumentTitle';
import { useSession } from '@/store/session';
import type { PageNode, Project } from '@/types';
import { subpages, useLongDay } from './format';
import { MovePageDialog, PageGlyph } from './MovePageDialog';
import { PageTree } from './PageTree';
import { PageView, SHEET } from './PageView';
import { findPage, flattenPages, movedTree, pathTo, subtreeIds, withoutPages, type Placement } from './tree';

/** What a new page is called until it gets its title. */
const NEW_TITLE = 'Neue Seite';

/**
 * Whether the signed-in person may edit the wiki of the project. `usePermissions` says "not allowed" while the rights
 * load; this waits for them instead, so the page does not show read-only for a moment.
 */
function useWikiRights(projectId: string) {
  const { reason } = usePermissions();
  const queries = [useUsers(), useProjects({ include_archived: true }), useMembers()];
  const ready = queries.every((query) => query.isSuccess) || queries.some((query) => query.isError);
  return { ready, denied: reason('wiki.edit', projectId) };
}

const without = (set: ReadonlySet<string>, ids: readonly string[]) => new Set([...set].filter((id) => !ids.includes(id)));

/**
 * When the control that had the focus went away (a deleted page with its menu, the question, the toast), the focus
 * would fall back to the document. Once the screen has drawn the change it goes to the tree's row of `pageId`, else to
 * the screen's heading, else to the main area.
 */
export function focusWhenLost(pageId: string | null | undefined): void {
  const target = () => {
    const rows = [...document.querySelectorAll<HTMLElement>('[role="treeitem"][data-page-id]')];
    return (pageId ? rows.find((element) => element.dataset.pageId === pageId && element.getClientRects().length > 0) : undefined) ?? document.querySelector<HTMLElement>('[data-screen-heading]');
  };
  watchLostFocus(target);
}

/**
 * Watches the focus for a moment (the router draws a navigation as a transition, the closing menu gives the focus back
 * to its trigger first): when it is lost, `target` gets it, or the main area once the moment is over.
 */
function watchLostFocus(target: () => HTMLElement | null | undefined, ms = 800): void {
  const until = performance.now() + ms;
  const lost = () => {
    const active = document.activeElement;
    return !active || active === document.body || !active.isConnected || active.id === 'main';
  };
  // whenever the focus is lost meanwhile (the target of a moment ago may go too), the target of now takes it
  const look = () => {
    if (lost()) {
      const element = target();
      if (element) element.focus();
      else if (performance.now() >= until) return void document.getElementById('main')?.focus();
    }
    if (performance.now() < until) requestAnimationFrame(look);
  };
  requestAnimationFrame(look);
}

function ScreenSkeleton() {
  return (
    <SkeletonGroup label="Wiki wird geladen …">
      <Skeleton className="mt-1.5 h-5 w-56" />
      <div className="mt-6 lg:grid lg:grid-cols-[15rem_minmax(0,1fr)] lg:gap-8 xl:grid-cols-[17rem_minmax(0,1fr)]">
        <TreeSkeleton className="max-lg:hidden" />
        <div className={cx(SHEET, 'flex flex-col gap-3')}>
          <Skeleton className="h-8 w-2/3" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-4/5" />
        </div>
      </div>
    </SkeletonGroup>
  );
}

function TreeSkeleton({ className }: { className?: string }) {
  return (
    <SkeletonGroup label="Seiten werden geladen …" className={cx('flex flex-col gap-3 py-1 pl-10', className)}>
      {['w-36', 'w-28 ml-4', 'w-32 ml-4', 'w-24', 'w-36 ml-4', 'w-28'].map((look, index) => (
        <Skeleton key={index} className={cx('h-3.5', look)} />
      ))}
    </SkeletonGroup>
  );
}

export function WikiScreen() {
  const { identifier = '', pageId } = useParams();
  const project = useProject(identifier);
  const known = project.data;
  const open = usePage(known ? pageId : null);
  useDocumentTitle(known ? (open.data && pageId ? `${open.data.title} – Wiki ${known.identifier}` : `Wiki ${known.identifier}`) : 'Wiki');

  if (project.isError && project.error instanceof ApiError && project.error.status === 404) {
    return (
      <NotFound
        title={`Das Projekt ${identifier.toUpperCase()} gibt es nicht`}
        description="Die Kennung stimmt nicht, oder du darfst das Projekt nicht sehen. Über die Suche findest du Projekte, Items und Seiten."
      />
    );
  }
  if (project.isError) {
    return (
      <ErrorState
        title="Das Wiki konnte nicht geladen werden"
        description={project.error instanceof ApiError ? project.error.message : 'Der Server hat nicht geantwortet.'}
        onRetry={() => void project.refetch()}
        retrying={project.isFetching}
      />
    );
  }
  if (!known) return <ScreenSkeleton />;
  // a former identifier, or another spelling of the current one: to the address the project has now
  if (known.identifier !== identifier) return <Navigate replace to={`/projects/${known.identifier}/wiki${pageId ? `/${pageId}` : ''}`} />;
  // the state of the tree belongs to its project
  return <Wiki key={known.id} project={known} pageId={pageId} />;
}

export default WikiScreen;

function Wiki({ project, pageId }: { project: Project; pageId: string | undefined }) {
  const navigate = useNavigate();
  const userId = useSession((state) => state.userId);
  const queryClient = useQueryClient();
  const pages = usePages(project.id);
  const createPage = useCreatePage();
  const movePage = useMovePage();
  const deletePage = useDeletePage();
  const rights = useWikiRights(project.id);
  const base = `/projects/${project.identifier}/wiki`;
  const listKey = qk.pages.list({ project: project.id });

  /** Pages waiting for their delete (the undo toast runs), pages whose subpages are folded away. */
  const [hidden, setHidden] = useState<ReadonlySet<string>>(() => new Set());
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set());
  const [moving, setMoving] = useState<{ open: boolean; page: PageNode | null }>({ open: false, page: null });
  const [asking, setAsking] = useState<{ open: boolean; page: PageNode | null; count: number }>({ open: false, page: null, count: 0 });

  const tree = useMemo(() => withoutPages(pages.data?.items ?? [], hidden), [pages.data, hidden]);
  const ancestors = pageId ? pathTo(tree, pageId).slice(0, -1) : [];

  // the screen may outlive a delete it started: "Rückgängig" leads back only while the wiki is still open
  const mounted = useRef(true);
  const currentPage = useRef(pageId);
  currentPage.current = pageId;
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // the open page is never folded away
  const ancestorIds = ancestors.map((node) => node.id).join(' ');
  useEffect(() => {
    const ids = ancestorIds.split(' ').filter(Boolean);
    if (ids.length > 0) setCollapsed((state) => (ids.some((id) => state.has(id)) ? without(state, ids) : state));
  }, [ancestorIds]);

  const toggle = (id: string, open: boolean) => setCollapsed((state) => (open ? without(state, [id]) : new Set(state).add(id)));

  async function create(parentId: string | null) {
    try {
      const page = await createPage.mutateAsync({ project_id: project.id, parent_id: parentId, title: NEW_TITLE });
      if (parentId) setCollapsed((state) => without(state, [parentId]));
      toast({ title: 'Seite angelegt', description: 'Der Titel wartet darauf, überschrieben zu werden.', tone: 'success' });
      void navigate(`${base}/${page.id}`, { state: { focusTitle: true } });
    } catch (error) {
      notifyError('Seite nicht angelegt', error, () => void create(parentId));
    }
  }

  /** Shows the move at once; the server's refusal takes it back. */
  async function move(id: string, placement: Placement) {
    const node = findPage(tree, id);
    if (!node) return;
    await queryClient.cancelQueries({ queryKey: listKey });
    const before = queryClient.getQueryData<ListPage<PageNode>>(listKey);
    if (before) queryClient.setQueryData<ListPage<PageNode>>(listKey, { ...before, items: movedTree(before.items, id, placement.parent_id, placement.before_id) });
    const parent = placement.parent_id ? findPage(tree, placement.parent_id) : null;
    if (parent) setCollapsed((state) => without(state, [parent.id]));
    try {
      await movePage.mutateAsync({ id, ...placement });
      toast({ title: `„${node.title}“ verschoben`, description: parent ? `Jetzt unter „${parent.title}“.` : 'Jetzt auf der obersten Ebene.', tone: 'success' });
    } catch (error) {
      if (before) queryClient.setQueryData(listKey, before);
      notifyError(`„${node.title}“ nicht verschoben`, error, () => void move(id, placement));
    }
  }

  /** Every delete asks first, a page with subpages says how many go along; after the yes it goes with undo (`remove`). */
  function requestDelete(id: string) {
    const node = findPage(tree, id);
    if (!node) return;
    setAsking({ open: true, page: node, count: subtreeIds(tree, id).length });
  }

  function remove(node: PageNode) {
    const ids = subtreeIds(tree, node.id);
    const parentId = pathTo(tree, node.id).at(-2)?.id ?? null;
    const openPage = currentPage.current;
    const wasOpen = openPage !== undefined && ids.includes(openPage);
    const landing = parentId ? `${base}/${parentId}` : base;
    setHidden((state) => new Set([...state, ...ids]));
    if (wasOpen) void navigate(landing);
    // the control that had the focus (menu, question, row) went away with the page
    focusWhenLost(parentId);
    const show = () => setHidden((state) => without(state, ids));
    runWithUndo({
      label: ids.length > 1 ? `„${node.title}“ und ${subpages(ids.length - 1)} gelöscht` : `„${node.title}“ gelöscht`,
      failureTitle: `„${node.title}“ nicht gelöscht`,
      undo: () => {
        show();
        // back to the page that was open, unless the person has moved on
        if (wasOpen && mounted.current && currentPage.current === (parentId ?? undefined)) {
          void navigate(`${base}/${openPage}`);
          focusWhenLost(openPage);
        }
      },
      run: async () => {
        try {
          await deletePage.mutateAsync(node.id);
        } catch (error) {
          show();
          throw error;
        }
        show();
      },
    });
  }

  const canEdit = rights.ready && rights.denied === null;
  const createReason = rights.ready ? rights.denied : 'Die Rechte werden noch geladen.';
  useCommand({ id: 'wiki.create', label: 'Neue Seite', group: `Wiki ${project.identifier}`, icon: <FilePlus2 />, keywords: ['anlegen', 'seite', 'wiki'], run: () => void create(null), when: () => canEdit });

  const openNode = pageId ? findPage(tree, pageId) : undefined;
  let treeArea;
  if (pages.isPending) treeArea = <TreeSkeleton />;
  else if (pages.isError && !pages.data) {
    treeArea = (
      <ErrorState
        title="Die Seiten konnten nicht geladen werden"
        description={pages.error instanceof ApiError ? pages.error.message : 'Der Server hat nicht geantwortet.'}
        onRetry={() => void pages.refetch()}
        retrying={pages.isFetching}
      />
    );
  } else if (tree.length > 0) {
    treeArea = (
      <PageTree
        nodes={tree}
        hrefOf={(id) => `${base}/${id}`}
        currentId={pageId}
        collapsed={collapsed}
        onToggle={toggle}
        canMove={canEdit}
        onMove={(id, placement) => void move(id, placement)}
        onDelete={canEdit ? requestDelete : undefined}
      />
    );
  }

  return (
    <div className="min-w-0">
      <header className="flex min-h-8 flex-wrap items-center gap-x-3 gap-y-2">
        <div className="flex min-w-0 items-center gap-2">
          <ProjectBadge project={project} />
          <Link to={`/projects/${project.identifier}`} className="inline-flex min-h-11 min-w-0 items-center text-ui font-medium text-muted no-underline hover:text-ink hover:underline md:min-h-0">
            <span className="truncate">{project.name}</span>
          </Link>
          <ChevronRight className="size-3.5 shrink-0 text-faint" aria-hidden="true" />
          {pageId ? (
            <Link to={base} className="inline-flex min-h-11 shrink-0 items-center font-display text-lg font-bold tracking-title text-ink no-underline hover:underline md:min-h-0">
              Wiki
            </Link>
          ) : (
            <h1 data-screen-heading="" tabIndex={-1} className="shrink-0 scroll-mt-20 font-display text-lg font-bold tracking-title text-ink">
              Wiki
            </h1>
          )}
        </div>
        <div className="ml-auto">
          <Button variant="secondary" icon={Plus} pending={createPage.isPending} disabledReason={createReason} onClick={() => void create(null)}>
            Neue Seite
          </Button>
        </div>
      </header>

      <div className="mt-4 lg:mt-6 lg:grid lg:grid-cols-[15rem_minmax(0,1fr)] lg:items-start lg:gap-8 xl:grid-cols-[17rem_minmax(0,1fr)]">
        {treeArea && (
          <nav aria-label="Seiten des Wikis" className={cx('min-w-0 lg:sticky lg:top-4 lg:max-h-[calc(100dvh-2rem)] lg:overflow-y-auto lg:overscroll-contain lg:py-1 lg:pr-1', pageId && 'max-lg:hidden')}>
            {treeArea}
          </nav>
        )}
        <div className={cx('min-w-0', !pageId && treeArea && 'max-lg:mt-6')}>
          {pageId ? (
            <PageView
              // a page of its own per person: "Als … ansehen" never carries a draft over to somebody else
              key={`${userId} ${pageId}`}
              projectId={project.id}
              base={base}
              pageId={pageId}
              ancestors={ancestors}
              rights={rights}
              onMove={() => openNode && setMoving({ open: true, page: openNode })}
              onDelete={() => requestDelete(pageId)}
              onCreateChild={() => void create(pageId)}
            />
          ) : (
            <WikiHome nodes={tree} base={base} loading={pages.isPending} canCreate={canEdit} createReason={createReason} creating={createPage.isPending} onCreate={() => void create(null)} />
          )}
        </div>
      </div>

      <MovePageDialog
        open={moving.open}
        onOpenChange={(open) => setMoving((state) => ({ ...state, open }))}
        tree={tree}
        page={moving.page && (findPage(tree, moving.page.id) ?? moving.page)}
        onMove={(placement) => moving.page && void move(moving.page.id, placement)}
      />
      <AlertDialog
        open={asking.open}
        onOpenChange={(open) => setAsking((state) => ({ ...state, open }))}
        title={asking.page ? deleteTitle(asking.page, asking.count) : ''}
        description={asking.page ? deleteText(asking.page, asking.count) : ''}
        confirmLabel={asking.count > 1 ? `${asking.count} Seiten löschen` : 'Seite löschen'}
        onConfirm={() => {
          const node = asking.page;
          setAsking((state) => ({ ...state, open: false }));
          if (node) remove(node);
        }}
      />
    </div>
  );
}

const LIST = new Intl.ListFormat('de-DE', { type: 'conjunction' });

/** The question: the page, and how many subpages go along. */
function deleteTitle(page: PageNode, count: number): string {
  return count > 1 ? `„${page.title}“ mit ${subpages(count - 1)} löschen?` : `„${page.title}“ löschen?`;
}

/** What goes along with a page, in words: its subpages by name, at most five; and how long it can be taken back. */
function deleteText(page: PageNode, count: number): string {
  const below = flattenPages(page.children).map((row) => `„${row.node.title}“`);
  const later = 'Fünf Sekunden lang lässt sich das rückgängig machen.';
  if (below.length === 0) return later;
  if (below.length === 1) return `Mit der Seite verschwindet auch ihre Unterseite ${below[0]}. ${later}`;
  const names = below.length > 5 ? `${below.slice(0, 5).join(', ')} und ${below.length - 5} weitere` : LIST.format(below);
  return `Mit der Seite verschwinden auch ihre ${subpages(count - 1)}: ${names}. ${later}`;
}

type WikiHomeProps = {
  nodes: PageNode[];
  base: string;
  loading: boolean;
  canCreate: boolean;
  createReason: string | null;
  creating: boolean;
  onCreate: () => void;
};

/** The wiki without an open page: the latest changes, or the way to the first page. */
function WikiHome({ nodes, base, loading, canCreate, createReason, creating, onCreate }: WikiHomeProps) {
  const users = useUserMap();
  const longDay = useLongDay();
  const headingId = useId();
  const rows = flattenPages(nodes);
  const latest = [...rows].sort((a, b) => (a.node.updated_at < b.node.updated_at ? 1 : a.node.updated_at > b.node.updated_at ? -1 : 0)).slice(0, 6);

  if (loading) {
    return (
      <SkeletonGroup label="Übersicht wird geladen …" className={cx(SHEET, 'flex flex-col gap-3')}>
        <Skeleton className="h-6 w-48" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-4/5" />
      </SkeletonGroup>
    );
  }
  if (rows.length === 0) {
    return (
      <EmptyState
        icon={BookOpen}
        title="Noch keine Seiten"
        description={canCreate ? 'Das Wiki hält fest, was das Team wissen muss: Absprachen, Abläufe, Technik. Leg die erste Seite an.' : 'Das Wiki hält fest, was das Team wissen muss. Seiten legen Member und Admins des Projekts an.'}
        actions={
          <Button variant="primary" icon={Plus} pending={creating} disabledReason={createReason} onClick={onCreate}>
            Erste Seite anlegen
          </Button>
        }
        className="max-w-[52rem]"
      />
    );
  }

  return (
    <section aria-labelledby={headingId} className={SHEET}>
      <h2 id={headingId} className="scroll-mt-20 font-display text-xl font-bold tracking-title text-ink">
        Zuletzt geändert
      </h2>
      <p className="mt-1 max-w-[65ch] text-ui text-pretty text-muted">
        {rows.length === 1 ? 'Eine Seite' : `${rows.length} Seiten`} im Wiki. Im Baum lassen sich Seiten mit der Maus umordnen; ohne Maus über „Verschieben nach …“ auf der Seite.
      </p>
      <ul aria-labelledby={headingId} className="mt-4 flex flex-col gap-0.5">
        {latest.map((row) => {
          const parent = row.parentId ? findPage(nodes, row.parentId) : undefined;
          return (
            <li key={row.id} className="relative flex min-h-11 items-center gap-3 rounded-ctl px-2 py-1.5 transition-colors duration-120 hover:bg-hover">
              <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-ctl border border-line bg-surface text-base shadow-elev-1">
                <PageGlyph emoji={row.node.emoji} />
              </span>
              <div className="min-w-0 flex-1">
                <Link to={`${base}/${row.id}`} className="block truncate text-ui font-medium text-ink no-underline after:absolute after:inset-0 after:rounded-ctl">
                  {row.node.title}
                </Link>
                <p className="truncate text-sm text-muted">
                  {users.get(row.node.updated_by)?.name ?? 'Unbekannt'}, {longDay(row.node.updated_at)}
                  {parent && <span> in „{parent.title}“</span>}
                </p>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
