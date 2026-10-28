/*
 * The log of a webhook (spec 6.3): every attempt with its event, time, status, duration and the answer, cut to 2 KB.
 * A delivery can be sent again, and a test ping sends a harmless event to see whether the receiver answers. Both end
 * as a new entry at the top of the log and a toast that says what the receiver answered. A webhook the system shut
 * down shows its notice here too, with the way to turn it on again.
 */

import { ArrowLeft, Check, CircleAlert, RefreshCw, Send, X } from 'lucide-react';
import { Link, type To } from 'react-router';
import { Button, buttonClass } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { useDeliveries, usePingWebhook, useRedeliver, useWebhooks } from '@/hooks/webhooks';
import { notifyError } from '@/lib/errors';
import { useDocumentTitle } from '@/lib/useDocumentTitle';
import type { WebhookDelivery } from '@/types';
import { eventLabel } from './catalog';
import { formatDateTime, useOrgZone } from './format';
import { Badge, Loaded, Panel, Row, Rows, RowsSkeleton, SectionHeader } from './parts';
import { DisabledNotice, formatDuration, toastDelivery } from './webhookParts';

export interface WebhookDeliveriesProps {
  webhookId: string;
  onClose: () => void;
  /** Where "Alle Webhooks" leads. With it the way back is a real link (new tab, ⌘-click); without it a button. */
  closeTo?: To;
}

function StatusBadge({ delivery }: { delivery: WebhookDelivery }) {
  if (delivery.status_code === null) {
    return (
      <Badge tone="danger" icon={CircleAlert}>
        Keine Antwort
      </Badge>
    );
  }
  const ok = delivery.status_code >= 200 && delivery.status_code < 300;
  return (
    <Badge tone={ok ? 'neutral' : 'danger'} icon={ok ? Check : X}>
      {delivery.status_code}
    </Badge>
  );
}

export function WebhookDeliveries({ webhookId, onClose, closeTo }: WebhookDeliveriesProps) {
  const webhooks = useWebhooks();
  const deliveries = useDeliveries(webhookId);
  const ping = usePingWebhook();
  const redeliver = useRedeliver();
  const zone = useOrgZone();
  const webhook = webhooks.data?.items.find((entry) => entry.id === webhookId);
  useDocumentTitle(webhook ? `Zustellungen von ${webhook.name} – Webhooks` : 'Zustellungen – Webhooks');

  function runPing() {
    if (!webhook) return;
    ping.mutate(webhook.id, {
      onSuccess: (delivery) => toastDelivery('Test-Ping', webhook, delivery),
      onError: (error) => notifyError('Test-Ping nicht gesendet', error, runPing),
    });
  }

  function runRedeliver(delivery: WebhookDelivery) {
    if (!webhook) return;
    redeliver.mutate(delivery.id, {
      onSuccess: (sent) => toastDelivery('Zustellung', webhook, sent),
      onError: (error) => notifyError('Zustellung nicht gesendet', error, () => runRedeliver(delivery)),
    });
  }

  const back = closeTo ? (
    <Link to={closeTo} className={buttonClass({ variant: 'ghost', size: 'sm' }, '-ml-2.5')}>
      <ArrowLeft className="size-4 text-muted" aria-hidden="true" />
      Alle Webhooks
    </Link>
  ) : (
    <Button variant="ghost" size="sm" icon={ArrowLeft} className="-ml-2.5" onClick={onClose}>
      Alle Webhooks
    </Button>
  );

  return (
    <div className="flex flex-col gap-4">
      <SectionHeader
        back={back}
        title={webhook ? `Zustellungen von ${webhook.name}` : 'Zustellungen'}
        description={webhook ? <span translate="no" className="break-all">{webhook.url}</span> : undefined}
        actions={
          webhook && (
            <Button variant="primary" icon={Send} pending={ping.isPending} onClick={runPing}>
              Test-Ping
            </Button>
          )
        }
      />
      {webhook && <DisabledNotice webhook={webhook} />}
      <Loaded queries={[webhooks, deliveries]} failure="Das Zustellprotokoll konnte nicht geladen werden" skeleton={<RowsSkeleton rows={5} label="Das Zustellprotokoll wird geladen …" />}>
        {() => {
          if (!webhook) {
            return (
              <EmptyState
                icon={CircleAlert}
                title="Diesen Webhook gibt es nicht"
                description="Er wurde gelöscht, oder der Link stimmt nicht."
                actions={
                  closeTo ? (
                    <Link to={closeTo} className={buttonClass({ variant: 'secondary' })}>
                      <ArrowLeft className="size-4 text-muted" aria-hidden="true" />
                      Alle Webhooks
                    </Link>
                  ) : (
                    <Button variant="secondary" icon={ArrowLeft} onClick={onClose}>
                      Alle Webhooks
                    </Button>
                  )
                }
              />
            );
          }
          const items = deliveries.data?.items ?? [];
          if (items.length === 0) {
            return (
              <EmptyState
                icon={Send}
                title="Noch keine Zustellungen"
                description="Sobald ein gewähltes Ereignis eintritt, steht hier jeder Versuch. Ein Test-Ping zeigt gleich, ob der Empfänger antwortet."
                actions={
                  <Button variant="primary" icon={Send} pending={ping.isPending} onClick={runPing}>
                    Test-Ping senden
                  </Button>
                }
              />
            );
          }
          return (
            <Panel>
              <p className="max-w-[65ch] border-b border-line px-4 py-3 text-sm text-pretty text-muted">
                Jeder Versuch wird 30&nbsp;Tage aufbewahrt, Antworten sind auf 2&nbsp;KB gekürzt. Bei einem Fehler versucht werkbuch es bis zu achtmal über etwa 24&nbsp;Stunden.
              </p>
              <Rows label="Zustellungen">
                {items.map((delivery) => (
                  <Row key={delivery.id}>
                    <div className="min-w-0 flex-1 basis-48">
                      <p className="font-medium text-ink">{eventLabel(delivery.event)}</p>
                      <p className="text-sm text-muted" translate="no">
                        {delivery.event}
                      </p>
                    </div>
                    <div className="min-w-36 text-sm">
                      <p className="text-ink tabular-nums">{formatDateTime(delivery.created_at, zone)}</p>
                      <p className="text-muted">Versuch {delivery.attempt}</p>
                    </div>
                    <div className="flex min-w-28 flex-col items-start gap-0.5">
                      <StatusBadge delivery={delivery} />
                      <span className="text-sm text-muted tabular-nums">{formatDuration(delivery.duration_ms)}</span>
                    </div>
                    <div className="min-w-0 flex-1 basis-48">
                      <p className="line-clamp-2 text-sm break-words text-ink" title={delivery.response_excerpt ?? delivery.error ?? undefined} translate="no">
                        {delivery.response_excerpt ?? delivery.error ?? 'Keine Antwort im Protokoll'}
                      </p>
                      {delivery.response_excerpt && delivery.error && <p className="text-sm text-danger">{delivery.error}</p>}
                    </div>
                    <Button variant="secondary" size="sm" icon={RefreshCw} pending={redeliver.isPending && redeliver.variables === delivery.id} onClick={() => runRedeliver(delivery)}>
                      Erneut senden{' '}
                      <span className="sr-only">({eventLabel(delivery.event)}, Versuch {delivery.attempt})</span>
                    </Button>
                  </Row>
                ))}
              </Rows>
            </Panel>
          );
        }}
      </Loaded>
    </div>
  );
}
