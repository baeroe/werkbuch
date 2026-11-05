/*
 * The log of a template's runs (spec 4.12), newest first, ported from the clickdummy: when the run was (its term, or
 * the moment of a run by hand), whether the schedule ran it or who pressed „Jetzt ausführen“ (A338), and the item it
 * made or why it failed. A failed run (the template was invalid at run time, e.g. a required property is missing) is
 * logged, the project lead and the template's author hear about it, and the template stays on. The item of a run opens
 * in the preview; with a modifier key its page opens in a new tab. The items of all runs are read in one request
 * (`useItemRef`): one the reader does not see, or that is gone, reads as such, without a 404.
 */

import { CircleAlert, CircleCheck } from 'lucide-react';
import { useId } from 'react';
import { ApiError } from '@/api/client';
import { useUserMap } from '@/components/fields/itemData';
import { ItemKey } from '@/components/items/ItemKey';
import { ItemLink, linkFocusRing } from '@/components/items/ItemLink';
import { cx } from '@/components/ui/cx';
import { ErrorState } from '@/components/ui/ErrorState';
import { Skeleton, SkeletonGroup } from '@/components/ui/Skeleton';
import { useItemRef } from '@/hooks/richText';
import { useTemplateRuns } from '@/hooks/templates';
import { t } from '@/lib/i18n';
import { useUiStore } from '@/store/ui';
import type { TemplateRun } from '@/types';
import { useTemplateTimes } from './format';

function RunItem({ id }: { id: string | null }) {
  const ref = useItemRef(id);
  const item = ref.data;
  if (item) {
    return (
      <ItemLink item={item} onOpen={(itemId) => useUiStore.getState().openPeek(itemId)} className="flex min-w-0 items-center gap-1.5 after:rounded-ctl">
        <ItemKey value={item.key} className="shrink-0 text-sm text-muted" />
        <span className="min-w-0 truncate">{item.title}</span>
      </ItemLink>
    );
  }
  if (id !== null && ref.isPending) {
    return (
      <span role="status" className="flex min-w-0 flex-1 items-center">
        <span className="sr-only">{t('templates.runs.item_loading')}</span>
        <Skeleton className="h-3.5 w-48 max-w-full" />
      </span>
    );
  }
  // deleted since, or in a project the reader no longer sees; any other failure reads the same here
  return <span className="min-w-0 truncate text-muted">{t('templates.runs.item_gone')}</span>;
}

function RunEntry({ run }: { run: TemplateRun }) {
  const times = useTemplateTimes();
  const people = useUserMap();
  const created = run.status === 'created';
  const at = run.scheduled_for ?? run.ran_at;
  const how =
    run.triggered_by === null ? t('templates.runs.scheduled') : t('templates.runs.by_hand', { name: people.get(run.triggered_by)?.name ?? t('items.someone') });

  return (
    <li className={cx('relative flex items-start gap-3 rounded-ctl px-2 py-2 transition-colors duration-120', created && cx('hover:bg-hover', linkFocusRing))}>
      {created ? (
        <CircleCheck className="mt-0.5 size-4 shrink-0 text-st-completed" aria-hidden="true" />
      ) : (
        <CircleAlert className="mt-0.5 size-4 shrink-0 text-danger" aria-hidden="true" />
      )}
      <div className="min-w-0 flex-1">
        {created ? (
          <p className="flex min-w-0 items-center gap-1.5 text-ui text-ink">
            <span className="shrink-0 font-medium">{t('templates.runs.created')}</span>
            <RunItem id={run.work_item_id} />
          </p>
        ) : (
          <p className="text-ui font-medium text-pretty text-danger">{t('templates.runs.failed', { error: run.error ?? t('templates.runs.unknown_error') })}</p>
        )}
        <p className="text-sm text-muted tabular-nums">
          <time dateTime={at}>{times.short(at)}</time> · {how}
        </p>
      </div>
    </li>
  );
}

export function RunLog({ templateId, className }: { templateId: string; className?: string }) {
  const runs = useTemplateRuns(templateId);
  const headingId = useId();
  const list = runs.data?.items ?? [];

  let body;
  if (runs.isPending) {
    body = (
      <SkeletonGroup label={t('templates.runs.loading')} className="mt-3 flex flex-col gap-3">
        {[0, 1].map((row) => (
          <div key={row} className="flex items-start gap-3 px-2">
            <Skeleton className="size-4 rounded-full" />
            <div className="flex flex-1 flex-col gap-1.5">
              <Skeleton className="h-3.5 w-2/3" />
              <Skeleton className="h-3 w-32" />
            </div>
          </div>
        ))}
      </SkeletonGroup>
    );
  } else if (runs.isError && !runs.data) {
    body = (
      <ErrorState
        className="mt-3"
        title={t('templates.runs.load_failed')}
        description={runs.error instanceof ApiError ? runs.error.message : t('errors.no_answer')}
        onRetry={() => void runs.refetch()}
        retrying={runs.isFetching}
      />
    );
  } else if (list.length === 0) {
    body = <p className="mt-2 max-w-[60ch] text-ui text-pretty text-muted">{t('templates.runs.empty')}</p>;
  } else {
    body = (
      <ol aria-label={t('templates.runs.label')} className="mt-2 flex flex-col gap-0.5">
        {list.map((run) => (
          <RunEntry key={run.id} run={run} />
        ))}
      </ol>
    );
  }

  return (
    <section aria-labelledby={headingId} className={cx('rounded-card border border-line bg-surface px-4 py-4 shadow-elev-1 md:px-5', className)}>
      <h2 id={headingId} className="font-display text-lg font-bold tracking-title text-ink">
        {t('templates.runs.title')}
      </h2>
      {body}
    </section>
  );
}
