/*
 * The settings of a project (spec 5.2) in the shared settings frame: General and Members, one address each
 * (`/projects/{identifier}/settings/{section?}`, General without a section; Workflow, Types and Automations join with
 * their phases). Project admins and org admins change them; everybody else reads, with the reason from `usePermissions`
 * (spec 4.3). The server answers an old identifier with a 301; a rename made here (or elsewhere, while the page is open)
 * moves the address to the identifier the project has now.
 */

import { Link, router, usePage } from '@inertiajs/react';
import { Archive, CircleAlert } from 'lucide-react';
import { Fragment, useEffect } from 'react';
import { ApiError } from '@/api/client';
import { Banner } from '@/components/ui/Banner';
import { buttonClass } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { ProjectBadge } from '@/components/ui/ProjectBadge';
import { useProject, useProjects } from '@/hooks/projects';
import { useCurrentUser } from '@/hooks/users';
import { t } from '@/lib/i18n';
import { paths } from '@/lib/links';
import { usePermissions } from '@/lib/permissions';
import { useDocumentTitle } from '@/lib/useDocumentTitle';
import { NotFound } from '@/shell/PageStates';
import { ReadOnlyBanner, SettingsError, SettingsSkeleton } from '../frame/parts';
import { SectionNav, SectionNavSkeleton, SettingsFrame } from '../frame/SettingsFrame';
import { General } from './General';
import { Members } from './Members';

const SECTIONS = ['general', 'members'] as const;
type Section = (typeof SECTIONS)[number];

const isSection = (slug: string): slug is Section => (SECTIONS as readonly string[]).includes(slug);

/** The name of a section in the language of the page. */
const sectionLabel = (section: Section): string => t(`settings.project.section.${section}`);

export function ProjectSettings({ identifier, section }: { identifier: string; section: string }) {
  const project = useProject(identifier);
  // the query the rights read: its failure and its retry are this page's as well
  const rights = useProjects({ include_archived: true }, { enabled: useCurrentUser() !== undefined });
  const { reason, loading } = usePermissions();
  const known = project.data;
  const current = isSection(section) ? section : null;
  useDocumentTitle(
    known && current ? t('settings.project.document_title', { section: sectionLabel(current), identifier: known.identifier }) : t('settings.project.tab_title'),
  );

  // renamed meanwhile: the address of the identifier the project has now
  const moved = known !== undefined && known.identifier !== identifier;
  useEffect(() => {
    if (moved) router.visit(paths.projectSettings(known.identifier, section), { replace: true });
  }, [moved, known?.identifier, section]);

  // another spelling in the address (`/projects/web/settings`): the address gets the identifier's own, so the sidebar
  // and the marks of the current page find it
  const { url } = usePage();
  const canonical = url.replace(/^\/projects\/[^/?#]+/, `/projects/${encodeURIComponent(identifier)}`);
  useEffect(() => {
    if (canonical !== url) router.replace({ url: canonical, preserveState: true, preserveScroll: true });
  }, [canonical, url]);

  if (project.error instanceof ApiError && project.error.status === 404) {
    return <NotFound title={t('settings.project.not_found.title', { identifier })} description={t('settings.project.not_found.description')} />;
  }

  const loadError = project.isError ? project.error : rights.isError ? rights.error : null;
  if (loadError) {
    return (
      <SettingsFrame title={t('settings.project.title')} nav={null}>
        <SettingsError
          title={t('settings.project.load_failed')}
          error={loadError}
          retrying={project.isFetching || rights.isFetching}
          onRetry={() => {
            if (project.isError) void project.refetch();
            if (rights.isError) void rights.refetch();
          }}
        />
      </SettingsFrame>
    );
  }

  if (!known || loading || moved) {
    return (
      <SettingsFrame title={t('settings.project.title')} nav={<SectionNavSkeleton items={SECTIONS.length} />}>
        <SettingsSkeleton rows={4} label={t('settings.project.loading')} />
      </SettingsFrame>
    );
  }

  const denied = reason('project.manage', known.id);
  const canManage = denied === null;
  const props = { project: known, canManage };
  const items = SECTIONS.map((slug) => ({ slug, label: sectionLabel(slug) }));

  return (
    <SettingsFrame
      title={t('settings.project.title')}
      lead={
        <span className="inline-flex max-w-full items-center gap-2">
          <ProjectBadge project={known} />
          <span className="min-w-0 truncate font-medium text-ink">{known.name}</span>
          <span translate="no" className="shrink-0 tabular-nums">
            {known.identifier}
          </span>
        </span>
      }
      nav={<SectionNav label={t('settings.project.nav_label')} items={items} current={current} hrefFor={(slug) => paths.projectSettings(known.identifier, slug)} />}
    >
      {current === null ? (
        <EmptyState
          icon={CircleAlert}
          title={t('settings.project.unknown.title')}
          description={t('settings.project.unknown.description', { identifier: known.identifier })}
          actions={
            <Link href={paths.projectSettings(known.identifier, 'general')} className={buttonClass({ variant: 'primary' })}>
              {t('settings.project.unknown.to_general')}
            </Link>
          }
        />
      ) : (
        <>
          {known.archived_at !== null && (
            <Banner tone="info" icon={Archive} role="status" title={t('settings.project.archived.title')}>
              {canManage ? t('settings.project.archived.description_manage') : t('settings.project.archived.description')}
            </Banner>
          )}
          {denied && <ReadOnlyBanner reason={denied} />}
          {/* The sections keep their drafts, choices and dialogs in state: each project gets sections of its own, or an
              unsaved edit of one would turn up in the other. */}
          <Fragment key={known.id}>
            {current === 'general' && <General {...props} />}
            {current === 'members' && <Members {...props} />}
          </Fragment>
        </>
      )}
    </SettingsFrame>
  );
}

