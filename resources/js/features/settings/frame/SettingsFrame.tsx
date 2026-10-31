/*
 * The frame every settings screen sits in (organisation, personal, project; R26): the title with what the page is about,
 * the list of sections on the left, the chosen section on the right. Below the lg breakpoint (a phone, a tablet beside
 * the sidebar) the list is a row of links above the section, so the section keeps the room.
 */

import { Link } from '@inertiajs/react';
import type { LucideIcon } from 'lucide-react';
import { Lock } from 'lucide-react';
import { useEffect, useRef, type ReactNode } from 'react';
import { cx } from '@/components/ui/cx';
import { t } from '@/lib/i18n';

export interface SectionItem {
  /** The last part of the address, e.g. `members`. */
  slug: string;
  label: string;
  icon?: LucideIcon;
  /** The heading of the group the section belongs to; sections of one group follow each other. */
  group?: string;
  /** The section is for admins only: a lock and "only for admins" for screen readers mark it. */
  locked?: boolean;
}

type FrameProps = {
  /** The h1. */
  title: string;
  /** What the page is about, under the title (e.g. the project). */
  lead?: ReactNode;
  /** The `SectionNav`; without one (the page could not load) the content has the whole width. */
  nav: ReactNode;
  children: ReactNode;
};

/** Title, section navigation and the content. */
export function SettingsFrame({ title, lead, nav, children }: FrameProps) {
  return (
    <div className="mx-auto w-full max-w-6xl">
      <header className="min-w-0">
        <h1 className="scroll-mt-20 font-display text-xl font-bold tracking-title text-ink">{title}</h1>
        {lead && <div className="mt-1 min-w-0 text-ui text-muted">{lead}</div>}
      </header>
      <div className={cx('mt-4 grid items-start gap-3 lg:gap-8', nav ? 'lg:grid-cols-[12.5rem_minmax(0,1fr)]' : null)}>
        {nav}
        <div className="flex min-w-0 flex-col gap-6 lg:pt-1">{children}</div>
      </div>
    </div>
  );
}

type SectionNavProps = {
  /** Names the navigation, e.g. "Sections of the project settings". */
  label: string;
  items: readonly SectionItem[];
  current: string | null;
  /** The address of a section. */
  hrefFor: (slug: string) => string;
};

/** Consecutive sections of one group; sections without a group form one group without a heading. */
function groupsOf(items: readonly SectionItem[]): { heading: string | undefined; items: SectionItem[] }[] {
  const groups: { heading: string | undefined; items: SectionItem[] }[] = [];
  for (const item of items) {
    const last = groups.at(-1);
    if (last && last.heading === item.group) last.items.push(item);
    else groups.push({ heading: item.group, items: [item] });
  }
  return groups;
}

/** The sections as links, so ⌘-click and the back button work: vertical from lg on, a row that scrolls sideways below it. */
export function SectionNav({ label, items, current, hrefFor }: SectionNavProps) {
  const active = useRef<HTMLAnchorElement>(null);

  // on a phone the row scrolls: the current section has to be in view
  useEffect(() => {
    active.current?.scrollIntoView?.({ block: 'nearest', inline: 'center' });
  }, [current]);

  return (
    <nav aria-label={label} className="-mx-4 overflow-x-auto px-4 py-1 lg:sticky lg:top-3 lg:mx-0 lg:overflow-visible lg:px-0 lg:py-0">
      <div className="flex gap-4 lg:flex-col lg:gap-5">
        {groupsOf(items).map((group, index) => (
          // a heading may come back later in the list: the position keeps the keys apart
          <div key={`${index}:${group.heading ?? ''}`} className="flex shrink-0 items-center gap-1 lg:flex-col lg:items-stretch">
            {group.heading && <p className="hidden px-2 pb-1 text-sm font-semibold text-muted lg:block">{group.heading}</p>}
            <ul className="flex gap-1 lg:flex-col">
              {group.items.map((item) => {
                const isCurrent = item.slug === current;
                return (
                  <li key={item.slug}>
                    <Link
                      ref={isCurrent ? active : undefined}
                      href={hrefFor(item.slug)}
                      aria-current={isCurrent ? 'page' : undefined}
                      className={cx(
                        'flex h-11 items-center gap-2 rounded-ctl px-2.5 text-ui whitespace-nowrap transition-colors duration-120 lg:h-8 lg:px-2',
                        isCurrent ? 'bg-raised text-ink shadow-elev-1 ring-1 ring-line-input ring-inset' : 'text-ink hover:bg-hover',
                      )}
                    >
                      {item.icon && <item.icon className={cx('size-4 shrink-0', isCurrent ? 'text-accent-text' : 'text-muted')} aria-hidden="true" />}
                      <span className="min-w-0 flex-1 truncate">{item.label}</span>
                      {item.locked && (
                        <>
                          <Lock className="size-3 shrink-0 text-faint" aria-hidden="true" />
                          <span className="sr-only">{t('settings.frame.admins_only')}</span>
                        </>
                      )}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
    </nav>
  );
}
