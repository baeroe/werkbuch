/*
 * The next five terms of a schedule (spec 4.12), ported from the clickdummy as leaves of a tear-off calendar, each with
 * its day and time in the organisation's zone. Only the server counts terms (A335): they come from `useSchedulePreview`
 * with the same question the title's preview asks (schedule, title, runs so far), so both share one answer. A paused
 * schedule plans none, which needs no answer; a schedule the server cannot read, one that has ended and a failed answer
 * say so. A skeleton stands at first; afterwards the old terms stay (busy) until the answer to a change arrives.
 */

import { CircleAlert, Pause, RotateCw } from 'lucide-react';
import { useId, type ReactNode } from 'react';
import { ApiError } from '@/api/client';
import { Button } from '@/components/ui/Button';
import { Skeleton, SkeletonGroup } from '@/components/ui/Skeleton';
import { useSchedulePreview } from '@/hooks/templates';
import { t } from '@/lib/i18n';
import type { Schedule } from '@/types';
import { useTemplateTimes } from './format';

type NextRunsProps = {
  schedule: Schedule;
  /** The runs the template has had: a schedule that ends after some counts on. */
  runCount: number;
  /** The title of the template's items, as the title's preview asks with it. */
  title?: string;
};

function Note({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <p className="mt-2 flex items-start gap-2 text-ui text-pretty text-muted">
      {icon}
      <span>{children}</span>
    </p>
  );
}

export function NextRuns({ schedule, runCount, title = '' }: NextRunsProps) {
  const headingId = useId();
  const times = useTemplateTimes();
  const preview = useSchedulePreview({ schedule, title: title.trim(), run_count: runCount });
  const alert = <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />;

  let body: ReactNode;
  if (schedule.paused) {
    body = <Note icon={<Pause className="mt-0.5 size-4 shrink-0" aria-hidden="true" />}>{t('schedule.next.paused')}</Note>;
  } else if (preview.isError) {
    body =
      preview.error instanceof ApiError && preview.error.status === 422 ? (
        <Note icon={alert}>{t('schedule.next.unreadable')}</Note>
      ) : (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Note icon={alert}>{t('schedule.next.failed', { message: preview.error.message })}</Note>
          <Button variant="secondary" size="sm" icon={RotateCw} onClick={() => void preview.refetch()}>
            {t('common.retry')}
          </Button>
        </div>
      );
  } else if (!preview.data) {
    body = (
      <SkeletonGroup label={t('schedule.next.loading')} className="mt-3 flex flex-col gap-2.5">
        <Skeleton className="h-12 rounded-ctl" />
        <Skeleton className="h-12 rounded-ctl" />
        <Skeleton className="h-12 rounded-ctl" />
      </SkeletonGroup>
    );
  } else if (preview.data.runs.length === 0) {
    body = <Note icon={alert}>{t('schedule.next.ended')}</Note>;
  } else {
    body = (
      <ol role="list" aria-labelledby={headingId} aria-busy={preview.isPlaceholderData || undefined} className="mt-3 flex flex-col gap-2.5 aria-busy:opacity-70">
        {preview.data.runs.map((at) => {
          const leaf = times.leaf(at);
          return (
            <li key={at} className="flex items-center gap-3">
              <span aria-hidden="true" className="flex w-12 shrink-0 flex-col items-center rounded-ctl border border-line bg-surface py-1 leading-none shadow-elev-1">
                <span className="text-2xs font-semibold text-muted">{leaf.weekday}</span>
                <span className="mt-0.5 font-display text-lg leading-6 font-bold text-ink tabular-nums">{leaf.day}</span>
                <span className="text-2xs text-muted">{leaf.month}</span>
              </span>
              <time dateTime={at} className="min-w-0 flex-1 text-ui text-ink tabular-nums">
                {times.term(at)}
              </time>
            </li>
          );
        })}
      </ol>
    );
  }

  return (
    <div className="border-t border-line px-4 py-4 md:px-5">
      <h3 id={headingId} className="font-display text-md font-bold tracking-title text-ink">
        {t('schedule.next.title')}
      </h3>
      {body}
    </div>
  );
}
