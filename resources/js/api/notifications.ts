/*
 * The inbox of the signed-in person and their notification settings (spec 4.14). Newest first; the server shows only
 * what the person still sees (a project they lost takes its notifications out of the inbox) and reads the excerpt of a
 * comment or description from its text as it is now. Marking answers how many changed (`{updated}`, without `data`).
 */

import type { Notification, NotificationEvent, NotificationPreference } from '@/types';
import type { Page, PageArgs } from './client';
import { del, get, getPage, one, post, put } from './http';

export interface ListNotificationsArgs extends PageArgs {
  unread_only?: boolean;
  mentions_only?: boolean;
}

/** How many ids one call to mark takes (`MarkNotificationsRead::MAX_IDS`); more go in blocks of this size. */
export const MARK_MAX = 100;

/** A page of the own inbox; the filters go as `1`/`0` (Laravel's `boolean` takes no "true"). */
export function listNotifications(args: ListNotificationsArgs = {}): Promise<Page<Notification>> {
  return getPage<Notification>('/notifications', { ...args });
}

/** Marks by id in blocks of MARK_MAX, one after the other; no ids ask nothing. Answers how many changed in all. */
async function mark(path: string, ids: readonly string[]): Promise<{ updated: number }> {
  let updated = 0;
  for (let start = 0; start < ids.length; start += MARK_MAX) {
    updated += (await post<{ updated: number }>(path, { ids: ids.slice(start, start + MARK_MAX) })).updated;
  }

  return { updated };
}

/** Marks notifications of the signed-in person as read; ids of others are passed over. */
export function markRead(ids: readonly string[]): Promise<{ updated: number }> {
  return mark('/notifications/read', ids);
}

/** Marks notifications of the signed-in person as unread again (spec 4.14: "gelesen/ungelesen"). */
export function markUnread(ids: readonly string[]): Promise<{ updated: number }> {
  return mark('/notifications/unread', ids);
}

/** Marks every unread notification read, with `mentions_only` every unread mention: what the filter shows (A291). */
export function markAllRead(options: { mentions_only?: boolean } = {}): Promise<{ updated: number }> {
  return post<{ updated: number }>('/notifications/read', { all: true, ...options });
}

export function deleteNotification(id: string): Promise<void> {
  return del<void>(`/notifications/${encodeURIComponent(id)}`);
}

/** Every kind of event the settings page offers, in its order (the order of `NotificationKind` on the server). */
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

/** The whole matrix of events and channels for the signed-in person: their choices, the defaults for the rest. */
export function getPreferences(): Promise<NotificationPreference[]> {
  return one(get<{ data: NotificationPreference[] }>('/notification-preferences'));
}

/** Stores the choices of the signed-in person and answers the whole matrix. */
export function savePreferences(preferences: NotificationPreference[]): Promise<NotificationPreference[]> {
  return one(put<{ data: NotificationPreference[] }>('/notification-preferences', { preferences }));
}
