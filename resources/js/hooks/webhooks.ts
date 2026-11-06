import { useQuery } from '@tanstack/react-query';
import { deleteWebhook, listDeliveries, listWebhooks, pingWebhook, redeliver, rotateWebhookSecret, saveWebhook } from '@/api/webhooks';
import { qk } from './keys';
import { useApiMutation } from './mutation';

/** Every webhook (all pages). */
export function useWebhooks() {
  return useQuery({ queryKey: qk.webhooks.list({ pages: 'all' }), queryFn: listWebhooks });
}

/** Variable: a `WebhookInput` (no `id` creates). Answers `{ webhook, secret }`; the answer leaves the cache with its dialog. */
export function useSaveWebhook() {
  return useApiMutation(saveWebhook, [qk.webhooks.all], { gcTime: 0 });
}

/** Variable: the webhook id. Answers `{ webhook, secret }` with the new secret, which stays out of the cache like any secret. */
export function useRotateWebhookSecret() {
  return useApiMutation(rotateWebhookSecret, [qk.webhooks.all], { gcTime: 0 });
}

/** Variable: the webhook id. The log goes with it. */
export function useDeleteWebhook() {
  return useApiMutation(deleteWebhook, [qk.webhooks.all, qk.deliveries.all]);
}

/** The attempts of a webhook, newest first (the first page); waits without an id. */
export function useDeliveries(webhookId: string | null | undefined) {
  return useQuery({ queryKey: qk.deliveries.list({ webhook: webhookId }), queryFn: () => listDeliveries(webhookId!), enabled: !!webhookId });
}

/** Variable: the webhook id. */
export function usePingWebhook() {
  return useApiMutation(pingWebhook, [qk.deliveries.all]);
}

/** Variables: `{ webhook_id, delivery_id }`. A delivery that goes through again changes `failing_since`, so webhooks reload. */
export function useRedeliver() {
  return useApiMutation(({ webhook_id, delivery_id }: { webhook_id: string; delivery_id: string }) => redeliver(webhook_id, delivery_id), [qk.deliveries.all, qk.webhooks.all]);
}
