/*
 * Contract with the router (lazy-loaded): the default export is the screen of /projects. The sidebar's "Projekt anlegen"
 * leads to /projects?create=1; the screen then opens the dialog "Neues Projekt". The screen is `ProjectsScreen`.
 */

export { ProjectsScreen as default } from './ProjectsScreen';
