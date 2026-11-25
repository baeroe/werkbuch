import { expect, test } from '../fixtures';
import { api, artisanEval, createE2eProject, pressMod, PEOPLE, removeE2eProject, runId, tabTo, tr, variant } from '../helpers';

// Settings → GitHub and Project → Agenten (spec 10.2, 10.3, 11.3) as the e2e person (Erik Ende, org admin), in English.
// One private GitHub app per account (A680): every test makes the app of an account of its own variant and run
// (`e2e-<variant>-<run>…`, slug `e2e-…`, the seeder removes what an aborted run left) and removes it again; apps of the
// instance stay untouched. Its installation is suspended on purpose: then werkbuch never asks GitHub (whether a ruleset
// protects a branch, a token), and the specs send nothing to github.com. Connecting itself posts the manifest to
// github.com: the spec catches that post. "Neu einlesen" has no test here: it asks GitHub for installations and repos
// with a token of the app, and only an app registered at github.com gets one (Vitest and Pest prove the button and the
// sync; the note stands in FLOWS too).

const label = (key: string, params: Record<string, string | number> = {}) => tr('en', key, params);
// the ddev calls (tinker) take their time
test.describe.configure({ timeout: 120_000 });

interface Connection {
  app: string;
  login: string;
  installation: string;
  repository: string;
  fullName: string;
}

/** The app of an account of this variant, a suspended installation and one repo of it, made in the app under test. */
function connect(repo: string): Connection {
  const login = `e2e-${variant()}-${runId()}-${repo}`;
  const fullName = `${login}/${repo}`;
  const answer = artisanEval(
    [
      `$erik = App\\Models\\User::query()->where('email', '${PEOPLE.e2e.email}')->firstOrFail();`,
      `$app = App\\Models\\GitHubApp::factory()->account('${login}')->create(['created_by' => $erik->id]);`,
      `$installation = App\\Models\\GitHubInstallation::factory()->create(['github_app_id' => $app->id, 'account_login' => '${login}', 'suspended_at' => now()]);`,
      `$repository = App\\Models\\GitHubRepository::factory()->create(['installation_id' => $installation->id, 'full_name' => '${fullName}']);`,
      "echo json_encode(['app' => $app->id, 'installation' => $installation->id, 'repository' => $repository->id]), PHP_EOL;",
    ].join('\n'),
  );
  return { ...(JSON.parse(answer) as Omit<Connection, 'fullName' | 'login'>), fullName, login };
}

/** Takes the app away (its installations, repos and the links of projects go with it); one that is gone already does nothing. */
function disconnect(connection: Connection | null): void {
  if (!connection) return;
  artisanEval([`App\\Models\\GitHubApp::query()->whereKey('${connection.app}')->delete();`, "echo 'ok', PHP_EOL;"].join('\n'));
}

test('posts the manifest of another account to GitHub, with the keyboard', async ({ page, allowedErrors }) => {
  // an app of this variant: the page offers "Add another app"
  const connection = connect('first');
  // the account that has its app already is refused on purpose
  allowedErrors.push(/status of 409 .*\/api\/v1\/github\/manifest\)$/);
  // GitHub answers the post of the manifest with an empty page: what counts is what the browser sent
  const posts: { url: string; method: string; body: string }[] = [];
  await page.route('https://github.com/**', async (route) => {
    const request = route.request();
    posts.push({ url: request.url(), method: request.method(), body: request.postData() ?? '' });
    await route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>GitHub</title>' });
  });
  try {
    await page.goto('/settings/github');
    await expect(page.getByRole('heading', { level: 2, name: label('settings.org.section.github') })).toBeVisible();
    await expect(page.getByRole('region', { name: label('settings.github.app.title', { login: connection.login }) })).toBeVisible();

    await tabTo(page, page.getByRole('button', { name: label('settings.github.add.button') }), { max: 80 });
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog', { name: label('settings.github.add.title') });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText(`${new URL(page.url()).origin}/github/webhook`)).toBeVisible();

    // the account that has its app already: the sentence of the server at the login
    const field = dialog.getByRole('textbox', { name: label('settings.github.connect.login_organization') });
    await tabTo(page, field, { max: 10 });
    await page.keyboard.type(connection.login);
    await page.keyboard.press('Enter');
    await expect(dialog.getByText(tr('en', 'problem.detail.github_account_connected', { login: connection.login }))).toBeVisible();
    await expect(field).toBeFocused();

    // another organization: the manifest goes to GitHub
    const other = `e2e-${variant()}-${runId()}-other`;
    await field.fill(other);
    await page.keyboard.press('Enter');

    await expect.poll(() => posts.length, { timeout: 15_000 }).toBe(1);
    expect(posts[0]!.method).toBe('POST');
    expect(posts[0]!.url).toMatch(new RegExp(`^https://github\\.com/organizations/${other}/settings/apps/new\\?state=[A-Za-z0-9]+$`));
    const manifest = JSON.parse(new URLSearchParams(posts[0]!.body).get('manifest')!) as { name: string; redirect_url: string; default_events: string[] };
    expect(manifest.redirect_url).toMatch(/\/github\/manifest$/);
    expect(manifest.default_events).toContain('push');
    expect(manifest.name).toBe(`${[...other].slice(0, 25).join('')} werkbuch`);

    // The post leaves the app for the fulfilled GitHub page. Back to a page of the app: the coverage fixture reads the
    // pages that stand on the app at the end, and while the post was still under way it read the GitHub document (no
    // `__coverage__`, a race in the CI). The app document stashed its counters at `pagehide` in the sessionStorage of the
    // app; the next document of the app in this tab hands them over, so nothing of the test is lost.
    await page.waitForURL(/^https:\/\/github\.com\//);
    await page.goto('/settings/github');
    await expect(page.getByRole('heading', { level: 2, name: label('settings.org.section.github') })).toBeVisible();
  } finally {
    disconnect(connection);
  }
});

test('chooses the repo of a project with the keyboard', async ({ page }) => {
  const connection = connect('site');
  const project = await createE2eProject(page, `E2E ${variant()} ${runId()} agents repo`);
  try {
    await page.goto(`/projects/${project.identifier}/settings/agents`);
    await expect(page.getByRole('heading', { name: label('settings.project.agents.repository.title') })).toBeVisible();

    const select = page.getByRole('combobox', { name: new RegExp(`^${label('settings.project.agents.repo')}`) });
    await tabTo(page, select, { max: 80 });
    await page.keyboard.press('Enter');
    const option = page.getByRole('option', { name: connection.fullName });
    await expect(option).toBeVisible();
    // the list starts on the chosen entry ("No repo"); the arrows walk to the repo
    for (let step = 0; step < 40 && !(await option.evaluate((element) => element.hasAttribute('data-highlighted'))); step++) await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await expect(select).toContainText(connection.fullName);

    await pressMod(page, 'Enter');
    await expect(page.getByText(label('settings.project.agents.saved'), { exact: true })).toBeVisible();
    // empty base branch: the default branch of the repo
    await expect(page.getByRole('textbox', { name: new RegExp(`^${label('settings.project.agents.base_branch')}`) })).toHaveValue('main');
    const stored = (await (await api(page, 'GET', `/api/v1/projects/${project.id}/repository`)).json()) as { data: { repository: { full_name: string }; base_branch: string } | null };
    expect(stored.data?.repository.full_name).toBe(connection.fullName);
    expect(stored.data?.base_branch).toBe('main');
  } finally {
    await removeE2eProject(page, project.identifier);
    disconnect(connection);
  }
});

test('confirms an unauthorized merge with the keyboard', async ({ page }) => {
  const connection = connect('guarded');
  const project = await createE2eProject(page, `E2E ${variant()} ${runId()} agents guard`);
  try {
    // what DetectUnauthorizedPush leaves: the repo of the project with the guard on
    artisanEval(
      [
        `App\\Models\\ProjectRepository::query()->create(['project_id' => '${project.id}', 'repository_id' => '${connection.repository}', 'base_branch' => 'main', 'protected' => false, 'guard_detected_at' => now(), 'guard_sha' => 'a41c9e7d00ff11', 'guard_branch' => 'main']);`,
        "echo 'ok', PHP_EOL;",
      ].join('\n'),
    );

    await page.goto(`/projects/${project.identifier}/settings/agents`);
    const banner = page.getByRole('alert', { name: label('settings.project.agents.guard.title', { identifier: project.identifier }) });
    await expect(banner).toBeVisible();
    await expect(banner).toContainText('(a41c9e7)');
    await expect(banner).toContainText(label('settings.project.agents.guard.unprotected', { branch: 'main' }));

    const confirm = banner.getByRole('button', { name: label('settings.project.agents.guard.confirm') });
    await tabTo(page, confirm, { max: 80 });
    await page.keyboard.press('Enter');

    await expect(page.getByText(label('settings.project.agents.guard.confirmed'), { exact: true })).toBeVisible();
    await expect(banner).toHaveCount(0);
    // the banner went with the button: the focus is on the first sheet under it
    await expect(page.getByRole('heading', { name: label('settings.project.agents.repository.title') })).toBeFocused();
  } finally {
    await removeE2eProject(page, project.identifier);
    disconnect(connection);
  }
});

test('disconnects the app of one account with the keyboard', async ({ page }) => {
  const connection = connect('gone');
  const kept = connect('kept');
  try {
    await page.goto('/settings/github');
    const panel = page.getByRole('region', { name: label('settings.github.app.title', { login: connection.login }) });
    await expect(panel).toBeVisible();

    await tabTo(page, panel.getByRole('button', { name: `${label('settings.github.disconnect.title')} ${label('settings.github.app.for', { login: connection.login })}` }), { max: 120 });
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('alertdialog', { name: label('settings.github.disconnect.question', { login: connection.login }) });
    await expect(dialog).toBeVisible();
    // the focus starts on "Cancel": Tab goes on to "Disconnect"
    await tabTo(page, dialog.getByRole('button', { name: label('settings.github.disconnect.confirm'), exact: true }), { max: 4 });
    await page.keyboard.press('Enter');

    await expect(page.getByText(label('settings.github.disconnect.done', { login: connection.login }), { exact: true })).toBeVisible();
    await expect(panel).toHaveCount(0);
    // the other app stays
    await expect(page.getByRole('region', { name: label('settings.github.app.title', { login: kept.login }) })).toBeVisible();
    // exact: the question is a heading too while it fades out
    await expect(page.getByRole('heading', { level: 2, name: label('settings.org.section.github'), exact: true })).toBeFocused();
    const apps = ((await (await api(page, 'GET', '/api/v1/github')).json()) as { data: { apps: { id: string }[] } }).data.apps.map((app) => app.id);
    expect(apps).toContain(kept.app);
    expect(apps).not.toContain(connection.app);
  } finally {
    // gone with the disconnect; deleting what is gone does nothing
    disconnect(connection);
    disconnect(kept);
  }
});
