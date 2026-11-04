/*
 * The notifications of one group of the inbox on a card (ported from the clickdummy's GroupCard): an item is an index
 * card with the tab of its type and its key, the title as the link to the item's page and its project beside it; the
 * rows below, newest first. What belongs to no item stands on a plain card of its project (a failed template) or of
 * the organisation (a switched-off webhook).
 *
 * The item comes with its notifications (lean, `Notification.item`). One that comes without it (its project went into
 * deletion between counting and reading) is "Nicht mehr verfügbar" (13c), never "gibt es nicht mehr": the row still
 * opens the preview, which says why it cannot show the item.
 *
 * The title opens the item's page, here or in a new tab: every notification of the card is read then (Alt alone saves
 * the link and reads nothing).
 */

import { Building2 } from 'lucide-react';
import { useId, type MouseEvent, type ReactNode } from 'react';
import { Link } from '@inertiajs/react';
import { IndexCard } from '@/components/ui/IndexCard';
import { ProjectBadge } from '@/components/ui/ProjectBadge';
import { t } from '@/lib/i18n';
import { paths } from '@/lib/links';
import type { WorkItemType } from '@/types';
import type { NotificationGroup } from './notifications';
import { NotificationRow, type RowActions, type RowContext } from './NotificationRow';

type NotificationCardProps = {
  group: NotificationGroup;
  ctx: RowContext;
  types: readonly WorkItemType[] | undefined;
  /** The row with the cursor, and the one row in the tab order. */
  current: string | null;
  tabStop: string | null;
  /** The card's item is in the preview. */
  previewed: boolean;
  actions: RowActions;
  /** The title opened the item's page; `focused`: the title had the focus. */
  onOpenItem: (group: NotificationGroup, focused: boolean) => void;
};

/** The project of a card: its mark and name, or nothing while the projects load. */
function ProjectName({ ctx, projectId }: { ctx: RowContext; projectId: string | null }) {
  const project = ctx.project(projectId);
  if (!project) return null;
  return (
    <span className="flex min-w-0 items-center gap-1.5 text-sm text-muted">
      <ProjectBadge project={project} />
      <span className="min-w-0 truncate">{project.name}</span>
    </span>
  );
}

export function NotificationCard({ group, ctx, types, current, tabStop, previewed, actions, onOpenItem }: NotificationCardProps) {
  const headingId = useId();
  const item = group.itemId === null ? null : (group.notifications.find((notification) => notification.item)?.item ?? null);
  const project = ctx.project(group.projectId);
  let subject = item?.key ?? t('inbox.item.unavailable');
  if (group.itemId === null) subject = group.projectId === null ? t('inbox.organization') : (project?.name ?? t('items.group.hidden.project'));

  const rows = (
    <ul className="-mx-2 mt-1.5 flex flex-col">
      {group.notifications.map((notification) => (
        <NotificationRow
          key={notification.id}
          notification={notification}
          ctx={ctx}
          subject={subject}
          current={current === notification.id}
          tabStop={tabStop === notification.id}
          actions={actions}
        />
      ))}
    </ul>
  );

  if (group.itemId !== null) {
    const type = item ? types?.find((entry) => entry.id === item.type_id) : undefined;
    let title: ReactNode = <span className="text-muted">{t('inbox.item.unavailable')}</span>;
    if (item) {
      // the item's page, here or in a new tab, reads all of the card's notifications (Alt alone saves the link)
      const openItem = (event: MouseEvent) => onOpenItem(group, document.activeElement === event.currentTarget);
      title = (
        // the padding makes the target taller without moving anything: 24 px on desktop, 44 px on a phone
        <Link
          href={paths.item(item.key)}
          onClick={(event: MouseEvent) => {
            if (event.button === 0 && !event.altKey) openItem(event);
          }}
          onAuxClick={(event: MouseEvent) => {
            if (event.button === 1) openItem(event);
          }}
          className="rounded-chip py-3.5 text-inherit no-underline hover:underline md:py-1"
        >
          <span className="sr-only">{item.key}:</span> {item.title}
        </Link>
      );
    }
    return (
      <IndexCard tone={type?.tone ?? 'slate'} icon={type?.icon ?? 'square-check'} tabLabel={item?.key ?? '—'} selected={previewed} aria-labelledby={headingId}>
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <h2 id={headingId} className="min-w-0 text-ui font-medium text-pretty break-words text-ink">
            {title}
          </h2>
          <ProjectName ctx={ctx} projectId={item?.project_id ?? group.projectId} />
        </div>
        {rows}
      </IndexCard>
    );
  }

  return (
    <section aria-labelledby={headingId} className="relative mt-5 rounded-card border border-line bg-surface p-3 shadow-elev-1">
      <h2 id={headingId} className="flex items-center gap-2 text-ui font-medium text-ink">
        {group.projectId === null ? (
          <>
            <Building2 className="size-4 text-muted" aria-hidden="true" />
            {t('inbox.organization')}
          </>
        ) : (
          <>
            {project && <ProjectBadge project={project} />}
            <span className="min-w-0 truncate">{project?.name ?? t('items.group.hidden.project')}</span>
          </>
        )}
      </h2>
      {rows}
    </section>
  );
}
