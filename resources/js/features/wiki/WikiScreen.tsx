/*
 * `/projects/{identifier}/wiki/{pageId?}` (ported from the clickdummy's WikiScreen.tsx): the project first, then its
 * wiki (`Wiki`, keyed by the project, so the folded pages never travel to another project).
 * - A project that does not exist or that the person does not see is the 404 of the screen; another failure is the
 *   error with retry; meanwhile the skeleton.
 * - Another spelling in the address (`/projects/web/wiki`) becomes the identifier's own (`router.replace`), so the
 *   sidebar finds the project. A former identifier never arrives here: the server answers it with a 301. A project
 *   renamed while the wiki is open moves to its new address (`router.visit`, the wiki stays on the screen; T13-M3).
 * - `pageFound` (the server found the page for the person) only counts together with `pageId`.
 */

import { router, usePage } from '@inertiajs/react';
import { useEffect } from 'react';
import { ApiError } from '@/api/client';
import { cx } from '@/components/ui/cx';
import { ErrorState } from '@/components/ui/ErrorState';
import { Skeleton, SkeletonGroup } from '@/components/ui/Skeleton';
import { useProject } from '@/hooks/projects';
import { t } from '@/lib/i18n';
import { useDocumentTitle } from '@/lib/useDocumentTitle';
import { NotFound } from '@/shell/PageStates';
import { SHEET } from './format';
import { TreeSkeleton, Wiki } from './Wiki';

export interface WikiScreenProps {
  identifier: string;
  pageId: string | null;
  pageFound: boolean;
}

function ScreenSkeleton() {
  return (
    <SkeletonGroup label={t('wiki.loading')}>
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

function ScreenError({ error, onRetry, retrying }: { error: Error; onRetry(): void; retrying: boolean }) {
  useDocumentTitle(t('wiki.title'));
  return <ErrorState title={t('wiki.failed')} description={error.message || t('errors.no_answer')} onRetry={onRetry} retrying={retrying} />;
}

export function WikiScreen({ identifier, pageId, pageFound }: WikiScreenProps) {
  const project = useProject(identifier);
  const known = project.data;

  // renamed meanwhile (T13-M3): the address of the identifier the project has now, the rest of it as it is; the wiki
  // stays on the screen (it is keyed by the project), so neither the tree nor an open editor goes
  const { url } = usePage();
  const moved = known !== undefined && known.identifier !== identifier;
  const renamed = moved ? url.replace(/^\/projects\/[^/?#]+/, `/projects/${encodeURIComponent(known.identifier)}`) : null;
  useEffect(() => {
    if (renamed !== null) router.visit(renamed, { replace: true, preserveState: true, preserveScroll: true });
  }, [renamed]);
  // another spelling in the address: the identifier's own, with the rest of the address as it is
  const canonical = url.replace(/^\/projects\/[^/?#]+/, `/projects/${encodeURIComponent(identifier)}`);
  useEffect(() => {
    if (!moved && canonical !== url) router.replace({ url: canonical, preserveState: true, preserveScroll: true });
  }, [moved, canonical, url]);

  if (project.error instanceof ApiError && project.error.status === 404) {
    return <NotFound title={t('wiki.not_found.title', { identifier })} description={t('wiki.not_found.description')} />;
  }
  if (!known && project.isError) return <ScreenError error={project.error} onRetry={() => void project.refetch()} retrying={project.isFetching} />;
  if (!known) return <ScreenSkeleton />;
  return <Wiki key={known.id} project={known} pageId={pageId} pageFound={pageId !== null && pageFound} />;
}
