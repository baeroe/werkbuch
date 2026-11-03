/*
 * The lines of an item's activity (spec 4.10): comments and the history in one order, oldest first, with the changes of
 * one account read as one line while they follow each other within a few minutes ("Ida Brenner hat die Priorität …
 * geändert und das Due-Date … verschoben."). A bulk edit writes up to three events for one item at once (fields,
 * assignee, move): they read as one line too. Every comment is a line of its own.
 */

import type { ActivityEntry, Comment, ItemEvent } from '@/types';

/** "Alles", "Kommentare" or "Änderungen". */
export type ActivityFilter = 'all' | 'comments' | 'changes';

/** One line: a comment, or the events of one account, made the same way (`via`) for the same reason, within the window. */
export type TimelineEntry =
  | { kind: 'comment'; key: string; at: string; comment: Comment }
  | {
      kind: 'events';
      key: string;
      /** When the first change of the line happened. */
      at: string;
      actorId: string;
      via: string | null;
      reason: string | null;
      events: ItemEvent[];
    };

export type EventsLine = Extract<TimelineEntry, { kind: 'events' }>;

/** Changes by one account within this time read as one line (spec 13, master plan: five minutes). */
export const GROUP_WINDOW_MS = 5 * 60_000;

/**
 * The lines of the timeline: comments one by one ("Alles", "Kommentare"), changes ("Alles", "Änderungen") grouped by
 * account, `via` and reason while they follow each other within `windowMs` of the group's first change. A comment in
 * between ends the group where comments are shown ("Alles"); "Änderungen" leaves comments out, so the changes around
 * one stay together.
 */
export function buildTimeline(entries: readonly ActivityEntry[], filter: ActivityFilter, windowMs = GROUP_WINDOW_MS): TimelineEntry[] {
  const lines: TimelineEntry[] = [];
  let open: EventsLine | null = null;
  for (const entry of entries) {
    if (entry.kind === 'comment') {
      if (filter === 'changes') continue;
      lines.push({ kind: 'comment', key: entry.id, at: entry.at, comment: entry.comment });
      open = null;
      continue;
    }
    if (filter === 'comments') continue;
    const { event } = entry;
    if (
      open &&
      open.actorId === event.actor_id &&
      open.via === event.via &&
      open.reason === event.reason &&
      Date.parse(event.occurred_at) - Date.parse(open.at) <= windowMs
    ) {
      open.events.push(event);
      continue;
    }
    open = { kind: 'events', key: event.id, at: event.occurred_at, actorId: event.actor_id, via: event.via, reason: event.reason, events: [event] };
    lines.push(open);
  }
  return lines;
}
