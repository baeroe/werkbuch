/*
 * The sidebar (spec 5.2, moodboard): Inbox, Meine Items, the starred views and projects, at the bottom the profile and
 * the settings. Tracing paper floating over the dot paper; collapsed it shrinks to a rail of icons. Below md the same
 * content lives in the drawer of the top bar (MobileBar). The starred entries, the unread count, search and the
 * "create" links join with the phases that bring their screens.
 */

import { Link } from '@inertiajs/react';
import type { LucideIcon } from 'lucide-react';
import { FolderKanban, Inbox, Layers, PanelLeftClose, PanelLeftOpen, Settings, UserRoundCheck } from 'lucide-react';
import { useId, type ReactNode } from 'react';
import { cx } from '@/components/ui/cx';
import { IconButton } from '@/components/ui/IconButton';
import { ariaKeyshortcuts } from '@/components/ui/Kbd';
import { Tooltip } from '@/components/ui/Tooltip';
import { t, type TranslationKey } from '@/lib/i18n';
import { paths, useActivePath } from '@/lib/links';
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
  /** The "Alle …" links. */
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

type SectionProps = {
  title: TranslationKey;
  /** What stands in the list until something is starred. */
  empty: TranslationKey;
  allLabel: TranslationKey;
  allHref: string;
};

/** The starred views or projects, and the link to all of them. */
function Section({ title, empty, allLabel, allHref }: SectionProps) {
  const id = useId();
  return (
    <section aria-labelledby={id}>
      <div className="flex h-6 items-center pl-2">
        <h2 id={id} className="text-sm font-semibold text-muted">
          {t(title)}
        </h2>
      </div>
      <ul className="mt-0.5 flex flex-col gap-0.5">
        <li className="px-2 py-1 text-sm text-pretty text-muted">{t(empty)}</li>
        <li>
          <SideLink href={allHref} end indent quiet>
            {t(allLabel)}
          </SideLink>
        </li>
      </ul>
    </section>
  );
}

/** Gear at the bottom: the settings of the organisation; in the rail as big as the other icons. */
function SettingsLink({ rail = false }: { rail?: boolean }) {
  const active = useActivePath(paths.settings());
  const label = t('shell.nav.organization_settings');
  return (
    <Tooltip content={label} side={rail ? 'right' : 'top'}>
      <Link
        href={paths.settings()}
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
        <Section title="shell.nav.views" empty="shell.nav.starred_views_empty" allLabel="shell.nav.all_views" allHref={paths.views()} />
        <Section title="shell.nav.projects" empty="shell.nav.starred_projects_empty" allLabel="shell.nav.all_projects" allHref={paths.projects()} />
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
