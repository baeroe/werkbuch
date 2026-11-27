/*
 * The layout each list was last shown in (WEBU-68): per person and list (a built-in list, a project, a view), in a module
 * store with localStorage behind it, like the open pages of a wiki (`features/wiki/expanded.ts`). A list without one
 * shows its own default. Reading and writing the storage may fail (private mode, a full quota): then the module store
 * alone keeps it for this visit. A change of the person forgets the module store (`drafts.onClear`).
 */

import { useSyncExternalStore } from 'react';
import { LAYOUTS } from '@/domain/viewState';
import { drafts } from '@/lib/drafts';
import type { Display } from '@/types';

type Layout = Display['layout'];

const PREFIX_OF_KEYS = 'werkbuch.layout.';

/** The key of a person's layout of a list: `my`, `created`, `subscribed`, `project:<ULID>`, `view:<ULID>`. */
export const layoutKey = (userId: string, list: string) => `${PREFIX_OF_KEYS}${userId}.${list}`;

const memory = new Map<string, Layout | null>();
const listeners = new Set<() => void>();

drafts.onClear(() => {
  memory.clear();
  listeners.forEach((listener) => listener());
});

const isLayout = (value: unknown): value is Layout => (LAYOUTS as readonly unknown[]).includes(value);

/** The layout remembered under `key`, or null. */
export function readLayout(key: string): Layout | null {
  if (memory.has(key)) return memory.get(key)!;
  let read: Layout | null = null;
  try {
    const stored = window.localStorage.getItem(key);
    read = isLayout(stored) ? stored : null;
  } catch {
    // no storage: nothing remembered
  }
  memory.set(key, read);
  return read;
}

/** Remembers the layout under `key`; the same one again changes nothing. */
export function writeLayout(key: string, layout: Layout): void {
  if (readLayout(key) === layout) return;
  memory.set(key, layout);
  try {
    window.localStorage.setItem(key, layout);
  } catch {
    // the module store keeps it for this visit
  }
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The layout remembered under `key`, or null; null as the key reads nothing. */
export function useRememberedLayout(key: string | null): Layout | null {
  return useSyncExternalStore(subscribe, () => (key === null ? null : readLayout(key)));
}
