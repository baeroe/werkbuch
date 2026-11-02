/*
 * Where the focus goes back to when a dialog that a command or a button opened closes: the element that had the focus
 * when it was asked for, or, when the command ran from the palette, the element that had it before the palette opened
 * (the palette is gone by then). Without such an element (the focus was on the page itself, or the element went away:
 * a menu entry, the palette's field) it goes to the screen's focus origin (`[data-focus-origin]`, the heading of the
 * item page), else to its main area (`#main`), never to the body.
 *
 * The store is watched from the moment this module loads (the shell imports it): the create dialog loads with its first
 * open, after the palette that asked for it closed.
 */

import type { RefObject } from 'react';
import { useUiStore } from '@/store/ui';

/** What had the focus when the palette opened; a command chosen there runs while the palette has the focus. */
let beforePalette: Element | null = null;
/** What had the focus when the create dialog was asked for. */
let beforeCreate: Element | null = null;

useUiStore.subscribe((ui, previous) => {
  if (ui.paletteOpen && !previous.paletteOpen) beforePalette = document.activeElement;
  if (ui.createOpen && !previous.createOpen) beforeCreate = ui.paletteOpen ? beforePalette : document.activeElement;
});

/** The element a dialog asked for now gives the focus back to: the focused one, or the one before the palette. */
export function focusOriginNow(): Element | null {
  return useUiStore.getState().paletteOpen ? beforePalette : document.activeElement;
}

/** Where the focus goes back to: `origin` while it is on the page and not the page itself, else the fallbacks above. */
export function focusBackTo(origin: Element | null): HTMLElement | null {
  const back = origin instanceof HTMLElement && origin.isConnected && origin !== document.body ? origin : null;
  return back ?? document.querySelector<HTMLElement>('[data-focus-origin]') ?? document.getElementById('main');
}

/** The `finalFocus` of the create dialog, read when it closes. */
export const createReturnFocus: RefObject<HTMLElement | null> = {
  get current() {
    return focusBackTo(beforeCreate);
  },
};
