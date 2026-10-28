/*
 * The settings of a project (spec 5.2): General, Members, Workflow, Types and Automations, one address each
 * (`/projects/:identifier/settings/:section?`, General without a section). Project admins and org admins change them;
 * everybody else reads, with the reason from `usePermissions` (spec 4.3).
 *
 * The project is found by its identifier or by a former one: the address is corrected to the current identifier, so
 * old links keep working after a rename.
 */

import { Archive } from 'lucide-react';
import { Fragment, useCallback } from 'react';
import { Navigate, useParams } from 'react-router';
import { ApiError } from '@/api/client';
import { NotFound } from '@/app/PageStates';
import { Banner } from '@/components/ui/Banner';
import { ProjectBadge } from '@/components/ui/ProjectBadge';
import { Skeleton } from '@/components/ui/Skeleton';
import { useMembers, useProject, useProjects } from '@/hooks/projects';
import { useUsers } from '@/hooks/users';
import { usePermissions } from '@/lib/permissions';
import { useDocumentTitle } from '@/lib/useDocumentTitle';
import { Automations } from './Automations';
import { General } from './General';
import { Members } from './Members';
import { ReadOnlyBanner, SectionNav, SettingsError, SettingsFrame, SettingsSkeleton, useSectionCommands, type SectionItem } from './SettingsParts';
import { Types } from './Types';
import { Workflow } from './Workflow';

const SECTIONS = [
  { slug: 'general', label: 'Allgemein' },
  { slug: 'members', label: 'Mitglieder' },
  { slug: 'workflow', label: 'Workflow' },
  { slug: 'types', label: 'Typen' },
  { slug: 'automations', label: 'Automatisierungen' },
] as const satisfies readonly SectionItem[];

const NO_SECTIONS: readonly SectionItem[] = [];

/** The rights of the person need the people, the projects and the memberships; until they are there, nothing is judged. */
function useRightsData() {
  const queries = [useUsers(), useProjects({ include_archived: true }), useMembers()];
  return {
    ready: queries.every((query) => query.isSuccess),
    error: queries.find((query) => query.isError)?.error,
    fetching: queries.some((query) => query.isFetching),
    retry: () => queries.filter((query) => query.isError).forEach((query) => void query.refetch()),
  };
}

export default function ProjectSettings() {
  const { identifier = '', section } = useParams();
  const current = section ?? 'general';
  const project = useProject(identifier);
  const rights = useRightsData();
  const { can, reason } = usePermissions();

  const known = project.data;
  const base = `/projects/${known?.identifier ?? identifier}/settings`;
  const hrefFor = useCallback((slug: string) => `${base}/${slug}`, [base]);
  useSectionCommands('settings.project', `Einstellungen ${known?.identifier ?? identifier}`, known ? SECTIONS : NO_SECTIONS, hrefFor);

  const label = SECTIONS.find((item) => item.slug === current)?.label;
  useDocumentTitle(known && label ? `${label} – Einstellungen ${known.identifier}` : 'Projekteinstellungen');

  if (project.isError && project.error instanceof ApiError && project.error.status === 404) {
    return (
      <NotFound
        title={`Das Projekt ${identifier.toUpperCase()} gibt es nicht`}
        description="Die Kennung stimmt nicht, oder du darfst das Projekt nicht sehen. Über die Suche findest du Projekte, Items und Seiten."
      />
    );
  }

  const loadError = project.isError ? project.error : rights.error;
  if (loadError) {
    return (
      <SettingsFrame title="Einstellungen" nav={null}>
        <SettingsError
          title="Das Projekt konnte nicht geladen werden"
          error={loadError}
          retrying={project.isFetching || rights.fetching}
          onRetry={() => {
            if (project.isError) void project.refetch();
            rights.retry();
          }}
        />
      </SettingsFrame>
    );
  }

  if (!known || !rights.ready) {
    return (
      <SettingsFrame title="Einstellungen" nav={<Skeleton className="h-9 w-full max-w-md" />}>
        <SettingsSkeleton rows={4} label="Projekteinstellungen werden geladen …" />
      </SettingsFrame>
    );
  }

  // a former identifier, or another spelling of the current one: go to the address the project has now
  if (known.identifier !== identifier) return <Navigate replace to={`/projects/${known.identifier}/settings${section ? `/${section}` : ''}`} />;

  if (!label) {
    return (
      <NotFound
        title="Diesen Bereich gibt es nicht"
        description={`Die Einstellungen von ${known.identifier} haben die Bereiche Allgemein, Mitglieder, Workflow, Typen und Automatisierungen.`}
      />
    );
  }

  const canManage = can('project.manage', known.id);
  const denied = reason('project.manage', known.id);
  const props = { project: known, canManage };

  return (
    <SettingsFrame
      title="Einstellungen"
      lead={
        <span className="inline-flex max-w-full items-center gap-2">
          <ProjectBadge project={known} />
          <span className="min-w-0 truncate font-medium text-ink">{known.name}</span>
          <span translate="no" className="shrink-0 tabular-nums">
            {known.identifier}
          </span>
        </span>
      }
      nav={<SectionNav label="Bereiche der Projekteinstellungen" items={SECTIONS} current={current} hrefFor={hrefFor} />}
    >
      {known.archived_at !== null && (
        <Banner tone="info" icon={Archive} role="status" title="Dieses Projekt ist archiviert">
          Es ist schreibgeschützt und aus Navigation und Views ausgeblendet.{canManage && ' Unter Allgemein lässt es sich wiederherstellen.'}
        </Banner>
      )}
      {!canManage && denied && <ReadOnlyBanner reason={denied} />}
      {/* The sections keep their drafts, choices and dialogs in state, and a project that has been open before is in the
          cache, so nothing remounts by itself on the way to the next one: each project gets sections of its own, or an
          unsaved edit of one would turn up in the other. */}
      <Fragment key={known.id}>
        {current === 'general' && <General {...props} />}
        {current === 'members' && <Members {...props} />}
        {current === 'workflow' && <Workflow {...props} />}
        {current === 'types' && <Types {...props} />}
        {current === 'automations' && <Automations {...props} />}
      </Fragment>
    </SettingsFrame>
  );
}
