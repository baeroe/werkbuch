/*
 * Contract with the router (lazy-loaded): the default export is the screen of /views. The sidebar's "View anlegen" leads
 * to /views?create=1; the screen then opens the dialog "Neue View". The screen is `ViewsScreen`.
 */

export { ViewsScreen as default } from './ViewsScreen';
