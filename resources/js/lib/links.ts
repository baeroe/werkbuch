/*
 * The paths of the app (the routes of the clickdummy's README, without the hash router) and the links that do not go
 * through Inertia: the addresses people copy (item link, invitation) and the base address of the API snippets. Screens
 * link with Inertia's <Link href={paths.inbox()}>, never with a literal path.
 */

import { usePage } from '@inertiajs/react';

type ProjectLayout = 'board' | 'table' | 'timeline';

const segment = encodeURIComponent;
/** `/base` or `/base/<part>`. */
const below = (base: string, part?: string) => (part === undefined ? base : `${base}/${segment(part)}`);

export const paths = {
  home: () => '/',
  myItems: () => '/my-items',
  created: () => '/created',
  subscribed: () => '/subscribed',
  inbox: () => '/inbox',
  views: () => '/views',
  view: (id: string) => `/views/${segment(id)}`,
  projects: () => '/projects',
  project: (identifier: string, layout?: ProjectLayout) => `/projects/${segment(identifier)}${layout ? `?layout=${layout}` : ''}`,
  wiki: (identifier: string, pageId?: string) => below(`/projects/${segment(identifier)}/wiki`, pageId),
  templates: (identifier: string, templateId?: string) => below(`/projects/${segment(identifier)}/templates`, templateId),
  projectSettings: (identifier: string, section?: string) => below(`/projects/${segment(identifier)}/settings`, section),
  item: (key: string) => `/items/${segment(key)}`,
  settings: (section?: string) => below('/settings', section),
  me: (section?: string) => below('/me', section),
  login: () => '/login',
  logout: () => '/logout',
  forgotPassword: () => '/forgot-password',
  resetPassword: (token: string, email: string) => `/reset-password/${segment(token)}?email=${segment(email)}`,
  invitation: (token: string) => `/invitations/${segment(token)}`,
};

/** The full address of an app path, to copy or send: `https://host/items/WEB-47`. */
export function appUrl(path: string): string {
  return `${window.location.origin}${path}`;
}

/** The address of this instance, for the REST and MCP snippets. */
export function instanceOrigin(): string {
  return window.location.origin;
}

/** Whether the current page is `to` (with `end`) or lies below it, or is one of `also`; the query is ignored. */
export function useActivePath(to: string, end = false, also: string[] = []): boolean {
  const { url } = usePage();
  const path = url.split(/[?#]/)[0].replace(/(?<=.)\/$/, '');
  return (end ? path === to : path === to || path.startsWith(`${to}/`)) || also.includes(path);
}
