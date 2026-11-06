/*
 * The log of a webhook (spec 6.3, `?deliveries=<id>`): every attempt with its event, time, status, duration and the
 * answer, cut to 2 KB, newest first, a page at a time. A delivery can be sent again, and a test ping sends a harmless
 * event to see whether the receiver answers. Both end as a new entry at the top of the log and a toast that says what
 * the receiver answered; their buttons stay busy until the answer is here (K17). A webhook the system shut down shows
 * its notice here too, with the way to turn it on again.
 */

import { Link } from '@inertiajs/react';
import { ArrowLeft, Check, CircleAlert, RefreshCw, Send, X } from 'lucide-react';
import { Button, buttonClass } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { useSettle } from '@/hooks/mutation';
import { useInfiniteDeliveries, useRedeliver, useWebhooks } from '@/hooks/webhooks';
import { notifyError } from '@/lib/errors';
import { t } from '@/lib/i18n';
import { paths } from '@/lib/links';
import { useDocumentTitle } from '@/lib/useDocumentTitle';
import type { Webhook, WebhookDelivery } from '@/types';
import { formatDateTime, useOrgZone } from '../../frame/format';
import { Badge, Loaded, Panel, Row, Rows, RowsSkeleton, SectionHeader } from '../../frame/parts';
import { eventLabel } from './catalog';
import { arrived, DisabledNotice, formatDuration, toastDelivery, usePingAction } from './webhookParts';

function StatusBadge({ delivery }: { delivery: WebhookDelivery }) {
  if (delivery.status_code === null) {
    return (
      <Badge tone="danger" icon={CircleAlert}>
        {t('settings.webhooks.log.no_response')}
      </Badge>
    );
  }
  const ok = arrived(delivery);
  return (
    <Badge tone={ok ? 'neutral' : 'danger'} icon={ok ? Check : X}>
      {delivery.status_code}
    </Badge>
  );
}

const BackLink = ({ variant = 'ghost' }: { variant?: 'ghost' | 'secondary' }) => (
  <Link href={paths.settings('webhooks')} className={buttonClass({ variant, size: variant === 'ghost' ? 'sm' : 'md' }, variant === 'ghost' ? '-ml-2.5' : undefined)}>
    <ArrowLeft className="size-4 text-muted" aria-hidden="true" />
    {t('settings.webhooks.log.all')}
  </Link>
);

function Attempts({ webhook }: { webhook: Webhook }) {
  const settle = useSettle();
  const zone = useOrgZone();
  const deliveries = useInfiniteDeliveries(webhook.id);
  const ping = usePingAction(webhook);
  const redeliver = useRedeliver();

  function runRedeliver(delivery: WebhookDelivery) {
    settle(redeliver.mutateAsync({ webhook_id: webhook.id, delivery_id: delivery.delivery_id }), {
      onSuccess: (sent) => toastDelivery(t('settings.webhooks.log.subject_delivery'), webhook, sent),
      onError: (error) => notifyError(t('settings.webhooks.log.redeliver_failed'), error, () => runRedeliver(delivery)),
    });
  }

  return (
    <Loaded queries={[deliveries]} failure={t('settings.webhooks.log.load_failed')} skeleton={<RowsSkeleton rows={5} label={t('settings.webhooks.log.loading')} />}>
      {() => {
        const items = deliveries.data?.pages.flatMap((page) => page.items) ?? [];
        if (items.length === 0) {
          return (
            <EmptyState
              icon={Send}
              title={t('settings.webhooks.log.empty.title')}
              description={t('settings.webhooks.log.empty.description')}
              actions={
                <Button variant="primary" icon={Send} pending={ping.pending} onClick={ping.run}>
                  {t('settings.webhooks.log.ping_send')}
                </Button>
              }
            />
          );
        }
        return (
          <Panel>
            <p className="max-w-[65ch] border-b border-line px-4 py-3 text-sm text-pretty text-muted">{t('settings.webhooks.log.note')}</p>
            <Rows label={t('settings.webhooks.deliveries')}>
              {items.map((delivery) => (
                <Row key={delivery.id}>
                  <div className="min-w-0 flex-1 basis-48">
                    <p className="font-medium text-ink">
                      {eventLabel(delivery.event)}
                      {delivery.kind === 'manual' && <span className="ml-2 text-sm font-normal text-muted">{t(`settings.webhooks.log.kind.${delivery.kind}`)}</span>}
                    </p>
                    <p className="text-sm break-all text-muted" translate="no">
                      {delivery.event}
                    </p>
                  </div>
                  <div className="min-w-36 text-sm">
                    <p className="text-ink tabular-nums">{formatDateTime(delivery.created_at, zone)}</p>
                    <p className="text-muted">{t('settings.webhooks.log.attempt', { n: delivery.attempt })}</p>
                  </div>
                  <div className="flex min-w-28 flex-col items-start gap-0.5">
                    <StatusBadge delivery={delivery} />
                    <span className="text-sm text-muted tabular-nums">{formatDuration(delivery.duration_ms)}</span>
                  </div>
                  <div className="min-w-0 flex-1 basis-48">
                    <p className="line-clamp-2 text-sm break-words text-ink" title={delivery.response_excerpt ?? delivery.error ?? undefined} translate="no">
                      {delivery.response_excerpt ?? delivery.error ?? t('settings.webhooks.log.no_excerpt')}
                    </p>
                    {delivery.response_excerpt && delivery.error && <p className="text-sm text-danger">{delivery.error}</p>}
                  </div>
                  {delivery.kind === 'ping' ? (
                    <p className="max-w-48 text-sm text-pretty text-muted">{t('settings.webhooks.log.ping_no_resend')}</p>
                  ) : (
                    <Button
                      variant="secondary"
                      size="sm"
                      icon={RefreshCw}
                      pending={redeliver.isPending && redeliver.variables?.delivery_id === delivery.delivery_id}
                      aria-label={t('settings.webhooks.log.resend_named', { event: eventLabel(delivery.event), n: delivery.attempt })}
                      onClick={() => runRedeliver(delivery)}
                    >
                      {t('settings.webhooks.log.resend')}
                    </Button>
                  )}
                </Row>
              ))}
            </Rows>
            {(deliveries.hasNextPage || deliveries.isFetchNextPageError) && (
              <div className="flex flex-col items-start gap-2 border-t border-line px-4 py-3">
                {deliveries.isFetchNextPageError && <p className="text-sm text-danger">{t('settings.webhooks.log.more_failed')}</p>}
                <Button variant="secondary" size="sm" pending={deliveries.isFetchingNextPage} onClick={() => void deliveries.fetchNextPage()}>
                  {t('settings.webhooks.log.more')}
                </Button>
              </div>
            )}
          </Panel>
        );
      }}
    </Loaded>
  );
}

export function WebhookDeliveries({ webhookId }: { webhookId: string }) {
  const webhooks = useWebhooks();
  const webhook = webhooks.data?.items.find((entry) => entry.id === webhookId);
  const ping = usePingAction(webhook);
  useDocumentTitle(t('settings.org.document_title', { section: `${webhook ? t('settings.webhooks.deliveries_of', { name: webhook.name }) : t('settings.webhooks.deliveries')} – ${t('settings.org.section.webhooks')}` }));

  return (
    <div className="flex flex-col gap-4">
      <SectionHeader
        back={<BackLink />}
        title={webhook ? t('settings.webhooks.deliveries_of', { name: webhook.name }) : t('settings.webhooks.deliveries')}
        description={webhook ? <span translate="no" className="break-all">{webhook.url}</span> : undefined}
        actions={
          webhook && (
            <Button variant="primary" icon={Send} pending={ping.pending} onClick={ping.run}>
              {t('settings.webhooks.ping')}
            </Button>
          )
        }
      />
      <Loaded queries={[webhooks]} failure={t('settings.webhooks.log.load_failed')} skeleton={<RowsSkeleton rows={5} label={t('settings.webhooks.log.loading')} />}>
        {() =>
          webhook ? (
            <>
              <DisabledNotice webhook={webhook} />
              <Attempts webhook={webhook} />
            </>
          ) : (
            <EmptyState icon={CircleAlert} title={t('settings.webhooks.log.missing.title')} description={t('settings.webhooks.log.missing.description')} actions={<BackLink variant="secondary" />} />
          )
        }
      </Loaded>
    </div>
  );
}
