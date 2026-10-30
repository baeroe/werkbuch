/*
 * The frame every screen lives in (spec 5.2): the sidebar from md on, below it a top bar whose menu opens the same
 * content as a drawer; the live banner above the screen; and the shortcut help above everything. The shell's shortcuts
 * are registered here. The preview panel, the create dialog and the command palette arrive with the phases that bring
 * their screens.
 */

import { useEffect, useRef, type ReactNode } from 'react';
import { cx } from '@/components/ui/cx';
import { InPageLink } from '@/components/ui/InPageLink';
import { toast } from '@/components/ui/toast';
import { t } from '@/lib/i18n';
import { useSharedProps } from '@/lib/page';
import { HelpOverlay } from '@/lib/shortcuts/HelpOverlay';
import { useUiStore } from '@/store/ui';
import { useShellBindings } from './bindings';
import { LiveIndicator } from './LiveIndicator';
import { MobileBar } from './MobileBar';
import { Sidebar } from './Sidebar';

/**
 * Shows what the server flashed once per visit: a message of success (`status`, e.g. the welcome after accepting an
 * invitation) and an error (an expired page, a refusal).
 */
function useFlash(): void {
  const { flash } = useSharedProps();
  // every visit brings a new `flash` object, also when the text is the same as before
  const shown = useRef<typeof flash | null>(null);
  useEffect(() => {
    if (shown.current === flash) return;
    shown.current = flash;
    if (flash.status) toast({ title: flash.status, tone: 'success' });
    if (flash.error) toast({ title: flash.error, tone: 'error' });
  }, [flash]);
}

export function Shell({ children }: { children: ReactNode }) {
  useShellBindings();
  useFlash();
  const collapsed = useUiStore((state) => state.sidebarCollapsed);

  return (
    <>
      <InPageLink
        to="main"
        className="sr-only rounded-ctl bg-surface px-3 py-2 text-ui font-semibold text-ink shadow-elev-2 focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-60"
      >
        {t('shell.skip_to_content')}
      </InPageLink>
      <MobileBar />
      <Sidebar />
      <main
        id="main"
        tabIndex={-1}
        data-focus-ring="none"
        className={cx('min-w-0 px-4 pt-3 pb-24 outline-none', collapsed ? 'md:pl-20' : 'md:pl-[calc(var(--side-w)+2rem)]')}
      >
        <LiveIndicator />
        {children}
      </main>
      <HelpOverlay />
    </>
  );
}
