/*
 * The frame every screen lives in (spec 5.2): the sidebar from md on, below it a top bar whose menu opens the same
 * content as a drawer; the live banner above the screen; and the floating layers over everything: preview panel,
 * create dialog, command palette and the shortcut help. The shell's shortcuts and commands are registered here,
 * and live events reach the screens through `useLiveSync`.
 */

import { Dialog as BaseDialog } from '@base-ui/react/dialog';
import { Inbox, Menu, Search, X } from 'lucide-react';
import { Suspense, useEffect, useState } from 'react';
import { Link, Outlet, useLocation } from 'react-router';
import { cx } from '@/components/ui/cx';
import { IconButton } from '@/components/ui/IconButton';
import { Skeleton, SkeletonGroup } from '@/components/ui/Skeleton';
import { CommandPalette } from '@/features/palette/CommandPalette';
import { useLiveSync } from '@/hooks/live';
import { useUnreadCount } from '@/hooks/notifications';
import { HelpOverlay } from '@/lib/shortcuts/HelpOverlay';
import { useDialogScope } from '@/lib/shortcuts/useShortcut';
import { useUiStore } from '@/store/ui';
import { useShellBindings } from './bindings';
import { CreateHost } from './CreateHost';
import { LiveIndicator } from './LiveIndicator';
import { PeekHost } from './PeekHost';
import { SidebarContent, Sidebar } from './Sidebar';

/** Mounted while the drawer is open: it is modal, so the page's list and detail shortcuts pause. */
function DrawerScope() {
  useDialogScope();
  return null;
}

/** Below md: menu (drawer with the sidebar), wordmark, search and the inbox. */
function MobileBar() {
  const [open, setOpen] = useState(false);
  const { pathname } = useLocation();
  const unread = useUnreadCount();

  // a chosen link closes the drawer
  useEffect(() => setOpen(false), [pathname]);

  return (
    <header className="tracing sticky top-0 z-30 flex h-14 items-center gap-1 rounded-none border-x-0 border-t-0 px-2 [--glass-shadow:var(--elev-1)] md:hidden">
      <BaseDialog.Root open={open} onOpenChange={setOpen}>
        <BaseDialog.Trigger render={<IconButton icon={Menu} label="Navigation öffnen" tooltip={false} />} />
        <BaseDialog.Portal>
          <BaseDialog.Backdrop className="fixed inset-0 z-50 bg-scrim transition-opacity duration-160 data-ending-style:opacity-0 data-starting-style:opacity-0" />
          <BaseDialog.Popup
            data-focus-ring="none"
            className="tracing fixed top-2 bottom-2 left-2 z-50 flex w-[min(18rem,calc(100vw-1rem))] flex-col rounded-card p-2 outline-none transition-transform duration-160 data-ending-style:-translate-x-[110%] data-starting-style:-translate-x-[110%]"
          >
            <BaseDialog.Title className="sr-only">Navigation</BaseDialog.Title>
            <DrawerScope />
            <nav aria-label="Seitenleiste" className="flex min-h-0 flex-1 flex-col gap-4">
              <SidebarContent headerAction={<BaseDialog.Close render={<IconButton icon={X} label="Navigation schließen" tooltip={false} />} />} />
            </nav>
          </BaseDialog.Popup>
        </BaseDialog.Portal>
      </BaseDialog.Root>
      <span translate="no" className="font-display text-lg font-bold tracking-title text-ink">
        werkbuch
      </span>
      <div className="ml-auto flex items-center">
        <IconButton icon={Search} label="Suchen" tooltip={false} onClick={() => useUiStore.getState().setPaletteOpen(true)} />
        <Link
          to="/inbox"
          aria-label={unread > 0 ? `Inbox, ${unread} ungelesen` : 'Inbox'}
          className="relative inline-flex size-11 items-center justify-center rounded-chip text-muted transition-colors duration-120 hover:bg-hover hover:text-ink"
        >
          <Inbox className="size-4" aria-hidden="true" />
          {unread > 0 && <span className="absolute top-2.5 right-2.5 size-2 rounded-full bg-accent ring-2 ring-surface" aria-hidden="true" />}
        </Link>
      </div>
    </header>
  );
}

/** While a screen's code loads: a page in outline. */
function ScreenLoading() {
  return (
    <SkeletonGroup label="Wird geladen …">
      <Skeleton className="mt-1.5 h-5 w-48" />
      <div className="mt-6 flex flex-col gap-3">
        <Skeleton className="h-9 w-full rounded-ctl" />
        <Skeleton className="h-9 w-full rounded-ctl" />
        <Skeleton className="h-9 w-2/3 rounded-ctl" />
      </div>
    </SkeletonGroup>
  );
}

export function Shell() {
  useShellBindings();
  useLiveSync();
  const collapsed = useUiStore((state) => state.sidebarCollapsed);

  return (
    <>
      <a
        href="#main"
        className="sr-only rounded-ctl bg-surface px-3 py-2 text-ui font-semibold text-ink shadow-elev-2 focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-60"
      >
        Zum Inhalt
      </a>
      <MobileBar />
      <Sidebar />
      <main
        id="main"
        tabIndex={-1}
        data-focus-ring="none"
        className={cx('min-w-0 px-4 pt-3 pb-24 outline-none', collapsed ? 'md:pl-20' : 'md:pl-[calc(var(--side-w)+2rem)]')}
      >
        <LiveIndicator />
        <Suspense fallback={<ScreenLoading />}>
          <Outlet />
        </Suspense>
      </main>
      <PeekHost />
      <CreateHost />
      <CommandPalette />
      <HelpOverlay />
    </>
  );
}
