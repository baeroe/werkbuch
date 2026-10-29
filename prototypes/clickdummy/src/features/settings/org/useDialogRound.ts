/*
 * The state of a dialog that edits something: whether it is open and what it is about. Every opening is a new round:
 * the dialog is mounted under a new key, so its draft starts from the stored values and a refusal of the last time is
 * gone. The old dialog stays mounted while it closes, so its exit animation plays.
 *
 *   const dialog = useDialogRound<Label>();
 *   <Button onClick={() => dialog.show(label)}>Bearbeiten</Button>
 *   <LabelDialog key={dialog.round} open={dialog.open} label={dialog.target} onOpenChange={dialog.setOpen} />
 */

import { useCallback, useState } from 'react';

interface Round<T> {
  round: number;
  open: boolean;
  target: T | null;
}

export function useDialogRound<T = never>() {
  const [state, setState] = useState<Round<T>>({ round: 0, open: false, target: null });

  const show = useCallback((target?: T) => setState((current) => ({ round: current.round + 1, open: true, target: target ?? null })), []);
  const setOpen = useCallback((open: boolean) => setState((current) => ({ ...current, open })), []);

  return { ...state, show, setOpen };
}
