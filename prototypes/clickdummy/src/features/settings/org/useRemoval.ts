/*
 * Removing instead of asking (spec 5.1): the row disappears at once, a toast offers "Rückgängig" for five seconds, and
 * only when the toast runs out does the call go out (`runWithUndo`). Whoever takes it back finds the row where it was.
 * A call that fails brings the row back, and the error toast says why. So does one that only archives (a type with
 * items, a resolution that items carry): the call has refreshed the list by the time it is over, and what is left in it
 * shows again.
 */

import { useCallback, useState } from 'react';
import { runWithUndo } from '@/lib/undo';
import { focusSoon, neighbourOf } from './focus';

interface Removal {
  /** The id of the row; it stays out of the list until the removal is over. */
  id: string;
  /** What the toast says happened: "Label „UX“ gelöscht". */
  label: string;
  /** The call itself. */
  run: () => Promise<unknown>;
  /** Title of the error toast when the call fails. */
  failureTitle?: string;
}

export function useRemoval(): { hidden: ReadonlySet<string>; remove: (removal: Removal) => void } {
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
    ({ id, label, run, failureTitle }: Removal) => {
      // the button that was pressed goes with its row: the focus moves on to the next row instead of falling to the top
      const next = neighbourOf(document.activeElement);
      hide(id);
      focusSoon(next);
      runWithUndo({
        label,
        failureTitle,
        undo: () => show(id),
        run: async () => {
          try {
            await run();
          } finally {
            // gone from the refreshed list, or still there because it was only archived: either way it is no longer hidden
            show(id);
          }
        },
      });
    },
    [hide, show],
  );

  return { hidden, remove };
}
