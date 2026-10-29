/*
 * The frame of the screens before signing in: an index card on the dot paper, its tab names the form.
 */

import type { LucideIcon } from 'lucide-react';
import { useId, type ReactNode } from 'react';
import { useDocumentTitle } from '@/lib/useDocumentTitle';

type AuthLayoutProps = {
  /** The word on the card's tab. */
  tab: string;
  tabIcon: LucideIcon;
  title: string;
  description: ReactNode;
  children: ReactNode;
  /** Links below the card. */
  footer?: ReactNode;
};

export function AuthLayout({ tab, tabIcon: TabIcon, title, description, children, footer }: AuthLayoutProps) {
  const titleId = useId();
  useDocumentTitle(title);

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
        <div className="mt-6">{children}</div>
      </section>
      {footer && <div className="mt-6 flex flex-col items-center gap-1 text-ui text-muted">{footer}</div>}
      <p className="mt-auto max-w-sm pt-12 text-center text-sm text-pretty text-muted">Klickdummy: Jede Eingabe gilt, alle Daten bleiben in diesem Browser.</p>
    </main>
  );
}
