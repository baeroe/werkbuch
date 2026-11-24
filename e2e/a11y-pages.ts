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
import { api, artisanEval, createE2eProject, createE2eRunnerRow, createItem, login, PEOPLE, pngBytes, pressMod, redeemRunnerCode, removeE2eProject, removeE2eRunner, removeE2eWebhook, runId, tr, uploadViaApi, variant } from './helpers';

/** What a path needs from the data of the run (A11Y ids, resolved over the API by the spec). */
export type A11yIds = {
  /** A team view of the demo. */
  view: string;
  /** A wiki page of WEB that has versions (“Seitenstruktur”). */
  wikiPage: string;
  /** A template of WEB with a schedule. */
  template: string;
  /** A fresh invitation link, only for an entry with `invites` (empty for the others). */
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
  /** The path of a section of a settings screen: the spec checks that its link in the list of sections is current. */
  section?: string;
  /** Visits a fresh invitation link (`ids.invitation`), which the spec makes before and takes away after the test. */
  invites?: true;
};

/** Where the states run (A441): the dark theme and the phone layout are covered by the pages in all four projects. */
export const STATE_PROJECTS = ['desktop-light', 'desktop-dark', 'phone-light'] as const;

const en = (key: string, params?: Record<string, string | number>) => tr('en', key, params);

/**
 * The name of what a state creates: `E2E <variant> <run> a11y`. Its `cleanup` takes it away; should that fail, the
 * E2eSeeder removes a webhook of that name before the next run, a token stays with Erik (the seeder keeps tokens).
 */
const e2eName = () => `E2E ${variant()} ${runId()} a11y`;

/** A state of a screen: runs in `STATE_PROJECTS`. */
const state = (entry: Omit<A11yEntry, 'projects'>): A11yEntry => ({ ...entry, projects: STATE_PROJECTS });

/** A section of a settings screen as an entry (in `STATE_PROJECTS`); `name` without a third argument: `<kind> settings: <slug>`. */
function settings(kind: 'organization' | 'personal' | 'project', slug: string, name = `${kind} settings: ${slug}`): A11yEntry {
  const page = { organization: 'Settings/Organization', personal: 'Settings/Personal', project: 'Projects/Settings' }[kind];
  const path = { organization: `/settings/${slug}`, personal: `/me/${slug}`, project: `/projects/WEB/settings/${slug}` }[kind];
  return { name, page, path: () => path, projects: STATE_PROJECTS, section: path };
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

/** A runner of a state (`E2E <variant> <run> a11y <what>`), written into the database; the list is read anew. */
async function a11yRunner(page: Page, what: string): Promise<{ id: string; name: string }> {
  const runner = createE2eRunnerRow(`a11y ${what}`);
  await page.reload();
  return runner;
}

/** Two runners with runs on items of a project of the state: one online that runs one, one offline that one waits for. */
async function a11yRunners(page: Page) {
  const project = await createE2eProject(page, e2eName());
  const item = await createItem(page, { project_id: project.id, title: 'E2E a11y run' });
  const waiting = await createItem(page, { project_id: project.id, title: 'E2E a11y waiting run' });
  const online = createE2eRunnerRow('a11y online', { runs: [{ itemId: item.id, status: 'running' }] });
  const offline = createE2eRunnerRow('a11y offline', { online: false, runs: [{ itemId: waiting.id, status: 'waiting' }] });
  await page.reload();
  return { online, offline, item };
}

/** Revokes the runners of the states and takes their project away (its runs go with it). */
async function removeA11yRunners(page: Page): Promise<void> {
  const runners = (await (await api(page, 'GET', '/api/v1/runners?per_page=100')).json()) as { data: { id: string; name: string }[] };
  for (const runner of runners.data.filter((entry) => entry.name.startsWith(e2eName()))) await removeE2eRunner(page, runner.id);
  const projects = (await (await api(page, 'GET', '/api/v1/projects?per_page=100&include_archived=1')).json()) as { data: { identifier: string; name: string }[] };
  for (const project of projects.data.filter((entry) => entry.name === e2eName())) await removeE2eProject(page, project.identifier);
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
  { name: 'invitation', page: 'Auth/Invitation', guest: true, invites: true, path: (ids) => ids.invitation },
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
    name: 'image viewer',
    page: 'Items/Show',
    path: () => '/items/WEB-47',
    // a comment with a picture of its own (WEBU-7), on an item of a project of its own: the demo texts hold none, and
    // a comment on a demo item would notify its watchers
    state: async (page) => {
      const project = await createE2eProject(page, e2eName(), { types: ['Task'] });
      const item = await createItem(page, { project_id: project.id, title: e2eName() });
      const picture = await uploadViaApi(page, project.id, { name: 'a11y.png', type: 'image/png', bytes: pngBytes(40, 30) });
      const comment = await api(page, 'POST', `/api/v1/work-items/${item.id}/comments`, {
        body_json: { type: 'doc', content: [{ type: 'image', attrs: { attachmentId: picture.id, alt: e2eName() } }] },
      });
      expect(comment.status()).toBe(201);
      await page.goto(`/items/${item.key}`);
      await press(page, page.getByRole('link', { name: tr('en', 'editor.image.view', { name: e2eName() }) }));
      await expect(page.getByRole('dialog', { name: e2eName() }).getByRole('img', { name: e2eName() })).toBeVisible();
    },
    cleanup: async (page) => {
      const response = await api(page, 'GET', '/api/v1/projects?per_page=100&include_archived=1');
      const { data } = (await response.json()) as { data: { identifier: string; name: string }[] };
      await page.goto('/my-items');
      for (const project of data.filter((entry) => entry.name === e2eName())) await removeE2eProject(page, project.identifier);
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
    name: 'runners with a runner',
    page: 'Settings/Organization',
    path: () => '/settings/runners',
    // the screen itself, no dialog: a runner with a report (pots, meters, CLIs, equipment with its warning) and a run,
    // one offline with a waiting run (its banner)
    state: async (page) => {
      const { online, offline, item } = await a11yRunners(page);
      await expect(page.getByRole('article', { name: online.name, exact: true }).getByRole('link', { name: new RegExp(`^${item.key} `) })).toBeVisible();
      await expect(page.getByText(en('settings.runners.waiting.one', { count: 1, name: offline.name }))).toBeVisible();
    },
    cleanup: (page) => removeA11yRunners(page),
  }),
  state({
    name: 'pairing dialog',
    page: 'Settings/Organization',
    path: () => '/settings/runners',
    state: async (page) => {
      await press(page, page.getByRole('button', { name: en('settings.runners.connect') }).first());
      // a fresh code with its command (making it ends no runner; the code just runs out)
      await expect(page.getByRole('dialog', { name: en('settings.runners.connect') }).getByText(en('settings.runners.pairing.waiting'))).toBeVisible();
    },
  }),
  state({
    name: 'pairing dialog connected',
    page: 'Settings/Organization',
    path: () => '/settings/runners',
    // the machine redeems the code the dialog shows, as `werkbuch-runner login` does
    state: async (page) => {
      await press(page, page.getByRole('button', { name: en('settings.runners.connect') }).first());
      const command = page.getByRole('dialog', { name: en('settings.runners.connect') }).getByRole('group', { name: en('settings.runners.pairing.command') }).locator('code');
      await expect(command).toHaveText(/--code \S+$/);
      const runner = await redeemRunnerCode(page, (await command.textContent())!.split('--code ')[1]!.trim(), 'a11y paired');
      await expect(page.getByRole('dialog', { name: en('settings.runners.pairing.connected_title', { name: runner.name }) })).toBeVisible({ timeout: 15_000 });
    },
    cleanup: (page) => removeA11yRunners(page),
  }),
  state({
    name: 'runner places dialog',
    page: 'Settings/Organization',
    path: () => '/settings/runners',
    state: async (page) => {
      const runner = await a11yRunner(page, 'places');
      await press(page, page.getByRole('button', { name: en('settings.runners.action.places_named', { name: runner.name }) }));
      await expect(page.getByRole('dialog', { name: en('settings.runners.slots.title', { name: runner.name }) }).getByRole('textbox', { name: en('settings.runners.pot.total') })).toBeVisible();
    },
    cleanup: (page) => removeA11yRunners(page),
  }),
  state({
    name: 'runner rename dialog',
    page: 'Settings/Organization',
    path: () => '/settings/runners',
    state: async (page) => {
      const runner = await a11yRunner(page, 'rename');
      await press(page, page.getByRole('button', { name: en('settings.runners.action.rename_named', { name: runner.name }) }));
      await expect(page.getByRole('dialog', { name: en('settings.runners.rename.title', { name: runner.name }) }).getByRole('textbox', { name: en('settings.runners.rename.name') })).toBeVisible();
    },
    cleanup: (page) => removeA11yRunners(page),
  }),
  state({
    name: 'runner revoke dialog',
    page: 'Settings/Organization',
    path: () => '/settings/runners',
    state: async (page) => {
      const runner = await a11yRunner(page, 'revoke');
      await press(page, page.getByRole('button', { name: en('settings.runners.action.revoke_named', { name: runner.name }) }));
      await expect(page.getByRole('alertdialog', { name: en('settings.runners.revoke.title', { name: runner.name }) })).toBeVisible();
    },
    cleanup: (page) => removeA11yRunners(page),
  }),
  state({
    name: 'run cancel dialog',
    page: 'Settings/Organization',
    path: () => '/settings/runners',
    state: async (page) => {
      const { online, item } = await a11yRunners(page);
      const task = en('settings.runners.run.type.task');
      await press(page, page.getByRole('article', { name: online.name, exact: true }).getByRole('button', { name: en('settings.runners.runs.cancel_named', { run: task, subject: item.key }) }));
      await expect(page.getByRole('alertdialog', { name: en('settings.runners.cancel.title', { run: task, key: item.key }) })).toBeVisible();
    },
    cleanup: (page) => removeA11yRunners(page),
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
  settings('organization', 'runners'),
  settings('organization', 'github'),
  settings('organization', 'system', 'system page'),
  settings('personal', 'security'),
  settings('personal', 'notifications'),
  settings('personal', 'api'),
  settings('project', 'members'),
  settings('project', 'workflow'),
  settings('project', 'types'),
  settings('project', 'automations'),
  settings('project', 'agents'),
  state({
    name: 'github connected',
    page: 'Settings/Organization',
    path: () => '/settings/github',
    // the connected view: the app, an installation, a repo of a project with a guard and without a ruleset, a free repo
    state: async (page) => {
      await connectGitHub(page);
      await page.reload();
      await expect(page.getByRole('list', { name: en('settings.github.repos.label') }).getByText(en('settings.github.repo.guarded'))).toBeVisible();
    },
    cleanup: disconnectGitHub,
  }),
  state({
    name: 'disconnect GitHub dialog',
    page: 'Settings/Organization',
    path: () => '/settings/github',
    state: async (page) => {
      await connectGitHub(page);
      await page.reload();
      await press(page, page.getByRole('button', { name: en('settings.github.disconnect.button') }));
      await expect(page.getByRole('alertdialog', { name: en('settings.github.disconnect.question') })).toBeVisible();
    },
    cleanup: disconnectGitHub,
  }),
  state({
    name: 'project agents with guard',
    page: 'Projects/Settings',
    path: () => '/projects/WEB/settings/agents',
    // the agents of the E2E project whose repo the guard holds: the banner "Unauthorized merge detected"
    state: async (page) => {
      const identifier = await connectGitHub(page);
      await page.goto(`/projects/${identifier}/settings/agents`);
      await expect(page.getByRole('alert', { name: en('settings.project.agents.guard.title', { identifier }) })).toBeVisible();
    },
    cleanup: disconnectGitHub,
  }),
  state({
    name: 'workflow editor with agent steps',
    page: 'Settings/Organization',
    path: () => '/settings/workflows',
    // the editor of a demo workflow, its section "Agents" with the steps included (WEBU-27)
    state: async (page) => {
      await press(page, page.getByRole('link', { name: new RegExp(`^${en('settings.workflows.edit')} `) }).first());
      await expect(page.getByRole('region', { name: en('settings.workflows.agents.title') })).toBeVisible();
    },
  }),
  state({
    name: 'bot agent',
    page: 'Settings/Organization',
    path: () => '/settings/bots',
    // Kira of the demo as an agent: Mara is responsible for it, so the form shows (WEBU-27)
    state: async (page) => {
      await press(page, page.getByRole('link', { name: new RegExp(`${en('settings.bots.agent.for', { name: 'Kira' })}$`) }));
      await expect(page.getByRole('switch', { name: en('settings.bot_agent.enabled') })).toBeVisible();
    },
  }),
  state({
    name: 'bot agent of a bot that cannot be an agent',
    page: 'Settings/Organization',
    path: () => '/settings/bots',
    // the default bot ("Automation") cannot be an agent: the view says why instead of the form (WEBU-27)
    state: async (page) => {
      await press(page, page.getByRole('link', { name: new RegExp(`${en('settings.bots.agent.for', { name: DEFAULT_BOT })}$`) }));
      await expect(page.getByText(en('settings.bot_agent.cannot.title', { name: DEFAULT_BOT }))).toBeVisible();
    },
  }),
];

/** The name of the default bot of the demo (the state "bot agent of a bot that cannot be an agent"). */
const DEFAULT_BOT = 'Automation';

/** What `connectGitHub` made, for `disconnectGitHub`. */
let a11yGitHub: { created: boolean; installation: string; identifier: string } | null = null;

/**
 * GitHub for the states of Settings → GitHub and Project → Agenten: an app named e2e-werkbuch when the instance has none
 * (an app of the instance's own stays untouched), a suspended installation (so werkbuch asks GitHub nothing) with two
 * repos, the first the repo of an E2E project with the guard on and no ruleset. Answers the identifier of the project.
 * `disconnectGitHub` takes it all away again (else the E2eSeeder before the next run).
 */
async function connectGitHub(page: Page): Promise<string> {
  const project = await createE2eProject(page, e2eName());
  const repo = `e2e/${variant()}-${runId()}-a11y`;
  const answer = JSON.parse(
    artisanEval(
      [
        "$erik = App\\Models\\User::query()->where('email', 'e2e@example.com')->firstOrFail();",
        '$created = App\\Models\\GitHubApp::current() === null;',
        "if ($created) { App\\Models\\GitHubApp::factory()->create(['slug' => 'e2e-werkbuch', 'name' => 'E2E werkbuch', 'owner_login' => 'e2e', 'created_by' => $erik->id]); }",
        `$installation = App\\Models\\GitHubInstallation::factory()->create(['account_login' => 'e2e-${variant()}', 'suspended_at' => now()]);`,
        `$site = App\\Models\\GitHubRepository::factory()->create(['installation_id' => $installation->id, 'full_name' => '${repo}-site']);`,
        `App\\Models\\GitHubRepository::factory()->create(['installation_id' => $installation->id, 'full_name' => '${repo}-docs', 'private' => false]);`,
        `App\\Models\\ProjectRepository::query()->create(['project_id' => '${project.id}', 'repository_id' => $site->id, 'base_branch' => 'main', 'protected' => false, 'guard_detected_at' => now(), 'guard_sha' => 'a41c9e7d00ff11', 'guard_branch' => 'main']);`,
        "echo json_encode(['created' => $created, 'installation' => $installation->id]), PHP_EOL;",
      ].join('\n'),
    ),
  ) as { created: boolean; installation: string };
  a11yGitHub = { ...answer, identifier: project.identifier };
  return project.identifier;
}

async function disconnectGitHub(page: Page): Promise<void> {
  const made = a11yGitHub;
  a11yGitHub = null;
  if (!made) return;
  await removeE2eProject(page, made.identifier);
  artisanEval(
    [
      `App\\Models\\GitHubInstallation::query()->whereKey('${made.installation}')->delete();`,
      made.created ? "App\\Models\\GitHubApp::query()->where('slug', 'e2e-werkbuch')->delete();" : '',
      "echo 'ok', PHP_EOL;",
    ].join('\n'),
  );
}
