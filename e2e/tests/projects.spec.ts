import type { Page } from '@playwright/test';
import { expect, test } from '../fixtures';
import { api, createProjectFromSidebar, isPhone, openNavigation, PEOPLE, pressMod, runId, signedInContext, tabTo, tr, variant } from '../helpers';

// Signed in as the e2e person (Erik Ende, org admin; playwright.config.ts), in English. Every project a test creates is
// named "E2E …" and carries the id of the run; the e2e seeder removes them before the next run.

/** A short code per Playwright project, so identifiers stay within ten characters. */
const CODE: Record<string, string> = { 'desktop-light': 'A', 'desktop-dark': 'B', 'phone-light': 'C', 'phone-dark': 'D' };

/** `<letter><run><variant>`: an identifier no other test and no other run uses. */
const identifierFor = (letter: string) => `${letter}${runId()}${CODE[variant()]}`;

/** Creates a project as the signed-in person over the API; answers its name and identifier. */
async function createProject(page: Page, letter: string, visibility: 'public' | 'private' = 'public'): Promise<{ name: string; identifier: string }> {
  await page.goto('/my-items');
  const identifier = identifierFor(letter);
  const name = `E2E ${letter} ${variant()} ${runId()}`;
  const response = await api(page, 'POST', '/api/v1/projects', { name, identifier, visibility });
  expect(response.status(), await response.text()).toBe(201);
  return { name, identifier };
}

/** Puts `text` into the focused field instead of what is there. */
async function replaceText(page: Page, text: string): Promise<void> {
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.type(text);
}

const card = (page: Page, name: string) => page.getByRole('list', { name: tr('en', 'projects.list_label') }).getByRole('listitem').filter({ hasText: name });

test('creates a project with the keyboard from the sidebar', async ({ page }) => {
  await page.goto('/my-items');
  const name = `E2E ${variant()} ${runId()}`;

  const identifier = await createProjectFromSidebar(page, name);

  await expect(card(page, name)).toContainText(identifier);
  await expect(card(page, name)).toContainText(`${tr('en', 'projects.your_role')} ${tr('en', 'roles.project.admin')}`);
  await expect(card(page, name)).toContainText(PEOPLE.e2e.name);
});

test('stars a project into the sidebar and out again', async ({ page }) => {
  const { name } = await createProject(page, 'S');
  await page.goto('/projects');
  const star = card(page, name).getByRole('button', { name: tr('en', 'ui.favorite_star.add', { name }) });
  await expect(star).toBeEnabled();

  // the grid holds the projects of every run so far: many stops on the way
  await tabTo(page, star, { max: 150 });
  await page.keyboard.press('Enter');
  const unstar = card(page, name).getByRole('button', { name: tr('en', 'ui.favorite_star.remove', { name }) });
  await expect(unstar).toBeFocused();
  const navigation = await openNavigation(page, 'en', { backwards: true });
  await expect(navigation.getByRole('button', { name })).toBeVisible();
  if (isPhone(page)) {
    await page.keyboard.press('Escape');
    await expect(navigation).toBeHidden();
  }

  await tabTo(page, unstar, { max: 150 });
  await page.keyboard.press('Enter');
  await expect(star).toBeFocused();
  const after = await openNavigation(page, 'en', { backwards: true });
  await expect(after.getByRole('button', { name })).toHaveCount(0);
});

test('renames the identifier and follows the old address', async ({ page }) => {
  const { identifier } = await createProject(page, 'N');
  const renamed = identifierFor('M');
  await page.goto(`/projects/${identifier}/settings`);
  const field = page.getByRole('textbox', { name: tr('en', 'settings.project.general.identifier') });

  await tabTo(page, field);
  await replaceText(page, renamed);
  await expect(page.getByText(tr('en', 'settings.project.general.old_keys_title'))).toBeVisible();
  await pressMod(page, 'Enter');
  await expect(page.getByText(tr('en', 'settings.project.general.renamed'))).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`/projects/${renamed}/settings/general$`));
  await expect(field).toHaveValue(renamed);

  // the old address keeps working
  await page.goto(`/projects/${identifier}/settings/members`);
  await expect(page).toHaveURL(new RegExp(`/projects/${renamed}/settings/members$`));
  await expect(page.getByRole('list', { name: tr('en', 'settings.project.members.list_of', { identifier: renamed }) })).toBeVisible();
});

test('archives and restores a project', async ({ page }) => {
  const { name, identifier } = await createProject(page, 'R');
  await page.goto(`/projects/${identifier}/settings`);

  await tabTo(page, page.getByRole('button', { name: tr('en', 'settings.project.danger.archive'), exact: true }));
  const archived = page.waitForResponse((response) => response.url().endsWith('/archive'));
  await page.keyboard.press('Enter');
  await expect(page.getByText(tr('en', 'settings.project.danger.archived', { identifier }))).toBeVisible();
  // the call goes out when the toast runs out
  expect((await archived).status()).toBe(200);
  await expect(page.getByText(tr('en', 'settings.project.archived.title'), { exact: true })).toBeVisible();

  const restore = page.getByRole('button', { name: tr('en', 'settings.project.danger.restore'), exact: true });
  await tabTo(page, restore);
  await page.keyboard.press('Enter');
  await expect(page.getByText(tr('en', 'settings.project.danger.restored', { identifier }))).toBeVisible();
  await expect(page.getByText(tr('en', 'settings.project.archived.title'), { exact: true })).toBeHidden();

  // back in the overview without the switch for archived projects
  await page.goto('/projects');
  await expect(card(page, name)).toBeVisible();
});

test('deletes a project after typing its identifier', async ({ page }) => {
  const { name, identifier } = await createProject(page, 'D');
  await page.goto(`/projects/${identifier}/settings`);

  await tabTo(page, page.getByRole('button', { name: tr('en', 'settings.project.danger.delete_open') }));
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: tr('en', 'settings.project.danger.confirm_title', { identifier }) });
  await expect(dialog).toBeVisible();
  const field = dialog.getByRole('textbox', { name: tr('en', 'settings.project.danger.confirm_label') });
  await tabTo(page, field);
  await page.keyboard.type(identifier.toLowerCase());
  await page.keyboard.press('Enter');
  // the wrong spelling keeps the question open
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button', { name: tr('en', 'settings.project.danger.delete'), exact: true })).toHaveAttribute('aria-disabled', 'true');

  await replaceText(page, identifier);
  const deleted = page.waitForResponse((response) => response.request().method() === 'DELETE' && response.url().includes('/api/v1/projects/'));
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/projects$/);
  await expect(page.getByText(tr('en', 'settings.project.danger.deleted', { identifier }))).toBeVisible();
  expect((await deleted).status()).toBe(202);
  await expect(card(page, name)).toHaveCount(0);
});

test('joins a public project with one click', async ({ page, browser }) => {
  const { name } = await createProject(page, 'J');
  // Lene is a member with a German profile
  const { context, page: lene } = await signedInContext(browser, PEOPLE.lene);
  try {
    await lene.goto('/projects');
    const entry = lene.getByRole('list', { name: tr('de', 'projects.list_label') }).getByRole('listitem').filter({ hasText: name });
    await expect(entry).toContainText(tr('de', 'projects.reading_only'));

    await tabTo(lene, entry.getByRole('button', { name: tr('de', 'projects.join') }), { max: 150 });
    await lene.keyboard.press('Enter');
    await expect(lene.getByText(tr('de', 'projects.joined', { name }))).toBeVisible();
    // the button goes with the membership; the focus stays on the card
    await expect(entry.getByRole('link', { name })).toBeFocused();
    await expect(entry).toContainText(`${tr('de', 'projects.your_role')} ${tr('de', 'roles.project.member')}`);
    await expect(entry.getByRole('button', { name: tr('de', 'projects.join') })).toHaveCount(0);
  } finally {
    await context.close();
  }
});

test('hides a private project from a non-member', async ({ browser }) => {
  // Ida is in WEB, not in the private OPS
  const { context, page: ida } = await signedInContext(browser, PEOPLE.ida);
  try {
    const answer = await ida.goto('/projects/OPS/settings');
    expect(answer?.status()).toBe(404);
    await expect(ida.getByRole('heading', { level: 1 })).toHaveText(tr('de', 'errors.page.not_found.title'));

    await ida.goto('/projects');
    const list = ida.getByRole('list', { name: tr('de', 'projects.list_label') });
    await expect(list).toContainText('Website-Relaunch');
    await expect(list).not.toContainText('Infrastruktur');
  } finally {
    await context.close();
  }
});

test('says when the sidebar could not load the projects and loads them again', async ({ page, allowedErrors }) => {
  allowedErrors.push(/status of 503 .*\/api\/v1\/favorites\)$/);
  await page.route('**/api/v1/favorites', (route) => route.fulfill({ status: 503, contentType: 'application/problem+json', body: '{"status":503,"reason":"service_unavailable"}' }));
  await page.goto('/my-items');

  const navigation = await openNavigation(page, 'en');
  await expect(navigation.getByText(tr('en', 'shell.nav.projects_failed'))).toBeVisible();

  await page.unroute('**/api/v1/favorites');
  await tabTo(page, navigation.getByRole('button', { name: tr('en', 'common.retry') }));
  await page.keyboard.press('Enter');
  await expect(navigation.getByText(tr('en', 'shell.nav.projects_failed'))).toBeHidden();
  await expect(navigation.getByRole('link', { name: tr('en', 'shell.nav.all_projects') })).toBeVisible();
});
