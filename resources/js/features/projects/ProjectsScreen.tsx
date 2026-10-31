/*
 * All projects the signed-in person sees (spec 4.4, 5.2), as cards: the mark of the project (its image, or its initial),
 * name and identifier, lead and visibility, and what the person is there: their role, or "Join" for a public project
 * they are not in (a viewer until then, spec 4.3). The star puts a project into the sidebar. The sidebar's "Create
 * project" leads here with `?create=1` (the page's prop `create`), which opens the dialog "New project". The count of
 * open items joins with Phase 4.
 */

import { Link, router, usePage } from '@inertiajs/react';
import { Archive, FolderKanban, Globe, Lock, Plus, UserPlus } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { ApiError } from '@/api/client';
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
import { FavoriteToggle } from '@/features/favorites/FavoriteToggle';
import { useJoinProject, useProjects } from '@/hooks/projects';
import { useAllUsers, useCurrentUser } from '@/hooks/users';
import { notifyError } from '@/lib/errors';
import { intlLocale, t } from '@/lib/i18n';
import { paths } from '@/lib/links';
import { usePermissions } from '@/lib/permissions';
import { useDocumentTitle } from '@/lib/useDocumentTitle';
import { useUiStore } from '@/store/ui';
import type { Project, User } from '@/types';
import { CreateProjectDialog } from './CreateProjectDialog';

/** The card shows the focus ring of its link, which covers the whole card; its own controls sit above the link. */
const linkFocusRing =
  'has-[[data-card-link]:focus-visible]:outline-2 has-[[data-card-link]:focus-visible]:outline-solid has-[[data-card-link]:focus-visible]:outline-(--focus-ring) has-[[data-card-link]:focus-visible]:[box-shadow:var(--focus-halo)]';

/** The right edge of a card: the role, or the way in. */
function Membership({ project, me }: { project: Project; me: User | undefined }) {
  const join = useJoinProject();

  // `mutateAsync`: every call ends itself, also one sent again from the toast's retry while another is on its way
  async function enter(card: Element | null) {
    try {
      await join.mutateAsync(project.id);
      // the button goes with the membership: the keyboard focus moves to the link of the card instead of the page
      card?.querySelector<HTMLElement>('[data-card-link]')?.focus();
      toast({ title: t('projects.joined', { name: project.name }), tone: 'success' });
    } catch (error) {
      notifyError(t('projects.join_failed', { name: project.name }), error, () => void enter(card));
    }
  }

  if (project.archived_at !== null) {
    return (
      <Chip icon={<Archive className="size-3.5 text-muted" />} className="text-muted!">
        {t('projects.archived')}
      </Chip>
    );
  }
  if (project.is_member) {
    return (
      <Chip>
        <span className="sr-only">{t('projects.your_role')} </span>
        {t(`roles.project.${project.my_role}`)}
      </Chip>
    );
  }
  // not a member: an org admin sees private projects too, and has no need to join them
  if (project.visibility !== 'public') return <span className="text-sm text-muted">{t('projects.not_member')}</span>;
  return (
    <div className="flex items-center gap-2">
      {/* an org admin is an admin everywhere: they do not merely read along */}
      {me?.org_role !== 'admin' && <span className="text-sm text-muted">{t('projects.reading_only')}</span>}
      <Button variant="secondary" size="sm" icon={UserPlus} pending={join.isPending} onClick={(event) => void enter(event.currentTarget.closest('li'))}>
        {t('projects.join')}
      </Button>
    </div>
  );
}

function ProjectCard({ project, lead, me }: { project: Project; lead: User | undefined; me: User | undefined }) {
  const flashing = useUiStore((state) => state.flashIds.includes(project.id));
  const visibility = project.visibility === 'public' ? { label: t('projects.public'), icon: Globe } : { label: t('projects.private'), icon: Lock };

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
              href={paths.project(project.identifier)}
              data-card-link=""
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
          <FavoriteToggle kind="project" id={project.id} name={project.name} />
        </div>
      </div>

      <p className="mt-3 line-clamp-2 text-ui text-pretty break-words text-muted">{project.description || t('projects.no_description')}</p>

      <dl className="mt-4 grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-4 gap-y-1.5 text-ui">
        <dt className="text-muted">{t('projects.lead')}</dt>
        <dd className="flex min-w-0 items-center gap-2 text-ink">
          {lead && <Avatar user={lead} size="sm" decorative />}
          <span className="min-w-0 truncate">{lead?.name ?? t('projects.lead_unknown')}</span>
        </dd>
        <dt className="text-muted">{t('projects.visibility')}</dt>
        <dd className="flex items-center gap-1.5 text-ink">
          <visibility.icon className="size-3.5 text-muted" aria-hidden="true" />
          {visibility.label}
        </dd>
      </dl>

      <div className="relative z-10 mt-auto flex min-h-8 items-center justify-end pt-4">
        <Membership project={project} me={me} />
      </div>
    </li>
  );
}

/** Cards in the shape of the grid while it loads. */
function ProjectsSkeleton() {
  return (
    <SkeletonGroup label={t('projects.loading')} className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
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

/** The page's address without `name`, or with it set to `1`; everything else of the query stays. */
function addressWith(url: string, name: string, on: boolean): string {
  const address = new URL(url, window.location.origin);
  if (on) address.searchParams.set(name, '1');
  else address.searchParams.delete(name);
  return `${address.pathname}${address.search}`;
}

export function ProjectsScreen({ create }: { create: boolean }) {
  useDocumentTitle(t('projects.title'));
  const { url } = usePage();
  const projects = useProjects({ include_archived: true });
  const users = useAllUsers();
  const me = useCurrentUser();
  const { reason } = usePermissions();
  const [dialogOpen, setDialogOpen] = useState(false);
  // the switch is part of the address, so a link keeps it
  const showArchived = new URL(url, window.location.origin).searchParams.get('archived') === '1';
  const setShowArchived = (on: boolean) => router.replace({ url: addressWith(url, 'archived', on), preserveState: true, preserveScroll: true });

  // the sidebar's "Create project" comes as `?create=1`: it opens the dialog once and leaves nothing in the address
  useEffect(() => {
    if (!create) return;
    setDialogOpen(true);
    router.replace({ url: addressWith(window.location.href, 'create', false), props: (props) => ({ ...props, create: false }), preserveState: true, preserveScroll: true });
  }, [create]);

  const all = useMemo(() => {
    const collator = new Intl.Collator(intlLocale());
    return [...(projects.data?.items ?? [])].sort((a, b) => collator.compare(a.name, b.name));
  }, [projects.data]);
  const people = useMemo(() => new Map((users.data?.items ?? []).map((user) => [user.id, user])), [users.data]);
  const archivedCount = all.filter((project) => project.archived_at !== null).length;
  const shown = all.filter((project) => showArchived || project.archived_at === null);

  const createReason = reason('project.create');
  const openCreate = () => setDialogOpen(true);

  function created(project: Project) {
    setDialogOpen(false);
    useUiStore.getState().flash(project.id);
    toast({
      title: t('projects.created', { identifier: project.identifier }),
      tone: 'success',
      action: { label: t('projects.open'), onClick: () => router.visit(paths.project(project.identifier)) },
    });
  }

  const newProjectButton = (
    <Button variant="primary" icon={Plus} disabledReason={createReason} onClick={openCreate}>
      {t('projects.new')}
    </Button>
  );

  let content;
  if (projects.isPending) {
    content = <ProjectsSkeleton />;
  } else if (projects.isError && !projects.data) {
    content = (
      <ErrorState
        title={t('projects.load_failed')}
        description={projects.error instanceof ApiError ? projects.error.message : t('errors.no_answer')}
        onRetry={() => void projects.refetch()}
        retrying={projects.isFetching}
      />
    );
  } else if (shown.length === 0) {
    content =
      archivedCount > 0 ? (
        <EmptyState
          icon={Archive}
          title={t('projects.all_archived.title')}
          description={t('projects.all_archived.description')}
          actions={
            <Button variant="secondary" onClick={() => setShowArchived(true)}>
              {t('projects.show_archived')}
            </Button>
          }
        />
      ) : (
        <EmptyState icon={FolderKanban} title={t('projects.empty.title')} description={t('projects.empty.description')} actions={newProjectButton} />
      );
  } else {
    content = (
      <ul aria-label={t('projects.list_label')} className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {shown.map((project) => (
          <ProjectCard key={project.id} project={project} lead={people.get(project.lead_id)} me={me} />
        ))}
      </ul>
    );
  }

  return (
    <div className="max-w-6xl">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="min-w-0">
          <h1 className="font-display text-lg font-bold tracking-title text-ink">{t('projects.title')}</h1>
          <p className="max-w-[65ch] text-ui text-pretty text-muted">{t('projects.description')}</p>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-x-4 gap-y-2">
          {archivedCount > 0 && <Switch label={t('projects.show_archived')} checked={showArchived} onCheckedChange={setShowArchived} />}
          {newProjectButton}
        </div>
      </div>
      <div className="mt-5">{content}</div>
      <CreateProjectDialog open={dialogOpen} onOpenChange={setDialogOpen} onCreated={created} />
    </div>
  );
}
