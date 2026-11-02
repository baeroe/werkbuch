/*
 * Unsent text, for this visit (A251): a comment not sent yet, the edit of a comment, a description the server does not
 * hold yet. The text lives here, not in the view that shows it, so it outlives closing the preview or opening another
 * item, and a save or send that fails after its view went away still has its text (A154/N2). Nothing is stored: a
 * reload loses it, and while any text is unsent, leaving or reloading the page asks first (`beforeunload`, here at
 * module level, so no view needs to be there).
 *
 *   drafts.set(commentDraft(item.id), doc);      // null: nothing unsent any more
 *   drafts.get(commentDraft(item.id));
 *   useDraft(commentDraft(item.id));              // the text, rendered anew when it changes
 *
 * Keys: `comment:<itemId>`, `comment-edit:<commentId>`, `description:<itemId>`.
 */

import { useCallback, useSyncExternalStore } from 'react';
import type { RichText } from '@/types';

export type DraftKey = `comment:${string}` | `comment-edit:${string}` | `description:${string}`;

export const commentDraft = (itemId: string): DraftKey => `comment:${itemId}`;
export const commentEditDraft = (commentId: string): DraftKey => `comment-edit:${commentId}`;
export const descriptionDraft = (itemId: string): DraftKey => `description:${itemId}`;

const texts = new Map<DraftKey, RichText>();
const listeners = new Map<DraftKey, Set<() => void>>();

const warnOnUnload = (event: BeforeUnloadEvent) => {
  if (texts.size > 0) event.preventDefault();
};
window.addEventListener('beforeunload', warnOnUnload);

function notify(key: DraftKey): void {
  listeners.get(key)?.forEach((listener) => listener());
}

export const drafts = {
  /** The unsent text under `key`, or null. */
  get(key: DraftKey): RichText | null {
    return texts.get(key) ?? null;
  },

  /** Keeps `doc` as the unsent text under `key`; null: nothing is unsent there any more. */
  set(key: DraftKey, doc: RichText | null): void {
    if ((texts.get(key) ?? null) === doc) return;
    if (doc === null) texts.delete(key);
    else texts.set(key, doc);
    notify(key);
  },

  /** Hears every change under `key`; returns the unsubscribe. */
  subscribe(key: DraftKey, listener: () => void): () => void {
    const own = listeners.get(key) ?? new Set();
    own.add(listener);
    listeners.set(key, own);
    return () => {
      own.delete(listener);
      if (own.size === 0) listeners.delete(key);
    };
  },

  /** The keys with unsent text. */
  pending(): DraftKey[] {
    return [...texts.keys()];
  },

  /** Forgets every text (tests). */
  clear(): void {
    const keys = [...texts.keys()];
    texts.clear();
    keys.forEach(notify);
  },
};

/** The unsent text under `key`, rendered anew whenever it changes. */
export function useDraft(key: DraftKey): RichText | null {
  const subscribe = useCallback((listener: () => void) => drafts.subscribe(key, listener), [key]);
  return useSyncExternalStore(subscribe, () => drafts.get(key));
}
