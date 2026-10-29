/*
 * Contract with the router (lazy-loaded, from Task 4): the default export is the screen of
 * /projects/:identifier/templates/:templateId? and reads both params itself. Without an id it lists the templates of
 * the project; the id `new` opens the editor for a new template.
 */

export { default } from './TemplatesScreen';
