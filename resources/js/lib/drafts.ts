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
 * A wiki page keeps more than its text (`page:<pageId>`, K4): the title, the emoji and the text as typed, the version
 * they were typed on (`base_version`, so a draft brought back never saves over a newer version without the 409), and
 * the conflict a save met (`drafts.setPage`, `usePageDraft`). It asks before leaving like any text.
 *
 * Beside the text, the store knows whether a send or save of a key is on its way (`startSending`, `useDraftSending`):
 * a view opened again while the call of an earlier one runs follows it (its button stays busy, and the answer that
 * changes the text reaches it), so nothing is sent twice.
 *
 * A refusal of a sent text (a 422 of the server) stays with its key until the text changes (`setProblem`, `useDraftProblem`):
 * a view opened again after the refusal shows it under the editor, as the view that sent showed it (T18-M6).
 *
 * Work on its way that is no text, an upload of the file list, holds the same question (`hold()`), also after its view
 * went away; a sign-in of another person does not end it (the call runs on until it answers).
 *
 * Who is signed in owns the drafts: when the person changes (`resetForUser`), `clear()` forgets every text and every
 * call on its way (`epoch()` tells a call that ends afterwards to leave the store alone), and the modules that keep
 * more beside a draft forget it too (`onClear`).
 */

import { useCallback, useSyncExternalStore } from 'react';
import type { RichText, Page as WikiPage } from '@/types';

export type DraftKey = `comment:${string}` | `comment-edit:${string}` | `description:${string}`;
export type PageDraftKey = `page:${string}`;
type AnyKey = DraftKey | PageDraftKey;

export const commentDraft = (itemId: string): DraftKey => `comment:${itemId}`;
export const commentEditDraft = (commentId: string): DraftKey => `comment-edit:${commentId}`;
export const descriptionDraft = (itemId: string): DraftKey => `description:${itemId}`;
export const pageDraft = (pageId: string): PageDraftKey => `page:${pageId}`;

/** What a wiki page holds that the server does not have yet. */
export interface PageDraft {
  title: string;
  emoji: string | null;
  content: RichText | null;
  /** The version of the page the draft was typed on: saving it sends this, never a newer one. */
  base_version: number;
  /** The conflict a save of it met (409 `page_conflict`): the server's sentence and the page as it is stored. */
  conflict: { message: string; current: WikiPage } | null;
}

const texts = new Map<DraftKey, RichText>();
const pageDrafts = new Map<PageDraftKey, PageDraft>();
const listeners = new Map<AnyKey, Set<() => void>>();
/** Calls on their way, by key (two views of an item may each have one). */
const sendingCounts = new Map<AnyKey, number>();
/** The server's refusal of the text under a key, until the text changes. */
const problems = new Map<DraftKey, string>();
const clearHooks = new Set<() => void>();
/** Counts the clears: a call that began before the last one leaves the store alone. */
let epoch = 0;
/** Work on its way that leaving the page would lose (`hold()`). */
let holds = 0;

const warnOnUnload = (event: BeforeUnloadEvent) => {
  if (texts.size > 0 || pageDrafts.size > 0 || holds > 0) event.preventDefault();
};
window.addEventListener('beforeunload', warnOnUnload);

function notify(key: AnyKey): void {
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
    // a new text is not the one the server refused
    problems.delete(key);
    notify(key);
  },

  /** What a wiki page holds unsaved under `key`, or null. */
  page(key: PageDraftKey): PageDraft | null {
    return pageDrafts.get(key) ?? null;
  },

  /** Keeps `draft` as what the page under `key` holds unsaved; null: nothing is unsaved there any more. */
  setPage(key: PageDraftKey, draft: PageDraft | null): void {
    if ((pageDrafts.get(key) ?? null) === draft) return;
    if (draft === null) pageDrafts.delete(key);
    else pageDrafts.set(key, draft);
    notify(key);
  },

  /** The server's refusal of the text under `key` (a 422), or null. */
  problem(key: DraftKey): string | null {
    return problems.get(key) ?? null;
  },

  /** Keeps the server's refusal of the text under `key` until the text changes; null: none any more. */
  setProblem(key: DraftKey, message: string | null): void {
    if ((problems.get(key) ?? null) === message) return;
    if (message === null) problems.delete(key);
    else problems.set(key, message);
    notify(key);
  },

  /** Hears every change under `key`; returns the unsubscribe. */
  subscribe(key: AnyKey, listener: () => void): () => void {
    const own = listeners.get(key) ?? new Set();
    own.add(listener);
    listeners.set(key, own);
    return () => {
      own.delete(listener);
      if (own.size === 0) listeners.delete(key);
    };
  },

  /** The keys with unsent text (and the pages with unsaved changes). */
  pending(): AnyKey[] {
    return [...texts.keys(), ...pageDrafts.keys()];
  },

  /** Whether a send or save of `key` is on its way. */
  sending(key: AnyKey): boolean {
    return (sendingCounts.get(key) ?? 0) > 0;
  },

  /** A send or save of `key` begins; the function returned ends it (once). */
  startSending(key: AnyKey): () => void {
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

  /** Leaving or reloading the page asks first until the function returned is called (once): an upload on its way. */
  hold(): () => void {
    holds += 1;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      holds -= 1;
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
    const keys = new Set<AnyKey>([...texts.keys(), ...pageDrafts.keys(), ...sendingCounts.keys()]);
    epoch += 1;
    texts.clear();
    pageDrafts.clear();
    sendingCounts.clear();
    problems.clear();
    clearHooks.forEach((hook) => hook());
    keys.forEach(notify);
  },
};

/** The unsent text under `key`, rendered anew whenever it changes. */
export function useDraft(key: DraftKey): RichText | null {
  const subscribe = useCallback((listener: () => void) => drafts.subscribe(key, listener), [key]);
  return useSyncExternalStore(subscribe, () => drafts.get(key));
}

/** The server's refusal of the text under `key`, rendered anew when it changes. */
export function useDraftProblem(key: DraftKey): string | null {
  const subscribe = useCallback((listener: () => void) => drafts.subscribe(key, listener), [key]);
  return useSyncExternalStore(subscribe, () => drafts.problem(key));
}

/** What the wiki page under `key` holds unsaved, rendered anew when it changes. */
export function usePageDraft(key: PageDraftKey): PageDraft | null {
  const subscribe = useCallback((listener: () => void) => drafts.subscribe(key, listener), [key]);
  return useSyncExternalStore(subscribe, () => drafts.page(key));
}

/** Whether a send or save of `key` is on its way, rendered anew when that changes. */
export function useDraftSending(key: AnyKey): boolean {
  const subscribe = useCallback((listener: () => void) => drafts.subscribe(key, listener), [key]);
  return useSyncExternalStore(subscribe, () => drafts.sending(key));
}
