/*
 * The save state of a wiki page (13c "Zeitangabe ‚gespeichert‘ für Screenreader"): a status region that is always there
 * says only the state, "Speichert …", "Gespeichert" or "Nicht gespeichert", so a screen reader hears it once per
 * change. Beside it, outside the region and not hidden, the time of the last save ("vor 5 Minuten", `<time dateTime>`):
 * it moves on every 15 seconds, and a screen reader reads it when reading the page, never on every tick.
 */

import { useEffect, useReducer } from 'react';
import { cx } from '@/components/ui/cx';
import { savedAgo } from './savedAgo';
import type { SaveState } from './usePageSave';

/** How often the time of the last save moves on. */
const TICK_MS = 15_000;

export function SaveStatus({ state, savedAt, spoken }: { state: SaveState; savedAt: Date | null; spoken: string }) {
  const [, tick] = useReducer((count: number) => count + 1, 0);
  useEffect(() => {
    if (!savedAt) return;
    const timer = setInterval(tick, TICK_MS);
    return () => clearInterval(timer);
  }, [savedAt]);

  return (
    <div data-save-status="" className="flex min-w-0 items-baseline gap-1 text-sm text-muted">
      <span role="status" className={cx('shrink-0', state === 'failed' && 'font-medium text-danger')}>
        {spoken}
      </span>
      {state === 'saved' && savedAt && (
        <time dateTime={savedAt.toISOString()} className="truncate">
          {savedAgo(savedAt, new Date())}
        </time>
      )}
    </div>
  );
}
