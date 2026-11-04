/*
 * Settings → System (spec 5.2, org admins only; port of the clickdummy's `System.tsx`): the version, the backlog of each
 * queue with its oldest job, the jobs that are meant to run later apart from it, whether Meilisearch answers and how
 * many of its tasks are open or failed, whether mail can go out and whether Reverb answers (with the switch of the proxy
 * that live updates need, spec 14); the jobs that failed with their errors and a button to try them all again; and a
 * test mail to the signed-in admin. Without a mail server the test mail is not offered, because it could only fail.
 */

import { CircleAlert, CircleCheck, CircleMinus, RotateCw, Send } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Banner } from '@/components/ui/Banner';
import { Button } from '@/components/ui/Button';
import { toast } from '@/components/ui/toast';
import { useSettle } from '@/hooks/mutation';
import { useRetryFailedJobs, useSendTestMail, useSystemStatus } from '@/hooks/system';
import { useCurrentUser } from '@/hooks/users';
import { causeOf, notifyError } from '@/lib/errors';
import { intlLocale, t, tn } from '@/lib/i18n';
import type { SystemStatus } from '@/types';
import { hasReason } from '../../frame/form';
import { formatDateTime, useOrgZone } from '../../frame/format';
import { Badge, FormSkeleton, Loaded, Panel, Row, Rows, SectionHeader } from '../../frame/parts';
import type { SectionProps } from '../sections';

const count = (value: number): string => new Intl.NumberFormat(intlLocale()).format(value);

/** One fact of the instance: its label, the state, and a sentence on what the state means. */
function Fact({ label, children, notes = [] }: { label: string; children: ReactNode; notes?: (string | null)[] }) {
  return (
    <Row className="items-start">
      <span className="w-44 shrink-0 text-ui text-muted">{label}</span>
      <div className="min-w-0 flex-1 basis-48">
        <div className="text-ui font-medium text-ink">{children}</div>
        {notes.map((note) => note && (
          <p key={note} className="mt-0.5 max-w-[65ch] text-sm text-pretty text-muted">
            {note}
          </p>
        ))}
      </div>
    </Row>
  );
}

const Ok = ({ children }: { children: ReactNode }) => <Badge icon={CircleCheck}>{children}</Badge>;

const Down = ({ children }: { children: ReactNode }) => (
  <Badge tone="danger" icon={CircleAlert}>
    {children}
  </Badge>
);

function Queues({ status }: { status: SystemStatus }) {
  const zone = useOrgZone();
  return (
    <Fact label={t('settings.system.queues.label')} notes={[t(status.queued_jobs === 0 ? 'settings.system.queues.empty_note' : 'settings.system.queues.note')]}>
      {tn('settings.system.queues.waiting', status.queued_jobs)}
      <ul aria-label={t('settings.system.queues.list')} className="mt-2 flex flex-col gap-1 font-normal">
        {status.queues.map((queue) => (
          <li key={queue.queue} className="flex flex-wrap items-baseline gap-x-3 text-sm">
            <span className="w-28 shrink-0 font-medium text-ink" translate="no">
              {queue.queue}
            </span>
            <span className={queue.pending === 0 ? 'text-muted' : 'text-ink tabular-nums'}>{queue.pending === 0 ? t('settings.system.queues.idle') : tn('settings.system.queues.pending', queue.pending)}</span>
            {queue.oldest_at && <span className="text-muted tabular-nums">{t('settings.system.queues.oldest', { time: formatDateTime(queue.oldest_at, zone) })}</span>}
          </li>
        ))}
      </ul>
    </Fact>
  );
}

function Instance({ status }: { status: SystemStatus }) {
  const tasks = status.search_tasks;
  const proxy = status.live === 'off' ? null : t('settings.system.live.proxy_note');
  return (
    <Panel title={t('settings.system.instance.title')}>
      <Rows label={t('settings.system.instance.label')}>
        <Fact label={t('settings.system.version')}>
          <span translate="no">{status.version}</span>
        </Fact>
        <Queues status={status} />
        <Fact label={t('settings.system.delayed.label')} notes={[t('settings.system.delayed.note')]}>
          {tn('settings.system.delayed.count', status.delayed_jobs)}
        </Fact>
        <Fact
          label={t('settings.system.search.label')}
          notes={[
            status.search === 'down' ? t('settings.system.search.down_note') : null,
            tasks ? t('settings.system.search.tasks', { open: count(tasks.enqueued + tasks.processing), failed: count(tasks.failed_last_day) }) : null,
          ]}
        >
          {status.search === 'ok' ? <Ok>{t('settings.system.search.ok')}</Ok> : <Down>{t('settings.system.search.down')}</Down>}
        </Fact>
        <Fact label={t('settings.system.mail.label')}>{status.mail_configured ? <Ok>{t('settings.system.mail.ok')}</Ok> : <Down>{t('settings.system.mail.off')}</Down>}</Fact>
        <Fact
          label={t('settings.system.live.label')}
          notes={[status.live === 'down' ? t('settings.system.live.down_note') : status.live === 'off' ? t('settings.system.live.off_note') : null, proxy]}
        >
          {status.live === 'ok' && <Ok>{t('settings.system.live.ok')}</Ok>}
          {status.live === 'down' && <Down>{t('settings.system.live.down')}</Down>}
          {status.live === 'off' && (
            <Badge tone="quiet" icon={CircleMinus}>
              {t('settings.system.live.off')}
            </Badge>
          )}
        </Fact>
      </Rows>
    </Panel>
  );
}

function FailedJobs({ status }: { status: SystemStatus }) {
  const settle = useSettle();
  const retry = useRetryFailedJobs();
  const zone = useOrgZone();
  const total = status.failed_jobs_total;

  function run() {
    settle(retry.mutateAsync(undefined), {
      onSuccess: ({ retried }) => toast({ title: tn('settings.system.failed.retried', retried), description: t('settings.system.failed.retried_note'), tone: 'success' }),
      onError: (error) => notifyError(t('settings.system.failed.retry_failed'), error, run),
    });
  }

  return (
    <Panel
      title={total > 0 ? t('settings.system.failed.title_count', { count: count(total) }) : t('settings.system.failed.title')}
      description={t('settings.system.failed.description')}
      actions={
        total > 0 && (
          <Button variant="secondary" icon={RotateCw} pending={retry.isPending} onClick={run}>
            {t('settings.system.failed.retry')}
          </Button>
        )
      }
    >
      {status.failed_jobs.length === 0 ? (
        <p className="flex items-center gap-2 px-4 py-3 text-ui text-muted">
          <CircleCheck className="size-4 shrink-0 text-st-completed" aria-hidden="true" />
          {t('settings.system.no_failed')}
        </p>
      ) : (
        <>
          <Rows label={t('settings.system.failed.title')}>
            {status.failed_jobs.map((job) => (
              <Row key={job.id} className="items-start">
                <div className="min-w-0 flex-1 basis-72">
                  <p className="flex flex-wrap items-center gap-2">
                    <span className="font-medium break-all text-ink" translate="no">
                      {job.job}
                    </span>
                    <Badge tone="quiet">
                      <span translate="no">{job.queue}</span>
                    </Badge>
                  </p>
                  <p className="mt-1 text-sm break-words text-muted" translate="no">
                    {job.error}
                  </p>
                </div>
                <p className="text-sm text-muted tabular-nums">{formatDateTime(job.failed_at, zone)}</p>
              </Row>
            ))}
          </Rows>
          {total > status.failed_jobs.length && (
            <p className="border-t border-line px-4 py-3 text-sm text-muted">{t('settings.system.failed.newest', { shown: count(status.failed_jobs.length), total: count(total) })}</p>
          )}
        </>
      )}
    </Panel>
  );
}

function TestMail({ status }: { status: SystemStatus }) {
  const settle = useSettle();
  const email = useCurrentUser()?.email ?? '';
  const send = useSendTestMail();
  const [refusal, setRefusal] = useState<string | null>(null);

  function run() {
    setRefusal(null);
    settle(send.mutateAsync(undefined), {
      onSuccess: ({ sent_to }) => toast({ title: t('settings.system.test_mail.sent', { email: sent_to }), description: t('settings.system.test_mail.sent_note'), tone: 'success' }),
      // the mail server went away since the page loaded: the panel says so, a retry could only fail again
      onError: (error) => (hasReason(error, 'mail_not_configured') ? setRefusal(causeOf(error)) : notifyError(t('settings.system.test_mail.failed'), error, run)),
    });
  }

  return (
    <Panel title={t('settings.system.test_mail.title')} description={t('settings.system.test_mail.description')}>
      <div className="flex flex-col gap-3 p-4">
        {refusal && (
          <Banner tone="danger" role="alert" title={t('settings.system.test_mail.refused')}>
            {refusal}
          </Banner>
        )}
        {status.mail_configured ? (
          <div>
            <Button variant="secondary" icon={Send} pending={send.isPending} onClick={run}>
              {t('settings.system.test_mail.send', { email })}
            </Button>
          </div>
        ) : (
          <p className="max-w-[65ch] text-sm text-pretty text-muted">{t('settings.system.no_mail')}</p>
        )}
      </div>
    </Panel>
  );
}

export default function System(_props: SectionProps) {
  const status = useSystemStatus();
  return (
    <div className="flex flex-col gap-4">
      <SectionHeader title={t('settings.org.section.system')} description={t('settings.system.description')} />
      <Loaded queries={[status]} failure={t('settings.system.load_failed')} skeleton={<FormSkeleton label={t('settings.system.loading')} />}>
        {() => (
          <>
            <Instance status={status.data!} />
            <FailedJobs status={status.data!} />
            <TestMail status={status.data!} />
          </>
        )}
      </Loaded>
    </div>
  );
}
