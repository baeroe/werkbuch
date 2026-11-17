/*
 * Which pages of a wiki's tree are open (WEBU-5): per person and project, in a module store with localStorage behind
 * it. The tree starts folded (a page with subpages is open only once someone opened it, or while it is an ancestor of
 * the open page), and what someone opens or folds stays: on another page of the wiki, back and forth in the browser,
 * between the wiki and the item list, after a reload. Reading and writing the storage may fail (private mode, a full
 * quota, no storage at all): then the module store alone keeps it for this visit, as before. A change of the person
 * forgets the module store (`drafts.onClear`); the storage keeps each person's under their own key.
 */

import { useCallback, useSyncExternalStore } from 'react';
import { drafts } from '@/lib/drafts';
import type { PageNode } from '@/types';

const PREFIX_OF_KEYS = 'werkbuch.wiki.expanded.';

/** The key of a person's open pages in a project's wiki. */
export const expandedKey = (userId: string, projectId: string) => `${PREFIX_OF_KEYS}${userId}.${projectId}`;

const memory = new Map<string, ReadonlySet<string>>();
const listeners = new Set<() => void>();
const EMPTY: ReadonlySet<string> = new Set();

drafts.onClear(() => {
  memory.clear();
  listeners.forEach((listener) => listener());
});

/** The open pages under `key`: from this visit, else from the storage, else none. The same set until it changes. */
export function readExpanded(key: string): ReadonlySet<string> {
  const known = memory.get(key);
  if (known) return known;
  let read = EMPTY;
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(key) ?? '[]');
    if (Array.isArray(parsed)) read = new Set(parsed.filter((id): id is string => typeof id === 'string'));
  } catch {
    // no storage, or something in it that is no list: the tree starts folded
  }
  memory.set(key, read);
  return read;
}

/** Keeps the open pages under `key`; the same pages again change nothing. */
export function writeExpanded(key: string, next: ReadonlySet<string>): void {
  const current = readExpanded(key);
  if (next.size === current.size && [...next].every((id) => current.has(id))) return;
  memory.set(key, next);
  try {
    if (next.size === 0) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, JSON.stringify([...next]));
  } catch {
    // the module store keeps it for this visit
  }
  listeners.forEach((listener) => listener());
}

let watching = false;

/** Another tab changed what is open: read it again, so this tab neither shows nor writes back its old state. */
function onStorage(event: StorageEvent): void {
  if (event.key === null) memory.clear();
  else if (event.key.startsWith(PREFIX_OF_KEYS)) memory.delete(event.key);
  else return;
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void): () => void {
  if (!watching) {
    window.addEventListener('storage', onStorage);
    watching = true;
  }
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The open pages under `key` and a way to change them from what they are. */
export function useExpanded(key: string): [ReadonlySet<string>, (change: (open: ReadonlySet<string>) => ReadonlySet<string>) => void] {
  const open = useSyncExternalStore(subscribe, () => readExpanded(key));
  const change = useCallback((update: (open: ReadonlySet<string>) => ReadonlySet<string>) => writeExpanded(key, update(readExpanded(key))), [key]);
  return [open, change];
}

/** `open` with the pages `ids` added. */
export const opened = (open: ReadonlySet<string>, ids: readonly string[]): ReadonlySet<string> => (ids.every((id) => open.has(id)) ? open : new Set([...open, ...ids]));

/** `open` without the pages `ids`. */
export const folded = (open: ReadonlySet<string>, ids: readonly string[]): ReadonlySet<string> =>
  ids.some((id) => open.has(id)) ? new Set([...open].filter((id) => !ids.includes(id))) : open;

/** The pages with subpages that are not open: what the tree shows folded. */
export function collapsedOf(nodes: readonly PageNode[], open: ReadonlySet<string>): ReadonlySet<string> {
  const closed = new Set<string>();
  const walk = (list: readonly PageNode[]) => {
    for (const node of list) {
      if (node.children.length === 0) continue;
      if (!open.has(node.id)) closed.add(node.id);
      walk(node.children);
    }
  };
  walk(nodes);
  return closed;
}

/** Every page of the tree, to drop open pages that are gone (deleted); a moved page keeps its id and stays open. */
export function idsOf(nodes: readonly PageNode[]): Set<string> {
  const ids = new Set<string>();
  const walk = (list: readonly PageNode[]) => list.forEach((node) => (ids.add(node.id), walk(node.children)));
  walk(nodes);
  return ids;
}
