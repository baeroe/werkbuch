/*
 * The pages axe checks (e2e/tests/a11y.spec.ts, A441, K15): every page of the app (every file under resources/js/pages,
 * `page`) at least once in its start view, in all four projects (contrast light and dark, layout 1440 and 390). The
 * data are those of the E2eSeeder (the demo of Feldwerk, organization language English); `path` gets the ids that
 * only the API knows (`A11yIds`, resolved once per project by the spec). Guest pages run without a session.
 *
 * scripts/a11y-pages.test.mjs reads this file as text: write the values of `page` and `name` as string literals.
 */

import type { Page } from '@playwright/test';
import { login, PEOPLE, variant } from './helpers';

/** What a path needs from the data of the run (A11Y ids, resolved over the API by the spec). */
export type A11yIds = {
  /** A team view of the demo. */
  view: string;
  /** A wiki page of WEB that has versions (“Seitenstruktur”). */
  wikiPage: string;
  /** A template of WEB with a schedule. */
  template: string;
  /** A fresh invitation link of this project and run (the E2eSeeder removes open invitations to …@example.com). */
  invitation: string;
};

export type A11yEntry = {
  /** The title of the test; unique. */
  name: string;
  /** The page file under resources/js/pages that renders, without `.tsx`. */
  page: string;
  path: (ids: A11yIds) => string;
  /** What to do on the page before axe looks: open a dialog, a menu, a layout. */
  state?: (page: Page) => Promise<void>;
  /** Before the visit, in the context of the page: half a sign-in for the second factor. */
  before?: (page: Page) => Promise<void>;
  /** Without a session. */
  guest?: boolean;
  /** The status the page answers with when it is no 200 (the browser reports it as a console error). */
  status?: 403 | 404;
  /** Only in these Playwright projects; all four without. */
  projects?: readonly string[];
};

export const A11Y_PAGES: readonly A11yEntry[] = [
  // without a session
  { name: 'sign-in', page: 'Auth/Login', guest: true, path: () => '/login' },
  { name: 'forgot password', page: 'Auth/ForgotPassword', guest: true, path: () => '/forgot-password' },
  {
    name: 'reset password',
    page: 'Auth/ResetPassword',
    guest: true,
    // the page shows the form for any token; only sending it checks the token
    path: () => `/reset-password/a11y-token?email=${encodeURIComponent(PEOPLE.reset[variant()].email)}`,
  },
  {
    name: 'second factor',
    page: 'Auth/TwoFactorChallenge',
    guest: true,
    path: () => '/two-factor-challenge',
    // the password of an account with a second factor: the sign-in waits for the code
    before: async (page) => {
      const account = PEOPLE.twoFactor[variant()];
      await page.goto('/login');
      await login(page, account.email, account.password);
      await page.waitForURL(/\/two-factor-challenge$/);
    },
  },
  { name: 'invitation', page: 'Auth/Invitation', guest: true, path: (ids) => ids.invitation },
  // a link of an invitation without its signature: 403
  { name: 'error page', page: 'Errors/Error', guest: true, status: 403, path: () => '/invitations/a11y' },

  // signed in as Erik Ende (org admin)
  { name: 'not found', page: 'Errors/NotFound', status: 404, path: () => '/a11y-nowhere' },
  { name: 'my items', page: 'Items/MyItems', path: () => '/my-items' },
  { name: 'created items', page: 'Items/Created', path: () => '/created' },
  { name: 'watched items', page: 'Items/Subscribed', path: () => '/subscribed' },
  { name: 'item page', page: 'Items/Show', path: () => '/items/WEB-47' },
  { name: 'inbox', page: 'Inbox/Index', path: () => '/inbox' },
  { name: 'projects', page: 'Projects/Index', path: () => '/projects' },
  { name: 'project items', page: 'Projects/Show', path: () => '/projects/WEB' },
  { name: 'project settings', page: 'Projects/Settings', path: () => '/projects/WEB/settings/general' },
  { name: 'organization settings', page: 'Settings/Organization', path: () => '/settings/general' },
  { name: 'personal settings', page: 'Settings/Personal', path: () => '/me/profile' },
  { name: 'templates', page: 'Templates/Index', path: () => '/projects/WEB/templates' },
  { name: 'views', page: 'Views/Index', path: () => '/views' },
  { name: 'view', page: 'Views/Show', path: (ids) => `/views/${ids.view}` },
  { name: 'wiki', page: 'Wiki/Show', path: () => '/projects/WEB/wiki' },
];
