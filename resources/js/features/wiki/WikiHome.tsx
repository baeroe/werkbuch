/*
 * The wiki without an open page (ported from the clickdummy's WikiScreen.tsx): the six pages changed last, with who
 * changed them on which day (in the organisation's time zone), or the way to the first page. A viewer reads that the
 * wiki is empty, without the button: only members and admins create pages.
 */

import { Link } from '@inertiajs/react';
import { BookOpen, Plus } from 'lucide-react';
import { useId } from 'react';
import { useUserMap } from '@/components/fields/itemData';
import { Button } from '@/components/ui/Button';
import { cx } from '@/components/ui/cx';
import { EmptyState } from '@/components/ui/EmptyState';
import { Skeleton, SkeletonGroup } from '@/components/ui/Skeleton';
import { useInstantDay } from '@/features/item-detail/shared';
import { t, tn } from '@/lib/i18n';
import type { PageNode } from '@/types';
import { SHEET } from './format';
import { PageGlyph } from './PageGlyph';
import { findPage, flattenPages } from './tree';

/** How many pages the overview lists. */
export const LATEST = 6;

export interface WikiHomeProps {
  nodes: readonly PageNode[];
  hrefOf: (id: string) => string;
  loading: boolean;
  /** Why "Erste Seite anlegen" does not work now (the rights load, or none), null when it does. */
  createReason: string | null;
  /** The person reads only: the empty wiki offers no first page. */
  readOnly: boolean;
  creating: boolean;
  onCreate: () => void;
}

export function WikiHome({ nodes, hrefOf, loading, createReason, readOnly, creating, onCreate }: WikiHomeProps) {
  const users = useUserMap();
  const day = useInstantDay();
  const headingId = useId();

  if (loading) {
    return (
      <SkeletonGroup label={t('wiki.home.loading')} className={cx(SHEET, 'flex flex-col gap-3')}>
        <Skeleton className="h-6 w-48" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-4/5" />
      </SkeletonGroup>
    );
  }

  const rows = flattenPages(nodes);
  if (rows.length === 0) {
    return (
      <EmptyState
        icon={BookOpen}
        title={t('wiki.empty.title')}
        description={readOnly ? t('wiki.empty.description_read') : t('wiki.empty.description')}
        actions={
          readOnly ? undefined : (
            <Button variant="primary" icon={Plus} pending={creating} disabledReason={createReason} onClick={onCreate}>
              {t('wiki.empty.create')}
            </Button>
          )
        }
        className="max-w-[52rem]"
      />
    );
  }

  // the newest first; pages changed at the same moment keep their order in the tree
  const latest = [...rows].sort((a, b) => (a.node.updated_at < b.node.updated_at ? 1 : a.node.updated_at > b.node.updated_at ? -1 : 0)).slice(0, LATEST);
  return (
    <section aria-labelledby={headingId} className={SHEET}>
      <h2 id={headingId} className="scroll-mt-20 font-display text-xl font-bold tracking-title text-ink">
        {t('wiki.home.title')}
      </h2>
      <p className="mt-1 max-w-[65ch] text-ui text-pretty text-muted">{tn('wiki.home.intro', rows.length)}</p>
      <ul aria-labelledby={headingId} className="mt-4 flex flex-col gap-0.5">
        {latest.map((row) => {
          const parent = row.parentId ? findPage(nodes, row.parentId) : undefined;
          const name = users.get(row.node.updated_by)?.name ?? t('wiki.home.unknown_person');
          const when = day(row.node.updated_at);
          return (
            <li key={row.id} className="relative flex min-h-11 items-center gap-3 rounded-ctl px-2 py-1.5 transition-colors duration-120 hover:bg-hover">
              <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-ctl border border-line bg-surface text-base shadow-elev-1">
                <PageGlyph emoji={row.node.emoji} />
              </span>
              <div className="min-w-0 flex-1">
                <Link href={hrefOf(row.id)} className="block truncate text-ui font-medium text-ink no-underline after:absolute after:inset-0 after:rounded-ctl">
                  {row.node.title}
                </Link>
                <p className="truncate text-sm text-muted">
                  {parent ? t('wiki.home.changed_in', { name, day: when, parent: parent.title }) : t('wiki.home.changed', { name, day: when })}
                </p>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
