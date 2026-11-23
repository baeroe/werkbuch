/*
 * Where the focus goes around the runs of an agent (WEBU-18): to a run line the page asks for (the chip „Kira
 * arbeitet“, „Ergebnis eines Auftrags“), and to the line a call added (Erneut starten, Wieder Kira zuweisen) when the
 * control that had the focus went away with the change.
 */

/** Asks the activity to show runs: a filter without them (Kommentare, Änderungen) goes back to „Alles“. */
export const SHOW_RUNS_EVENT = 'werkbuch:show-runs';

/** Shows a run in the activity: the filter lets runs through, then the run scrolls into view and takes the focus. */
export function showRun(id: string): void {
  window.dispatchEvent(new Event(SHOW_RUNS_EVENT));
  let frames = 0;
  const look = () => {
    const target = document.getElementById(`run-${id}`);
    if (target) {
      target.scrollIntoView({ block: 'center' });
      target.focus();
    } else if ((frames += 1) < 30) requestAnimationFrame(look);
  };
  requestAnimationFrame(look);
}

/** The run lines in the activity now, to find the one a call adds. */
export const runIds = () => new Set([...document.querySelectorAll('article[id^="run-"]')].map((element) => element.id));

/**
 * Puts a lost focus on the run line a call added, once the reloaded runs are drawn. Without one by the end (the run
 * is not in the filter, or none came), on the item's title. A click in the meantime ends the watch.
 */
export function focusNewRun(before: Set<string>, watchMs = 4000): void {
  const until = performance.now() + watchMs;
  let clicked = false;
  const onPointer = () => (clicked = true);
  document.addEventListener('pointerdown', onPointer, { capture: true, once: true });
  const stop = () => document.removeEventListener('pointerdown', onPointer, { capture: true });
  const lost = () => {
    const active = document.activeElement;
    return !active || active === document.body || !active.isConnected;
  };
  const look = () => {
    if (clicked) return stop();
    const added = [...document.querySelectorAll<HTMLElement>('article[id^="run-"]')].find((element) => !before.has(element.id));
    if (added && lost()) {
      stop();
      return added.focus();
    }
    if (performance.now() < until) return void requestAnimationFrame(look);
    stop();
    if (lost()) document.querySelector<HTMLElement>('[data-item-title]')?.focus();
  };
  requestAnimationFrame(look);
}
