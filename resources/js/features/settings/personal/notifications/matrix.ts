/*
 * The matrix of the notification settings (spec 4.14): events in the rows, channels in the columns. The choices are
 * kept as one flat record, so a form can change cells and tell what differs from what is saved. The defaults are the
 * ones of `App\Domain\Notifications\Preferences`: the inbox for every event, mail for four of them.
 */

import type { NotificationChannel, NotificationEvent, NotificationPreference } from '@/types';

/** One flag per cell, keyed by `cellKey`. */
export type Choices = Record<string, boolean>;

export const cellKey = (event: NotificationEvent, channel: NotificationChannel): string => `${event}:${channel}`;

/** The mails that are on until somebody chooses otherwise (`NotificationKind::mailByDefault()`). */
const MAIL_BY_DEFAULT: readonly NotificationEvent[] = ['assigned', 'mentioned', 'comment', 'due'];

/** What a person gets without having chosen: the inbox for every event, mail for the four above. */
export function defaultEnabled(event: NotificationEvent, channel: NotificationChannel): boolean {
  return channel === 'inbox' || MAIL_BY_DEFAULT.includes(event);
}

/** The defaults of the cells of `events` in `channels`, e.g. only the inbox while mail cannot be chosen. */
export function defaultsFor(events: readonly NotificationEvent[], channels: readonly NotificationChannel[]): Choices {
  return Object.fromEntries(events.flatMap((event) => channels.map((channel) => [cellKey(event, channel), defaultEnabled(event, channel)])));
}

export function toChoices(rows: readonly NotificationPreference[]): Choices {
  return Object.fromEntries(rows.map((row) => [cellKey(row.event, row.channel), row.enabled]));
}

/** The cells of `draft` that differ from `saved`, as the rows the server takes. */
export function changedPreferences(userId: string, saved: Choices, draft: Choices): NotificationPreference[] {
  return Object.entries(draft)
    .filter(([key, enabled]) => saved[key] !== enabled)
    .map(([key, enabled]) => {
      const [event, channel] = key.split(':') as [NotificationEvent, NotificationChannel];
      return { user_id: userId, event, channel, enabled };
    });
}
