/*
 * What the building blocks of the item detail share, in the preview (`ItemPeek`) and on the page (`ItemPage`):
 * - `DetailContext`: where the detail is shown, how another item opens there (the preview switches, the page
 *   navigates), the heading level of its sections, and the actions the shortcuts e, m and r reach (the title, the
 *   comment composer and the relation dialog register them).
 * - `Section`: a titled part of the detail with actions on the right.
 * - `LinkedItem`: another item in one line (status, key, title), a link that opens it.
 * - `isGone`: whether a failed read means the item is gone for the reader.
 */

import { createContext, useContext, useEffect, useId, type MouseEvent, type ReactNode, type RefObject } from 'react';
import { ApiError } from '@/api/client';
import { useItemWorkflow } from '@/components/fields/itemData';
import { ItemKey } from '@/components/items/ItemKey';
import { cx } from '@/components/ui/cx';
import { StatusIcon } from '@/components/ui/StatusIcon';
import type { WorkItem } from '@/types';

export type DetailSurface = 'peek' | 'page';

/** What the shortcuts and menus of the detail start; each part registers its own while it is mounted. */
export interface DetailActions {
  editTitle?: () => void;
  writeComment?: () => void;
  addRelation?: () => void;
  simulateConflict?: () => void;
}

export interface DetailContextValue {
  surface: DetailSurface;
  /** Opens another item where the detail is: the preview shows it, the page navigates to it. */
  open: (item: Pick<WorkItem, 'id' | 'key'>) => void;
  actions: RefObject<DetailActions>;
}

export const DetailContext = createContext<DetailContextValue | null>(null);

export function useDetail(): DetailContextValue {
  const value = useContext(DetailContext);
  if (!value) throw new Error('useDetail needs an item detail around it');
  return value;
}

/**
 * The item is gone for this reader: deleted, or in a project they no longer see (404, or 403 for lost access). The
 * detail then says so instead of keeping what it loaded before; any other failed reload keeps the item on screen.
 */
export function isGone(error: unknown): boolean {
  return error instanceof ApiError && (error.status === 404 || error.status === 403);
}

/** Section headings sit one level below the item's title: h3 in the preview (h2 title), h2 on the page (h1). */
export function SectionHeading({ id, children, className }: { id: string; children: ReactNode; className?: string }) {
  const { surface } = useDetail();
  const Heading = surface === 'page' ? 'h2' : 'h3';
  return (
    <Heading id={id} className={cx(surface === 'page' ? 'font-display text-lg font-bold tracking-title text-ink' : 'text-sm font-semibold text-muted', className)}>
      {children}
    </Heading>
  );
}

type SectionProps = {
  title: ReactNode;
  /** Buttons on the right of the heading. */
  actions?: ReactNode;
  /** A short note beside the heading, e.g. the save state or a count. */
  aside?: ReactNode;
  children?: ReactNode;
  className?: string;
};

export function Section({ title, actions, aside, children, className }: SectionProps) {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className={cx('mt-4 border-t border-edge pt-3', className)}>
      <div className="flex min-h-7 items-center gap-2">
        <SectionHeading id={headingId}>{title}</SectionHeading>
        {aside && <div className="min-w-0 text-sm text-muted">{aside}</div>}
        {actions && <div className="ml-auto flex shrink-0 items-center gap-1">{actions}</div>}
      </div>
      {children}
    </section>
  );
}

/**
 * When the control that had the focus goes away (a deleted comment, relation or file), the focus would fall back to
 * the page: once React has drawn the change, it goes to `next` instead.
 */
export function focusWhenLost(next: () => HTMLElement | null | undefined): void {
  requestAnimationFrame(() => {
    const active = document.activeElement;
    if (!active || active === document.body || !active.isConnected) next()?.focus();
  });
}

/** While `active`, leaving or reloading the page asks first, so typed text is not lost on the way. */
export function useUnsavedGuard(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [active]);
}

/** A plain click opens the item in place; a click with a modifier key leaves the browser to open the page. */
export function openHandler(open: () => void) {
  return (event: MouseEvent) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    open();
  };
}

type LinkedItemProps = {
  item: WorkItem;
  /** Controls after the title (remove, avatar); they sit above the link. */
  trailing?: ReactNode;
  className?: string;
};

/** Another item in one line: its status, key and title as a link that opens it where the detail is. */
export function LinkedItem({ item, trailing, className }: LinkedItemProps) {
  const { open } = useDetail();
  const { workflow } = useItemWorkflow(item);
  const state = workflow?.states.find((entry) => entry.id === item.state_id);
  return (
    <div className={cx('relative flex min-h-11 min-w-0 items-center gap-2 rounded-ctl px-2 transition-colors duration-120 hover:bg-hover md:min-h-8', className)}>
      {state ? (
        <StatusIcon icon={state.icon} category={state.category} label={`Status ${state.name}`} className="size-3.5" />
      ) : (
        <span className="size-3.5 shrink-0" aria-hidden="true" />
      )}
      <a
        href={`/items/${item.key}`}
        onClick={openHandler(() => open(item))}
        className="flex min-w-0 flex-1 items-center gap-2 rounded-chip text-ui text-ink no-underline after:absolute after:inset-0 after:rounded-ctl"
      >
        <ItemKey value={item.key} className="text-sm text-muted" />
        <span className={cx('min-w-0 truncate', item.archived_at && 'text-muted')}>{item.title}</span>
      </a>
      {trailing && <div className="relative z-10 flex shrink-0 items-center gap-1">{trailing}</div>}
    </div>
  );
}
