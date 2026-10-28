/*
 * Where the focus goes when the thing it is on disappears (APG: manage focus). A row that is removed takes the trash
 * button with it, and a focus that falls to the page start would send a keyboard user back to the top of the settings.
 * It goes to the next row, or to the one before when this was the last, and to the page itself when the list is empty.
 */

const FOCUSABLE = 'button:not([disabled]):not([aria-disabled="true"]), a[href], input:not([disabled]):not([type="hidden"]), [tabindex="0"]';

/** The element that should take the focus once the row around `from` is gone; null when nothing needs to move. */
export function neighbourOf(from: Element | null): HTMLElement | null {
  const row = from?.closest('li');
  // without a row around the focus there is nothing it could lose
  if (!row || !(from instanceof HTMLElement) || from === document.body) return null;
  const sibling = row.nextElementSibling ?? row.previousElementSibling;
  return sibling?.querySelector<HTMLElement>(FOCUSABLE) ?? document.getElementById('main');
}

/** Moves the focus after the next paint, when the row is out of the DOM and the new target is where it will stay. */
export function focusSoon(target: HTMLElement | null): void {
  if (!target) return;
  requestAnimationFrame(() => {
    if (target.isConnected) target.focus();
  });
}
