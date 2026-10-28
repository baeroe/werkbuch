/*
 * The sidebar (spec 5.2, moodboard): search, Inbox with its count, Meine Items, the favorite views and projects (a
 * project opens to Items, Wiki, Vorlagen and Einstellungen), at the bottom the profile and the settings. Tracing
 * paper floating over the dot paper; collapsed it shrinks to a rail of icons. Below md the same content lives in the
 * drawer of the top bar (Shell).
 */

import type { LucideIcon } from 'lucide-react';
import { BookOpen, ChevronDown, CircleAlert, FolderKanban, Inbox, Layers, LayoutTemplate, PanelLeftClose, PanelLeftOpen, Plus, Search, Settings, SquareKanban, UserRoundCheck } from 'lucide-react';
import { useId, useState, type ReactNode } from 'react';
import { Link, useLocation, useMatch } from 'react-router';
import { cx } from '@/components/ui/cx';
import { IconButton } from '@/components/ui/IconButton';
import { ariaKeyshortcuts, Kbd } from '@/components/ui/Kbd';
import { ProjectBadge } from '@/components/ui/ProjectBadge';
import { Skeleton, SkeletonGroup } from '@/components/ui/Skeleton';
import { Tooltip } from '@/components/ui/Tooltip';
import { ViewIcon } from '@/components/ui/ViewIcon';
import { useUnreadCount } from '@/hooks/notifications';
import { useProjects } from '@/hooks/projects';
import { useFavorites, useViews } from '@/hooks/views';
import { usePermissions } from '@/lib/permissions';
import { useUiStore } from '@/store/ui';
import { ProfileMenu } from './ProfileMenu';

const count = new Intl.NumberFormat('de-DE');

/** Whether the current route is `to` (with `end`) or lies below it, or is one of `also`. */
function useActive(to: string, end: boolean, also: string[]): boolean {
  const { pathname } = useLocation();
  const path = pathname.length > 1 ? pathname.replace(/\/$/, '') : pathname;
  return (end ? path === to : path === to || path.startsWith(`${to}/`)) || also.includes(path);
}

type SideLinkProps = {
  to: string;
  children: ReactNode;
  /** 16 px icon; it turns ink blue on the current page. */
  leading?: ReactNode;
  /** Active only on exactly this route, not below it. */
  end?: boolean;
  /** Further routes on which the link counts as current. */
  also?: string[];
  trailing?: ReactNode;
  /** Sub-entries of a project and the "Alle …" links. */
  indent?: boolean;
  /** Medium weight for the main entries. */
  strong?: boolean;
  /** Pencil grey, for "Alle Views" and "Alle Projekte". */
  quiet?: boolean;
};

/** One row of the sidebar. The current page is a sheet of card laid on the tracing paper (the active stripe). */
function SideLink({ to, children, leading, end = false, also = [], trailing, indent = false, strong = false, quiet = false }: SideLinkProps) {
  const active = useActive(to, end, also);
  return (
    <Link
      to={to}
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
      {trailing}
    </Link>
  );
}

function UnreadBadge() {
  const unread = useUnreadCount();
  if (unread === 0) return null;
  return (
    <span className="inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-accent px-1.5 text-2xs font-semibold text-on-accent tabular-nums">
      {count.format(unread)}
      <span className="sr-only"> ungelesen</span>
    </span>
  );
}

function SearchButton() {
  return (
    <button
      type="button"
      aria-keyshortcuts={ariaKeyshortcuts('mod+k')}
      onClick={() => useUiStore.getState().setPaletteOpen(true)}
      className="flex h-11 shrink-0 cursor-pointer items-center gap-2 rounded-ctl border border-line bg-surface px-2 text-ui text-muted shadow-elev-1 transition-colors duration-120 hover:text-ink md:h-8"
    >
      <Search className="size-4 shrink-0" aria-hidden="true" />
      Suchen …
      <Kbd keys="mod+k" className="ml-auto" aria-hidden="true" />
    </button>
  );
}

/** The "+" of a section: a link to where something new is made, or disabled with the reason. */
function AddLink({ to, label, reason }: { to: string; label: string; reason: string | null }) {
  if (reason) return <IconButton icon={Plus} label={label} size="sm" disabledReason={reason} />;
  return (
    <Tooltip content={label}>
      <Link
        to={to}
        aria-label={label}
        className="inline-flex size-11 shrink-0 items-center justify-center rounded-chip text-muted transition-colors duration-120 hover:bg-hover hover:text-ink md:size-6"
      >
        <Plus className="size-3.5" aria-hidden="true" />
      </Link>
    </Tooltip>
  );
}

function SectionHeader({ id, title, action }: { id: string; title: string; action: ReactNode }) {
  return (
    <div className="flex h-6 items-center justify-between pl-2">
      <h2 id={id} className="text-sm font-semibold text-muted">
        {title}
      </h2>
      {action}
    </div>
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

function SectionError({ what, onRetry }: { what: string; onRetry: () => void }) {
  // the alert sits inside the list item, so the list keeps its structure
  return (
    <li>
      <div role="alert" className="flex flex-wrap items-center gap-x-2 gap-y-1 px-2 py-1 text-sm text-danger">
        <CircleAlert className="size-3.5 shrink-0" aria-hidden="true" />
        {what} nicht geladen.
        <button
          type="button"
          onClick={onRetry}
          className="inline-flex h-11 cursor-pointer items-center rounded-chip font-semibold text-accent-text underline-offset-2 hover:underline md:h-6"
        >
          Erneut versuchen
        </button>
      </div>
    </li>
  );
}

function ViewsSection() {
  const id = useId();
  const favorites = useFavorites();
  const views = useViews();
  const { reason } = usePermissions();
  const favoriteViews = (favorites.data?.items ?? [])
    .filter((favorite) => favorite.kind === 'view')
    .flatMap((favorite) => views.data?.items.filter((view) => view.id === favorite.id) ?? []);

  let rows: ReactNode;
  if (favorites.isError || views.isError) {
    rows = (
      <SectionError
        what="Views"
        onRetry={() => {
          void favorites.refetch();
          void views.refetch();
        }}
      />
    );
  } else if (!favorites.data || !views.data) {
    rows = <SectionLoading label="Views werden geladen …" />;
  } else if (favoriteViews.length === 0) {
    rows = <li className="px-2 py-1 text-sm text-pretty text-muted">Views mit Stern stehen hier.</li>;
  } else {
    rows = favoriteViews.map((view) => (
      <li key={view.id}>
        <SideLink to={`/views/${view.id}`} end leading={<ViewIcon icon={view.icon} />}>
          {view.name}
        </SideLink>
      </li>
    ));
  }

  return (
    <section aria-labelledby={id}>
      <SectionHeader id={id} title="Views" action={<AddLink to="/views?create=1" label="View anlegen" reason={reason('view.create')} />} />
      <ul className="mt-0.5 flex flex-col gap-0.5">
        {rows}
        <li>
          <SideLink to="/views" end indent quiet>
            Alle Views
          </SideLink>
        </li>
      </ul>
    </section>
  );
}

const PROJECT_AREAS: { path: string; label: string; icon: LucideIcon; end?: boolean }[] = [
  { path: '', label: 'Items', icon: SquareKanban, end: true },
  { path: '/wiki', label: 'Wiki', icon: BookOpen },
  { path: '/templates', label: 'Vorlagen', icon: LayoutTemplate },
  { path: '/settings', label: 'Einstellungen', icon: Settings },
];

function ProjectsSection() {
  const id = useId();
  const favorites = useFavorites();
  const projects = useProjects();
  const { reason } = usePermissions();
  const current = useMatch('/projects/:identifier/*')?.params.identifier;
  // the project of the current route starts open; the chevron overrides that per project
  const [toggled, setToggled] = useState<Record<string, boolean>>({});
  const favoriteProjects = (favorites.data?.items ?? [])
    .filter((favorite) => favorite.kind === 'project')
    .flatMap((favorite) => projects.data?.items.filter((project) => project.id === favorite.id) ?? []);

  let rows: ReactNode;
  if (favorites.isError || projects.isError) {
    rows = (
      <SectionError
        what="Projekte"
        onRetry={() => {
          void favorites.refetch();
          void projects.refetch();
        }}
      />
    );
  } else if (!favorites.data || !projects.data) {
    rows = <SectionLoading label="Projekte werden geladen …" />;
  } else if (favoriteProjects.length === 0) {
    rows = <li className="px-2 py-1 text-sm text-pretty text-muted">Projekte mit Stern stehen hier.</li>;
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
              {PROJECT_AREAS.map(({ path, label, icon: Icon, end }) => (
                <li key={label}>
                  <SideLink to={`/projects/${project.identifier}${path}`} end={end} indent leading={<Icon className="size-4" aria-hidden="true" />}>
                    {label}
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
      <SectionHeader id={id} title="Projekte" action={<AddLink to="/projects?create=1" label="Projekt anlegen" reason={reason('project.create')} />} />
      <ul className="mt-0.5 flex flex-col gap-0.5">
        {rows}
        <li>
          <SideLink to="/projects" end indent quiet>
            Alle Projekte
          </SideLink>
        </li>
      </ul>
    </section>
  );
}

/** Gear at the bottom: the settings of the organisation; in the rail as big as the other icons. */
function SettingsLink({ rail = false }: { rail?: boolean }) {
  const active = useActive('/settings', false, []);
  return (
    <Tooltip content="Einstellungen der Organisation" side={rail ? 'right' : 'top'}>
      <Link
        to="/settings"
        aria-label="Einstellungen der Organisation"
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
      <SearchButton />
      <ul className="flex shrink-0 flex-col gap-0.5">
        <li>
          <SideLink to="/inbox" end strong leading={<Inbox className="size-4" aria-hidden="true" />} trailing={<UnreadBadge />}>
            Inbox
          </SideLink>
        </li>
        <li>
          <SideLink to="/my-items" end also={['/created', '/subscribed']} strong leading={<UserRoundCheck className="size-4" aria-hidden="true" />}>
            Meine Items
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

type RailLinkProps = { to: string; label: string; icon: LucideIcon; end?: boolean; also?: string[]; shortcut?: string; badge?: ReactNode };

function RailLink({ to, label, icon: Icon, end = false, also = [], shortcut, badge }: RailLinkProps) {
  const active = useActive(to, end, also);
  return (
    <Tooltip content={label} shortcut={shortcut} side="right">
      <Link
        to={to}
        aria-label={label}
        aria-current={active ? 'page' : undefined}
        aria-keyshortcuts={shortcut ? ariaKeyshortcuts(shortcut) : undefined}
        className={cx(
          'relative inline-flex size-9 shrink-0 items-center justify-center rounded-ctl transition-colors duration-120',
          active ? 'bg-raised text-accent-text shadow-elev-1 ring-1 ring-line-input ring-inset' : 'text-muted hover:bg-hover hover:text-ink',
        )}
      >
        <Icon className="size-4" aria-hidden="true" />
        {badge}
      </Link>
    </Tooltip>
  );
}

function RailUnread() {
  const unread = useUnreadCount();
  if (unread === 0) return null;
  return (
    <span className="absolute -top-1 -right-1 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-2xs leading-none font-semibold text-on-accent tabular-nums">
      {count.format(unread)}
      <span className="sr-only"> ungelesen</span>
    </span>
  );
}

/** The collapsed sidebar: a rail of icons with tooltips. */
function SidebarRail() {
  const toggleSidebar = useUiStore((state) => state.toggleSidebar);
  return (
    <nav aria-label="Seitenleiste" className="tracing fixed top-2 bottom-2 left-2 z-20 hidden w-12 flex-col items-center gap-1 rounded-card py-2 [--glass-shadow:var(--elev-1)] md:flex">
      <IconButton icon={PanelLeftOpen} label="Seitenleiste ausklappen" onClick={toggleSidebar} className="md:size-9" />
      <IconButton icon={Search} label="Suchen" shortcut="mod+k" onClick={() => useUiStore.getState().setPaletteOpen(true)} className="md:size-9" />
      <span className="my-1 h-px w-6 bg-edge" aria-hidden="true" />
      <RailLink to="/inbox" end label="Inbox" icon={Inbox} shortcut="g i" badge={<RailUnread />} />
      <RailLink to="/my-items" end also={['/created', '/subscribed']} label="Meine Items" icon={UserRoundCheck} shortcut="g m" />
      <RailLink to="/views" label="Views" icon={Layers} shortcut="g v" />
      <RailLink to="/projects" label="Projekte" icon={FolderKanban} shortcut="g p" />
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
      aria-label="Seitenleiste"
      className="tracing fixed top-2 bottom-2 left-2 z-20 hidden w-[var(--side-w)] flex-col gap-4 rounded-card p-2 [--glass-shadow:var(--elev-1)] md:flex"
    >
      <SidebarContent headerAction={<IconButton icon={PanelLeftClose} label="Seitenleiste einklappen" onClick={toggleSidebar} />} />
    </nav>
  );
}
