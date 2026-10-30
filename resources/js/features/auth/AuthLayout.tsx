/*
 * The frame of the screens before signing in: an index card on the dot paper, its tab names the form. Above the form it
 * shows what the server flashed: `status` as a notice (a sent link, a set password), `error` as a problem (an expired page).
 */

import type { LucideIcon } from 'lucide-react';
import { useEffect, useId, type ReactNode } from 'react';
import { Banner } from '@/components/ui/Banner';
import { useSharedProps } from '@/lib/page';

type AuthLayoutProps = {
  /** The word on the card's tab. */
  tab: string;
  tabIcon: LucideIcon;
  title: string;
  description: ReactNode;
  children: ReactNode;
  /** Links below the card. */
  footer?: ReactNode;
  /** The screen shows the answer of the server itself (the sent link), so the flashed status stays hidden. */
  hideStatus?: boolean;
};

export function AuthLayout({ tab, tabIcon: TabIcon, title, description, children, footer, hideStatus = false }: AuthLayoutProps) {
  const titleId = useId();
  const { flash } = useSharedProps();
  const status = hideStatus ? null : flash.status;

  // names the browser tab after the screen (WCAG 2.4.2)
  useEffect(() => {
    document.title = `${title} – werkbuch`;
  }, [title]);

  return (
    <main id="main" className="flex min-h-dvh flex-col items-center px-4 pt-[max(3rem,12vh)] pb-12">
      <p translate="no" className="font-display text-2xl font-extrabold tracking-display text-ink">
        werkbuch
      </p>
      <section aria-labelledby={titleId} className="relative mt-14 w-full max-w-sm rounded-card border border-line bg-surface px-6 pt-6 pb-7 shadow-elev-1">
        <span data-tone="sky" aria-hidden="true" className="tab-shape absolute bottom-full left-5 inline-flex h-6 items-center gap-1.5 px-3 text-xs font-semibold">
          <TabIcon className="size-3.5" />
          {tab}
        </span>
        <h1 id={titleId} className="font-display text-xl font-bold tracking-title text-balance text-ink">
          {title}
        </h1>
        <div className="mt-1.5 text-ui text-pretty text-muted">{description}</div>
        {/* the regions stay in the page, so a screen reader announces a message that arrives later */}
        <div role="status" className="empty:hidden">
          {status && <Banner tone="info" title={status} className="mt-5" />}
        </div>
        <div role="alert" className="empty:hidden">
          {flash.error && <Banner tone="danger" title={flash.error} className="mt-5" />}
        </div>
        <div className="mt-6">{children}</div>
      </section>
      {footer && <div className="mt-6 flex flex-col items-center gap-1 text-ui text-muted">{footer}</div>}
    </main>
  );
}
