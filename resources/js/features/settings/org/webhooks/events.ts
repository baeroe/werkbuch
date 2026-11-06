/*
 * The events of a webhook as the form shows them: a tree of groups with their events, where ticking a whole group
 * stores the wildcard `work_item.*` and ticking single events stores their names (spec 6.3). The stored list and the
 * ticks agree both ways: these two functions are each other's inverse up to normalising (a group with all its events
 * ticked is stored as its wildcard). Names the catalog does not know tick nothing.
 */

import { EVENT_GROUPS } from './catalog';

/** The ticked events by group name. */
export type EventSelection = Record<string, readonly string[]>;

/** What a stored list of event names ticks: `work_item.*` ticks all events of the group, a single name one. */
export function selectionOf(events: readonly string[]): EventSelection {
  const selection: Record<string, string[]> = {};
  for (const group of EVENT_GROUPS) {
    const ticked = group.events.filter((event) => events.includes(`${group.group}.*`) || events.includes(`${group.group}.${event}`));
    if (ticked.length > 0) selection[group.group] = ticked;
  }
  return selection;
}

/** The list to store for a selection, in the order of the catalog: the wildcard of a full group, otherwise the names. */
export function eventsOf(selection: EventSelection): string[] {
  return EVENT_GROUPS.flatMap((group) => {
    const ticked = group.events.filter((event) => selection[group.group]?.includes(event));
    if (ticked.length === 0) return [];
    return ticked.length === group.events.length ? [`${group.group}.*`] : ticked.map((event) => `${group.group}.${event}`);
  });
}

/** How many single events a stored list stands for: `work_item.*` counts nine. */
export function countEvents(events: readonly string[]): number {
  return Object.values(selectionOf(events)).reduce((sum, ticked) => sum + ticked.length, 0);
}
