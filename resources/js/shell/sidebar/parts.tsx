/*
 * The pieces the sections of the sidebar share: a row (`SideLink`), the heading of a section with its "+", and the
 * loading and error rows of a section's list.
 */

import { Link } from '@inertiajs/react';
import { CircleAlert, Plus } from 'lucide-react';
import type { ReactNode } from 'react';
import { cx } from '@/components/ui/cx';
import { IconButton } from '@/components/ui/IconButton';
import { Skeleton, SkeletonGroup } from '@/components/ui/Skeleton';
import { Tooltip } from '@/components/ui/Tooltip';
import { useRefetchFailed } from '@/hooks/retry';
import { t } from '@/lib/i18n';
import { useActivePath } from '@/lib/links';

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
  /** A name other than the text, e.g. the inbox with its unread count. */
  label?: string;
  /** After the text, e.g. the unread badge of the inbox. */
  trailing?: ReactNode;
};

/** One row of the sidebar. The current page is a sheet of card laid on the tracing paper (the active stripe). */
export function SideLink({ href, children, leading, end = false, also = [], indent = false, strong = false, quiet = false, label, trailing }: SideLinkProps) {
  const active = useActivePath(href, end, also);
  return (
    <Link
      href={href}
      aria-label={label}
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
      {/* a space the flex row does not draw: as text, the name and what trails it ("Inbox" and its count) stay two
          words, and the label of the link holds them (WCAG 2.5.3) */}
      {trailing && ' '}
      {trailing}
    </Link>
  );
}

export function SectionHeader({ id, title, action }: { id: string; title: string; action?: ReactNode }) {
  return (
    <div className="flex h-6 items-center justify-between pl-2">
      <h2 id={id} className="text-sm font-semibold text-muted">
        {title}
      </h2>
      {action}
    </div>
  );
}

/** The "+" of a section: a link to where something new is made, or disabled with the reason. */
export function AddLink({ href, label, reason }: { href: string; label: string; reason: string | null }) {
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

export function SectionLoading({ label }: { label: string }) {
  return (
    <li>
      <SkeletonGroup label={label} className="flex flex-col gap-3 px-2 py-2">
        <Skeleton className="h-3.5 w-3/4" />
        <Skeleton className="h-3.5 w-1/2" />
      </SkeletonGroup>
    </li>
  );
}

export function SectionError({ message, onRetry }: { message: string; onRetry: () => void }) {
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
