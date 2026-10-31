/*
 * The state of a dialog that edits something: whether it is open and what it is about. Every opening is a new round:
 * the dialog is mounted under a new key, so its draft starts from the stored values and a refusal of the last time is
 * gone. The old dialog stays mounted while it closes, so its exit animation plays.
 *
 *   const dialog = useDialogRound<Label>();
 *   <Button onClick={() => dialog.show(label)}>Edit</Button>
 *   <LabelDialog key={dialog.round} open={dialog.open} label={dialog.target} onOpenChange={dialog.setOpen} />
 *
 * `returnFocus(fallback)` is the `finalFocus` of the dialog: the button that opened it, or `fallback` when that button
 * is gone by the time the dialog closes (the empty state with "Create" gave way to the list the new entry started).
 */

import { useCallback, useRef, useState, type RefObject } from 'react';

interface Round<T> {
  round: number;
  open: boolean;
  target: T | null;
}

export function useDialogRound<T = never>() {
  const [state, setState] = useState<Round<T>>({ round: 0, open: false, target: null });
  const opener = useRef<HTMLElement | null>(null);

  const show = useCallback((target?: T) => {
    opener.current = document.activeElement as HTMLElement | null;
    setState((current) => ({ round: current.round + 1, open: true, target: target ?? null }));
  }, []);
  const setOpen = useCallback((open: boolean) => setState((current) => ({ ...current, open })), []);
  // read when the dialog closes, not when it renders: by then the opener may be gone
  const returnFocus = useCallback(
    (fallback: RefObject<HTMLElement | null>): RefObject<HTMLElement | null> => ({
      get current() {
        return opener.current?.isConnected ? opener.current : fallback.current;
      },
    }),
    [],
  );

  return { ...state, show, setOpen, returnFocus };
}
