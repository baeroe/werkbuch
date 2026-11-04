/*
 * The wiki of a project (spec 4.15; 5.2: "Baum links, Seite rechts"), ported from the clickdummy's WikiScreen.tsx:
 * - The header names the project and "Wiki" (a link back to the overview while a page is open, else the heading
 *   `data-screen-heading`) and offers "Neue Seite" for whoever may edit the wiki (`wiki.edit`, else the reason; while
 *   the rights load it waits with that reason). The palette has the same as `wiki.create`.
 * - The tree (`PageTree`) stands on the left from lg on, as the navigation "Seiten des Wikis"; below lg only the
 *   overview shows it, an open page shows alone. The ancestors of the open page are never folded away.
 * - Without a page: the overview (`WikiHome`). With one: the page (`PageView`) with the pages above it as its path.
 * - A new page is called "Neue Seite" (at the top level, or below the open page: "Unterseite anlegen"); after the toast
 *   the wiki opens it with `?focus=title`. The wiki reads that once when the page opens, takes it out of the address
 *   (`router.replace`), and the page selects its title, ready to be typed over.
 * - Moving ("Verschieben nach …", `MovePageDialog`) shows at once (`movedTree` in the cached tree); a refusal of the
 *   server takes it back: a 422 at the field of the dialog, anything else as a toast (`notifyError`).
 * - Deleting takes a page with its subtree and always asks first (`DeletePageDialog`), on every way: the page's menu,
 *   ⌘⌫ on the page (`wiki.delete`), ⌘⌫ on a row of the tree (the row's page, not the open one), the palette's
 *   `wiki.page.delete`; "Abbrechen" gives the focus back to where it was. After the yes the pages leave the tree at once
 *   (`hiddenPages`, at module level: a visit draws the wiki anew) and an open page of the subtree gives way to its
 *   parent page (or the overview). The delete itself runs when the undo toast runs out (`runWithUndo`, 5 s;
 *   `useDeletePage` with the subtree as the wiki knew it). "Rückgängig" brings the pages back, and the page that was
 *   open while the person still stands where the delete led; a failure brings them back too. The focus goes to the
 *   row of the parent page in the tree where the tree shows, else to the screen's heading.
 * The tree and the pages are read by the project's ULID, never its identifier, so live updates and deletes meet one
 * cache entry (`usePages`).
 */

import { Link, router, usePage as useInertiaPage } from '@inertiajs/react';
import { useQueryClient } from '@tanstack/react-query';
import { ChevronRight, FilePlus2, Plus } from 'lucide-react';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type RefObject } from 'react';
import { ApiError, type Page as ListPage } from '@/api/client';
import { Button } from '@/components/ui/Button';
import { cx } from '@/components/ui/cx';
import { ErrorState } from '@/components/ui/ErrorState';
import { ProjectBadge } from '@/components/ui/ProjectBadge';
import { Skeleton, SkeletonGroup } from '@/components/ui/Skeleton';
import { toast } from '@/components/ui/toast';
import { qk } from '@/hooks/keys';
import { useCreatePage, useDeletePage, useMovePage, usePages } from '@/hooks/pages';
import { useCommand } from '@/lib/commands';
import { drafts } from '@/lib/drafts';
import { notifyError } from '@/lib/errors';
import { focusBackTo, focusOriginNow, focusWhenLost } from '@/lib/focusOrigin';
import { t } from '@/lib/i18n';
import { paths } from '@/lib/links';
import { usePermissions } from '@/lib/permissions';
import { runWithUndo } from '@/lib/undo';
import { useDocumentTitle } from '@/lib/useDocumentTitle';
import type { PageNode, Project, Page as WikiPage } from '@/types';
import { DeletePageDialog } from './DeletePageDialog';
import { subpages } from './format';
import { MovePageDialog } from './MovePageDialog';
import { PageTree } from './PageTree';
import { PageView } from './PageView';
import { findPage, movedTree, pathTo, subtreeIds, withoutPages, type Placement } from './tree';
import { WikiHome } from './WikiHome';

export interface WikiProps {
  project: Project;
  pageId: string | null;
  /** Whether the server found the page for the person; never true without a page. */
  pageFound: boolean;
}

const without = (set: ReadonlySet<string>, ids: readonly string[]) => new Set([...set].filter((id) => !ids.includes(id)));

/** How long the focus is watched after a delete or its undo: a visit draws the next page later. */
const FOCUS_WATCH_MS = 800;

/**
 * Pages deleted while their undo toast stands, and after it (a deleted page never comes back), for every wiki on the
 * screen: a visit draws the wiki anew, and its tree must not show them meanwhile. A person change forgets them.
 */
let hiddenPages: ReadonlySet<string> = new Set();
const hiddenListeners = new Set<() => void>();

function setPagesHidden(ids: readonly string[], on: boolean): void {
  hiddenPages = on ? new Set([...hiddenPages, ...ids]) : without(hiddenPages, ids);
  hiddenListeners.forEach((listener) => listener());
}

/** Forgets the hidden pages (a person change; tests). */
export function clearHiddenPages(): void {
  setPagesHidden([...hiddenPages], false);
}
drafts.onClear(clearHiddenPages);

const subscribeHidden = (listener: () => void) => {
  hiddenListeners.add(listener);
  return () => void hiddenListeners.delete(listener);
};

/** The address of the wiki on the screen (null: none): "Rückgängig" leads back only from where the delete led. */
let shownAt: string | null = null;

/** The row of a page in the tree, where the tree shows; else the screen's heading. */
function landingFocus(pageId: string | null): HTMLElement | null {
  const rows = [...document.querySelectorAll<HTMLElement>('[role="treeitem"][data-page-id]')];
  const row = pageId ? rows.find((element) => element.dataset.pageId === pageId && element.getClientRects().length > 0) : undefined;
  return row ?? document.querySelector<HTMLElement>('[data-screen-heading]');
}

/** The rows of the tree while it loads. */
export function TreeSkeleton({ className }: { className?: string }) {
  return (
    <SkeletonGroup label={t('wiki.tree.loading')} className={cx('flex flex-col gap-3 py-1 pl-6', className)}>
      {['w-36', 'w-28 ml-4', 'w-32 ml-4', 'w-24', 'w-36 ml-4', 'w-28'].map((look, index) => (
        <Skeleton key={index} className={cx('h-3.5', look)} />
      ))}
    </SkeletonGroup>
  );
}

/**
 * Whether the page just opened asked for its title to be selected (`?focus=title`, after "Neue Seite"). The parameter
 * is read once and leaves the address at once, so going back or reloading does not select it again.
 */
function useTitleFocus(pageId: string | null): boolean {
  const { url } = useInertiaPage();
  const address = new URL(url, window.location.origin);
  const asked = address.searchParams.get('focus') === 'title';
  // remembered past the replace below: the title of this page keeps the selection it got when it opened
  const [focusFor, setFocusFor] = useState<string | null>(null);
  useEffect(() => {
    // another page forgets the wish: coming back later selects nothing
    if (!asked) return setFocusFor((current) => (current === pageId ? current : null));
    setFocusFor(pageId);
    address.searchParams.delete('focus');
    router.replace({ url: `${address.pathname}${address.search}${address.hash}`, preserveState: true, preserveScroll: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `address` and `asked` come from `url`
  }, [url, pageId]);
  return pageId !== null && (asked || focusFor === pageId);
}

export function Wiki({ project, pageId, pageFound }: WikiProps) {
  const queryClient = useQueryClient();
  const pages = usePages(project.id);
  const createPage = useCreatePage();
  const movePage = useMovePage();
  const deletePage = useDeletePage();
  const hidden = useSyncExternalStore(subscribeHidden, () => hiddenPages);
  const permissions = usePermissions();
  const createReason = permissions.reason('wiki.edit', project.id);
  const canEdit = createReason === null;
  const readOnly = !permissions.loading && !canEdit;
  const focusTitle = useTitleFocus(pageId);
  useDocumentTitle(t('wiki.tab', { identifier: project.identifier }));

  const hrefOf = (id: string) => paths.wiki(project.identifier, id);
  const listKey = qk.pages.list({ project: project.id });
  const tree = useMemo(() => withoutPages(pages.data?.items ?? [], hidden), [pages.data, hidden]);

  const here = paths.wiki(project.identifier, pageId ?? undefined);
  useLayoutEffect(() => {
    shownAt = here;
    return () => {
      if (shownAt === here) shownAt = null;
    };
  }, [here]);

  const [moving, setMoving] = useState<{ open: boolean; page: PageNode | null }>({ open: false, page: null });
  const [asking, setAsking] = useState<{ open: boolean; page: PageNode | null }>({ open: false, page: null });
  /** Where the focus goes when the question closes: back where it was, or, after the yes, where the pages went. */
  const askedFrom = useRef<Element | null>(null);
  const confirmed = useRef<{ parentId: string | null } | null>(null);
  const askFocus: RefObject<HTMLElement | null> = {
    get current() {
      return confirmed.current ? landingFocus(confirmed.current.parentId) : focusBackTo(askedFrom.current);
    },
  };

  // the open page is never folded away
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set());
  const ancestorIds = (pageId ? pathTo(tree, pageId).slice(0, -1) : []).map((node) => node.id).join(' ');
  useEffect(() => {
    const ids = ancestorIds.split(' ').filter(Boolean);
    if (ids.length > 0) setCollapsed((state) => (ids.some((id) => state.has(id)) ? without(state, ids) : state));
  }, [ancestorIds]);
  const toggle = (id: string, open: boolean) => setCollapsed((state) => (open ? without(state, [id]) : new Set(state).add(id)));

  async function create(parentId: string | null) {
    try {
      const page = await createPage.mutateAsync({ project_id: project.id, parent_id: parentId, title: t('wiki.new_title') });
      queryClient.setQueryData<WikiPage>(qk.pages.detail(page.id), page);
      if (parentId) setCollapsed((state) => without(state, [parentId]));
      toast({ title: t('wiki.created.title'), description: t('wiki.created.description'), tone: 'success' });
      router.visit(`${paths.wiki(project.identifier, page.id)}?focus=title`);
    } catch (error) {
      notifyError(t('wiki.create_failed'), error, () => void create(parentId));
    }
  }

  /**
   * Shows the move at once; a refusal of the server takes it back. Answers a 422 for the dialog to show at its fields
   * (`inDialog`); every other refusal says so in a toast.
   */
  async function move(node: PageNode, placement: Placement, inDialog = false): Promise<ApiError | null> {
    const { id } = node;
    await queryClient.cancelQueries({ queryKey: listKey });
    const before = queryClient.getQueryData<ListPage<PageNode>>(listKey);
    if (before) queryClient.setQueryData<ListPage<PageNode>>(listKey, { ...before, items: movedTree(before.items, id, placement.parent_id, placement.before_id) });
    const parent = placement.parent_id ? findPage(tree, placement.parent_id) : undefined;
    if (parent) setCollapsed((state) => without(state, [parent.id]));
    try {
      await movePage.mutateAsync({ id, ...placement });
      toast({
        title: t('wiki.move.done.title', { title: node.title }),
        description: parent ? t('wiki.move.done.under', { title: parent.title }) : t('wiki.move.done.top'),
        tone: 'success',
      });
      return null;
    } catch (error) {
      if (before) queryClient.setQueryData(listKey, before);
      if (inDialog && error instanceof ApiError && error.status === 422) return error;
      notifyError(t('wiki.move.failed', { title: node.title }), error, () => void move(node, placement));
      return null;
    }
  }

  /** Every delete asks first; the question remembers where the focus was. */
  function requestDelete(id: string) {
    const node = findPage(tree, id);
    if (!node) return;
    askedFrom.current = focusOriginNow();
    confirmed.current = null;
    setAsking({ open: true, page: node });
  }

  /** After the yes: the pages go at once, the delete when the undo toast runs out. */
  function remove(node: PageNode) {
    const ids = subtreeIds(tree, node.id);
    const parentId = pathTo(tree, node.id).at(-2)?.id ?? null;
    const openPage = pageId;
    const wasOpen = openPage !== null && ids.includes(openPage);
    const landing = paths.wiki(project.identifier, parentId ?? undefined);
    const back = openPage === null ? null : paths.wiki(project.identifier, openPage);
    const { title } = node;
    confirmed.current = { parentId };
    setPagesHidden(ids, true);
    if (wasOpen) router.visit(landing);
    // the control that had the focus (menu, question, row) went away with the page
    focusWhenLost(() => landingFocus(parentId), FOCUS_WATCH_MS);
    runWithUndo({
      label: ids.length > 1 ? t('wiki.delete.done_with', { title, subpages: subpages(ids.length - 1) }) : t('wiki.delete.done', { title }),
      failureTitle: t('wiki.delete.failed', { title }),
      undo: () => {
        setPagesHidden(ids, false);
        // back to the page that was open, unless the person has moved on
        if (wasOpen && back && shownAt === landing) {
          router.visit(back);
          focusWhenLost(() => landingFocus(openPage), FOCUS_WATCH_MS);
        }
      },
      run: async () => {
        try {
          await deletePage.mutateAsync({ id: node.id, project_id: project.id, subtree: ids });
        } catch (error) {
          setPagesHidden(ids, false);
          throw error;
        }
      },
    });
  }

  useCommand(
    {
      id: 'wiki.create',
      label: t('wiki.new'),
      group: t('wiki.command_group', { identifier: project.identifier }),
      icon: <FilePlus2 />,
      keywords: [t('commands.create.keywords'), t('wiki.title')],
      run: () => void create(null),
      when: () => canEdit,
    },
    [canEdit],
  );

  let treeArea = null;
  if (pages.isPending) treeArea = <TreeSkeleton />;
  else if (pages.isError && !pages.data) {
    treeArea = (
      <ErrorState
        title={t('wiki.tree.failed')}
        description={pages.error.message || t('errors.no_answer')}
        onRetry={() => void pages.refetch()}
        retrying={pages.isFetching}
      />
    );
  } else if (tree.length > 0) {
    treeArea = <PageTree nodes={tree} hrefOf={hrefOf} currentId={pageId} collapsed={collapsed} onToggle={toggle} onDelete={canEdit ? requestDelete : undefined} />;
  }

  let content = null;
  if (pageId !== null) {
    content = (
      <PageView
        key={pageId}
        projectId={project.id}
        identifier={project.identifier}
        pageId={pageId}
        pageFound={pageFound}
        ancestors={pathTo(tree, pageId).slice(0, -1)}
        rights={{ ready: !permissions.loading, denied: createReason }}
        focusTitle={focusTitle}
        onMove={() => setMoving({ open: true, page: findPage(tree, pageId) ?? null })}
        onDelete={() => requestDelete(pageId)}
        onCreateChild={() => void create(pageId)}
      />
    );
  } else if (!pages.isError || pages.data) {
    content = (
      <WikiHome
        nodes={tree}
        hrefOf={hrefOf}
        loading={pages.isPending}
        createReason={createReason}
        readOnly={readOnly}
        creating={createPage.isPending}
        onCreate={() => void create(null)}
      />
    );
  }

  return (
    <div className="min-w-0">
      <header className="flex min-h-8 flex-wrap items-center gap-x-3 gap-y-2">
        <div className="flex min-w-0 items-center gap-2">
          <ProjectBadge project={project} />
          <Link
            href={paths.project(project.identifier)}
            className="inline-flex min-h-11 min-w-0 items-center text-ui font-medium text-muted no-underline hover:text-ink hover:underline md:min-h-0"
          >
            <span className="truncate">{project.name}</span>
          </Link>
          <ChevronRight className="size-3.5 shrink-0 text-faint" aria-hidden="true" />
          {pageId !== null ? (
            <Link
              href={paths.wiki(project.identifier)}
              className="inline-flex min-h-11 shrink-0 items-center font-display text-lg font-bold tracking-title text-ink no-underline hover:underline md:min-h-0"
            >
              {t('wiki.title')}
            </Link>
          ) : (
            <h1 data-screen-heading="" tabIndex={-1} className="shrink-0 scroll-mt-20 font-display text-lg font-bold tracking-title text-ink">
              {t('wiki.title')}
            </h1>
          )}
        </div>
        <div className="ml-auto">
          <Button variant="secondary" icon={Plus} pending={createPage.isPending} disabledReason={createReason} onClick={() => void create(null)}>
            {t('wiki.new')}
          </Button>
        </div>
      </header>

      <div className="mt-4 lg:mt-6 lg:grid lg:grid-cols-[15rem_minmax(0,1fr)] lg:items-start lg:gap-8 xl:grid-cols-[17rem_minmax(0,1fr)]">
        {treeArea && (
          <nav
            aria-label={t('wiki.tree.nav')}
            className={cx(
              'min-w-0 lg:sticky lg:top-4 lg:max-h-[calc(100dvh-2rem)] lg:overflow-y-auto lg:overscroll-contain lg:py-1 lg:pr-1',
              pageId !== null && 'max-lg:hidden',
            )}
          >
            {treeArea}
          </nav>
        )}
        <div className={cx('min-w-0', pageId === null && treeArea && 'max-lg:mt-6')}>{content}</div>
      </div>

      <MovePageDialog
        open={moving.open}
        onOpenChange={(open) => setMoving((state) => ({ ...state, open }))}
        tree={tree}
        page={moving.page && (findPage(tree, moving.page.id) ?? moving.page)}
        onMove={(placement) => move(moving.page!, placement, true)}
      />
      <DeletePageDialog
        open={asking.open}
        onOpenChange={(open) => setAsking((state) => ({ ...state, open }))}
        page={asking.page}
        finalFocus={askFocus}
        onConfirm={() => {
          setAsking((state) => ({ ...state, open: false }));
          remove(asking.page!);
        }}
      />
    </div>
  );
}
