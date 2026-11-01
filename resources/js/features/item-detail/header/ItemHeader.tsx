/*
 * The head of the item detail (moodboard panel). In the preview the key, the project and the actions in one row
 * (watch, copy link, open as page, more, close); on the page the path (project, parent item, key) with the same
 * actions but "Als Seite öffnen". Until the item has loaded the preview's row holds a placeholder and its close button.
 */

import { X } from 'lucide-react';
import { IconButton } from '@/components/ui/IconButton';
import { ProjectBadge } from '@/components/ui/ProjectBadge';
import { Skeleton } from '@/components/ui/Skeleton';
import { useProjects } from '@/hooks/projects';
import { t } from '@/lib/i18n';
import { SHORTCUTS } from '@/lib/shortcuts/catalog';
import type { WorkItemDetail } from '@/types';
import type { DetailSurface } from '../shared';
import { CopyLinkButton, ItemMenu, OpenAsPage, WatchButton } from './ItemMenu';
import { ItemPath } from './ItemPath';

type ItemHeaderProps = {
  detail: WorkItemDetail | undefined;
  surface: DetailSurface;
  /** The preview's close button. */
  onClose?: () => void;
};

export function ItemHeader({ detail, surface, onClose }: ItemHeaderProps) {
  const projects = useProjects({ include_archived: true }).data?.items;
  const item = detail?.item;
  const project = item ? projects?.find((entry) => entry.id === item.project_id) : undefined;

  const actions = detail && item && (
    <>
      <WatchButton detail={detail} />
      <CopyLinkButton item={item} />
      {surface === 'peek' && <OpenAsPage item={item} />}
      <ItemMenu detail={detail} />
    </>
  );

  if (surface === 'page') {
    return (
      <div className="flex min-h-11 items-center gap-2">
        <ItemPath item={item!} project={project} />
        <div className="ml-auto flex shrink-0 items-center gap-0.5">{actions}</div>
      </div>
    );
  }

  return (
    <div className="flex h-14 shrink-0 items-center gap-2 border-b border-edge pr-2 pl-4 md:h-11">
      {detail && item ? (
        <>
          {/* below md the panel starts under the top bar: the key sits in the row instead of on a tab */}
          <span
            data-tone={detail.type.tone}
            translate="no"
            className="inline-flex h-6 shrink-0 items-center rounded-chip bg-[var(--tab-bg)] px-2 text-xs font-semibold text-[var(--tab-ink)] tabular-nums md:hidden"
          >
            {item.key}
          </span>
          {project ? (
            <span className="flex min-w-0 items-center gap-1.5 text-sm text-muted" title={project.name}>
              <ProjectBadge project={project} />
              {/* on phones the row needs the room for its 44 px buttons */}
              <span className="hidden truncate md:inline">{project.name}</span>
              <span className="sr-only md:hidden">{project.name}</span>
            </span>
          ) : (
            <Skeleton className="h-4 w-28" />
          )}
        </>
      ) : (
        <Skeleton className="h-4 w-32" />
      )}
      <div className="ml-auto flex shrink-0 items-center gap-0.5">
        {actions}
        <IconButton icon={X} label={t('items.peek.close')} shortcut={SHORTCUTS['peek.close'].keys} onClick={onClose} />
      </div>
    </div>
  );
}
