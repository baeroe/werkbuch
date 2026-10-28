import { useQuery } from '@tanstack/react-query';
import {
  deleteNotification,
  getPreferences,
  listNotifications,
  markAllRead,
  markRead,
  savePreferences,
  type ListNotificationsArgs,
} from '@/api/notifications';
import { qk } from './keys';
import { useApiMutation } from './mutation';

/** The inbox of the signed-in person, newest first. */
export function useNotifications(args: ListNotificationsArgs = {}) {
  return useQuery({ queryKey: qk.notifications.list(args), queryFn: () => listNotifications(args) });
}

/** The number on the inbox badge. */
export function useUnreadCount(): number {
  return useNotifications({ unread_only: true, per_page: 1 }).data?.total ?? 0;
}

/** Variable: the ids to mark as read. */
export function useMarkRead() {
  return useApiMutation(markRead, [qk.notifications.all]);
}

export function useMarkAllRead() {
  return useApiMutation(markAllRead, [qk.notifications.all]);
}

export function useDeleteNotification() {
  return useApiMutation(deleteNotification, [qk.notifications.all]);
}

/** The matrix of events and channels of the signed-in person. */
export function usePreferences() {
  return useQuery({ queryKey: qk.preferences.all, queryFn: getPreferences });
}

export function useSavePreferences() {
  return useApiMutation(savePreferences, [qk.preferences.all]);
}
