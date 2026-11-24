import type { Page } from '@playwright/test';
import { expect, test } from '../fixtures';
import { api, artisanEval, createE2eProject, pressMod, PEOPLE, removeE2eProject, runId, tabTo, tr, variant } from '../helpers';

// Settings → GitHub and Project → Agenten (spec 10.2, 10.3, 11.3) as the e2e person (Erik Ende, org admin), in English.
// An instance has one GitHub app: the specs make one named `e2e-werkbuch` only when there is none (and stop when the
// instance has its own), and remove it again (the seeder removes what an aborted run left). Its installation is
// suspended on purpose: then werkbuch never asks GitHub (whether a ruleset protects a branch, a token), and the specs
// send nothing to github.com. Connecting itself posts the manifest to github.com: the spec catches that post.
// "Neu einlesen" has no test here: it asks GitHub for installations and repos with a token of the app, and only an app
// registered at github.com gets one (Vitest and Pest prove the button and the sync; the note stands in FLOWS too).

const label = (key: string, params: Record<string, string | number> = {}) => tr('en', key, params);
// the ddev calls (tinker) take their time
test.describe.configure({ timeout: 120_000 });

interface Connection {
  /** Whether this spec made the app (and removes it again). */
  created: boolean;
  installation: string;
  repository: string;
  fullName: string;
}

/** The GitHub app of this instance as the API reads it, or null without one. */
async function currentApp(page: Page): Promise<{ slug: string } | null> {
  const answer = (await (await api(page, 'GET', '/api/v1/github')).json()) as { data: { app: { slug: string } | null } };
  return answer.data.app;
}

/**
 * The app the instance has, if any, is one a spec made: an app of the instance's own (connected to the real GitHub) the
 * specs never touch, so they stop and say so.
 */
async function expectNoForeignApp(page: Page): Promise<{ slug: string } | null> {
  await page.goto('/my-items');
  const app = await currentApp(page);
  expect(app === null || app.slug.startsWith('e2e-'), 'the instance has a GitHub app of its own: github.spec.ts needs none').toBe(true);
  return app;
}

/** An app (when there is none), a suspended installation and one repo of it, made in the app under test. */
function connect(repo: string): Connection {
  const fullName = `e2e/${variant()}-${runId()}-${repo}`;
  const answer = artisanEval(
    [
      `$erik = App\\Models\\User::query()->where('email', '${PEOPLE.e2e.email}')->firstOrFail();`,
      '$created = App\\Models\\GitHubApp::current() === null;',
      "if ($created) { App\\Models\\GitHubApp::factory()->create(['slug' => 'e2e-werkbuch', 'name' => 'E2E werkbuch', 'owner_login' => 'e2e', 'created_by' => $erik->id]); }",
      `$installation = App\\Models\\GitHubInstallation::factory()->create(['account_login' => 'e2e-${variant()}', 'suspended_at' => now()]);`,
      `$repository = App\\Models\\GitHubRepository::factory()->create(['installation_id' => $installation->id, 'full_name' => '${fullName}']);`,
      "echo json_encode(['created' => $created, 'installation' => $installation->id, 'repository' => $repository->id]), PHP_EOL;",
    ].join('\n'),
  );
  return { ...(JSON.parse(answer) as Omit<Connection, 'fullName'>), fullName };
}

/** Takes the installation away (its repos and the links of projects go with it), and the app when the spec made it. */
function disconnect(connection: Connection | null): void {
  if (!connection) return;
  artisanEval(
    [
      `App\\Models\\GitHubInstallation::query()->whereKey('${connection.installation}')->delete();`,
      connection.created ? "App\\Models\\GitHubApp::query()->where('slug', 'e2e-werkbuch')->delete();" : '',
      "echo 'ok', PHP_EOL;",
    ].join('\n'),
  );
}

test('posts the manifest to GitHub when connecting, with the keyboard', async ({ page }) => {
  // an app a spec left behind (an aborted run) goes with the seeder before the next run
  expect(await expectNoForeignApp(page), 'an app is connected: there is nothing to connect').toBeNull();

  // GitHub answers the post of the manifest with an empty page: what counts is what the browser sent
  const posts: { url: string; method: string; body: string }[] = [];
  await page.route('https://github.com/**', async (route) => {
    const request = route.request();
    posts.push({ url: request.url(), method: request.method(), body: request.postData() ?? '' });
    await route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>GitHub</title>' });
  });

  await page.goto('/settings/github');
  await expect(page.getByRole('heading', { level: 2, name: label('settings.org.section.github') })).toBeVisible();
  await expect(page.getByRole('region', { name: label('settings.github.connect.title') }).getByText(`${new URL(page.url()).origin}/github/webhook`)).toBeVisible();

  const button = page.getByRole('button', { name: label('settings.github.connect.button') });
  await tabTo(page, button, { max: 80 });
  await page.keyboard.press('Enter');

  await expect.poll(() => posts.length, { timeout: 15_000 }).toBe(1);
  expect(posts[0]!.method).toBe('POST');
  expect(posts[0]!.url).toMatch(/^https:\/\/github\.com\/settings\/apps\/new\?state=[A-Za-z0-9]+$/);
  const manifest = JSON.parse(new URLSearchParams(posts[0]!.body).get('manifest')!) as { redirect_url: string; default_events: string[] };
  expect(manifest.redirect_url).toMatch(/\/github\/manifest$/);
  expect(manifest.default_events).toContain('push');
});

test('chooses the repo of a project with the keyboard', async ({ page }) => {
  await expectNoForeignApp(page);
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
  await expectNoForeignApp(page);
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

test('disconnects GitHub with the keyboard', async ({ page }) => {
  await expectNoForeignApp(page);
  const connection = connect('gone');
  try {
    await page.goto('/settings/github');
    await expect(page.getByText('E2E werkbuch', { exact: true })).toBeVisible();

    const button = page.getByRole('button', { name: label('settings.github.disconnect.button') });
    await tabTo(page, button, { max: 80 });
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('alertdialog', { name: label('settings.github.disconnect.question') });
    await expect(dialog).toBeVisible();
    // the focus starts on "Cancel": Tab goes on to "Disconnect"
    await tabTo(page, dialog.getByRole('button', { name: label('settings.github.disconnect.confirm'), exact: true }), { max: 4 });
    await page.keyboard.press('Enter');

    await expect(page.getByText(label('settings.github.disconnect.done'), { exact: true })).toBeVisible();
    await expect(page.getByRole('region', { name: label('settings.github.connect.title') })).toBeVisible();
    // exact: the question "Disconnect GitHub?" is a heading too while it fades out
    await expect(page.getByRole('heading', { level: 2, name: label('settings.org.section.github'), exact: true })).toBeFocused();
    expect(await currentApp(page)).toBeNull();
  } finally {
    // gone with the disconnect; deleting what is gone does nothing
    disconnect({ ...connection, created: true });
  }
});
