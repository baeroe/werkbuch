/*
 * The log of a template's runs (spec 4.12), newest first: when the run was planned, and the item it made or why it
 * failed. A failed run (the template was invalid at run time, e.g. a required property is missing) is logged, the
 * project lead and the template's author hear about it, and the template stays on. The item of a run opens in the
 * preview; with a modifier key its page opens in a new tab.
 */

import { CircleAlert, CircleCheck } from 'lucide-react';
import { useId } from 'react';
import { ApiError } from '@/api/client';
import { ItemKey } from '@/components/items/ItemKey';
import { ItemLink, linkFocusRing } from '@/components/items/ItemLink';
import { cx } from '@/components/ui/cx';
import { ErrorState } from '@/components/ui/ErrorState';
import { Skeleton, SkeletonGroup } from '@/components/ui/Skeleton';
import { useTemplateRuns } from '@/hooks/templates';
import { useWorkItem } from '@/hooks/workItems';
import { useUiStore } from '@/store/ui';
import type { TemplateRun } from '@/types';
import { useRunFormats } from './format';

function RunEntry({ run }: { run: TemplateRun }) {
  const formats = useRunFormats();
  const detail = useWorkItem(run.work_item_id);
  const item = detail.data?.item;
  const created = run.status === 'created';

  return (
    <li className={cx('relative flex items-start gap-3 rounded-ctl px-2 py-2 transition-colors duration-120', item && cx('hover:bg-hover', linkFocusRing))}>
      {created ? <CircleCheck className="mt-0.5 size-4 shrink-0 text-st-completed" aria-hidden="true" /> : <CircleAlert className="mt-0.5 size-4 shrink-0 text-danger" aria-hidden="true" />}
      <div className="min-w-0 flex-1">
        {created ? (
          <p className="flex min-w-0 items-center gap-1.5 text-ui text-ink">
            <span className="shrink-0 font-medium">Angelegt:</span>
            {item ? (
              <ItemLink item={item} onOpen={(id) => useUiStore.getState().openPeek(id)} className="flex min-w-0 items-center gap-1.5 after:rounded-ctl">
                <ItemKey value={item.key} className="shrink-0 text-sm text-muted" />
                <span className="min-w-0 truncate">{item.title}</span>
              </ItemLink>
            ) : detail.isPending ? (
              <span role="status" className="flex min-w-0 flex-1 items-center">
                <span className="sr-only">Item wird geladen …</span>
                <Skeleton className="h-3.5 w-48 max-w-full" />
              </span>
            ) : (
              <span className="min-w-0 truncate text-muted">Das Item gibt es nicht mehr, oder du siehst es nicht.</span>
            )}
          </p>
        ) : (
          <p className="text-ui font-medium text-pretty text-danger">Gescheitert: {run.error ?? 'Unbekannter Fehler'}</p>
        )}
        <p className="text-sm text-muted tabular-nums">
          <time dateTime={run.scheduled_for}>{formats.short(run.scheduled_for)}</time>
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
      <SkeletonGroup label="Protokoll wird geladen …" className="mt-3 flex flex-col gap-3">
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
        title="Das Protokoll konnte nicht geladen werden"
        description={runs.error instanceof ApiError ? runs.error.message : 'Der Server hat nicht geantwortet.'}
        onRetry={() => void runs.refetch()}
        retrying={runs.isFetching}
      />
    );
  } else if (list.length === 0) {
    body = <p className="mt-2 max-w-[60ch] text-ui text-pretty text-muted">Noch keine Läufe. Jeder Lauf, nach Zeitplan oder mit „Jetzt ausführen“, steht danach hier: mit dem Item, das er angelegt hat, oder dem Grund, warum er gescheitert ist.</p>;
  } else {
    body = (
      <ol aria-label="Protokoll der Läufe" className="mt-2 flex flex-col gap-0.5">
        {list.map((run) => (
          <RunEntry key={run.id} run={run} />
        ))}
      </ol>
    );
  }

  return (
    <section aria-labelledby={headingId} className={cx('rounded-card border border-line bg-surface px-4 py-4 shadow-elev-1 md:px-5', className)}>
      <h2 id={headingId} className="font-display text-lg font-bold tracking-title text-ink">
        Protokoll
      </h2>
      {body}
    </section>
  );
}
