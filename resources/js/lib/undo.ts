/*
 * Undo instead of asking (spec 5.1): deleting and archiving show a toast with "Undo" for 5 seconds, and the change
 * itself only happens when the toast runs out, as in openbill. The screen shows the result at once (e.g. hides the
 * row); `undo` takes that back. `mod+z` presses "Undo" on the newest toast that still offers it.
 *
 *   runWithUndo({
 *     label: 'WEB-51 deleted',
 *     run: () => deleteItem.mutateAsync(item.id),
 *     undo: () => setHidden(null),
 *   });
 */

import { currentToasts, runToastAction, subscribeToasts, toast, waitingToasts } from '@/components/ui/toast';
import { t } from '@/lib/i18n';
import { notifyError } from './errors';

/** The action label of every toast that takes something back; `mod+z` looks for it. Not a constant: the language is only known after `initI18n`. */
export const undoLabel = (): string => t('common.undo');

export interface UndoOptions {
  /** What happened, as the toast says it: "WEB-51 deleted". */
  label: string;
  /** A second line of the toast, when there is more to say (unsaved changes that go with it). */
  description?: string;
  /** Does it for real when the toast runs out (time up or closed; newer toasts never push it out); may return a promise. */
  run: () => unknown;
  /** Takes back what the screen already shows. */
  undo?: () => void;
  /** Milliseconds until `run`; 5000 by default. */
  delay?: number;
  /** Title of the error toast when `run` fails; "Not done: <label>" by default. */
  failureTitle?: string;
}

/**
 * Shows the toast and runs the action when it runs out. Answers the id of the toast. Newer toasts never push it out
 * (`keep`): the action runs when its time is up or it is closed, never early.
 */
export function runWithUndo({ label, description, run, undo, delay = 5000, failureTitle }: UndoOptions): number {
  const fail = (error: unknown) => notifyError(failureTitle ?? t('errors.not_done', { label }), error, execute);
  function execute() {
    const done = holdRunning();
    try {
      void Promise.resolve(run()).catch(fail).finally(done);
    } catch (error) {
      fail(error);
      done();
    }
  }
  return toast({ title: label, description, duration: delay, keep: true, action: { label: undoLabel(), onClick: () => undo?.() }, onExpire: execute });
}

/** How many actions of undo toasts run right now (between the toast running out and the end of their call). */
let running = 0;
const runningListeners = new Set<() => void>();

function holdRunning(): () => void {
  running += 1;
  let ended = false;
  return () => {
    if (ended) return;
    ended = true;
    running -= 1;
    [...runningListeners].forEach((listener) => listener());
  };
}

/**
 * Whether a change the screen shows already is not stored yet: an undo toast still offers to take it back (or waits for
 * a place), or its action still runs. Live updates (`useLiveSync`) only mark caches stale meanwhile, as during a
 * mutation: a fresh answer would bring a hidden row back while the toast still says it is gone.
 */
export function undoPending(): boolean {
  return running > 0 || canUndo();
}

/** Calls `callback` whenever `undoPending()` may have changed, until the returned function is called. */
export function subscribeUndoPending(callback: () => void): () => void {
  runningListeners.add(callback);
  const stopToasts = subscribeToasts(callback);
  return () => {
    runningListeners.delete(callback);
    stopToasts();
  };
}

/** The toasts that can take something back, oldest first: on screen, and those still waiting for a place. */
const undoable = () => [...currentToasts(), ...waitingToasts()].filter((item) => item.action?.label === undoLabel()).sort((a, b) => a.id - b.id);

/** Whether a toast that can take something back is showing (or waiting to). */
export function canUndo(): boolean {
  return undoable().length > 0;
}

/** Takes back the newest action that can still be undone, also one whose toast still waits; false when there is none. */
export function undoLatest(): boolean {
  const latest = undoable().at(-1);
  if (!latest) return false;
  runToastAction(latest.id);
  return true;
}
