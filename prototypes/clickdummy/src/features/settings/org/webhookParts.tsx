/*
 * What the list of webhooks and their delivery log share: the three states of a webhook (it works, somebody switched it
 * off, the system shut it down after 24 hours without a success), the notice for the last one, and the call that turns
 * a webhook on again.
 */

import { CircleCheck, CirclePause, PowerOff } from 'lucide-react';
import { Banner } from '@/components/ui/Banner';
import { Button } from '@/components/ui/Button';
import { toast } from '@/components/ui/toast';
import { useSaveWebhook } from '@/hooks/webhooks';
import { useSettle } from '@/hooks/mutation';
import { notifyError } from '@/lib/errors';
import type { Webhook, WebhookDelivery } from '@/types';
import { formatDateTime, useOrgZone } from './format';
import { Badge, Measure } from './parts';

export type WebhookState = 'active' | 'off' | 'disabled';

/** `disabled`: the system shut it down. `off`: somebody switched it off. */
export const stateOf = (webhook: Webhook): WebhookState => (webhook.disabled_at !== null ? 'disabled' : webhook.active ? 'active' : 'off');

export function StateBadge({ webhook }: { webhook: Webhook }) {
  const state = stateOf(webhook);
  if (state === 'disabled') {
    return (
      <Badge tone="danger" icon={PowerOff}>
        Abgeschaltet
      </Badge>
    );
  }
  if (state === 'off') return <Badge icon={CirclePause}>Aus</Badge>;
  return <Badge icon={CircleCheck}>Aktiv</Badge>;
}

/** Turns a webhook on again. A webhook the system shut down loses its mark when it is switched on. */
export function useReenable(): { reenable: (webhook: Webhook) => void; pending: boolean } {
  const save = useSaveWebhook();
  const settle = useSettle();
  function reenable(webhook: Webhook) {
    settle(save.mutateAsync({ webhook: { id: webhook.id, name: webhook.name, url: webhook.url, project_id: webhook.project_id, events: webhook.events, bot_id: webhook.bot_id, active: true } }), {
      onSuccess: () => toast({ title: `Webhook „${webhook.name}“ ist wieder aktiv`, description: 'Die nächsten Ereignisse gehen wieder an den Empfänger.', tone: 'success' }),
      onError: (error) => notifyError(`Webhook „${webhook.name}“ nicht aktiviert`, error, () => reenable(webhook)),
    });
  }
  return { reenable, pending: save.isPending };
}

/** The notice on a webhook the system shut down, with the way back. */
export function DisabledNotice({ webhook }: { webhook: Webhook }) {
  const zone = useOrgZone();
  const { reenable, pending } = useReenable();
  if (stateOf(webhook) !== 'disabled') return null;
  return (
    <Banner
      tone="danger"
      role="status"
      title="Das System hat diesen Webhook abgeschaltet"
      action={
        <Button variant="secondary" pending={pending} onClick={() => reenable(webhook)}>
          Wieder aktivieren
        </Button>
      }
    >
      <Measure>
        Seit 24&nbsp;Stunden kam keine erfolgreiche Zustellung an (abgeschaltet am {formatDateTime(webhook.disabled_at!, zone)}). Die Org-Admins wurden benachrichtigt. Aktiviere den Webhook wieder, sobald der Empfänger antwortet.
      </Measure>
    </Banner>
  );
}

/** "460 ms", "10 s": how long an attempt took. */
export function formatDuration(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toLocaleString('de-DE', { maximumFractionDigits: 1 })}\u00a0s` : `${ms}\u00a0ms`;
}

/** The toast that answers a test ping or a delivery sent again with what the receiver said. */
export function toastDelivery(subject: string, webhook: Webhook, delivery: WebhookDelivery) {
  const ok = delivery.status_code !== null && delivery.status_code >= 200 && delivery.status_code < 300;
  toast({
    title: `${subject} an „${webhook.name}“ ${ok ? 'angekommen' : 'fehlgeschlagen'}`,
    description: `${delivery.status_code === null ? 'Keine Antwort' : `Antwort ${delivery.status_code}`} nach ${formatDuration(delivery.duration_ms)}.`,
    tone: ok ? 'success' : 'error',
  });
}
