/*
 * Templates deleted from their editor while the undo toast still runs (`TemplateEditor`): the editor leads to the list
 * at once, and the list leaves them out until the toast is over (the call goes out only then). A module store, because
 * the editor that deleted is gone by the time the list shows.
 */

import { useSyncExternalStore } from 'react';

let removed: ReadonlySet<string> = new Set();
const listeners = new Set<() => void>();

function set(next: ReadonlySet<string>): void {
  removed = next;
  listeners.forEach((listener) => listener());
}

export function hideTemplate(id: string): void {
  set(new Set(removed).add(id));
}

export function showTemplate(id: string): void {
  if (!removed.has(id)) return;
  const next = new Set(removed);
  next.delete(id);
  set(next);
}

/** The ids of the templates that are being deleted from their editor. */
export function useRemovedTemplates(): ReadonlySet<string> {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    () => removed,
  );
}
