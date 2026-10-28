/*
 * The inbox of the signed-in person and their notification settings (spec 4.14). Newest first.
 */

import type { Notification, NotificationChannel, NotificationEvent, NotificationPreference } from '@/types';
import { notFound, paginate, read, write, type Page, type PageArgs } from './client';
import { channelEnabled } from './events';

export interface ListNotificationsArgs extends PageArgs {
  unread_only?: boolean;
  mentions_only?: boolean;
}

export function listNotifications(args: ListNotificationsArgs = {}): Promise<Page<Notification>> {
  return read(({ db, me }) =>
    paginate(
      db.notifications
        .filter((notification) => notification.user_id === me.id)
        .filter((notification) => !args.unread_only || notification.read_at === null)
        .filter((notification) => !args.mentions_only || notification.event === 'mentioned')
        .sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0)),
      args,
    ),
  );
}

/** Marks notifications of the signed-in person as read; ids of others are ignored. */
export function markRead(ids: string[]): Promise<void> {
  return write(({ db, me, stamp }) => {
    for (const notification of db.notifications) {
      if (notification.user_id === me.id && ids.includes(notification.id) && notification.read_at === null) notification.read_at = stamp;
    }
  });
}

export function markAllRead(): Promise<void> {
  return write(({ db, me, stamp }) => {
    for (const notification of db.notifications) {
      if (notification.user_id === me.id && notification.read_at === null) notification.read_at = stamp;
    }
  });
}

export function deleteNotification(id: string): Promise<void> {
  return write(({ db, me }) => {
    if (!db.notifications.some((notification) => notification.id === id && notification.user_id === me.id)) throw notFound('Die Benachrichtigung');
    db.notifications = db.notifications.filter((notification) => notification.id !== id);
  });
}

/** Every kind of event the settings page offers, in its order. */
export const NOTIFICATION_EVENTS: readonly NotificationEvent[] = [
  'assigned',
  'mentioned',
  'comment',
  'state_changed',
  'item_changed',
  'due',
  'item_created',
  'template_run_failed',
  'webhook_disabled',
];
const CHANNELS: readonly NotificationChannel[] = ['inbox', 'mail'];

/** The whole matrix of events and channels for the signed-in person: their choices, the defaults for the rest. */
export function getPreferences(): Promise<NotificationPreference[]> {
  return read(({ db, me }) =>
    NOTIFICATION_EVENTS.flatMap((event) =>
      CHANNELS.map((channel): NotificationPreference => ({ user_id: me.id, event, channel, enabled: channelEnabled(db, me.id, event, channel) })),
    ),
  );
}

/** Stores the choices of the signed-in person (rows for others are ignored) and answers the whole matrix. */
export function savePreferences(preferences: NotificationPreference[]): Promise<NotificationPreference[]> {
  return write(({ db, me }) => {
    for (const preference of preferences) {
      if (!NOTIFICATION_EVENTS.includes(preference.event) || !CHANNELS.includes(preference.channel)) continue;
      const stored = db.notification_preferences.find(
        (entry) => entry.user_id === me.id && entry.event === preference.event && entry.channel === preference.channel,
      );
      if (stored) stored.enabled = preference.enabled;
      else db.notification_preferences.push({ user_id: me.id, event: preference.event, channel: preference.channel, enabled: preference.enabled });
    }
    return NOTIFICATION_EVENTS.flatMap((event) =>
      CHANNELS.map((channel): NotificationPreference => ({ user_id: me.id, event, channel, enabled: channelEnabled(db, me.id, event, channel) })),
    );
  });
}
