/*
 * The states of an item list besides its rows: the skeleton while it loads (in the shape of its layout, 13c: rows of
 * the list, columns of the board, rows of the table, bars of the timeline), shown only after a moment so an answer
 * within 300 ms shows without a flash; the empty list (no items at all, or none that match the filter); and the list
 * that could not be loaded, with "Erneut versuchen".
 */

import { Link } from '@inertiajs/react';
import { FunnelX, List, SquareKanban, SquarePen } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { Button, buttonClass } from '@/components/ui/Button';
import { cx } from '@/components/ui/cx';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { Skeleton, SkeletonGroup } from '@/components/ui/Skeleton';
import type { ItemsPreset } from '@/domain/viewState';
import { t } from '@/lib/i18n';
import { paths } from '@/lib/links';
import { SHORTCUTS } from '@/lib/shortcuts/catalog';
import type { Display, Project, View } from '@/types';
import { MyItemsEmpty } from './MyItemsEmpty';

const WIDTHS = ['w-2/5', 'w-1/3', 'w-1/2', 'w-1/4', 'w-2/5', 'w-1/3', 'w-1/2', 'w-1/4'];

function ListShape({ mark = true }: { mark?: boolean }) {
  return (
    <div data-skeleton={mark ? 'list' : undefined} className="flex flex-col gap-0.5">
      <Skeleton className="mb-2 ml-2 h-4 w-32" />
      {WIDTHS.map((width, index) => (
        <div key={index} className="flex h-11 items-center gap-2 px-2 sm:h-9">
          <Skeleton className="size-4" />
          <Skeleton className="size-4" />
          <Skeleton className="h-3.5 w-14" />
          <Skeleton className={cx('h-3.5', width)} />
          <span className="ml-auto flex items-center gap-1.5">
            <Skeleton className="h-6 w-20 max-sm:hidden" />
            <Skeleton className="size-5 rounded-full" />
          </span>
        </div>
      ))}
    </div>
  );
}

function BoardShape() {
  return (
    <div data-skeleton="board" className="flex gap-3 overflow-hidden">
      {[3, 2, 4, 1].map((cards, column) => (
        <div key={column} className="flex w-72 shrink-0 flex-col gap-2 rounded-card bg-sunken p-2">
          <Skeleton className="h-4 w-24" />
          {Array.from({ length: cards }, (_, card) => (
            <Skeleton key={card} className="h-20 w-full" />
          ))}
        </div>
      ))}
    </div>
  );
}

function TableShape() {
  return (
    <div data-skeleton="table" className="flex flex-col">
      <div className="flex h-9 items-center gap-4 border-b border-line px-2">
        {['w-12', 'w-40', 'w-20', 'w-20', 'w-16'].map((width, index) => (
          <Skeleton key={index} className={cx('h-3', width)} />
        ))}
      </div>
      {WIDTHS.map((width, index) => (
        <div key={index} className="flex h-9 items-center gap-4 border-b border-line px-2">
          <Skeleton className="h-3.5 w-12" />
          <Skeleton className={cx('h-3.5', width)} />
          <Skeleton className="h-3.5 w-20" />
          <Skeleton className="h-3.5 w-20" />
          <Skeleton className="h-3.5 w-16" />
        </div>
      ))}
    </div>
  );
}

function TimelineShape() {
  const bars = [
    ['ml-[5%]', 'w-1/3'],
    ['ml-[20%]', 'w-1/4'],
    ['ml-[10%]', 'w-1/2'],
    ['ml-[40%]', 'w-1/5'],
    ['ml-[30%]', 'w-1/3'],
  ];
  return (
    <div data-skeleton="timeline" className="flex flex-col gap-3">
      <Skeleton className="h-6 w-full" />
      {bars.map(([offset, width], index) => (
        <div key={index} className="flex h-8 items-center">
          <Skeleton className={cx('h-6', offset, width)} />
        </div>
      ))}
    </div>
  );
}

const SHAPES: Record<Display['layout'], () => ReactNode> = { list: () => <ListShape />, board: BoardShape, table: TableShape, timeline: TimelineShape };

/** The list in outline, in the shape of its layout. */
export function ListSkeleton({ layout }: { layout: Display['layout'] }) {
  const Shape = SHAPES[layout];
  return (
    <SkeletonGroup label={t('items.screen.loading')}>
      <Shape />
    </SkeletonGroup>
  );
}

/** The skeleton, but only after a moment: an answer within 300 ms shows without a flash of it. */
export function DelayedSkeleton({ layout }: { layout: Display['layout'] }) {
  const [late, setLate] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setLate(true), 300);
    return () => clearTimeout(timer);
  }, []);
  return late ? <ListSkeleton layout={layout} /> : <div className="h-40" aria-busy="true" />;
}

/** The whole screen in outline, while the project or view it belongs to loads. */
export function ScreenSkeleton() {
  return (
    <SkeletonGroup label={t('common.loading')}>
      <div className="flex h-8 items-center gap-2">
        <Skeleton className="size-5" />
        <Skeleton className="h-5 w-48" />
        <Skeleton className="ml-auto h-8 w-64 max-sm:w-28" />
      </div>
      <div className="mt-4">
        <ListShape mark={false} />
      </div>
    </SkeletonGroup>
  );
}

interface ListEmptyProps {
  preset: ItemsPreset;
  project?: Project;
  view?: View;
  /** The list has conditions of its own. */
  filtered: boolean;
  /** Its filter differs from its base. */
  filterChanged: boolean;
  onResetFilter(): void;
  /** Why no item can be created here, or null. */
  createReason: string | null;
  onCreate(): void;
}

/** A list without items: what that means for this list, and the way on. */
export function ListEmpty({ preset, project, view, filtered, filterChanged, onResetFilter, createReason, onCreate }: ListEmptyProps) {
  if (filtered && (filterChanged || preset === 'view')) {
    return (
      <EmptyState
        icon={FunnelX}
        title={view ? t('items.empty.filtered.view_title', { name: view.name }) : t('items.empty.filtered.title')}
        description={filterChanged ? t('items.empty.filtered.changed') : t('items.empty.filtered.view')}
        actions={
          <Button variant="secondary" icon={FunnelX} onClick={onResetFilter}>
            {t('items.empty.filtered.reset')}
          </Button>
        }
      />
    );
  }

  if (preset === 'my') return <MyItemsEmpty />;

  const newItem = (
    <Button variant="primary" icon={SquarePen} shortcut={SHORTCUTS['item.create'].keys} disabledReason={createReason} onClick={onCreate}>
      {t('commands.create.label')}
    </Button>
  );
  const link = (href: string, label: string) => (
    <Link href={href} className={buttonClass({ variant: 'secondary' })}>
      {label}
    </Link>
  );
  const empty = {
    project: { title: t('items.empty.project.title', { name: project?.name ?? '' }), description: t('items.empty.project.description'), actions: newItem },
    created: { title: t('items.empty.created.title'), description: t('items.empty.created.description'), actions: newItem },
    subscribed: {
      title: t('items.empty.subscribed.title'),
      description: t('items.empty.subscribed.description'),
      actions: link(paths.projects(), t('items.empty.projects_link')),
    },
    view: {
      title: t('items.empty.view.title', { name: view?.name ?? '' }),
      description: t('items.empty.view.description'),
      actions: link(paths.views(), t('items.empty.view.all')),
    },
  }[preset];
  return <EmptyState icon={preset === 'project' ? SquareKanban : List} title={empty.title} description={empty.description} actions={empty.actions} />;
}

/** The list could not be loaded: what failed, and "Erneut versuchen". */
export function ListError({ error, onRetry, retrying }: { error: Error | null; onRetry(): void; retrying: boolean }) {
  return (
    <ErrorState
      title={t('items.screen.load_failed.title')}
      description={[error?.message, t('items.screen.load_failed.description')].filter(Boolean).join(' ')}
      onRetry={onRetry}
      retrying={retrying}
    />
  );
}
