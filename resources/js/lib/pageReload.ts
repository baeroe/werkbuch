/*
 * A full reload the app starts itself (the language changed, `app.tsx`): it is no leave, so the leave guards neither
 * hold anything nor let the browser ask "Leave site?" while it runs. Everything else that unloads the page still asks.
 */

let reloading = false;

/** Loads the page anew with `reload` (`window.location.reload` in the app) and tells the leave guards that this is meant. */
export function reloadPage(reload: () => void): void {
  reloading = true;
  // The browser asks "Leave site?" for other reasons (an unsent draft) while this runs. If the person stays, the page
  // lives on and is no reload any more: once the last `beforeunload` listener has run (this one is added last), the
  // flag goes again. A page that does unload takes the flag with it.
  window.addEventListener('beforeunload', () => setTimeout(() => (reloading = false), 0), { once: true });
  try {
    reload();
  } catch (error) {
    reloading = false;
    throw error;
  }
}

/** Whether the app is reloading the page on purpose right now. */
export function isReloading(): boolean {
  return reloading;
}
