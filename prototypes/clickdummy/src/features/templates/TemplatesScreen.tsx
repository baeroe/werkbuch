/*
 * The templates of a project (spec 4.12). Contract with the router (lazy-loaded, kept from Task 4): the default export
 * is the screen of /projects/:identifier/templates/:templateId? and reads both params itself.
 *
 * - Without an id: the list, each template with its schedule in words, its next run and its last run if that failed.
 * - With an id: the template's editor (TemplateEditor); `new` makes a new template.
 * - Deleting runs when the undo toast runs out (5 s): the template leaves the list at once, "Rückgängig" brings it back.
 * - Members and admins manage templates, viewers read (`template.manage`, spec 4.3).
 */

import { CalendarClock, ChevronRight, CircleAlert, FileQuestionMark, LayoutTemplate, Pause, Plus } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router';
import { ApiError } from '@/api/client';
import { NotFound } from '@/app/PageStates';
import { TypeGlyph } from '@/components/fields/TypePicker';
import { Button, buttonClass } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';
import { cx } from '@/components/ui/cx';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { ProjectBadge } from '@/components/ui/ProjectBadge';
import { Skeleton, SkeletonGroup } from '@/components/ui/Skeleton';
import { nextOccurrences } from '@/domain/recurrence';
import { useLabels } from '@/hooks/catalog';
import { useMembers, useProject, useProjects } from '@/hooks/projects';
import { useProperties } from '@/hooks/properties';
import { useDeleteTemplate, useTemplateRuns, useTemplates } from '@/hooks/templates';
import { useUsers } from '@/hooks/users';
import { useWorkItemTypes } from '@/hooks/workItemTypes';
import { now } from '@/lib/clock';
import { useCommand } from '@/lib/commands';
import { usePermissions } from '@/lib/permissions';
import { runWithUndo } from '@/lib/undo';
import { useDocumentTitle } from '@/lib/useDocumentTitle';
import type { Project, Template } from '@/types';
import { useOrgClock, useRunFormats } from './format';
import { readableSchedule } from './ScheduleEditor';
import { describeSchedule } from './scheduleText';
import { focusHeadingWhenLost, NEW_TEMPLATE, TemplateEditor } from './TemplateEditor';

const COLLATOR = new Intl.Collator('de-DE');

/**
 * Whether the signed-in person may manage the templates of the project. `usePermissions` says "not allowed" while the
 * rights load; this waits for them, so the editor does not show read-only for a moment.
 */
function useTemplateRights(projectId: string) {
  const { reason } = usePermissions();
  const queries = [useUsers(), useProjects({ include_archived: true }), useMembers()];
  const ready = queries.every((query) => query.isSuccess) || queries.some((query) => query.isError);
  return { ready, denied: reason('template.manage', projectId) };
}

function ListSkeleton() {
  return (
    <SkeletonGroup label="Vorlagen werden geladen …" className="flex flex-col gap-1">
      {[0, 1].map((row) => (
        <div key={row} className="flex items-start gap-3 px-2 py-3">
          <Skeleton className="size-8 rounded-ctl" />
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <Skeleton className="h-3.5 w-1/3" />
            <Skeleton className="h-3 w-1/2" />
          </div>
          <Skeleton className="hidden h-8 w-40 md:block" />
        </div>
      ))}
    </SkeletonGroup>
  );
}

function EditorSkeleton() {
  return (
    <SkeletonGroup label="Vorlage wird geladen …">
      <Skeleton className="h-7 w-64" />
      <Skeleton className="mt-2 h-3.5 w-96 max-w-full" />
      <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="flex flex-col gap-4 rounded-card border border-line bg-surface p-5 shadow-elev-1">
          <Skeleton className="h-9 w-full rounded-ctl" />
          <Skeleton className="h-9 w-full rounded-ctl" />
          <Skeleton className="h-24 w-full rounded-ctl" />
        </div>
        <div className="flex flex-col gap-3 rounded-card border border-line bg-surface p-5 shadow-elev-1">
          <Skeleton className="h-6 w-3/4" />
          <Skeleton className="h-8 w-full rounded-ctl" />
          <Skeleton className="h-8 w-2/3 rounded-ctl" />
        </div>
      </div>
    </SkeletonGroup>
  );
}

export function TemplatesScreen() {
  const { identifier = '', templateId } = useParams();
  const project = useProject(identifier);
  const known = project.data;

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
        title="Die Vorlagen konnten nicht geladen werden"
        description={project.error instanceof ApiError ? project.error.message : 'Der Server hat nicht geantwortet.'}
        onRetry={() => void project.refetch()}
        retrying={project.isFetching}
      />
    );
  }
  if (!known) return <EditorSkeleton />;
  // a former identifier, or another spelling of the current one: to the address the project has now
  if (known.identifier !== identifier) return <Navigate replace to={`/projects/${known.identifier}/templates${templateId ? `/${templateId}` : ''}`} />;
  // what waits for its delete belongs to its project
  return <Templates key={known.id} project={known} templateId={templateId} />;
}

export default TemplatesScreen;

function Templates({ project, templateId }: { project: Project; templateId: string | undefined }) {
  const navigate = useNavigate();
  const templates = useTemplates(project.id);
  const deleteTemplate = useDeleteTemplate();
  const rights = useTemplateRights(project.id);
  // the catalogs the editor needs, so it opens complete
  const catalogs = [useWorkItemTypes(), useProperties(), useLabels()];
  const base = `/projects/${project.identifier}/templates`;
  /** Templates waiting for their delete (the undo toast runs). */
  const [hidden, setHidden] = useState<ReadonlySet<string>>(() => new Set());
  const mounted = useRef(true);
  const currentId = useRef(templateId);
  currentId.current = templateId;
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const template = templateId && templateId !== NEW_TEMPLATE ? templates.data?.items.find((entry) => entry.id === templateId) : undefined;
  useDocumentTitle(templateId === NEW_TEMPLATE ? `Neue Vorlage – ${project.identifier}` : template ? `${template.name} – Vorlagen ${project.identifier}` : `Vorlagen ${project.identifier}`);

  function remove(target: Template) {
    const show = () => setHidden((state) => new Set([...state].filter((id) => id !== target.id)));
    setHidden((state) => new Set(state).add(target.id));
    void navigate(base);
    focusHeadingWhenLost();
    runWithUndo({
      label: `Vorlage „${target.name}“ gelöscht`,
      failureTitle: `Vorlage „${target.name}“ nicht gelöscht`,
      undo: () => {
        show();
        // back to the template, unless the person has moved on
        if (mounted.current && currentId.current === undefined) {
          void navigate(`${base}/${target.id}`);
          focusHeadingWhenLost();
        }
      },
      run: async () => {
        try {
          await deleteTemplate.mutateAsync(target.id);
        } catch (error) {
          show();
          throw error;
        }
        show();
      },
    });
  }

  const header = (
    <header className="flex min-h-8 flex-wrap items-center gap-x-3 gap-y-2">
      <div className="flex min-w-0 items-center gap-2">
        <ProjectBadge project={project} />
        <Link to={`/projects/${project.identifier}`} className="inline-flex min-h-11 min-w-0 items-center text-ui font-medium text-muted no-underline hover:text-ink hover:underline md:min-h-0">
          <span className="truncate">{project.name}</span>
        </Link>
        <ChevronRight className="size-3.5 shrink-0 text-faint" aria-hidden="true" />
        {templateId ? (
          <Link to={base} className="inline-flex min-h-11 shrink-0 items-center font-display text-lg font-bold tracking-title text-ink no-underline hover:underline md:min-h-0">
            Vorlagen
          </Link>
        ) : (
          <h1 data-screen-heading="" tabIndex={-1} className="shrink-0 scroll-mt-20 font-display text-lg font-bold tracking-title text-ink">
            Vorlagen
          </h1>
        )}
      </div>
    </header>
  );

  if (templateId) {
    const loading = (templateId !== NEW_TEMPLATE && templates.isPending) || !rights.ready || catalogs.some((query) => query.isPending);
    const failed = (templateId !== NEW_TEMPLATE && templates.isError && !templates.data) || catalogs.find((query) => query.isError);
    let body;
    if (failed) {
      const error = templates.error ?? catalogs.find((query) => query.isError)?.error;
      body = (
        <ErrorState
          title="Die Vorlage konnte nicht geladen werden"
          description={error instanceof ApiError ? error.message : 'Der Server hat nicht geantwortet.'}
          onRetry={() => {
            void templates.refetch();
            catalogs.forEach((query) => query.isError && void query.refetch());
          }}
          retrying={templates.isFetching}
        />
      );
    } else if (loading) {
      body = <EditorSkeleton />;
    } else if (templateId !== NEW_TEMPLATE && (!template || hidden.has(templateId))) {
      body = (
        <EmptyState
          icon={FileQuestionMark}
          titleAs="h1"
          title="Diese Vorlage gibt es nicht"
          description="Sie wurde gelöscht, oder der Link ist unvollständig. Unter Vorlagen stehen alle Vorlagen des Projekts."
          actions={
            <Link to={base} className={buttonClass({ variant: 'secondary' })}>
              Zu den Vorlagen
            </Link>
          }
        />
      );
    } else {
      body = <TemplateEditor key={templateId} project={project} template={template ?? null} base={base} denied={rights.denied} onDelete={remove} />;
    }
    return (
      <div className="min-w-0">
        {header}
        <div className="mt-4">{body}</div>
      </div>
    );
  }

  return <TemplateList project={project} header={header} templates={templates} hidden={hidden} base={base} createReason={rights.ready ? rights.denied : 'Die Rechte werden noch geladen.'} />;
}

type TemplateListProps = {
  project: Project;
  header: ReactNode;
  templates: ReturnType<typeof useTemplates>;
  hidden: ReadonlySet<string>;
  base: string;
  createReason: string | null;
};

function TemplateList({ project, header, templates, hidden, base, createReason }: TemplateListProps) {
  const navigate = useNavigate();
  const visible = (templates.data?.items ?? []).filter((template) => !hidden.has(template.id)).sort((a, b) => COLLATOR.compare(a.name, b.name));
  const create = () => void navigate(`${base}/${NEW_TEMPLATE}`);
  useCommand({ id: 'templates.create', label: 'Neue Vorlage', group: `Vorlagen ${project.identifier}`, icon: <Plus />, keywords: ['anlegen', 'vorlage', 'zeitplan'], run: create, when: () => createReason === null });

  const newButton = (
    <Button variant="primary" icon={Plus} disabledReason={createReason} onClick={create}>
      Neue Vorlage
    </Button>
  );

  let content;
  if (templates.isPending) content = <ListSkeleton />;
  else if (templates.isError && !templates.data) {
    content = (
      <ErrorState
        title="Die Vorlagen konnten nicht geladen werden"
        description={templates.error instanceof ApiError ? templates.error.message : 'Der Server hat nicht geantwortet.'}
        onRetry={() => void templates.refetch()}
        retrying={templates.isFetching}
      />
    );
  } else if (visible.length === 0) {
    content = (
      <EmptyState
        icon={LayoutTemplate}
        title="Noch keine Vorlagen"
        description="Eine Vorlage legt Items mit festen Feldern an, von Hand oder nach Zeitplan, etwa den Monatsbericht am ersten Montag."
        actions={newButton}
      />
    );
  } else {
    content = (
      <ul aria-label={`Vorlagen von ${project.name}`} className="flex flex-col gap-0.5">
        {visible.map((template) => (
          <TemplateRow key={template.id} template={template} href={`${base}/${template.id}`} />
        ))}
      </ul>
    );
  }

  return (
    <div className="max-w-5xl min-w-0">
      <div className="flex flex-wrap items-start gap-x-4 gap-y-2">
        <div className="min-w-0">
          {header}
          <p className="mt-1 max-w-[65ch] text-ui text-pretty text-muted">Vorlagen legen Items mit festen Feldern an. Mit Zeitplan tut das der Bot „Automation“ zur festen Zeit.</p>
        </div>
        <div className="ml-auto">{newButton}</div>
      </div>
      <div className={cx('mt-4', visible.length > 0 && !templates.isPending && 'dots rounded-card border border-line-strong bg-paper p-2 shadow-elev-1')}>{content}</div>
    </div>
  );
}

function TemplateRow({ template, href }: { template: Template; href: string }) {
  const { zone } = useOrgClock();
  const formats = useRunFormats();
  const types = useWorkItemTypes().data?.items;
  const type = types?.find((entry) => entry.id === template.payload.type_id);
  const runs = useTemplateRuns(template.id);
  const last = runs.data?.items[0];
  const { schedule } = template;
  const next = schedule && readableSchedule(schedule) ? nextOccurrences(schedule, now(), 1, zone, template.run_count)[0] : undefined;

  return (
    <li className="relative grid grid-cols-[2rem_minmax(0,1fr)] items-start gap-x-3 gap-y-2 rounded-ctl bg-surface px-3 py-3 shadow-elev-1 transition-colors duration-120 hover:bg-sunken md:grid-cols-[2rem_minmax(0,1fr)_13rem]">
      <span aria-hidden="true" className="inline-flex size-8 items-center justify-center rounded-ctl border border-line bg-surface shadow-elev-1">
        {type ? <TypeGlyph type={type} /> : <LayoutTemplate className="size-4 text-muted" />}
      </span>
      <div className="min-w-0">
        <Link to={href} className="block truncate text-ui font-semibold text-ink no-underline after:absolute after:inset-0 after:rounded-ctl">
          {template.name}
        </Link>
        <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted">
          <CalendarClock className="size-3.5 shrink-0" aria-hidden="true" />
          <span>{schedule ? describeSchedule(schedule) : 'Ohne Zeitplan, nur von Hand'}</span>
          {schedule?.paused && <Chip icon={<Pause className="size-3" />}>Pausiert</Chip>}
        </p>
        <p className="mt-0.5 truncate text-sm text-muted">
          Titel{' '}
          <span translate="no" className="text-ink">
            {template.payload.title}
          </span>
        </p>
        {last?.status === 'failed' && (
          <p className="mt-1 flex items-start gap-1.5 text-sm font-medium text-pretty text-danger">
            <CircleAlert className="mt-px size-3.5 shrink-0" aria-hidden="true" />
            Letzter Lauf gescheitert: {last.error}
          </p>
        )}
      </div>
      <div className="col-start-2 text-sm md:col-start-3 md:text-right">
        <p className="text-muted">Nächster Lauf</p>
        <p className="font-medium text-ink tabular-nums">{next ? formats.short(next) : schedule?.paused ? 'Pausiert' : 'Keiner geplant'}</p>
      </div>
    </li>
  );
}
