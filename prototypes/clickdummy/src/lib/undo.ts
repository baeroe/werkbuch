/*
 * Undo instead of asking (spec 5.1): deleting and archiving show a toast with "Rückgängig" for 5 seconds, and the
 * change itself only happens when the toast runs out, as in openbill. The screen shows the result at once (e.g. hides
 * the row); `undo` takes that back. `mod+z` presses "Rückgängig" on the newest toast that still offers it.
 *
 *   runWithUndo({
 *     label: 'WEB-51 gelöscht',
 *     run: () => deleteItem.mutateAsync(item.id),
 *     undo: () => setHidden(null),
 *   });
 */

import { currentToasts, runToastAction, toast, waitingToasts } from '@/components/ui/toast';
import { notifyError } from './errors';

/** The action label of every toast that takes something back; `mod+z` looks for it. */
export const UNDO_LABEL = 'Rückgängig';

export interface UndoOptions {
  /** What happened, as the toast says it: "WEB-51 gelöscht". */
  label: string;
  /** Does it for real when the toast runs out (time up or closed; newer toasts never push it out); may return a promise. */
  run: () => unknown;
  /** Takes back what the screen already shows. */
  undo?: () => void;
  /** Milliseconds until `run`; 5000 by default. */
  delay?: number;
  /** Title of the error toast when `run` fails; "Nicht ausgeführt: <label>" by default. */
  failureTitle?: string;
}

/**
 * Shows the toast and runs the action when it runs out. Answers the id of the toast. Newer toasts never push it out
 * (`keep`): the action runs when its time is up or it is closed, never early.
 */
export function runWithUndo({ label, run, undo, delay = 5000, failureTitle }: UndoOptions): number {
  const fail = (error: unknown) => notifyError(failureTitle ?? `Nicht ausgeführt: ${label}`, error, execute);
  function execute() {
    try {
      void Promise.resolve(run()).catch(fail);
    } catch (error) {
      fail(error);
    }
  }
  return toast({ title: label, duration: delay, keep: true, action: { label: UNDO_LABEL, onClick: () => undo?.() }, onExpire: execute });
}

/** The toasts that can take something back, oldest first: on screen, and those still waiting for a place. */
const undoable = () => [...currentToasts(), ...waitingToasts()].filter((item) => item.action?.label === UNDO_LABEL).sort((a, b) => a.id - b.id);

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
