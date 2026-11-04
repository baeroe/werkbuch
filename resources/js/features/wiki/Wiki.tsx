/*
 * The wiki of a project (spec 4.15; 5.2: "Baum links, Seite rechts"), ported from the clickdummy's WikiScreen.tsx:
 * - The header names the project and "Wiki" (a link back to the overview while a page is open, else the heading
 *   `data-screen-heading`) and offers "Neue Seite" for whoever may edit the wiki (`wiki.edit`, else the reason; while
 *   the rights load it waits with that reason). The palette has the same as `wiki.create`.
 * - The tree (`PageTree`) stands on the left from lg on, as the navigation "Seiten des Wikis"; below lg only the
 *   overview shows it, an open page shows alone. The ancestors of the open page are never folded away.
 * - Without a page: the overview (`WikiHome`). With one: the page (`PageView`) with the pages above it as its path.
 * - A new page is called "Neue Seite"; after the toast the wiki opens it with `?focus=title`. The wiki reads that once
 *   when the page opens, takes it out of the address (`router.replace`), and the page selects its title, ready to be
 *   typed over.
 * The tree and the pages are read by the project's ULID, never its identifier, so live updates and deletes meet one
 * cache entry (`usePages`).
 */

import { Link, router, usePage as useInertiaPage } from '@inertiajs/react';
import { useQueryClient } from '@tanstack/react-query';
import { ChevronRight, FilePlus2, Plus } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { cx } from '@/components/ui/cx';
import { ErrorState } from '@/components/ui/ErrorState';
import { ProjectBadge } from '@/components/ui/ProjectBadge';
import { Skeleton, SkeletonGroup } from '@/components/ui/Skeleton';
import { toast } from '@/components/ui/toast';
import { qk } from '@/hooks/keys';
import { useCreatePage, usePages } from '@/hooks/pages';
import { useCommand } from '@/lib/commands';
import { notifyError } from '@/lib/errors';
import { t } from '@/lib/i18n';
import { paths } from '@/lib/links';
import { usePermissions } from '@/lib/permissions';
import { useDocumentTitle } from '@/lib/useDocumentTitle';
import type { Project, Page as WikiPage } from '@/types';
import { PageTree } from './PageTree';
import { PageView } from './PageView';
import { pathTo } from './tree';
import { WikiHome } from './WikiHome';

export interface WikiProps {
  project: Project;
  pageId: string | null;
  /** Whether the server found the page for the person; never true without a page. */
  pageFound: boolean;
}

const without = (set: ReadonlySet<string>, ids: readonly string[]) => new Set([...set].filter((id) => !ids.includes(id)));

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
  const permissions = usePermissions();
  const createReason = permissions.reason('wiki.edit', project.id);
  const canEdit = createReason === null;
  const readOnly = !permissions.loading && !canEdit;
  const focusTitle = useTitleFocus(pageId);
  useDocumentTitle(t('wiki.tab', { identifier: project.identifier }));

  const hrefOf = (id: string) => paths.wiki(project.identifier, id);
  const tree = pages.data?.items ?? [];

  // the open page is never folded away
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set());
  const ancestorIds = (pageId ? pathTo(tree, pageId).slice(0, -1) : []).map((node) => node.id).join(' ');
  useEffect(() => {
    const ids = ancestorIds.split(' ').filter(Boolean);
    if (ids.length > 0) setCollapsed((state) => (ids.some((id) => state.has(id)) ? without(state, ids) : state));
  }, [ancestorIds]);
  const toggle = (id: string, open: boolean) => setCollapsed((state) => (open ? without(state, [id]) : new Set(state).add(id)));

  async function create() {
    try {
      const page = await createPage.mutateAsync({ project_id: project.id, parent_id: null, title: t('wiki.new_title') });
      queryClient.setQueryData<WikiPage>(qk.pages.detail(page.id), page);
      toast({ title: t('wiki.created.title'), description: t('wiki.created.description'), tone: 'success' });
      router.visit(`${paths.wiki(project.identifier, page.id)}?focus=title`);
    } catch (error) {
      notifyError(t('wiki.create_failed'), error, () => void create());
    }
  }

  useCommand(
    {
      id: 'wiki.create',
      label: t('wiki.new'),
      group: t('wiki.command_group', { identifier: project.identifier }),
      icon: <FilePlus2 />,
      keywords: [t('commands.create.keywords'), t('wiki.title')],
      run: () => void create(),
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
    treeArea = <PageTree nodes={tree} hrefOf={hrefOf} currentId={pageId} collapsed={collapsed} onToggle={toggle} />;
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
        onCreate={() => void create()}
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
          <Button variant="secondary" icon={Plus} pending={createPage.isPending} disabledReason={createReason} onClick={() => void create()}>
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
    </div>
  );
}
