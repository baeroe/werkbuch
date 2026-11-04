import { useQuery } from '@tanstack/react-query';
import {
  deleteNotification,
  getPreferences,
  listNotifications,
  markAllRead,
  markRead,
  markUnread,
  savePreferences,
  type ListNotificationsArgs,
} from '@/api/notifications';
import { qk } from './keys';
import { useApiMutation } from './mutation';

/** A page of the inbox of the signed-in person, newest first. */
export function useNotifications(args: ListNotificationsArgs = {}) {
  return useQuery({ queryKey: qk.notifications.list(args), queryFn: () => listNotifications(args) });
}

/** The number on the inbox badge: the total of a page of one unread row; 0 until it is known. */
export function useUnreadCount(): number {
  return useNotifications({ unread_only: true, per_page: 1 }).data?.total ?? 0;
}

/**
 * Variable: the ids to mark as read. Every list of the inbox and the badge follow, also after a failure: more than 100
 * go in blocks, and the blocks before the one that failed are stored (the own tab hears no `notifications.changed`).
 */
export function useMarkRead() {
  return useApiMutation(markRead, [qk.notifications.all], { invalidateOnError: true });
}

/** Variable: the ids to mark as unread again (in blocks as well, see useMarkRead). */
export function useMarkUnread() {
  return useApiMutation(markUnread, [qk.notifications.all], { invalidateOnError: true });
}

/** Variable: `{ mentions_only }` or nothing (A291). */
export function useMarkAllRead() {
  return useApiMutation(markAllRead, [qk.notifications.all]);
}

/** Variable: the notification id. */
export function useDeleteNotification() {
  return useApiMutation(deleteNotification, [qk.notifications.all]);
}

/** The matrix of events and channels of the signed-in person. */
export function usePreferences() {
  return useQuery({ queryKey: qk.preferences.all, queryFn: getPreferences });
}

/** Variable: the rows to store. */
export function useSavePreferences() {
  return useApiMutation(savePreferences, [qk.preferences.all]);
}
