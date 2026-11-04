/*
 * The read marks of the inbox (spec 4.14), lifted out of the clickdummy's InboxScreen (13b). A notification marked read
 * or unread shows it at once, and the count in the header follows, before the server has answered; a refusal brings
 * the old state back and says why (`notifyError`), success needs no toast.
 *
 * The calls go one after another (`inTurn`): Enter and then u at once leave the notification unread, whichever call
 * the server would have answered first. Every call ends itself (`mutateAsync`), so the mark of an earlier call never
 * waits on the callbacks of a later one.
 *
 * The count (13c, "the header count can briefly show one too few"): the server's count and the list load again one
 * after the other after a call. A mark therefore remembers what the count held for its notification when it was made
 * (`wasUnread`, not what the list holds now) and the versions of the inbox's queries the moment the server took it
 * (`answered`). It counts only where it differs from what the count holds, and once the count has loaded after the
 * server took it, the count says it itself. A later mark of the same notification keeps the earlier one the server took
 * (`prior`): when the count holds that one, it counts from there. A mark is forgotten once the count and the list have
 * both loaded after it.
 */

import { hashKey, useQueryClient, type QueryKey } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { markAllRead, markRead, markUnread } from '@/api/notifications';
import { qk } from '@/hooks/keys';
import { useApiMutation } from '@/hooks/mutation';
import { notifyError } from '@/lib/errors';
import { t } from '@/lib/i18n';
import type { Notification } from '@/types';

/** The data versions (`dataUpdateCount`) of the inbox's queries, by query hash, the moment the server took a call. */
export type Versions = ReadonlyMap<string, number>;

/** A read mark the server's count does not show yet: what was chosen last for a notification, and the call that sends it. */
export interface Mark {
  read: boolean;
  call: number;
  /** Whether the notification was unread where the count stood when the first of its marks was made. */
  wasUnread: boolean;
  /** A mention: the count of unread mentions follows it too. */
  mention: boolean;
  /** The versions of the queries when the server took this call; null while it is on its way. */
  answered: Versions | null;
  /** The newest earlier mark of the notification the server took meanwhile. */
  prior: { unread: boolean; answered: Versions } | null;
}

/** Whether a count has loaded since the server took a call (its versions then). */
export type LoadedSince = (answered: Versions) => boolean;

/**
 * The unread count with the marks it does not show yet: the server's `total`, less what is marked read, plus what is
 * marked unread, each only where it differs from what the count holds. `include` picks the marks a count is about (the
 * unread mentions).
 */
export function countUnread(total: number, marks: ReadonlyMap<string, Mark>, loadedSince: LoadedSince, include: (mark: Mark) => boolean = () => true): number {
  let unread = total;
  for (const mark of marks.values()) {
    // the count has loaded since the server took this mark: it says it itself
    if (!include(mark) || (mark.answered && loadedSince(mark.answered))) continue;
    const counted = mark.prior && loadedSince(mark.prior.answered) ? mark.prior.unread : mark.wasUnread;
    unread += Number(!mark.read) - Number(counted);
  }
  return Math.max(0, unread);
}

/** The mark for `notification` (as the list stores it) on top of the one it may have already. */
function markOf(previous: Mark | undefined, notification: Notification, read: boolean, call: number): Mark {
  if (!previous) return { read, call, wasUnread: notification.read_at === null, mention: notification.event === 'mentioned', answered: null, prior: null };
  const prior = previous.answered ? { unread: !previous.read, answered: previous.answered } : previous.prior;
  return { ...previous, read, call, answered: null, prior };
}

interface MarkCall {
  call: number;
  ids: readonly string[];
  read: boolean;
  send: () => Promise<{ updated: number }>;
}

export interface ReadMarks {
  marks: ReadonlyMap<string, Mark>;
  /** Whether a notification shows as read: its mark, else what the list stores. */
  isRead: (notification: Notification) => boolean;
  /** The count of the query `countKey` (its `total`) with the marks it does not show yet. */
  unread: (total: number, countKey: QueryKey, include?: (mark: Mark) => boolean) => number;
  /** Marks the notifications (as the list stores them) read or unread. */
  setRead: (notifications: readonly Notification[], read: boolean) => Promise<void>;
  /**
   * Marks everything read, with `mentions_only` every mention (A291); `shown` are the notifications of the list that
   * show it at once. Answers how many the server changed, null when it failed.
   */
  readAll: (shown: readonly Notification[], options: { mentions_only?: boolean }) => Promise<number | null>;
  /** "All read" is on its way. */
  readingAll: boolean;
}

/** `watched`: the list and the counts the screen shows; a mark is forgotten once all of them loaded after it. */
export function useReadMarks(watched: readonly QueryKey[]): ReadMarks {
  const client = useQueryClient();
  const [marks, setMarks] = useState<ReadonlyMap<string, Mark>>(() => new Map());
  const [readingAll, setReadingAll] = useState(0);
  const calls = useRef(0);
  /** The calls that change what is read, one after another. */
  const turn = useRef<Promise<unknown>>(Promise.resolve());

  const version = (key: QueryKey) => client.getQueryState(key)?.dataUpdateCount ?? 0;
  const loadedSince =
    (key: QueryKey): LoadedSince =>
    (answered) =>
      version(key) > (answered.get(hashKey(key)) ?? 0);

  const mutation = useApiMutation((vars: MarkCall) => vars.send(), [qk.notifications.all], {
    // before the reload: the versions the count and the list have now are those without this call
    onSuccess: (_, { call, ids, read }) => {
      const answered: Versions = new Map(client.getQueryCache().findAll({ queryKey: qk.notifications.all }).map((query) => [query.queryHash, query.state.dataUpdateCount]));
      setMarks((state) => {
        const next = new Map(state);
        for (const id of ids) {
          const mark = state.get(id);
          if (mark?.call === call) next.set(id, { ...mark, answered });
          // a later mark waits: this one is what the count will hold until then
          else if (mark && mark.call > call) next.set(id, { ...mark, prior: { unread: !read, answered } });
        }
        return next;
      });
    },
  });

  /** Runs `send` once the calls before it have ended, however they ended. */
  function inTurn<T>(send: () => Promise<T>): Promise<T> {
    const call = turn.current.then(send);
    turn.current = call.catch(() => undefined);
    return call;
  }

  function begin(notifications: readonly Notification[], read: boolean): number {
    calls.current += 1;
    const call = calls.current;
    setMarks((state) => new Map([...state, ...notifications.map((notification) => [notification.id, markOf(state.get(notification.id), notification, read, call)] as const)]));
    return call;
  }

  /** The call failed: its marks go (a later mark of the same notification stays), the notifications are as before. */
  function drop(call: number) {
    setMarks((state) => new Map([...state].filter(([, mark]) => mark.call !== call)));
  }

  async function setRead(notifications: readonly Notification[], read: boolean): Promise<void> {
    if (notifications.length === 0) return;
    const ids = notifications.map((notification) => notification.id);
    const call = begin(notifications, read);
    try {
      await inTurn(() => mutation.mutateAsync({ call, ids, read, send: () => (read ? markRead(ids) : markUnread(ids)) }));
    } catch (error) {
      drop(call);
      notifyError(t(read ? 'inbox.read.failed' : 'inbox.unread.failed'), error, () => void setRead(notifications, read));
    }
  }

  async function readAll(shown: readonly Notification[], options: { mentions_only?: boolean }): Promise<number | null> {
    const call = begin(shown, true);
    setReadingAll((count) => count + 1);
    try {
      const { updated } = await inTurn(() => mutation.mutateAsync({ call, ids: shown.map((notification) => notification.id), read: true, send: () => markAllRead(options) }));
      return updated;
    } catch (error) {
      drop(call);
      notifyError(t('inbox.read_all.failed'), error, () => void readAll(shown, options));
      return null;
    } finally {
      setReadingAll((count) => count - 1);
    }
  }

  // a mark is forgotten once everything the screen shows has loaded after the server took it
  const versions = watched.map((key) => `${hashKey(key)}:${version(key)}`).join(' ');
  useEffect(() => {
    const settled = [...marks].filter(([, mark]) => mark.answered && watched.every((key) => loadedSince(key)(mark.answered!)));
    if (settled.length === 0) return;
    setMarks((state) => new Map([...state].filter(([id, mark]) => !settled.some(([settledId, done]) => settledId === id && done === mark))));
    // `versions` stands for the queries: `watched` is a new array on every render
  }, [marks, versions]);

  return {
    marks,
    isRead: (notification) => marks.get(notification.id)?.read ?? notification.read_at !== null,
    unread: (total, countKey, include) => countUnread(total, marks, loadedSince(countKey), include),
    setRead,
    readAll,
    readingAll: readingAll > 0,
  };
}
