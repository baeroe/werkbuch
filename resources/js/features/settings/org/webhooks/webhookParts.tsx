/*
 * What the list of webhooks and their delivery log share: the three states of a webhook (it works, somebody switched it
 * off, the system shut it down after 24 hours without a success), the notice for the last one with the call that turns
 * the webhook on again, the test ping, and the toast that tells what the receiver answered.
 */

import { CircleCheck, CirclePause, PowerOff } from 'lucide-react';
import { Banner } from '@/components/ui/Banner';
import { Button } from '@/components/ui/Button';
import { toast } from '@/components/ui/toast';
import { useSettle } from '@/hooks/mutation';
import { usePingWebhook, useSaveWebhook } from '@/hooks/webhooks';
import { notifyError } from '@/lib/errors';
import { intlLocale, t } from '@/lib/i18n';
import type { Webhook, WebhookDelivery } from '@/types';
import { formatDateTime, useOrgZone } from '../../frame/format';
import { Badge, Measure } from '../../frame/parts';

export type WebhookState = 'active' | 'off' | 'disabled';

/** `disabled`: the system shut it down. `off`: somebody switched it off. */
export const stateOf = (webhook: Webhook): WebhookState => (webhook.disabled_at !== null ? 'disabled' : webhook.active ? 'active' : 'off');

export function StateBadge({ webhook }: { webhook: Webhook }) {
  const state = stateOf(webhook);
  if (state === 'disabled') {
    return (
      <Badge tone="danger" icon={PowerOff}>
        {t('settings.webhooks.state.disabled')}
      </Badge>
    );
  }
  if (state === 'off') return <Badge icon={CirclePause}>{t('settings.webhooks.state.off')}</Badge>;
  return <Badge icon={CircleCheck}>{t('settings.webhooks.state.active')}</Badge>;
}

/** Turns a webhook on again. A webhook the system shut down loses its mark when it is switched on. */
function useReenable(): { reenable: (webhook: Webhook) => void; pending: boolean } {
  const save = useSaveWebhook();
  const settle = useSettle();
  function reenable(webhook: Webhook) {
    const { id, name, url, project_id, events, bot_id } = webhook;
    settle(save.mutateAsync({ id, name, url, project_id, events, bot_id, active: true }), {
      onSuccess: () => toast({ title: t('settings.webhooks.reenable.done', { name }), description: t('settings.webhooks.reenable.done_description'), tone: 'success' }),
      onError: (error) => notifyError(t('settings.webhooks.reenable.failed', { name }), error, () => reenable(webhook)),
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
      title={t('settings.webhooks.reenable.title')}
      action={
        <Button variant="secondary" pending={pending} onClick={() => reenable(webhook)}>
          {t('settings.webhooks.reenable.button')}
        </Button>
      }
    >
      <Measure>{t('settings.webhooks.reenable.notice', { day: formatDateTime(webhook.disabled_at!, zone) })}</Measure>
    </Banner>
  );
}

/** "460 ms", "1,5 s": how long an attempt took, in the language of the page. */
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms} ms`;
  return `${new Intl.NumberFormat(intlLocale(), { maximumFractionDigits: 1 }).format(ms / 1000)} s`;
}

/** Whether the receiver took the attempt: any 2xx answer. */
export const arrived = (attempt: WebhookDelivery): boolean => attempt.status_code !== null && attempt.status_code >= 200 && attempt.status_code < 300;

/** The toast that answers a test ping or a delivery sent again with what the receiver said. */
export function toastDelivery(subject: string, webhook: Webhook, attempt: WebhookDelivery) {
  const ok = arrived(attempt);
  const duration = formatDuration(attempt.duration_ms);
  toast({
    title: t(ok ? 'settings.webhooks.toast.arrived' : 'settings.webhooks.toast.failed', { subject, name: webhook.name }),
    description: attempt.status_code === null ? t('settings.webhooks.toast.no_response', { duration }) : t('settings.webhooks.toast.status', { code: attempt.status_code, duration }),
    tone: ok ? 'success' : 'error',
  });
}

/** The test ping of a webhook: `run` sends it and answers in a toast; `pending` holds from the call to the answer (K17). */
export function usePingAction(webhook: Webhook | undefined): { run: () => void; pending: boolean } {
  const settle = useSettle();
  const ping = usePingWebhook();
  function run() {
    if (!webhook) return;
    settle(ping.mutateAsync(webhook.id), {
      onSuccess: (attempt) => toastDelivery(t('settings.webhooks.log.subject_ping'), webhook, attempt),
      onError: (error) => notifyError(t('settings.webhooks.log.ping_failed'), error, run),
    });
  }
  return { run, pending: ping.isPending };
}
