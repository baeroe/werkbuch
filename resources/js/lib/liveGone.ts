/*
 * What live updates said is deleted (`project.deleted`, `work_item.deleted`), for the screens that still show it: the
 * item page and the preview say "Dieses Item wurde gelöscht" without asking the server (A298, F36), whose answer would
 * be a 404. `useLiveSync` marks, and forgets everything when it stops (sign-out).
 */

import { useSyncExternalStore } from 'react';

/** How many deleted ids the tab remembers (the oldest go first), like `useLiveSync`. */
const MAX = 200;

const gone = new Set<string>();
const listeners = new Set<() => void>();
let version = 0;

function changed(): void {
  version += 1;
  listeners.forEach((listener) => listener());
}

/** A message said `id` was deleted. */
export function markLiveGone(id: string): void {
  if (gone.has(id)) return;
  gone.add(id);
  if (gone.size > MAX) gone.delete(gone.values().next().value!);
  changed();
}

/** Live stopped: nothing is known to be gone any more. */
export function clearLiveGone(): void {
  if (gone.size === 0) return;
  gone.clear();
  changed();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Whether a live message said one of `ids` (an item, its project) was deleted. */
export function useLiveGone(...ids: (string | null | undefined)[]): boolean {
  useSyncExternalStore(subscribe, () => version);
  return ids.some((id) => id != null && gone.has(id));
}
