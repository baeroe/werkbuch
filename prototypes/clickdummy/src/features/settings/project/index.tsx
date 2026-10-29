/*
 * Contract with the router (lazy-loaded): the default export is the screen of /projects/:identifier/settings/:section?
 * and reads both params itself. The shell links to the screen without a section; the sections are general, members,
 * workflow, types and automations.
 */

export { default } from './ProjectSettings';
