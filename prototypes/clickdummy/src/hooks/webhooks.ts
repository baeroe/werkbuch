import { useQuery } from '@tanstack/react-query';
import { deleteWebhook, listDeliveries, listWebhooks, pingWebhook, redeliver, saveWebhook, type WebhookInput } from '@/api/webhooks';
import { qk } from './keys';
import { useApiMutation } from './mutation';

export function useWebhooks() {
  return useQuery({ queryKey: qk.webhooks.all, queryFn: listWebhooks });
}

/** Variables: `{ webhook, options?: { renew_secret } }`. Answers `{ webhook, secret }`; the secret only on create or renew. */
export function useSaveWebhook() {
  return useApiMutation(
    ({ webhook, options }: { webhook: WebhookInput; options?: { renew_secret?: boolean } }) => saveWebhook(webhook, options),
    [qk.webhooks.all],
  );
}

export function useDeleteWebhook() {
  return useApiMutation(deleteWebhook, [qk.webhooks.all, qk.deliveries.all]);
}

/** The delivery log of a webhook, newest first. */
export function useDeliveries(webhookId: string | null | undefined) {
  return useQuery({ queryKey: qk.deliveries.list({ webhook: webhookId }), queryFn: () => listDeliveries(webhookId!), enabled: !!webhookId });
}

/** Variable: the delivery id. */
export function useRedeliver() {
  return useApiMutation(redeliver, [qk.deliveries.all]);
}

/** Variable: the webhook id. */
export function usePingWebhook() {
  return useApiMutation(pingWebhook, [qk.deliveries.all]);
}
