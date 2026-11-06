/*
 * Webhooks (spec 6.3), managed by org admins. The secret is shown once: only creating a webhook and renewing the secret
 * answer it. The log lists attempts, newest first; "send again" and the test ping send one attempt in the request.
 */

import type { Webhook, WebhookDelivery, WebhookSaved } from '@/types';
import type { Page, PageArgs } from './client';
import { allPages } from './client';
import { del, getPage, post, put } from './http';

/** What saving takes: everything but what the server keeps (the secret, the stamps, the shut-off). */
export interface WebhookInput {
  id?: string;
  name: string;
  url: string;
  project_id: string | null;
  events: string[];
  bot_id: string | null;
  active: boolean;
}

const path = (id: string) => `/webhooks/${encodeURIComponent(id)}`;

/** Every webhook (all pages), by name. */
export function listWebhooks(): Promise<Page<Webhook>> {
  return allPages((cursor) => getPage<Webhook>('/webhooks', { cursor }));
}

/**
 * Creates a webhook (no `id`) or replaces one (`PUT`, the id is never in the body). Answers `{ webhook, secret }`: the
 * secret is the plain text for a new webhook, `null` for a replaced one.
 */
export async function saveWebhook({ id, ...input }: WebhookInput): Promise<WebhookSaved> {
  const answer = id ? await put<{ data: Webhook; secret?: string }>(path(id), input) : await post<{ data: Webhook; secret?: string }>('/webhooks', input);
  return { webhook: answer.data, secret: answer.secret ?? null };
}

/** Makes a new secret; answers it in plain text, once. */
export async function rotateWebhookSecret(id: string): Promise<WebhookSaved> {
  const answer = await post<{ data: Webhook; secret: string }>(`${path(id)}/rotate-secret`);
  return { webhook: answer.data, secret: answer.secret };
}

export function deleteWebhook(id: string): Promise<void> {
  return del<void>(path(id));
}

/** The attempts of a webhook, newest first, one page at a time. */
export function listDeliveries(webhook_id: string, args: PageArgs = {}): Promise<Page<WebhookDelivery>> {
  return getPage<WebhookDelivery>(`${path(webhook_id)}/deliveries`, { ...args });
}

/** Sends a test ping; answers its attempt. */
export async function pingWebhook(webhook_id: string): Promise<WebhookDelivery> {
  return (await post<{ data: WebhookDelivery }>(`${path(webhook_id)}/ping`)).data;
}

/** Sends a delivery again (the delivery of the webhook, not an attempt); answers the new attempt. */
export async function redeliver(webhook_id: string, delivery_id: string): Promise<WebhookDelivery> {
  return (await post<{ data: WebhookDelivery }>(`${path(webhook_id)}/deliveries/${encodeURIComponent(delivery_id)}/redeliver`)).data;
}
