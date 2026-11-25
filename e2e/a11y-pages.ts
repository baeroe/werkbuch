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

/**
 * Three items of a project of the state with what agents do at them (WEBU-28), written into the database: one with a
 * running run (its log open), a review with findings and a pull request with red CI; one the brake took from the agent
 * (a failed run, given back from its line) with a merged pull request; one assigned to a bot that is no agent here, with
 * a run that waits for its offline runner. The runner is `E2E … a11y agents`; `removeA11yRunners` takes everything away.
 */
async function a11yAgentItems(page: Page): Promise<{ running: string; braked: string; refused: string }> {
  const project = await createE2eProject(page, e2eName());
  const running = await createItem(page, { project_id: project.id, title: 'E2E a11y running' });
  const braked = await createItem(page, { project_id: project.id, title: 'E2E a11y braked' });
  const refused = await createItem(page, { project_id: project.id, title: 'E2E a11y refused' });
  const runner = createE2eRunnerRow('a11y agents');
  const ids = JSON.stringify({ running: running.id, braked: braked.id, refused: refused.id, runner: runner.id, email: PEOPLE.e2e.email });
  artisanEval(
    [
      `$p = json_decode('${ids}', true);`,
      "$kira = App\\Models\\User::query()->where('handle', 'kira')->firstOrFail();",
      "$erik = App\\Models\\User::query()->where('email', $p['email'])->value('id');",
      "$item = fn ($id) => App\\Models\\WorkItem::query()->findOrFail($id);",
      "$thread = fn ($item, $more = []) => App\\Models\\AgentThread::query()->create(['bot_id' => $kira->id, 'project_id' => $item->project_id, 'work_item_id' => $item->id, 'runner_id' => $p['runner'], 'branch' => 'agent/a11y', 'base_branch' => 'main', 'status' => 'open', 'corrections' => 0, 'conflicts' => 0, ...$more]);",
      "$run = fn ($item, $thread, $more) => App\\Models\\AgentRun::query()->create(['type' => 'task', 'status' => 'succeeded', 'bot_id' => $kira->id, 'cli' => 'claude', 'model' => 'sonnet', 'model_source' => 'bot', 'runner_id' => $p['runner'], 'project_id' => $item->project_id, 'work_item_id' => $item->id, 'thread_id' => $thread?->id, 'context' => [], 'attempt' => 1, 'started_at' => now()->subMinutes(20), 'finished_at' => now()->subMinutes(5), ...$more]);",
      "$link = fn ($item, $more) => App\\Models\\WorkItemLink::query()->create(['work_item_id' => $item->id, 'kind' => 'pull_request', 'repository_github_id' => 1, 'repository' => 'example/site', 'number' => 7, 'title' => 'E2E a11y pull request', 'url' => 'https://github.com/example/site/pull/7', 'state' => 'open', 'draft' => false, 'head_branch' => 'agent/a11y', 'base_branch' => 'main', 'head_sha' => str_repeat('a', 40), 'closes' => true, 'author' => 'jonas', 'thread_id' => null, 'review' => null, ...$more]);",
      // running, with a log, a review with findings and a PR with red CI
      "$a = $item($p['running']); App\\Models\\WorkItem::query()->whereKey($a->id)->update(['assignee_id' => $kira->id]); $ta = $thread($a);",
      "$review = $run($a, $ta, ['type' => 'review', 'result' => ['verdict' => 'changes', 'summary' => 'Two findings.'], 'created_at' => now()->subMinutes(30)]);",
      "$live = $run($a, $ta, ['status' => 'running', 'finished_at' => null, 'lease_expires_at' => now()->addHours(2), 'started_at' => now()->subMinutes(3), 'created_at' => now()->subMinutes(4)]);",
      "foreach (['Worktree ready', 'Read resources/js/banner.ts', '12 passed'] as $n => $text) App\\Models\\AgentRunEvent::query()->create(['run_id' => $live->id, 'attempt' => 1, 'kind' => ['system', 'tool', 'result'][$n], 'text' => $text, 'bytes' => strlen($text), 'at' => now()->subMinutes(3 - $n)]);",
      "$red = $link($a, ['review' => 'changes']);",
      "DB::table('work_item_link_checks')->insert(['id' => strtolower((string) Str::ulid()), 'work_item_link_id' => $red->id, 'kind' => 'check', 'check_run_id' => 1, 'name' => 'tests', 'app' => 'github-actions', 'status' => 'completed', 'conclusion' => 'failure', 'url' => null, 'head_sha' => str_repeat('a', 40), 'created_at' => now(), 'updated_at' => now()]);",
      // the brake: with Erik now, a failed run, a merged PR
      "$b = $item($p['braked']); App\\Models\\WorkItem::query()->whereKey($b->id)->update(['assignee_id' => $erik]); $tb = $thread($b, ['status' => 'paused', 'pause_reason' => 'brake', 'corrections' => 3, 'pr_number' => 8]);",
      "$run($b, $tb, ['status' => 'failed', 'error' => 'The setup command failed.']);",
      "$link($b, ['number' => 8, 'state' => 'merged', 'review' => 'approve', 'merged_at' => now()]);",
      // a bot that is no agent here, a run waiting for its offline runner
      "$c = $item($p['refused']); App\\Models\\WorkItem::query()->whereKey($c->id)->update(['assignee_id' => $kira->id]);",
      "$run($c, null, ['type' => 'correction', 'status' => 'waiting', 'waiting_reason' => 'runner_offline', 'started_at' => null, 'finished_at' => null]);",
      "echo json_encode([$a->key, $b->key, $c->key]), PHP_EOL;",
    ].join('\n'),
  );
  return { running: running.key, braked: braked.key, refused: refused.key };
}

/**
 * Two items whose strands GitHub stopped (WEBU-28): one in a project without a repo since GitHub was disconnected
 * (`Resume` waits for the repo), one in the project of `connectGitHub` whose guard names its run. Answers both keys;
 * `disconnectGitHub` and `removeA11yRunners` take everything away.
 */
async function a11yAgentGitHub(page: Page): Promise<{ github: string; guard: string }> {
  const guarded = await connectGitHub(page);
  const project = await createE2eProject(page, e2eName());
  const github = await createItem(page, { project_id: project.id, title: 'E2E a11y GitHub disconnected' });
  const guard = await createItem(page, { project_id: guarded, title: 'E2E a11y guard' });
  const ids = JSON.stringify({ github: github.id, guard: guard.id });
  artisanEval(
    [
      `$p = json_decode('${ids}', true);`,
      "$kira = App\\Models\\User::query()->where('handle', 'kira')->firstOrFail();",
      "foreach (['github', 'guard'] as $what) {",
      "  $item = App\\Models\\WorkItem::query()->findOrFail($p[$what]);",
      "  App\\Models\\WorkItem::query()->whereKey($item->id)->update(['assignee_id' => $kira->id]);",
      "  $thread = App\\Models\\AgentThread::query()->create(['bot_id' => $kira->id, 'project_id' => $item->project_id, 'work_item_id' => $item->id, 'branch' => 'agent/a11y-'.$what, 'base_branch' => 'main', 'status' => 'paused', 'pause_reason' => $what, 'pr_number' => 9, 'corrections' => 1, 'conflicts' => 0]);",
      "  $run = App\\Models\\AgentRun::query()->create(['type' => 'task', 'status' => 'succeeded', 'bot_id' => $kira->id, 'cli' => 'claude', 'model' => 'sonnet', 'model_source' => 'bot', 'project_id' => $item->project_id, 'work_item_id' => $item->id, 'thread_id' => $thread->id, 'context' => [], 'attempt' => 1, 'started_at' => now()->subMinutes(20), 'finished_at' => now()->subMinutes(5)]);",
      "  if ($what === 'guard') App\\Models\\ProjectRepository::query()->where('project_id', $item->project_id)->update(['guard_runs' => json_encode([['run_id' => $run->id, 'item_id' => $item->id, 'bot_id' => $kira->id]])]);",
      '}',
      "echo 'ok', PHP_EOL;",
    ].join('\n'),
  );
  return { github: github.key, guard: guard.key };
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
    name: 'item with agent runs',
    page: 'Items/Show',
    path: () => '/items/WEB-47',
    // a running run with its log, a review with findings, a pull request with red CI and its checks (WEBU-28)
    state: async (page) => {
      const { running } = await a11yAgentItems(page);
      await page.goto(`/items/${running}`);
      await expect(page.getByRole('log', { name: en('items.agents.log.label', { run: en('settings.runners.run.type.task') }) })).toContainText('12 passed');
      await expect(page.getByRole('list', { name: en('items.prs.list', { key: running }) })).toBeVisible();
    },
    cleanup: (page) => removeA11yRunners(page),
  }),
  state({
    name: 'item with agent notices',
    page: 'Items/Show',
    path: () => '/items/WEB-47',
    // the brake with a failed run given back from its line and a merged pull request; a bot that is no agent here with a
    // run that waits for its offline runner (WEBU-28)
    state: async (page) => {
      const { braked, refused } = await a11yAgentItems(page);
      await page.goto(`/items/${braked}`);
      await expect(page.getByText(en('items.agents.paused.brake_title', { bot: 'Kira', after: en('items.agents.paused.after_corrections.other', { count: 3 }) }))).toBeVisible();
      await page.goto(`/items/${refused}`);
      await expect(page.getByText(en('items.agents.refusal.title', { bot: 'Kira' }))).toBeVisible();
    },
    cleanup: (page) => removeA11yRunners(page),
  }),
  state({
    name: 'item with agent stopped by GitHub',
    page: 'Items/Show',
    path: () => '/items/WEB-47',
    // a strand GitHub stopped: disconnected (`Resume` waits for the repo of the project), and a guard that names the run
    // of the item (WEBU-28)
    state: async (page) => {
      const { github, guard } = await a11yAgentGitHub(page);
      await page.goto(`/items/${github}`);
      await expect(page.getByText(en('items.agents.paused.github_title', { bot: 'Kira' }))).toBeVisible();
      await page.goto(`/items/${guard}`);
      await expect(page.getByText(en('items.agents.paused.guard_here_title', { bot: 'Kira', branch: 'main' }))).toBeVisible();
    },
    cleanup: async (page) => {
      await disconnectGitHub(page);
      await removeA11yRunners(page);
    },
  }),
  state({
    name: 'cancel run dialog',
    page: 'Items/Show',
    path: () => '/items/WEB-47',
    state: async (page) => {
      const { running } = await a11yAgentItems(page);
      await page.goto(`/items/${running}`);
      const card = page.getByRole('article', { name: en('items.agents.run.label', { run: en('settings.runners.run.type.task'), bot: 'Kira' }) }).last();
      await press(page, card.getByRole('button', { name: en('settings.runners.runs.cancel') }));
      await expect(page.getByRole('alertdialog', { name: en('items.agents.cancel.title', { run: en('settings.runners.run.type.task') }) })).toBeVisible();
    },
    cleanup: (page) => removeA11yRunners(page),
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
  settings('organization', 'agents'),
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
    // two apps (A680): one with an installation, a repo of a project with a guard and without a ruleset, a free repo;
    // one of an own account without installation
    state: async (page) => {
      await connectGitHub(page);
      await page.reload();
      const login = a11yGitHub!.login;
      await expect(page.getByRole('list', { name: en('settings.github.repos.label', { login }) }).getByText(en('settings.github.repo.guarded'))).toBeVisible();
      await expect(page.getByRole('region', { name: en('settings.github.app.title', { login: `${login}-me` }) })).toBeVisible();
    },
    cleanup: disconnectGitHub,
  }),
  state({
    name: 'add GitHub app dialog',
    page: 'Settings/Organization',
    path: () => '/settings/github',
    state: async (page) => {
      await connectGitHub(page);
      await page.reload();
      await press(page, page.getByRole('button', { name: en('settings.github.add.button') }));
      await expect(page.getByRole('dialog', { name: en('settings.github.add.title') })).toBeVisible();
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
      const login = a11yGitHub!.login;
      await press(page, page.getByRole('region', { name: en('settings.github.app.title', { login }) }).getByRole('button', { name: `${en('settings.github.disconnect.title')} ${en('settings.github.app.for', { login })}` }));
      await expect(page.getByRole('alertdialog', { name: en('settings.github.disconnect.question', { login }) })).toBeVisible();
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
    name: 'agent rules with the contract open',
    page: 'Settings/Organization',
    path: () => '/settings/agents',
    // the working rules of "Review" with its contract unfolded (WEBU-32)
    state: async (page) => {
      await press(page, page.getByRole('tab', { name: en('settings.runners.run.type.review') }));
      await press(page, page.getByText(en('settings.agent_rules.contract.title', { type: en('settings.runners.run.type.review') })));
      await expect(page.locator('pre[lang="en"]')).toBeVisible();
    },
  }),
  state({
    name: 'type dialog',
    page: 'Settings/Organization',
    path: () => '/settings/types',
    // a new type with the field "Guidance for agents" (WEBU-32)
    state: async (page) => {
      await press(page, page.getByRole('button', { name: en('settings.types.create'), exact: true }).first());
      await expect(page.getByRole('dialog', { name: en('settings.types.create') }).getByRole('textbox', { name: new RegExp(en('settings.types.dialog.guidance_label').replace(/[()]/g, '\\$&')) })).toBeVisible();
    },
  }),
  state({
    name: 'label dialog with a model',
    page: 'Settings/Organization',
    path: () => '/settings/labels',
    // a new label with a model for agents chosen, the hint of its CLI below (WEBU-32)
    state: async (page) => {
      await press(page, page.getByRole('button', { name: en('settings.labels.create'), exact: true }).first());
      const dialog = page.getByRole('dialog', { name: en('settings.labels.create') });
      await press(page, dialog.getByRole('combobox', { name: new RegExp(`^${en('settings.labels.dialog.model')}`) }));
      await press(page, page.getByRole('option', { name: 'haiku', exact: true }));
      await expect(dialog.getByText(en('settings.agents.model_for_cli', { cli: 'Claude Code' }))).toBeVisible();
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
let a11yGitHub: { apps: string[]; identifier: string; login: string } | null = null;

/**
 * Two GitHub apps of this variant (A680: one per account), an organization with a suspended installation (werkbuch asks
 * GitHub nothing), a repo of an E2E project with the guard on and a free one, and an own account without installation.
 * Answers the identifier of the project.
 */
async function connectGitHub(page: Page): Promise<string> {
  const project = await createE2eProject(page, e2eName());
  const login = `e2e-${variant()}-${runId()}`;
  const repo = `${login}/a11y`;
  const answer = JSON.parse(
    artisanEval(
      [
        "$erik = App\\Models\\User::query()->where('email', 'e2e@example.com')->firstOrFail();",
        `$org = App\\Models\\GitHubApp::factory()->account('${login}')->create(['created_by' => $erik->id]);`,
        `$own = App\\Models\\GitHubApp::factory()->account('${login}-me', 'User')->create(['created_by' => $erik->id]);`,
        `$installation = App\\Models\\GitHubInstallation::factory()->create(['github_app_id' => $org->id, 'account_login' => '${login}', 'suspended_at' => now()]);`,
        `$site = App\\Models\\GitHubRepository::factory()->create(['installation_id' => $installation->id, 'full_name' => '${repo}-site']);`,
        `App\\Models\\GitHubRepository::factory()->create(['installation_id' => $installation->id, 'full_name' => '${repo}-docs', 'private' => false]);`,
        `App\\Models\\ProjectRepository::query()->create(['project_id' => '${project.id}', 'repository_id' => $site->id, 'base_branch' => 'main', 'protected' => false, 'guard_detected_at' => now(), 'guard_sha' => 'a41c9e7d00ff11', 'guard_branch' => 'main']);`,
        "echo json_encode(['apps' => [$org->id, $own->id]]), PHP_EOL;",
      ].join('\n'),
    ),
  ) as { apps: string[] };
  a11yGitHub = { ...answer, identifier: project.identifier, login };
  return project.identifier;
}

/** The apps of `connectGitHub` with their installations, repos and links, and its project. */
async function disconnectGitHub(page: Page): Promise<void> {
  const made = a11yGitHub;
  a11yGitHub = null;
  if (!made) return;
  await removeE2eProject(page, made.identifier);
  artisanEval([`App\\Models\\GitHubApp::query()->whereIn('id', ${JSON.stringify(made.apps).replace(/"/g, "'")})->delete();`, "echo 'ok', PHP_EOL;"].join('\n'));
}
