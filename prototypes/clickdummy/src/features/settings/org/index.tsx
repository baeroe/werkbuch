/*
 * The settings of the organisation. Contract with the router (lazy-loaded): the default export is the screen of
 * /settings/:section? and reads the param itself. The sections are general, people, bots, workflows, types,
 * properties, labels, relation-types, resolutions, webhooks and system (`sections.ts`); the command palette opens a
 * person found by the search under /settings/people and a bot under /settings/bots. `/settings` leads to general.
 */

export { default } from './OrgSettings';
