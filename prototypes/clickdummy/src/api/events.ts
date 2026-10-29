/*
 * The event log, and what follows from an event (spec 7.2: events are the source of the history and the outbox):
 * people watching are notified (spec 4.14), webhooks get a delivery (spec 6.3).
 */

import type { ItemEvent, NotificationChannel, NotificationData, NotificationEvent, WorkItemRecord } from '@/types';
import { canSeeProject } from './access';
import { newId, type Ctx } from './client';
import type { Db } from './db';

export interface EventInput {
  /** e.g. `work_item.state_changed`. */
  type: string;
  actor_id: string;
  subject: { type: string; id: string };
  project_id: string | null;
  changes?: Record<string, { old: unknown; new: unknown }>;
  /** Why an automation acted, e.g. "Automatisierung: Auto-Archiv". */
  reason?: string | null;
  /** The bot a `bot.*` event is about; webhooks can be limited to one bot. */
  bot_id?: string;
}

/* ------------------------------------------------------------------- watching */

/**
 * Makes somebody watch an item. Bots and deactivated accounts get no notifications and so do not watch. Somebody who
 * switched watching off is only subscribed again by a new mention or assignment (`explicit`).
 */
export function addSubscriber(db: Db, item: WorkItemRecord, userId: string | null, explicit = false): void {
  if (userId === null) return;
  const user = db.users.find((entry) => entry.id === userId);
  if (!user || user.type === 'bot' || user.disabled_at !== null) return;

  const muted = db.unsubscribed[item.id] ?? [];
  if (muted.includes(userId)) {
    if (!explicit) return;
    db.unsubscribed[item.id] = muted.filter((id) => id !== userId);
  }
  if (!item.subscriber_ids.includes(userId)) item.subscriber_ids.push(userId);
}

export function removeSubscriber(db: Db, item: WorkItemRecord, userId: string): void {
  item.subscriber_ids = item.subscriber_ids.filter((id) => id !== userId);
  const muted = db.unsubscribed[item.id] ?? [];
  if (!muted.includes(userId)) db.unsubscribed[item.id] = [...muted, userId];
}

/* ---------------------------------------------------------------------- events */

function matchesPattern(patterns: readonly string[], type: string): boolean {
  return patterns.some((pattern) => pattern === type || (pattern.endsWith('.*') && type.startsWith(pattern.slice(0, -1))));
}

/** Appends an event to the log and hands it to the webhooks that listen for it. */
export function recordEvent(ctx: Pick<Ctx, 'db' | 'stamp'>, input: EventInput): ItemEvent {
  const event: ItemEvent = {
    id: newId('ev'),
    type: input.type,
    actor_id: input.actor_id,
    subject: input.subject,
    project_id: input.project_id,
    changes: input.changes ?? {},
    reason: input.reason ?? null,
    occurred_at: ctx.stamp,
  };
  ctx.db.events.push(event);

  for (const webhook of ctx.db.webhooks) {
    if (!webhook.active || webhook.disabled_at !== null) continue;
    if (webhook.project_id !== null && webhook.project_id !== event.project_id) continue;
    if (!matchesPattern(webhook.events, event.type)) continue;
    if (webhook.bot_id !== null && webhook.bot_id !== input.bot_id && webhook.bot_id !== event.actor_id) continue;
    ctx.db.webhook_deliveries.push({
      id: newId('dl'),
      webhook_id: webhook.id,
      event: event.type,
      attempt: 1,
      status_code: 200,
      duration_ms: 90 + (event.id.length * 37 + event.type.length * 11) % 240,
      response_excerpt: '{"ok":true}',
      error: null,
      created_at: ctx.stamp,
    });
  }
  return event;
}

/* --------------------------------------------------------------- notifications */

/** Mail is on by default for these; everything else is inbox only (spec 4.14). */
export const MAIL_BY_DEFAULT: readonly NotificationEvent[] = ['assigned', 'mentioned', 'comment', 'due'];

export function channelEnabled(db: Db, userId: string, event: NotificationEvent, channel: NotificationChannel): boolean {
  const stored = db.notification_preferences.find(
    (preference) => preference.user_id === userId && preference.event === event && preference.channel === channel,
  );
  if (stored) return stored.enabled;
  return channel === 'inbox' ? true : MAIL_BY_DEFAULT.includes(event);
}

export type NotifyInput = {
  event: NotificationEvent;
  /** Who caused it, and is never told; null when nobody did (a template run of the scheduler). */
  actor_id: string | null;
  event_id: string | null;
  data?: NotificationData;
  /** Who is told. Defaults to everybody watching the item and the project lead. */
  recipients?: Iterable<string>;
} & ({ item: WorkItemRecord; project_id?: undefined } | { item?: undefined; project_id: string });

/**
 * Puts a notification into the inbox of each recipient who should get one: never the person who caused the event,
 * never bots, deactivated accounts or accounts without access, and only where the inbox is switched on. It is about an
 * item, or about a project alone (a failed template run).
 */
export function notifyPeople(ctx: Pick<Ctx, 'db' | 'stamp'>, input: NotifyInput): void {
  const { db } = ctx;
  const project = db.projects.find((entry) => entry.id === (input.item?.project_id ?? input.project_id));
  if (!project) return;

  const recipients = new Set(input.recipients ?? [...(input.item?.subscriber_ids ?? []), project.lead_id]);
  for (const userId of recipients) {
    if (userId === input.actor_id) continue;
    const user = db.users.find((entry) => entry.id === userId);
    if (!user || user.type === 'bot' || user.disabled_at !== null) continue;
    if (!canSeeProject(db, user, project)) continue;
    if (!channelEnabled(db, userId, input.event, 'inbox')) continue;

    db.notifications.push({
      id: newId('n'),
      user_id: userId,
      event_id: input.event_id,
      event: input.event,
      project_id: project.id,
      work_item_id: input.item?.id ?? null,
      actor_id: input.actor_id,
      data: input.data ?? {},
      read_at: null,
      mailed_at: null,
      created_at: ctx.stamp,
    });
  }
}
