/*
 * The sidebar (spec 5.2, moodboard): Inbox, Meine Items, the starred views and projects (a project opens to Items, Wiki,
 * Templates and Settings), at the bottom the profile and the settings. Tracing paper floating over the dot paper;
 * collapsed it shrinks to a rail of icons. Below md the same content lives in the drawer of the top bar (MobileBar). The
 * starred views, the unread count and search join with the phases that bring their screens.
 */

import { Link, usePage } from '@inertiajs/react';
import type { LucideIcon } from 'lucide-react';
import {
  BookOpen,
  ChevronDown,
  CircleAlert,
  FolderKanban,
  Inbox,
  Layers,
  LayoutTemplate,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Settings,
  SquareKanban,
  UserRoundCheck,
} from 'lucide-react';
import { useId, useState, type ReactNode } from 'react';
import { cx } from '@/components/ui/cx';
import { IconButton } from '@/components/ui/IconButton';
import { ariaKeyshortcuts } from '@/components/ui/Kbd';
import { ProjectBadge } from '@/components/ui/ProjectBadge';
import { Skeleton, SkeletonGroup } from '@/components/ui/Skeleton';
import { Tooltip } from '@/components/ui/Tooltip';
import { useProjects } from '@/hooks/projects';
import { useRefetchFailed } from '@/hooks/retry';
import { useFavorites } from '@/hooks/views';
import { t, type TranslationKey } from '@/lib/i18n';
import { paths, useActivePath } from '@/lib/links';
import { usePermissions } from '@/lib/permissions';
import { SHORTCUTS } from '@/lib/shortcuts/catalog';
import { useUiStore } from '@/store/ui';
import { ProfileMenu } from './ProfileMenu';

type SideLinkProps = {
  href: string;
  children: ReactNode;
  /** 16 px icon; it turns ink blue on the current page. */
  leading?: ReactNode;
  /** Active only on exactly this path, not below it. */
  end?: boolean;
  /** Further paths on which the link counts as current. */
  also?: string[];
  /** Sub-entries of a project and the "Alle …" links. */
  indent?: boolean;
  /** Medium weight for the main entries. */
  strong?: boolean;
  /** Pencil grey, for "Alle Views" and "Alle Projekte". */
  quiet?: boolean;
};

/** One row of the sidebar. The current page is a sheet of card laid on the tracing paper (the active stripe). */
function SideLink({ href, children, leading, end = false, also = [], indent = false, strong = false, quiet = false }: SideLinkProps) {
  const active = useActivePath(href, end, also);
  return (
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
      className={cx(
        'flex h-11 min-w-0 items-center gap-2 rounded-ctl px-2 text-ui transition-colors duration-120 md:h-8',
        indent && 'pl-9',
        strong && 'font-medium',
        active ? 'bg-raised text-ink shadow-elev-1 ring-1 ring-line-input ring-inset' : cx('hover:bg-hover', quiet ? 'text-muted hover:text-ink' : 'text-ink'),
      )}
    >
      {leading && <span className={cx('inline-flex shrink-0', active ? 'text-accent-text' : 'text-muted')}>{leading}</span>}
      <span className="min-w-0 flex-1 truncate">{children}</span>
    </Link>
  );
}

function SectionHeader({ id, title, action }: { id: string; title: string; action?: ReactNode }) {
  return (
    <div className="flex h-6 items-center justify-between pl-2">
      <h2 id={id} className="text-sm font-semibold text-muted">
        {title}
      </h2>
      {action}
    </div>
  );
}

/** The starred views, and the link to all of them; views and their stars join with Phase 5. */
function ViewsSection() {
  const id = useId();
  return (
    <section aria-labelledby={id}>
      <SectionHeader id={id} title={t('shell.nav.views')} />
      <ul className="mt-0.5 flex flex-col gap-0.5">
        <li className="px-2 py-1 text-sm text-pretty text-muted">{t('shell.nav.starred_views_empty')}</li>
        <li>
          <SideLink href={paths.views()} end indent quiet>
            {t('shell.nav.all_views')}
          </SideLink>
        </li>
      </ul>
    </section>
  );
}

/** The "+" of a section: a link to where something new is made, or disabled with the reason. */
function AddLink({ href, label, reason }: { href: string; label: string; reason: string | null }) {
  if (reason) return <IconButton icon={Plus} label={label} size="sm" disabledReason={reason} />;
  return (
    <Tooltip content={label}>
      <Link
        href={href}
        aria-label={label}
        className="inline-flex size-11 shrink-0 items-center justify-center rounded-chip text-muted transition-colors duration-120 hover:bg-hover hover:text-ink md:size-6"
      >
        <Plus className="size-3.5" aria-hidden="true" />
      </Link>
    </Tooltip>
  );
}

function SectionLoading({ label }: { label: string }) {
  return (
    <li>
      <SkeletonGroup label={label} className="flex flex-col gap-3 px-2 py-2">
        <Skeleton className="h-3.5 w-3/4" />
        <Skeleton className="h-3.5 w-1/2" />
      </SkeletonGroup>
    </li>
  );
}

function SectionError({ message, onRetry }: { message: string; onRetry: () => void }) {
  // after an outage the screen beside it failed as well: one retry fetches every failed query again
  const refetchFailed = useRefetchFailed();
  // the alert sits inside the list item, so the list keeps its structure
  return (
    <li>
      <div role="alert" className="flex flex-wrap items-center gap-x-2 gap-y-1 px-2 py-1 text-sm text-danger">
        <CircleAlert className="size-3.5 shrink-0" aria-hidden="true" />
        {message}
        <button
          type="button"
          onClick={() => {
            onRetry();
            refetchFailed();
          }}
          className="inline-flex h-11 cursor-pointer items-center rounded-chip font-semibold text-accent-text underline-offset-2 hover:underline md:h-6"
        >
          {t('common.retry')}
        </button>
      </div>
    </li>
  );
}

/** The areas of a project under its name in the sidebar; Items, Wiki and Templates open with their phases. */
const PROJECT_AREAS: { href: (identifier: string) => string; label: TranslationKey; icon: LucideIcon; end?: boolean }[] = [
  { href: (identifier) => paths.project(identifier), label: 'shell.nav.project_items', icon: SquareKanban, end: true },
  { href: (identifier) => paths.wiki(identifier), label: 'shell.nav.project_wiki', icon: BookOpen },
  { href: (identifier) => paths.templates(identifier), label: 'shell.nav.project_templates', icon: LayoutTemplate },
  { href: (identifier) => paths.projectSettings(identifier), label: 'shell.nav.project_settings', icon: Settings },
];

/** The identifier of the project the current page belongs to, if any. */
function useCurrentProject(): string | undefined {
  const { url } = usePage();
  return /^\/projects\/([^/?#]+)/.exec(url)?.[1];
}

/** The starred projects (archived ones and those the person no longer sees are left out), and the link to all of them. */
function ProjectsSection() {
  const id = useId();
  const favorites = useFavorites();
  // the query of the rights (archived ones included), so the list loads once; archived projects stay out of the sidebar
  const projects = useProjects({ include_archived: true });
  const { reason } = usePermissions();
  const current = useCurrentProject();
  // the project of the current page starts open; the chevron overrides that per project
  const [toggled, setToggled] = useState<Record<string, boolean>>({});
  const favoriteProjects = (favorites.data?.items ?? [])
    .filter((favorite) => favorite.kind === 'project')
    .flatMap((favorite) => projects.data?.items.filter((project) => project.id === favorite.id && project.archived_at === null) ?? []);

  let rows: ReactNode;
  if (favorites.isError || projects.isError) {
    rows = (
      <SectionError
        message={t('shell.nav.projects_failed')}
        onRetry={() => {
          void favorites.refetch();
          void projects.refetch();
        }}
      />
    );
  } else if (!favorites.data || !projects.data) {
    rows = <SectionLoading label={t('shell.nav.projects_loading')} />;
  } else if (favoriteProjects.length === 0) {
    rows = <li className="px-2 py-1 text-sm text-pretty text-muted">{t('shell.nav.starred_projects_empty')}</li>;
  } else {
    rows = favoriteProjects.map((project) => {
      const open = toggled[project.id] ?? project.identifier === current;
      const areasId = `${id}-${project.id}`;
      return (
        <li key={project.id}>
          <button
            type="button"
            aria-expanded={open}
            aria-controls={areasId}
            onClick={() => setToggled((state) => ({ ...state, [project.id]: !open }))}
            className="flex h-11 w-full min-w-0 cursor-pointer items-center gap-2 rounded-ctl px-2 text-left text-ui font-medium text-ink transition-colors duration-120 hover:bg-hover md:h-8"
          >
            <ProjectBadge project={project} />
            <span className="min-w-0 flex-1 truncate">{project.name}</span>
            <ChevronDown className={cx('size-3.5 shrink-0 text-muted transition-transform duration-160', !open && '-rotate-90')} aria-hidden="true" />
          </button>
          {open && (
            <ul id={areasId} className="mt-0.5 flex flex-col gap-0.5">
              {PROJECT_AREAS.map(({ href, label, icon: Icon, end }) => (
                <li key={label}>
                  <SideLink href={href(project.identifier)} end={end} indent leading={<Icon className="size-4" aria-hidden="true" />}>
                    {t(label)}
                  </SideLink>
                </li>
              ))}
            </ul>
          )}
        </li>
      );
    });
  }

  return (
    <section aria-labelledby={id}>
      <SectionHeader
        id={id}
        title={t('shell.nav.projects')}
        action={<AddLink href={paths.newProject()} label={t('shell.nav.create_project')} reason={reason('project.create')} />}
      />
      <ul className="mt-0.5 flex flex-col gap-0.5">
        {rows}
        <li>
          <SideLink href={paths.projects()} end indent quiet>
            {t('shell.nav.all_projects')}
          </SideLink>
        </li>
      </ul>
    </section>
  );
}

/** Gear at the bottom: the settings of the organisation; in the rail as big as the other icons. */
function SettingsLink({ rail = false }: { rail?: boolean }) {
  // every section of the settings counts
  const active = useActivePath(paths.settings());
  const label = t('shell.nav.organization_settings');
  return (
    <Tooltip content={label} side={rail ? 'right' : 'top'}>
      <Link
        // straight to the first section: /settings only redirects there
        href={paths.settings('general')}
        aria-label={label}
        aria-current={active ? 'page' : undefined}
        className={cx(
          'inline-flex shrink-0 items-center justify-center transition-colors duration-120',
          rail ? 'size-9 rounded-ctl' : 'size-11 rounded-chip md:size-7',
          active ? 'bg-raised text-accent-text shadow-elev-1 ring-1 ring-line-input ring-inset' : 'text-muted hover:bg-hover hover:text-ink',
        )}
      >
        <Settings className="size-4" aria-hidden="true" />
      </Link>
    </Tooltip>
  );
}

/** The whole sidebar content; `headerAction` sits next to the wordmark (collapse, or close in the drawer). */
export function SidebarContent({ headerAction }: { headerAction?: ReactNode }) {
  return (
    <>
      <div className="flex h-8 shrink-0 items-center justify-between pl-2">
        <span translate="no" className="font-display text-lg font-bold tracking-title text-ink">
          werkbuch
        </span>
        {headerAction}
      </div>
      <ul className="flex shrink-0 flex-col gap-0.5">
        <li>
          <SideLink href={paths.inbox()} end strong leading={<Inbox className="size-4" aria-hidden="true" />}>
            {t('shell.nav.inbox')}
          </SideLink>
        </li>
        <li>
          <SideLink href={paths.myItems()} end also={[paths.created(), paths.subscribed()]} strong leading={<UserRoundCheck className="size-4" aria-hidden="true" />}>
            {t('shell.nav.my_items')}
          </SideLink>
        </li>
      </ul>
      {/* the favorites scroll; the inset keeps focus rings inside the scroll box */}
      <div className="-mx-2 flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto overscroll-contain px-2 py-0.5">
        <ViewsSection />
        <ProjectsSection />
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <ProfileMenu />
        <SettingsLink />
      </div>
    </>
  );
}

type RailLinkProps = { href: string; label: TranslationKey; icon: LucideIcon; end?: boolean; also?: string[]; shortcut: keyof typeof SHORTCUTS };

function RailLink({ href, label, icon: Icon, end = false, also = [], shortcut }: RailLinkProps) {
  const active = useActivePath(href, end, also);
  const keys = SHORTCUTS[shortcut].keys;
  const name = t(label);
  return (
    <Tooltip content={name} shortcut={keys} side="right">
      <Link
        href={href}
        aria-label={name}
        aria-current={active ? 'page' : undefined}
        aria-keyshortcuts={ariaKeyshortcuts(keys)}
        className={cx(
          'relative inline-flex size-9 shrink-0 items-center justify-center rounded-ctl transition-colors duration-120',
          active ? 'bg-raised text-accent-text shadow-elev-1 ring-1 ring-line-input ring-inset' : 'text-muted hover:bg-hover hover:text-ink',
        )}
      >
        <Icon className="size-4" aria-hidden="true" />
      </Link>
    </Tooltip>
  );
}

/** The collapsed sidebar: a rail of icons with tooltips. */
function SidebarRail() {
  const toggleSidebar = useUiStore((state) => state.toggleSidebar);
  return (
    <nav aria-label={t('shell.sidebar.label')} className="tracing fixed top-2 bottom-2 left-2 z-20 hidden w-12 flex-col items-center gap-1 rounded-card py-2 [--glass-shadow:var(--elev-1)] md:flex">
      <IconButton icon={PanelLeftOpen} label={t('shell.sidebar.expand')} onClick={toggleSidebar} className="md:size-9" />
      <span className="my-1 h-px w-6 bg-edge" aria-hidden="true" />
      <RailLink href={paths.inbox()} end label="shell.nav.inbox" icon={Inbox} shortcut="shell.go.inbox" />
      <RailLink href={paths.myItems()} end also={[paths.created(), paths.subscribed()]} label="shell.nav.my_items" icon={UserRoundCheck} shortcut="shell.go.my_items" />
      <RailLink href={paths.views()} label="shell.nav.views" icon={Layers} shortcut="shell.go.views" />
      <RailLink href={paths.projects()} label="shell.nav.projects" icon={FolderKanban} shortcut="shell.go.projects" />
      <div className="mt-auto flex flex-col items-center gap-1">
        <SettingsLink rail />
        <ProfileMenu compact />
      </div>
    </nav>
  );
}

/** The sidebar from md on: full or as a rail. */
export function Sidebar() {
  const collapsed = useUiStore((state) => state.sidebarCollapsed);
  const toggleSidebar = useUiStore((state) => state.toggleSidebar);
  if (collapsed) return <SidebarRail />;
  return (
    <nav
      aria-label={t('shell.sidebar.label')}
      className="tracing fixed top-2 bottom-2 left-2 z-20 hidden w-[var(--side-w)] flex-col gap-4 rounded-card p-2 [--glass-shadow:var(--elev-1)] md:flex"
    >
      <SidebarContent headerAction={<IconButton icon={PanelLeftClose} label={t('shell.sidebar.collapse')} onClick={toggleSidebar} />} />
    </nav>
  );
}
