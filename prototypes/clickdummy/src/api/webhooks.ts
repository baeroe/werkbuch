/*
 * Webhooks (spec 6.3), managed by org admins. The secret is shown once: only creating a webhook or renewing the
 * secret returns it. Deliveries are simulated: a webhook that is on answers 200, a switched-off one fails.
 */

import type { Webhook, WebhookDelivery, WebhookSaved } from '@/types';
import { requireOrgAdmin } from './access';
import { FieldErrors, newId, notFound, paginate, read, write, type Ctx, type Page } from './client';
import type { Db, StoredWebhook } from './db';

/** The events a webhook can listen for, grouped like the spec's catalog; `group.*` stands for a whole group. */
export const WEBHOOK_EVENTS: Record<string, readonly string[]> = {
  project: ['created', 'updated', 'archived', 'deleted', 'member_added', 'member_removed'],
  work_item: ['created', 'updated', 'state_changed', 'assigned', 'archived', 'restored', 'deleted', 'relation_added', 'relation_removed'],
  comment: ['created', 'updated', 'deleted'],
  page: ['created', 'updated', 'moved', 'deleted'],
  bot: ['mentioned', 'assigned'],
  template: ['run_failed'],
};

const validEvent = (name: string): boolean => {
  const [group, event] = name.split('.');
  const events = WEBHOOK_EVENTS[group];
  return events !== undefined && (event === '*' || events.includes(event));
};

/** Private, loopback and link-local targets are refused (spec 6.3, SSRF). */
const PRIVATE_HOST = /^(localhost|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|0\.0\.0\.0|\[?::1\]?$)/i;

export type WebhookInput = Omit<Webhook, 'id' | 'created_at' | 'disabled_at'> & { id?: string; created_at?: string; disabled_at?: string | null };

const publicView = ({ secret: _secret, ...webhook }: StoredWebhook): Webhook => webhook;

const newSecret = () => `whsec_${Math.random().toString(36).slice(2, 12)}${Math.random().toString(36).slice(2, 12)}${Math.random().toString(36).slice(2, 8)}`;

export function listWebhooks(): Promise<Page<Webhook>> {
  return read(({ db, me }) => {
    requireOrgAdmin(me, 'Webhooks sehen nur Org-Admins.');
    return paginate(db.webhooks.map(publicView));
  });
}

/**
 * Creates a webhook (no id) or changes one. Answers `{ webhook, secret }`; `secret` is the plain text only for a new
 * webhook and with `renew_secret`, otherwise null. Switching a disabled webhook on again clears `disabled_at`.
 */
export function saveWebhook(webhook: WebhookInput, options: { renew_secret?: boolean } = {}): Promise<WebhookSaved> {
  return write(({ db, me, stamp }) => {
    requireOrgAdmin(me, 'Webhooks verwalten nur Org-Admins.');
    const existing = webhook.id ? db.webhooks.find((entry) => entry.id === webhook.id) : undefined;
    if (webhook.id && !existing) throw notFound('Der Webhook');

    const errors = new FieldErrors();
    if (webhook.name.trim() === '') errors.add('name', 'Der Name darf nicht leer sein.');
    try {
      const url = new URL(webhook.url);
      if (url.protocol !== 'https:' && url.protocol !== 'http:') errors.add('url', 'Die Adresse muss mit http:// oder https:// beginnen.');
      else if (PRIVATE_HOST.test(url.hostname)) errors.add('url', 'Ziele in privaten Netzen sind gesperrt.');
    } catch {
      errors.add('url', 'Das ist keine gültige Adresse.');
    }
    if (webhook.events.length === 0) errors.add('events', 'Wähle mindestens ein Ereignis.');
    else if (!webhook.events.every(validEvent)) errors.add('events', 'Mindestens ein Ereignis gibt es nicht.');
    if (webhook.project_id !== null && !db.projects.some((project) => project.id === webhook.project_id)) errors.add('project_id', 'Das Projekt gibt es nicht.');
    if (webhook.bot_id !== null && db.users.find((user) => user.id === webhook.bot_id)?.type !== 'bot') errors.add('bot_id', 'Das ist kein Bot.');
    errors.throwIfAny();

    const renewed = existing === undefined || options.renew_secret === true;
    const secret = renewed ? newSecret() : null;
    const stored: StoredWebhook = {
      id: existing?.id ?? newId('wh'),
      name: webhook.name.trim(),
      url: webhook.url.trim(),
      project_id: webhook.project_id,
      events: [...webhook.events],
      bot_id: webhook.bot_id,
      active: webhook.active,
      // switching it on clears the shut-off mark; a switched-off webhook stays marked until then
      disabled_at: webhook.active ? null : (existing?.disabled_at ?? null),
      created_at: existing?.created_at ?? stamp,
      secret: secret ?? existing!.secret,
    };
    if (existing) db.webhooks[db.webhooks.indexOf(existing)] = stored;
    else db.webhooks.push(stored);
    return { webhook: publicView(stored), secret };
  });
}

export function deleteWebhook(id: string): Promise<void> {
  return write(({ db, me }) => {
    requireOrgAdmin(me, 'Webhooks verwalten nur Org-Admins.');
    if (!db.webhooks.some((webhook) => webhook.id === id)) throw notFound('Der Webhook');
    db.webhooks = db.webhooks.filter((webhook) => webhook.id !== id);
    db.webhook_deliveries = db.webhook_deliveries.filter((delivery) => delivery.webhook_id !== id);
  });
}

/** The delivery log of a webhook, newest first. */
export function listDeliveries(webhook_id: string): Promise<Page<WebhookDelivery>> {
  return read(({ db, me }) => {
    requireOrgAdmin(me, 'Webhooks sehen nur Org-Admins.');
    if (!db.webhooks.some((webhook) => webhook.id === webhook_id)) throw notFound('Der Webhook');
    return paginate(db.webhook_deliveries.filter((delivery) => delivery.webhook_id === webhook_id).sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0)));
  });
}

/** A simulated attempt: a webhook that is on answers 200, a switched-off one answers 500. */
function attempt(ctx: Pick<Ctx, 'stamp'>, webhook: StoredWebhook, event: string): WebhookDelivery {
  const ok = webhook.active && webhook.disabled_at === null;
  return {
    id: newId('dl'),
    webhook_id: webhook.id,
    event,
    attempt: 1,
    status_code: ok ? 200 : 500,
    duration_ms: ok ? 140 : 1_800,
    response_excerpt: ok ? '{"ok":true}' : '{"error":"internal server error"}',
    error: null,
    created_at: ctx.stamp,
  };
}

function findWebhook(db: Db, id: string): StoredWebhook {
  const webhook = db.webhooks.find((entry) => entry.id === id);
  if (!webhook) throw notFound('Der Webhook');
  return webhook;
}

/** Sends a delivery again, as a new log entry. */
export function redeliver(delivery_id: string): Promise<WebhookDelivery> {
  return write((ctx) => {
    requireOrgAdmin(ctx.me, 'Webhooks verwalten nur Org-Admins.');
    const original = ctx.db.webhook_deliveries.find((delivery) => delivery.id === delivery_id);
    if (!original) throw notFound('Die Zustellung');
    const delivery = attempt(ctx, findWebhook(ctx.db, original.webhook_id), original.event);
    ctx.db.webhook_deliveries.push(delivery);
    return delivery;
  });
}

/** Sends a test ping. */
export function pingWebhook(webhook_id: string): Promise<WebhookDelivery> {
  return write((ctx) => {
    requireOrgAdmin(ctx.me, 'Webhooks verwalten nur Org-Admins.');
    const delivery = attempt(ctx, findWebhook(ctx.db, webhook_id), 'ping');
    ctx.db.webhook_deliveries.push(delivery);
    return delivery;
  });
}
