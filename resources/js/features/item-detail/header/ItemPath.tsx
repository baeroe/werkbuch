/*
 * Where an item stands, on its page: the project, the parent item, the key. Two levels (spec 4.8): an item has at most
 * one parent, an epic, so the chain is the project and at most that epic; its key and title come with the item
 * (`item.parent`). Below md only the parent's key shows and the project shrinks to its badge (the name stays for screen
 * readers), so each crumb keeps a 44 px target.
 */

import { Link } from '@inertiajs/react';
import { ChevronRight } from 'lucide-react';
import { ItemKey } from '@/components/items/ItemKey';
import { cx } from '@/components/ui/cx';
import { ProjectBadge } from '@/components/ui/ProjectBadge';
import { Skeleton } from '@/components/ui/Skeleton';
import { t } from '@/lib/i18n';
import { paths } from '@/lib/links';
import type { Project, WorkItem } from '@/types';

export function ItemPath({ item, project }: { item: WorkItem; project: Project | undefined }) {
  const { parent } = item;
  return (
    <nav aria-label={t('items.detail.path')} className="min-w-0">
      <ol className="flex min-w-0 items-center gap-1.5 text-sm text-muted">
        <li className="flex min-w-0 shrink-0 items-center gap-1.5">
          {project ? (
            <Link
              href={paths.project(project.identifier)}
              className={cx(
                'relative flex min-h-11 items-center gap-1.5 rounded-chip hover:text-ink md:min-h-6',
                parent && 'max-md:after:absolute max-md:after:inset-y-0 max-md:after:-inset-x-3',
              )}
            >
              <ProjectBadge project={project} />
              <span className={cx('max-w-40 truncate', parent && 'max-md:sr-only')}>{project.name}</span>
            </Link>
          ) : (
            <Skeleton className="h-4 w-28" />
          )}
          <ChevronRight className="size-3.5 shrink-0" aria-hidden="true" />
        </li>
        {parent && (
          <li className="flex min-w-0 items-center gap-1.5">
            <Link href={paths.item(parent.key)} className="flex min-h-11 min-w-0 items-center gap-1.5 rounded-chip text-muted hover:text-ink md:min-h-6">
              <ItemKey value={parent.key} className="min-w-0 truncate md:shrink-0" />
              <span className="hidden min-w-0 truncate md:inline">{parent.title}</span>
            </Link>
            <ChevronRight className="size-3.5 shrink-0" aria-hidden="true" />
          </li>
        )}
        <li aria-current="page" className="shrink-0 text-ink">
          <ItemKey value={item.key} />
        </li>
      </ol>
    </nav>
  );
}
