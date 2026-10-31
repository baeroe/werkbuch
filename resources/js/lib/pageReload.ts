/*
 * A full reload the app starts itself (the language changed, `app.tsx`): it is no leave, so the leave guards neither
 * hold anything nor let the browser ask "Leave site?" while it runs. Everything else that unloads the page still asks.
 */

let reloading = false;

/** Loads the page anew with `reload` (`window.location.reload` in the app) and tells the leave guards that this is meant. */
export function reloadPage(reload: () => void): void {
  reloading = true;
  reload();
}

/** Whether the app is reloading the page on purpose right now. */
export function isReloading(): boolean {
  return reloading;
}
