import { Dialog as BaseDialog } from '@base-ui/react/dialog';
import { Link, usePage } from '@inertiajs/react';
import { Inbox, Menu, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { IconButton } from '@/components/ui/IconButton';
import { t } from '@/lib/i18n';
import { paths } from '@/lib/links';
import { useDialogScope } from '@/lib/shortcuts/useShortcut';
import { SidebarContent } from './Sidebar';

/** Mounted while the drawer is open: it is modal, so the page's shortcuts pause (all but mod+k, escape, mod+enter). */
function DrawerScope() {
  useDialogScope();
  return null;
}

/** Below md: menu (drawer with the sidebar), wordmark and the inbox. */
export function MobileBar() {
  const [open, setOpen] = useState(false);
  const { url } = usePage();

  // a chosen link closes the drawer
  useEffect(() => setOpen(false), [url]);

  return (
    <header className="tracing sticky top-0 z-30 flex h-14 items-center gap-1 rounded-none border-x-0 border-t-0 px-2 [--glass-shadow:var(--elev-1)] md:hidden">
      <BaseDialog.Root open={open} onOpenChange={setOpen}>
        <BaseDialog.Trigger render={<IconButton icon={Menu} label={t('shell.mobile.open_navigation')} tooltip={false} />} />
        <BaseDialog.Portal>
          <BaseDialog.Backdrop className="fixed inset-0 z-50 bg-scrim transition-opacity duration-160 data-ending-style:opacity-0 data-starting-style:opacity-0" />
          <BaseDialog.Popup
            data-focus-ring="none"
            className="tracing fixed top-2 bottom-2 left-2 z-50 flex w-[min(18rem,calc(100vw-1rem))] flex-col rounded-card p-2 outline-none transition-transform duration-160 data-ending-style:-translate-x-[110%] data-starting-style:-translate-x-[110%]"
          >
            <BaseDialog.Title className="sr-only">{t('shell.mobile.navigation')}</BaseDialog.Title>
            <DrawerScope />
            <nav aria-label={t('shell.sidebar.label')} className="flex min-h-0 flex-1 flex-col gap-4">
              <SidebarContent headerAction={<BaseDialog.Close render={<IconButton icon={X} label={t('shell.mobile.close_navigation')} tooltip={false} />} />} />
            </nav>
          </BaseDialog.Popup>
        </BaseDialog.Portal>
      </BaseDialog.Root>
      <span translate="no" className="font-display text-lg font-bold tracking-title text-ink">
        werkbuch
      </span>
      <div className="ml-auto flex items-center">
        {/* the unread count joins the label with Phase 8 */}
        <Link
          href={paths.inbox()}
          aria-label={t('shell.nav.inbox')}
          className="relative inline-flex size-11 items-center justify-center rounded-chip text-muted transition-colors duration-120 hover:bg-hover hover:text-ink"
        >
          <Inbox className="size-4" aria-hidden="true" />
        </Link>
      </div>
    </header>
  );
}
