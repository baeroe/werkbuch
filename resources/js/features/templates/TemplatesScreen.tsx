/*
 * `/projects/{identifier}/templates/{templateId?}` (ported from the clickdummy's TemplatesScreen.tsx): the project
 * first, then its templates (`Templates`, keyed by the project).
 * - A project that does not exist or that the person does not see is the 404 of the screen; another failure is the
 *   error with retry; meanwhile the skeleton.
 * - Another spelling in the address (`/projects/app/templates`) becomes the identifier's own (`router.replace`), so the
 *   sidebar finds the project; a project renamed meanwhile moves to its new address. A former identifier never arrives
 *   here: the server answers it with a 301.
 * - Without an id the list (`TemplateList`); with one the template (`new` makes a new one, task 16 brings the editor).
 *   Templates are only read as the list of their project (A347): a template deleted meanwhile, or an id that names
 *   none, reads "Diese Vorlage gibt es nicht", without a request that would answer 404.
 */

import { Link, router, usePage } from '@inertiajs/react';
import { ChevronRight, FileQuestionMark } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { ApiError } from '@/api/client';
import { buttonClass } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { ProjectBadge } from '@/components/ui/ProjectBadge';
import { Skeleton, SkeletonGroup } from '@/components/ui/Skeleton';
import { useProject } from '@/hooks/projects';
import { useTemplates } from '@/hooks/templates';
import { t } from '@/lib/i18n';
import { paths } from '@/lib/links';
import { useDocumentTitle } from '@/lib/useDocumentTitle';
import { NotFound } from '@/shell/PageStates';
import type { Project } from '@/types';
import { useTemplateRights } from './rights';
import { RunLog } from './RunLog';
import { NEW_TEMPLATE, TemplateList } from './TemplateList';

export interface TemplatesScreenProps {
  identifier: string;
  /** `new`, the id of a template or any other text as it came; null for the list. */
  templateId: string | null;
}

function ScreenSkeleton() {
  return (
    <SkeletonGroup label={t('templates.loading')}>
      <Skeleton className="mt-1.5 h-5 w-56" />
      <div className="mt-6 flex flex-col gap-3">
        <Skeleton className="h-14 w-full rounded-ctl" />
        <Skeleton className="h-14 w-full rounded-ctl" />
      </div>
    </SkeletonGroup>
  );
}

export function TemplatesScreen({ identifier, templateId }: TemplatesScreenProps) {
  const project = useProject(identifier);
  const known = project.data;

  // renamed meanwhile: the address of the identifier the project has now, the rest of it as it is
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
    return <NotFound title={t('templates.not_found.title', { identifier })} description={t('templates.not_found.description')} />;
  }
  if (!known && project.isError) {
    return (
      <ErrorState
        title={t('templates.load_failed')}
        description={project.error.message || t('errors.no_answer')}
        onRetry={() => void project.refetch()}
        retrying={project.isFetching}
      />
    );
  }
  if (!known) return <ScreenSkeleton />;
  return <Templates key={known.id} project={known} templateId={templateId} />;
}

function Templates({ project, templateId }: { project: Project; templateId: string | null }) {
  const rights = useTemplateRights(project.id);
  const heading = useRef<HTMLHeadingElement>(null);
  useDocumentTitle(t('templates.tab', { identifier: project.identifier }));

  const header = (
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
        {templateId !== null ? (
          <Link
            href={paths.templates(project.identifier)}
            className="inline-flex min-h-11 shrink-0 items-center font-display text-lg font-bold tracking-title text-ink no-underline hover:underline md:min-h-0"
          >
            {t('templates.title')}
          </Link>
        ) : (
          <h1 ref={heading} data-screen-heading="" tabIndex={-1} className="shrink-0 scroll-mt-20 font-display text-lg font-bold tracking-title text-ink">
            {t('templates.title')}
          </h1>
        )}
      </div>
    </header>
  );

  if (templateId === null) return <TemplateList project={project} header={header} heading={heading} rights={rights} />;
  return (
    <div className="max-w-5xl min-w-0">
      {header}
      <div className="mt-4">
        <TemplateDetail project={project} templateId={templateId} />
      </div>
    </div>
  );
}

/** One template: until the editor comes (task 16), its name and the log of its runs. */
function TemplateDetail({ project, templateId }: { project: Project; templateId: string }) {
  const templates = useTemplates(project.id);
  if (templateId === NEW_TEMPLATE) {
    return (
      <h1 data-screen-heading="" tabIndex={-1} className="font-display text-xl font-bold tracking-title text-ink">
        {t('templates.new')}
      </h1>
    );
  }
  if (templates.isPending) return <ScreenSkeleton />;
  if (templates.isError && !templates.data) {
    return (
      <ErrorState
        title={t('templates.load_failed')}
        description={templates.error instanceof ApiError ? templates.error.message : t('errors.no_answer')}
        onRetry={() => void templates.refetch()}
        retrying={templates.isFetching}
      />
    );
  }
  const template = templates.data.items.find((entry) => entry.id === templateId);
  if (!template) {
    return (
      <EmptyState
        icon={FileQuestionMark}
        titleAs="h1"
        title={t('templates.missing.title')}
        description={t('templates.missing.description')}
        actions={
          <Link href={paths.templates(project.identifier)} className={buttonClass({ variant: 'secondary' })}>
            {t('templates.missing.back')}
          </Link>
        }
      />
    );
  }
  return (
    <div className="flex flex-col gap-4">
      <h1 data-screen-heading="" tabIndex={-1} className="font-display text-xl font-bold tracking-title text-ink">
        {template.name}
      </h1>
      <RunLog templateId={template.id} />
    </div>
  );
}
