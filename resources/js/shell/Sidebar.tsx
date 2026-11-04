/*
 * The sidebar (spec 5.2, moodboard): Inbox, Meine Items, the starred views and projects (sidebar/ViewsSection,
 * sidebar/ProjectsSection; a project opens to Items, Wiki, Templates and Settings), at the bottom the profile and the
 * settings. Tracing paper floating over the dot paper; collapsed it shrinks to a rail of icons. Below md the same
 * content lives in the drawer of the top bar (MobileBar). Below the wordmark the search opens the command palette
 * (`SearchButton`). The inbox carries the unread count (`InboxBadge`), in the sidebar and in the rail.
 */

import { Link } from '@inertiajs/react';
import type { LucideIcon } from 'lucide-react';
import { FolderKanban, Inbox, Layers, PanelLeftClose, PanelLeftOpen, Settings, UserRoundCheck } from 'lucide-react';
import type { ReactNode } from 'react';
import { cx } from '@/components/ui/cx';
import { IconButton } from '@/components/ui/IconButton';
import { ariaKeyshortcuts } from '@/components/ui/Kbd';
import { Tooltip } from '@/components/ui/Tooltip';
import { t, type TranslationKey } from '@/lib/i18n';
import { paths, useActivePath } from '@/lib/links';
import { SHORTCUTS } from '@/lib/shortcuts/catalog';
import { useUiStore } from '@/store/ui';
import { InboxBadge, useInboxName } from './InboxBadge';
import { ProfileMenu } from './ProfileMenu';
import { SearchButton } from './SearchButton';
import { ProjectsSection } from './sidebar/ProjectsSection';
import { SideLink } from './sidebar/parts';
import { ViewsSection } from './sidebar/ViewsSection';

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

/** The inbox row: its name says the unread count, the badge shows it. */
function InboxLink() {
  const name = useInboxName();
  return (
    <SideLink
      href={paths.inbox()}
      end
      strong
      label={name}
      leading={<Inbox className="size-4" aria-hidden="true" />}
      trailing={<InboxBadge look="full" />}
    >
      {t('shell.nav.inbox')}
    </SideLink>
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
      <SearchButton variant="full" />
      <ul className="flex shrink-0 flex-col gap-0.5">
        <li>
          <InboxLink />
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

type RailLinkProps = {
  href: string;
  label: TranslationKey;
  icon: LucideIcon;
  end?: boolean;
  also?: string[];
  shortcut: keyof typeof SHORTCUTS;
  /** A name other than the label, e.g. the inbox with its unread count. */
  name?: string;
  /** On the corner of the icon, e.g. the unread badge of the inbox. */
  badge?: ReactNode;
};

function RailLink({ href, label, icon: Icon, end = false, also = [], shortcut, name = t(label), badge }: RailLinkProps) {
  const active = useActivePath(href, end, also);
  const keys = SHORTCUTS[shortcut].keys;
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
        {badge}
      </Link>
    </Tooltip>
  );
}

/** The collapsed sidebar: a rail of icons with tooltips. */
function SidebarRail() {
  const toggleSidebar = useUiStore((state) => state.toggleSidebar);
  const inbox = useInboxName();
  return (
    <nav aria-label={t('shell.sidebar.label')} className="tracing fixed top-2 bottom-2 left-2 z-20 hidden w-12 flex-col items-center gap-1 rounded-card py-2 [--glass-shadow:var(--elev-1)] md:flex">
      <IconButton icon={PanelLeftOpen} label={t('shell.sidebar.expand')} onClick={toggleSidebar} className="md:size-9" />
      <SearchButton variant="rail" />
      <span className="my-1 h-px w-6 bg-edge" aria-hidden="true" />
      <RailLink href={paths.inbox()} end label="shell.nav.inbox" name={inbox} icon={Inbox} shortcut="shell.go.inbox" badge={<InboxBadge look="rail" />} />
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
