/*
 * What live updates said is deleted (`project.deleted`, `work_item.deleted`, `page.deleted` with its subtree), for the
 * screens that still show it: the item page and the preview say "Dieses Item wurde gelöscht", a wiki page "Diese Seite
 * wurde gelöscht", without asking the server (A298, F36), whose answer would be a 404. `useLiveSync` marks, and forgets
 * everything when it stops (sign-out); deleting a page in this tab marks its subtree too (`useDeletePage`), so a
 * screen still showing one of them asks for it no more.
 *
 * Pages are remembered apart from projects and items: a large subtree (up to 200 pages in one message) would push
 * every deleted project and item out otherwise.
 */

import { useSyncExternalStore } from 'react';

/** How many deleted ids the tab remembers of each kind (the oldest go first), like `useLiveSync`. */
const MAX = 200;

/** What a deleted id names: a wiki page, or a project or an item. */
export type GoneKind = 'page' | 'other';

const gone: Record<GoneKind, Set<string>> = { page: new Set(), other: new Set() };
const listeners = new Set<() => void>();
let version = 0;

function changed(): void {
  version += 1;
  listeners.forEach((listener) => listener());
}

/** A message said `id` (a project or an item, or with `kind` `page` a wiki page) was deleted. */
export function markLiveGone(id: string, kind: GoneKind = 'other'): void {
  const ids = gone[kind];
  if (ids.has(id)) return;
  ids.add(id);
  if (ids.size > MAX) ids.delete(ids.values().next().value!);
  changed();
}

/** Live stopped: nothing is known to be gone any more. */
export function clearLiveGone(): void {
  if (gone.page.size === 0 && gone.other.size === 0) return;
  gone.page.clear();
  gone.other.clear();
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
  return ids.some((id) => id != null && gone.other.has(id));
}

/** Whether a live message (or this tab) said the wiki page was deleted, with its subtree. */
export function usePageGone(pageId: string | null | undefined): boolean {
  useSyncExternalStore(subscribe, () => version);
  return pageId != null && gone.page.has(pageId);
}
