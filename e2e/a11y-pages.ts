/*
 * The pages axe checks (e2e/tests/a11y.spec.ts, A441, K15): every page of the app (every file under resources/js/pages,
 * `page`) at least once in its start view, in all four projects (contrast light and dark, layout 1440 and 390), then the
 * states of the screens (`state`: a dialog, a menu, a layout) and every section of the settings, those only in
 * desktop-light, desktop-dark and phone-light (`STATE_PROJECTS`: the dark theme and the phone layout are covered by the
 * pages already). The data are those of the E2eSeeder (the demo of Feldwerk, organization language English); `path`
 * gets the ids that only the API knows (`A11yIds`, resolved once per project by the spec). Guest pages run without a
 * session. A state that creates data names them `E2E …` and takes them away again in `cleanup`.
 *
 * scripts/a11y-pages.test.mjs reads this file as text: write the values of `page` and `name` as string literals.
 */

import { expect, type Locator, type Page } from '@playwright/test';
import { api, login, PEOPLE, pressMod, removeE2eWebhook, runId, tr, variant } from './helpers';

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
  /** What the state created, taken away after axe looked (also when it failed). */
  cleanup?: (page: Page) => Promise<void>;
  /** Before the visit, in the context of the page: half a sign-in for the second factor. */
  before?: (page: Page) => Promise<void>;
  /** Without a session. */
  guest?: boolean;
  /** The status the page answers with when it is no 200 (the browser reports it as a console error). */
  status?: 403 | 404;
  /** Only in these Playwright projects; all four without. */
  projects?: readonly string[];
  /** Signed in as this person of the demo instead of Erik Ende (`signedInContext`). */
  person?: 'mara';
};

/** Where the states run (A441): the dark theme and the phone layout are covered by the pages in all four projects. */
export const STATE_PROJECTS = ['desktop-light', 'desktop-dark', 'phone-light'] as const;

const en = (key: string, params?: Record<string, string | number>) => tr('en', key, params);

/** The name of what a state creates: `E2E <variant> <run> a11y`, removed by the E2eSeeder before the next run too. */
const e2eName = () => `E2E ${variant()} ${runId()} a11y`;

/** A state of a screen: runs in `STATE_PROJECTS`. */
const state = (entry: Omit<A11yEntry, 'projects'>): A11yEntry => ({ ...entry, projects: STATE_PROJECTS });

/** A section of a settings screen as an entry (in `STATE_PROJECTS`); `name` without a third argument: `<kind> settings: <slug>`. */
function settings(kind: 'organization' | 'personal' | 'project', slug: string, name = `${kind} settings: ${slug}`): A11yEntry {
  const page = { organization: 'Settings/Organization', personal: 'Settings/Personal', project: 'Projects/Settings' }[kind];
  const path = { organization: `/settings/${slug}`, personal: `/me/${slug}`, project: `/projects/WEB/settings/${slug}` }[kind];
  return { name, page, path: () => path, projects: STATE_PROJECTS };
}

/** Presses Enter on `target` (the files beside the specs stay without the mouse, scripts/keyboard-flows.test.mjs). */
async function press(page: Page, target: Locator, key = 'Enter'): Promise<void> {
  await target.focus();
  await page.keyboard.press(key);
}

/** Presses `key` on a list once its first row is there (the keys of the list need a row for the cursor). */
async function onList(page: Page, ...keys: string[]): Promise<void> {
  await expect(page.locator('[data-nav-target]').first()).toBeVisible();
  for (const key of keys) await page.keyboard.press(key);
}

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

  // the states of the screens
  state({
    name: 'palette',
    page: 'Items/MyItems',
    path: () => '/my-items',
    state: async (page) => {
      await pressMod(page, 'k');
      await expect(page.getByRole('dialog', { name: en('palette.title') }).getByRole('option').first()).toBeVisible();
    },
  }),
  state({
    name: 'shortcut help',
    page: 'Items/MyItems',
    path: () => '/my-items',
    state: async (page) => {
      await page.keyboard.press('?');
      await expect(page.getByRole('dialog', { name: en('shortcuts.help.title') })).toBeVisible();
    },
  }),
  state({
    name: 'item preview',
    page: 'Projects/Show',
    path: () => '/projects/WEB',
    state: async (page) => {
      await onList(page, 'j', ' ');
      await expect(page.getByRole('complementary', { name: en('items.peek.label') }).locator('[data-item-title]')).toBeVisible();
    },
  }),
  state({
    name: 'create dialog',
    page: 'Projects/Show',
    path: () => '/projects/WEB',
    state: async (page) => {
      await onList(page, 'c');
      const dialog = page.getByRole('dialog', { name: en('items.create.title') });
      await expect(dialog.getByRole('textbox', { name: new RegExp(`^${en('items.create.title_label')}`) })).toBeFocused();
    },
  }),
  state({
    name: 'item menu',
    page: 'Items/Show',
    path: () => '/items/WEB-47',
    state: async (page) => {
      await press(page, page.getByRole('button', { name: en('items.detail.more') }));
      await expect(page.getByRole('menu')).toBeVisible();
    },
  }),
  state({
    name: 'display menu',
    page: 'Projects/Show',
    path: () => '/projects/WEB',
    state: async (page) => {
      await press(page, page.getByRole('button', { name: en('items.display.label') }));
      await expect(page.getByRole('dialog')).toBeVisible();
    },
  }),
  state({
    name: 'board',
    page: 'Projects/Show',
    path: () => '/projects/WEB',
    state: async (page) => {
      await onList(page, '2');
      await expect(page.locator('[data-board-list]').first()).toBeVisible();
    },
  }),
  state({
    name: 'table',
    page: 'Projects/Show',
    path: () => '/projects/WEB',
    state: async (page) => {
      await onList(page, '3');
      await expect(page.getByRole('grid')).toBeVisible();
    },
  }),
  state({
    name: 'timeline',
    page: 'Projects/Show',
    path: () => '/projects/WEB',
    state: async (page) => {
      await onList(page, '4');
      await expect(page.locator('[data-timeline-scroller]')).toBeVisible();
    },
  }),
  state({
    name: 'filter menu',
    page: 'Projects/Show',
    path: () => '/projects/WEB',
    state: async (page) => {
      await onList(page, 'f');
      await expect(page.getByRole('combobox', { name: en('items.filter.add.search') })).toBeFocused();
    },
  }),
  state({
    name: 'bulk bar',
    page: 'Projects/Show',
    path: () => '/projects/WEB',
    // only a selection: nothing changes
    state: async (page) => {
      await onList(page, 'j', 'x');
      await expect(page.getByRole('group', { name: en('items.bulk.label') })).toBeVisible();
    },
  }),
  state({
    name: 'wiki page in the editor',
    page: 'Wiki/Show',
    path: (ids) => `/projects/WEB/wiki/${ids.wikiPage}`,
    // the cursor in the text; nothing is typed, so nothing is saved
    state: async (page) => {
      const editor = page.getByRole('textbox', { name: en('editor.label.page') });
      await editor.focus();
      await expect(editor).toBeFocused();
    },
  }),
  state({
    name: 'versions dialog',
    page: 'Wiki/Show',
    path: (ids) => `/projects/WEB/wiki/${ids.wikiPage}`,
    state: async (page) => {
      await press(page, page.getByRole('button', { name: en('wiki.versions.open') }));
      await expect(page.getByRole('dialog').getByRole('radio').first()).toBeVisible();
    },
  }),
  state({
    name: 'template editor with a schedule',
    page: 'Templates/Index',
    path: (ids) => `/projects/WEB/templates/${ids.template}`,
    state: async (page) => {
      await expect(page.getByRole('heading', { name: en('templates.editor.schedule') })).toBeVisible();
    },
  }),
  state({
    name: 'token dialog with the plain text',
    page: 'Settings/Personal',
    path: () => '/me/api',
    state: async (page) => {
      await press(page, page.getByRole('button', { name: en('settings.api.new_token') }));
      const dialog = page.getByRole('dialog', { name: en('settings.tokens.dialog.new_title') });
      await dialog.getByRole('textbox', { name: en('settings.tokens.dialog.name') }).fill(e2eName());
      await pressMod(page, 'Enter');
      await expect(page.getByRole('dialog', { name: en('settings.tokens.dialog.created_title') }).getByRole('textbox', { name: en('settings.tokens.dialog.token') })).toBeFocused();
    },
    cleanup: async (page) => {
      const response = await api(page, 'GET', '/api/v1/tokens?per_page=100');
      const { data } = (await response.json()) as { data: { id: string; name: string }[] };
      for (const token of data.filter((entry) => entry.name === e2eName())) {
        expect((await api(page, 'DELETE', `/api/v1/tokens/${token.id}`)).status()).toBe(204);
      }
    },
  }),
  state({
    name: 'webhook dialog',
    page: 'Settings/Organization',
    path: () => '/settings/webhooks',
    state: async (page) => {
      await press(page, page.getByRole('button', { name: en('settings.webhooks.create') }).first());
      await expect(page.getByRole('dialog', { name: en('settings.webhooks.dialog.new_title') }).getByRole('textbox', { name: en('settings.webhooks.dialog.name') })).toBeVisible();
    },
  }),
  state({
    name: 'webhook secret',
    page: 'Settings/Organization',
    path: () => '/settings/webhooks',
    state: async (page) => {
      await press(page, page.getByRole('button', { name: en('settings.webhooks.create') }).first());
      const dialog = page.getByRole('dialog', { name: en('settings.webhooks.dialog.new_title') });
      await dialog.getByRole('textbox', { name: en('settings.webhooks.dialog.name') }).fill(e2eName());
      await dialog.getByRole('textbox', { name: en('settings.webhooks.dialog.url') }).fill('https://receiver.example.com/hook');
      const group = dialog.getByRole('checkbox', { name: new RegExp(en('settings.webhooks.group.work_item')) }).first();
      await press(page, group, 'Space');
      await expect(group).toBeChecked();
      await pressMod(page, 'Enter');
      await expect(page.getByRole('dialog', { name: en('settings.webhooks.secret.created_title') }).getByRole('textbox', { name: en('settings.webhooks.secret.label') })).toHaveValue(/^whsec_/);
    },
    cleanup: async (page) => {
      const response = await api(page, 'GET', '/api/v1/webhooks?per_page=100');
      const { data } = (await response.json()) as { data: { id: string; name: string }[] };
      for (const webhook of data.filter((entry) => entry.name === e2eName())) await removeE2eWebhook(page, webhook.id);
    },
  }),
  state({
    name: 'inbox with cards',
    page: 'Inbox/Index',
    person: 'mara',
    path: () => '/inbox',
    state: async (page) => {
      await expect(page.getByRole('article').first()).toBeVisible();
    },
  }),

  // every section of the settings (the start views are above)
  settings('organization', 'people'),
  settings('organization', 'bots'),
  settings('organization', 'workflows'),
  settings('organization', 'types'),
  settings('organization', 'properties'),
  settings('organization', 'labels'),
  settings('organization', 'relation-types'),
  settings('organization', 'resolutions'),
  settings('organization', 'webhooks'),
  settings('organization', 'system', 'system page'),
  settings('personal', 'security'),
  settings('personal', 'notifications'),
  settings('personal', 'api'),
  settings('project', 'members'),
  settings('project', 'workflow'),
  settings('project', 'types'),
  settings('project', 'automations'),
];
