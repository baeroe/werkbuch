/*
 * What the building blocks of the item detail share, in the preview (`ItemPeek`) and on the page (`ItemPage`):
 * - `DetailContext`: where the detail is shown and the actions the detail's shortcuts reach (the title registers `e`,
 *   the relations `r`).
 * - `Section`: a titled part of the detail with actions on the right and a short note beside the heading.
 * - `LinkedItem`: another item in one line (status, key, title), a link that opens it where the detail is.
 * - `useUnsavedGuard`: while text is not saved yet, leaving or reloading the page asks first.
 * - `isGone`: whether a failed read means the item is gone for the reader.
 * - `useChildType`: the type a new child of the item takes ("Kind-Item anlegen …"), or why there is none.
 * - `focusWhenLost`: where the focus goes when the control that had it goes away.
 * - `useInstantDay`: the day of an instant (created, changed, archived) in the organisation's time zone (13c).
 */

import { createContext, useContext, useEffect, useId, type ReactNode, type RefObject } from 'react';
import { ApiError } from '@/api/client';
import { cx } from '@/components/ui/cx';
import { StatusIcon } from '@/components/ui/StatusIcon';
import { formatDay } from '@/components/fields/format';
import { useItemWorkflow } from '@/components/fields/itemData';
import { ItemKey } from '@/components/items/ItemKey';
import { ItemLink, linkFocusRing } from '@/components/items/ItemLink';
import { childTypeId } from '@/domain/hierarchy';
import { cachedZone } from '@/domain/tz';
import { useOrganization } from '@/hooks/organization';
import { useProjects } from '@/hooks/projects';
import { useWorkItemTypes } from '@/hooks/workItemTypes';
import { t } from '@/lib/i18n';
import { useUiStore } from '@/store/ui';
import type { WorkItem } from '@/types';

export type DetailSurface = 'peek' | 'page';

/** What the shortcuts of the detail start; each part registers its own while it is mounted. */
export interface DetailActions {
  editTitle?: () => void;
  addRelation?: () => void;
}

export interface DetailContextValue {
  surface: DetailSurface;
  actions: RefObject<DetailActions>;
}

export const DetailContext = createContext<DetailContextValue | null>(null);

export function useDetail(): DetailContextValue {
  const value = useContext(DetailContext);
  if (!value) throw new Error('useDetail needs an item detail around it');
  return value;
}

/**
 * The type a new child item of the project takes (`childTypeId`): the default type unless it is an epic. `reason` says
 * why there is none yet: the catalogs still load, or no enabled type may have a parent.
 */
export function useChildType(projectId: string): { typeId: string | null; reason: string | null } {
  const project = useProjects({ include_archived: true }).data?.items.find((entry) => entry.id === projectId);
  const types = useWorkItemTypes().data?.items;
  if (!project || !types) return { typeId: null, reason: t('items.detail.child.loading') };
  const typeId = childTypeId(project, types);
  return { typeId, reason: typeId ? null : t('items.hierarchy.no_child_type') };
}

/**
 * The item is gone for this reader: deleted, or in a project they no longer see (404, or 403 for lost access). The
 * detail then says so instead of keeping what it loaded before. Any other failure (a 5xx, no answer) keeps the item on
 * screen: it is not lost, the server only failed to answer (13c).
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
 * When the control that had the focus goes away (the "Wiederherstellen" of the archived note), the focus would fall
 * back to the page: once React has drawn the change, it goes to `next` instead.
 */
export function focusWhenLost(next: () => HTMLElement | null | undefined): void {
  requestAnimationFrame(() => {
    const active = document.activeElement;
    if (!active || active === document.body || !active.isConnected) next()?.focus();
  });
}

/** Formats the day of an instant as the organisation counts days: 31.10.2026 (never in a fixed zone such as Berlin). */
export function useInstantDay(): (iso: string) => string {
  const zone = cachedZone(useOrganization().data.timezone);
  return (iso) => formatDay(zone.date(new Date(iso)));
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

type LinkedItemProps = {
  item: WorkItem;
  /** Controls after the title (remove, avatar); they sit above the link. */
  trailing?: ReactNode;
};

/**
 * Another item in one line: its status, key and title as a link that opens it where the detail is (the preview shows
 * it, the page goes to its page; a click with a modifier key leaves the browser to open the page).
 */
export function LinkedItem({ item, trailing }: LinkedItemProps) {
  const { surface } = useDetail();
  const { workflow } = useItemWorkflow(item);
  const state = workflow?.states.find((entry) => entry.id === item.state_id);
  return (
    <div className={cx('relative flex min-h-11 min-w-0 items-center gap-2 rounded-ctl px-2 transition-colors duration-120 hover:bg-hover md:min-h-8', linkFocusRing)}>
      {state ? (
        <StatusIcon icon={state.icon} category={state.category} label={t('items.blocked.state', { state: state.name })} className="size-3.5 shrink-0" />
      ) : (
        <span className="size-3.5 shrink-0" aria-hidden="true" />
      )}
      <ItemLink
        item={item}
        onOpen={surface === 'peek' ? (id) => useUiStore.getState().openPeek(id) : undefined}
        className="flex min-w-0 flex-1 items-center gap-2 text-ui text-ink after:rounded-ctl"
      >
        <ItemKey value={item.key} className="text-sm text-muted" />
        <span className={cx('min-w-0 truncate', item.archived_at && 'text-muted')}>{item.title}</span>
      </ItemLink>
      {trailing && <div className="relative z-10 flex shrink-0 items-center gap-1">{trailing}</div>}
    </div>
  );
}
