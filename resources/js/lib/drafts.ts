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
 *
 * Beside the text, the store knows whether a send or save of a key is on its way (`startSending`, `useDraftSending`):
 * a view opened again while the call of an earlier one runs follows it (its button stays busy, and the answer that
 * changes the text reaches it), so nothing is sent twice.
 *
 * Who is signed in owns the drafts: when the person changes (`resetForUser`), `clear()` forgets every text and every
 * call on its way (`epoch()` tells a call that ends afterwards to leave the store alone), and the modules that keep
 * more beside a draft forget it too (`onClear`).
 */

import { useCallback, useSyncExternalStore } from 'react';
import type { RichText } from '@/types';

export type DraftKey = `comment:${string}` | `comment-edit:${string}` | `description:${string}`;

export const commentDraft = (itemId: string): DraftKey => `comment:${itemId}`;
export const commentEditDraft = (commentId: string): DraftKey => `comment-edit:${commentId}`;
export const descriptionDraft = (itemId: string): DraftKey => `description:${itemId}`;

const texts = new Map<DraftKey, RichText>();
const listeners = new Map<DraftKey, Set<() => void>>();
/** Calls on their way, by key (two views of an item may each have one). */
const sendingCounts = new Map<DraftKey, number>();
const clearHooks = new Set<() => void>();
/** Counts the clears: a call that began before the last one leaves the store alone. */
let epoch = 0;

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

  /** Whether a send or save of `key` is on its way. */
  sending(key: DraftKey): boolean {
    return (sendingCounts.get(key) ?? 0) > 0;
  },

  /** A send or save of `key` begins; the function returned ends it (once). */
  startSending(key: DraftKey): () => void {
    const began = epoch;
    sendingCounts.set(key, (sendingCounts.get(key) ?? 0) + 1);
    notify(key);
    let ended = false;
    return () => {
      // cleared meanwhile: the count it added is gone already
      if (ended || began !== epoch) return;
      ended = true;
      const left = sendingCounts.get(key)! - 1;
      if (left > 0) sendingCounts.set(key, left);
      else sendingCounts.delete(key);
      notify(key);
    };
  },

  /** Changes with every `clear()`: a call that ends in another epoch than it began in writes nothing. */
  epoch(): number {
    return epoch;
  },

  /** Runs `hook` on every `clear()`; returns the unsubscribe. */
  onClear(hook: () => void): () => void {
    clearHooks.add(hook);
    return () => clearHooks.delete(hook);
  },

  /** Forgets every text and every call on its way (another person signs in; tests). */
  clear(): void {
    const keys = new Set([...texts.keys(), ...sendingCounts.keys()]);
    epoch += 1;
    texts.clear();
    sendingCounts.clear();
    clearHooks.forEach((hook) => hook());
    keys.forEach(notify);
  },
};

/** The unsent text under `key`, rendered anew whenever it changes. */
export function useDraft(key: DraftKey): RichText | null {
  const subscribe = useCallback((listener: () => void) => drafts.subscribe(key, listener), [key]);
  return useSyncExternalStore(subscribe, () => drafts.get(key));
}

/** Whether a send or save of `key` is on its way, rendered anew when that changes. */
export function useDraftSending(key: DraftKey): boolean {
  const subscribe = useCallback((listener: () => void) => drafts.subscribe(key, listener), [key]);
  return useSyncExternalStore(subscribe, () => drafts.sending(key));
}
