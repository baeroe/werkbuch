/*
 * What live updates said is deleted (`project.deleted`, `work_item.deleted`, `page.deleted` with its subtree,
 * `template.deleted`), for the
 * screens that still show it: the item page and the preview say "Dieses Item wurde gelöscht", a wiki page "Diese Seite
 * wurde gelöscht", without asking the server (A298, F36), whose answer would be a 404. `useLiveSync` marks, and forgets
 * everything when it stops (sign-out); deleting a page in this tab marks its subtree too (`useDeletePage`), so a
 * screen still showing one of them asks for it no more.
 *
 * Pages are remembered apart from projects and items: a large subtree (up to 200 pages in one message) would push
 * every deleted project and item out otherwise. Templates are remembered on their own too: the log of a deleted
 * template's runs asks nothing any more (T14-I2), whether it was deleted here (`useDeleteTemplate`) or elsewhere.
 */

import { useSyncExternalStore } from 'react';

/** How many deleted ids the tab remembers of each kind (the oldest go first), like `useLiveSync`. */
const MAX = 200;

/** What a deleted id names: a wiki page, a template, or a project or an item. */
export type GoneKind = 'page' | 'template' | 'other';

const gone: Record<GoneKind, Set<string>> = { page: new Set(), template: new Set(), other: new Set() };
const listeners = new Set<() => void>();
let version = 0;

function changed(): void {
  version += 1;
  listeners.forEach((listener) => listener());
}

/** A message said `id` (a project or an item, or with `kind` a wiki page or a template) was deleted. */
export function markLiveGone(id: string, kind: GoneKind = 'other'): void {
  const ids = gone[kind];
  if (ids.has(id)) return;
  ids.add(id);
  if (ids.size > MAX) ids.delete(ids.values().next().value!);
  changed();
}

/** Live stopped: nothing is known to be gone any more. */
export function clearLiveGone(): void {
  if (Object.values(gone).every((ids) => ids.size === 0)) return;
  Object.values(gone).forEach((ids) => ids.clear());
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

/** Whether the wiki page is known to be deleted, outside a render (a save that runs as its view goes away). */
export function isPageGone(pageId: string): boolean {
  return gone.page.has(pageId);
}

/** Whether a live message (or this tab) said the wiki page was deleted, with its subtree. */
export function usePageGone(pageId: string | null | undefined): boolean {
  useSyncExternalStore(subscribe, () => version);
  return pageId != null && gone.page.has(pageId);
}

/** Whether a live message (or this tab) said the template was deleted: its runs are asked for no more. */
export function useTemplateGone(templateId: string | null | undefined): boolean {
  useSyncExternalStore(subscribe, () => version);
  return templateId != null && gone.template.has(templateId);
}
