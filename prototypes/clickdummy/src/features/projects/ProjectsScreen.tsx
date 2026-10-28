/*
 * All projects the signed-in person sees (spec 4.4, 5.2), as cards: the mark of the project (its image, or its initial),
 * name and identifier, lead, visibility and the open items, and what the person is there: their role, or "Beitreten"
 * for a public project they are not in (a viewer until then, spec 4.3). The star puts a project into the sidebar. The
 * sidebar's "Projekt anlegen" leads here with `?create=1`, which opens the dialog "Neues Projekt".
 */

import { Archive, FolderKanban, Globe, Lock, Plus, UserPlus } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { ApiError } from '@/api/client';
import { useUserMap } from '@/components/fields/itemData';
import { linkFocusRing } from '@/components/items/ItemLink';
import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';
import { cx } from '@/components/ui/cx';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { ProjectBadge } from '@/components/ui/ProjectBadge';
import { Skeleton, SkeletonGroup } from '@/components/ui/Skeleton';
import { Switch } from '@/components/ui/Switch';
import { toast } from '@/components/ui/toast';
import { useJoinProject, useMembers, useProjects } from '@/hooks/projects';
import { useWorkItems } from '@/hooks/workItems';
import { useCommand } from '@/lib/commands';
import { notifyError } from '@/lib/errors';
import { usePermissions } from '@/lib/permissions';
import { useDocumentTitle } from '@/lib/useDocumentTitle';
import { useSession } from '@/store/session';
import { useUiStore } from '@/store/ui';
import type { Project, ProjectRole } from '@/types';
import { FavoriteStar } from '@/features/views-overview/FavoriteStar';
import { CreateProjectDialog } from './CreateProjectDialog';

const COLLATOR = new Intl.Collator('de-DE');
const count = new Intl.NumberFormat('de-DE');
const ROLE_LABEL: Record<ProjectRole, string> = { admin: 'Admin', member: 'Member', viewer: 'Viewer' };
/** An item is open while its status is not Completed or Canceled. */
const OPEN = ['backlog', 'unstarted', 'started'];

/**
 * How many items of the project are open: the server counts them, a page of one item is enough. The items of an
 * archived project count as well (they only stay out of the lists); archived items are closed anyway.
 */
function OpenItems({ projectId }: { projectId: string }) {
  const open = useWorkItems({
    per_page: 1,
    include_archived: true,
    filter: {
      version: 1,
      conditions: [
        { field: 'project', op: 'in', value: [projectId] },
        { field: 'state_category', op: 'in', value: OPEN },
      ],
    },
  });
  if (open.isPending) return <Skeleton className="h-4 w-16" />;
  if (open.isError) return <span className="text-danger">nicht geladen</span>;
  return <span className="tabular-nums">{count.format(open.data.total)}&nbsp;offen</span>;
}

/** The right edge of a card: the role, or the way in. */
function Membership({ project, role, loading }: { project: Project; role: ProjectRole | undefined; loading: boolean }) {
  const join = useJoinProject();

  function enter() {
    join.mutate(project.id, {
      onSuccess: () => toast({ title: `Du bist ${project.name} beigetreten`, tone: 'success' }),
      onError: (error) => notifyError(`Beitritt zu ${project.name} nicht möglich`, error, enter),
    });
  }

  if (project.archived_at !== null) {
    return (
      <Chip icon={<Archive className="size-3.5 text-muted" />} className="text-muted!">
        Archiviert
      </Chip>
    );
  }
  if (loading) return <Skeleton className="h-6 w-16" />;
  if (role) {
    return (
      <Chip>
        <span className="sr-only">Deine Rolle: </span>
        {ROLE_LABEL[role]}
      </Chip>
    );
  }
  // not a member: an org admin sees private projects too, and has no need to join them
  if (project.visibility !== 'public') return <span className="text-sm text-muted">Kein Mitglied</span>;
  return (
    <div className="flex items-center gap-2">
      <span className="text-sm text-muted">Du liest nur mit.</span>
      <Button variant="secondary" size="sm" icon={UserPlus} pending={join.isPending} onClick={enter}>
        Beitreten
      </Button>
    </div>
  );
}

type ProjectCardProps = { project: Project; role: ProjectRole | undefined; rolesLoading: boolean };

function ProjectCard({ project, role, rolesLoading }: ProjectCardProps) {
  const lead = useUserMap().get(project.lead_id);
  const flashing = useUiStore((state) => state.flashIds.includes(project.id));
  const visibility = project.visibility === 'public' ? { label: 'Öffentlich', icon: Globe } : { label: 'Privat', icon: Lock };

  return (
    <li
      className={cx(
        'relative flex flex-col rounded-card border p-4 shadow-elev-1 transition-colors duration-120',
        project.archived_at !== null ? 'bg-sunken' : 'bg-surface',
        flashing ? 'border-line-strong ring-4 ring-wash' : 'border-line hover:border-line-strong',
        linkFocusRing,
      )}
    >
      <div className="flex items-start gap-3">
        <ProjectBadge project={project} size="md" />
        <div className="min-w-0 flex-1">
          <h2 className="font-display text-md font-bold tracking-title break-words text-ink">
            <Link
              to={`/projects/${project.identifier}`}
              data-item-link=""
              data-focus-ring="none"
              className="rounded-chip text-inherit no-underline outline-none after:absolute after:inset-0 after:rounded-card"
            >
              {project.name}
            </Link>
          </h2>
          <p translate="no" className="text-sm font-semibold text-muted tabular-nums">
            {project.identifier}
          </p>
        </div>
        <div className="relative z-10 -mt-1 -mr-1">
          <FavoriteStar kind="project" id={project.id} name={project.name} />
        </div>
      </div>

      <p className="mt-3 line-clamp-2 text-ui text-pretty break-words text-muted">{project.description || 'Keine Beschreibung.'}</p>

      <dl className="mt-4 grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-4 gap-y-1.5 text-ui">
        <dt className="text-muted">Lead</dt>
        <dd className="flex min-w-0 items-center gap-2 text-ink">
          {lead && <Avatar user={lead} size="sm" decorative />}
          <span className="min-w-0 truncate">{lead?.name ?? 'Unbekannt'}</span>
        </dd>
        <dt className="text-muted">Sichtbarkeit</dt>
        <dd className="flex items-center gap-1.5 text-ink">
          <visibility.icon className="size-3.5 text-muted" aria-hidden="true" />
          {visibility.label}
        </dd>
        <dt className="text-muted">Items</dt>
        <dd className="text-ink">
          <OpenItems projectId={project.id} />
        </dd>
      </dl>

      <div className="relative z-10 mt-auto flex min-h-8 items-center justify-end pt-4">
        <Membership project={project} role={role} loading={rolesLoading} />
      </div>
    </li>
  );
}

/** Cards in the shape of the grid while it loads. */
function ProjectsSkeleton() {
  return (
    <SkeletonGroup label="Projekte werden geladen …" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {[0, 1, 2].map((card) => (
        <div key={card} className="flex flex-col gap-3 rounded-card border border-line bg-surface p-4 shadow-elev-1">
          <div className="flex items-center gap-3">
            <Skeleton className="size-8" />
            <div className="flex flex-1 flex-col gap-1.5">
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="h-3 w-10" />
            </div>
          </div>
          <Skeleton className="h-3.5 w-full" />
          <Skeleton className="h-3.5 w-3/4" />
          <div className="mt-2 flex flex-col gap-2">
            <Skeleton className="h-3.5 w-1/2" />
            <Skeleton className="h-3.5 w-1/3" />
          </div>
        </div>
      ))}
    </SkeletonGroup>
  );
}

export function ProjectsScreen() {
  useDocumentTitle('Projekte');
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const projects = useProjects({ include_archived: true });
  const members = useMembers();
  const { reason } = usePermissions();
  const me = useSession((state) => state.userId);
  const [dialogOpen, setDialogOpen] = useState(false);
  // the switch is part of the address, so a link keeps it
  const showArchived = params.get('archived') === '1';
  const setShowArchived = (on: boolean) => {
    const next = new URLSearchParams(params);
    if (on) next.set('archived', '1');
    else next.delete('archived');
    setParams(next, { replace: true });
  };

  // the sidebar's "Projekt anlegen" comes as `?create=1`: it opens the dialog once and leaves nothing in the address
  const createRequested = params.get('create') === '1';
  useEffect(() => {
    if (!createRequested) return;
    setDialogOpen(true);
    const next = new URLSearchParams(params);
    next.delete('create');
    setParams(next, { replace: true });
  }, [createRequested, params, setParams]);

  const all = useMemo(() => [...(projects.data?.items ?? [])].sort((a, b) => COLLATOR.compare(a.name, b.name)), [projects.data]);
  const archivedCount = all.filter((project) => project.archived_at !== null).length;
  const shown = all.filter((project) => showArchived || project.archived_at === null);
  const roleIn = (projectId: string): ProjectRole | undefined => members.data?.items.find((member) => member.project_id === projectId && member.user_id === me)?.role;

  const createReason = reason('project.create');
  const openCreate = () => setDialogOpen(true);
  useCommand({ id: 'projects.create', label: 'Neues Projekt', group: 'Projekte', icon: <Plus />, keywords: ['anlegen', 'erstellen', 'projekt'], run: openCreate, when: () => createReason === null });

  function created(project: Project) {
    setDialogOpen(false);
    useUiStore.getState().flash(project.id);
    toast({ title: `Projekt ${project.identifier} angelegt`, tone: 'success', action: { label: 'Öffnen', onClick: () => void navigate(`/projects/${project.identifier}`) } });
  }

  const newProjectButton = (
    <Button variant="primary" icon={Plus} disabledReason={createReason} onClick={openCreate}>
      Neues Projekt
    </Button>
  );

  let content;
  if (projects.isPending) {
    content = <ProjectsSkeleton />;
  } else if (projects.isError && !projects.data) {
    content = (
      <ErrorState
        title="Die Projekte konnten nicht geladen werden"
        description={projects.error instanceof ApiError ? projects.error.message : 'Der Server hat nicht geantwortet.'}
        onRetry={() => void projects.refetch()}
        retrying={projects.isFetching}
      />
    );
  } else if (shown.length === 0) {
    content =
      archivedCount > 0 ? (
        <EmptyState
          icon={Archive}
          title="Alle Projekte sind archiviert"
          description="Archivierte Projekte sind schreibgeschützt und fehlen in der Seitenleiste. Sie lassen sich in ihren Einstellungen wiederherstellen."
          actions={
            <Button variant="secondary" onClick={() => setShowArchived(true)}>
              Archivierte zeigen
            </Button>
          }
        />
      ) : (
        <EmptyState
          icon={FolderKanban}
          title="Noch keine Projekte"
          description="In einem Projekt arbeitet das Team an Items. Öffentliche Projekte sehen alle in der Organisation, private nur ihre Mitglieder."
          actions={newProjectButton}
        />
      );
  } else {
    content = (
      <ul aria-label="Alle Projekte" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {shown.map((project) => (
          <ProjectCard key={project.id} project={project} role={roleIn(project.id)} rolesLoading={members.isPending} />
        ))}
      </ul>
    );
  }

  return (
    <div className="max-w-6xl">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="min-w-0">
          <h1 className="font-display text-lg font-bold tracking-title text-ink">Projekte</h1>
          <p className="max-w-[65ch] text-ui text-pretty text-muted">Öffentliche Projekte stehen allen in der Organisation offen, private nur ihren Mitgliedern.</p>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-x-4 gap-y-2">
          {archivedCount > 0 && <Switch label="Archivierte zeigen" checked={showArchived} onCheckedChange={setShowArchived} />}
          {newProjectButton}
        </div>
      </div>
      <div className="mt-5">{content}</div>
      <CreateProjectDialog open={dialogOpen} onOpenChange={setDialogOpen} onCreated={created} />
    </div>
  );
}
