/*
 * Removing instead of asking (spec 5.1): the row disappears at once, a toast offers "Undo" for five seconds, and only
 * when the toast runs out does the call go out (`runWithUndo`). Whoever takes it back finds the row where it was. A call
 * that fails brings the row back, and the error toast says why. So does one that only archives (a type with items, a
 * resolution that items carry): the call has refreshed the list by the time it is over, and what is left in it shows
 * again. What the answer says (how many items lost the label, that the type was only archived) only comes after the
 * undo time, so `onDone` gets the answer and tells it in a toast of its own (K12).
 */

import { useCallback, useState } from 'react';
import { runWithUndo } from '@/lib/undo';
import { focusNeighbour } from './form';

interface Removal<T> {
  /** The id of the row; it stays out of the list until the removal is over. */
  id: string;
  /** What the toast says happened: "Label “UX” deleted". */
  label: string;
  /** The call itself. */
  run: () => Promise<T>;
  /** Title of the error toast when the call fails. */
  failureTitle?: string;
  /** The answer of the call, once it succeeded and the list is shown again. */
  onDone?: (result: T) => void;
}

export function useRemoval(): { hidden: ReadonlySet<string>; remove: <T>(removal: Removal<T>) => void } {
  const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set());

  const hide = useCallback((id: string) => setHidden((current) => new Set(current).add(id)), []);
  const show = useCallback(
    (id: string) =>
      setHidden((current) => {
        const next = new Set(current);
        next.delete(id);
        return next;
      }),
    [],
  );

  const remove = useCallback(
    <T>({ id, label, run, failureTitle, onDone }: Removal<T>) => {
      // the button that was pressed goes with its row: the focus moves on to the next row instead of falling to the top
      focusNeighbour(document.activeElement?.closest('li'));
      hide(id);
      runWithUndo({
        label,
        failureTitle,
        undo: () => show(id),
        run: async () => {
          let result: T;
          try {
            result = await run();
          } finally {
            // gone from the refreshed list, or still there because it was only archived: either way it is no longer hidden
            show(id);
          }
          onDone?.(result);
        },
      });
    },
    [hide, show],
  );

  return { hidden, remove };
}
