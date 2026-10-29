/*
 * Links into the app that do not go through the router: the href of a plain <a> (cards, rows, notifications), the
 * addresses people copy (item link, invitation) and the base address in the API snippets.
 *
 * The review build (`pnpm build:review`, `VITE_ROUTER=hash` from `.env.review`) runs as one static page and keeps
 * the route in the hash: there `/items/WEB-47` is `#/items/WEB-47`, on whatever page the build was opened.
 */

/** The made-up address of the demo instance, where the page has none of its own to show. */
export const DEMO_ORIGIN = 'https://werkbuch.example.com';

const hashRouting = () => import.meta.env.VITE_ROUTER === 'hash';

/** The href of an app path for a plain <a>: `/items/WEB-47`, or `#/items/WEB-47` in the review build. */
export function hrefOf(path: string): string {
  return hashRouting() ? `#${path}` : path;
}

/**
 * The full address of an app path, to copy or send: `https://host/items/WEB-47`; in the review build the page's own
 * address with the path in the hash, so the link opens the same build.
 */
export function appUrl(path: string): string {
  if (!hashRouting()) return `${window.location.origin}${path}`;
  const { href, hash } = window.location;
  return `${href.slice(0, href.length - hash.length)}#${path}`;
}

/**
 * The address of this instance for the REST and MCP snippets. A sandboxed frame has no origin of its own ("null"),
 * and the review build is not an instance: both show the demo address.
 */
export function instanceOrigin(origin: string = window.location.origin): string {
  return hashRouting() || origin === 'null' ? DEMO_ORIGIN : origin;
}
