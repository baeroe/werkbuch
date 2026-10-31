import { expect, test } from '../fixtures';
import { api, artisan, runId, tabTo, tr, variant } from '../helpers';
import type { Page } from '@playwright/test';

// The e2e person (an org admin, signed in by the setup project) invites through the API; the invited person then opens the
// link without a session, in the same context (so the coverage of its pages is collected as usual).

// The four projects accept a handful of invitations within a minute: emptying the cache resets the limit per IP
// (10 a minute, config/werkbuch.php), once per project; the limit itself is tested in Pest.
test.beforeAll(() => artisan('cache:clear'));

const ORGANIZATION = 'Feldwerk';

/** Invites `invite-<variant>-<run>-<tag>@example.com` as the signed-in person; answers the address and the link. */
async function invite(page: Page, tag: string): Promise<{ email: string; link: string }> {
  const email = `invite-${variant()}-${runId().toLowerCase()}-${tag}@example.com`;
  const response = await api(page, 'POST', '/api/v1/invitations', { email, org_role: 'member' });
  expect(response.status(), await response.text()).toBe(201);
  const { link } = (await response.json()) as { link: string };
  return { email, link };
}

/** Ends the session of the context: from here on the page is that of the invited person. */
async function signOutQuietly(page: Page): Promise<void> {
  await page.context().clearCookies();
}

/**
 * My items as the e2e person, once the calls of the sidebar (favorites, projects) are answered: one that came back
 * after `signOutQuietly` would find no session and reload the page under the next `goto`.
 */
async function openMyItems(page: Page): Promise<void> {
  const answered = (path: string) => page.waitForResponse((response) => new URL(response.url()).pathname === path);
  const sidebar = Promise.all([answered('/api/v1/favorites'), answered('/api/v1/projects')]);
  await page.goto('/my-items');
  await sidebar;
}

test('accepts an invitation with the keyboard only', async ({ page }) => {
  await openMyItems(page);
  const { link } = await invite(page, 'accept');
  await signOutQuietly(page);

  await page.goto(link);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(tr('en', 'invitation.title'));
  await expect(page.getByText(tr('en', 'invitation.description', { organization: ORGANIZATION }))).toBeVisible();

  await tabTo(page, page.getByLabel(tr('en', 'invitation.name'), { exact: true }));
  await page.keyboard.type('Lea Sommer');
  await page.keyboard.press('Tab');
  await expect(page.getByLabel(tr('en', 'invitation.password'), { exact: true })).toBeFocused();
  await page.keyboard.type('e2e-invitation-password');
  await page.keyboard.press('Enter');

  await expect(page).toHaveURL(/\/my-items$/);
  await expect(page.getByText(tr('en', 'invitation.welcome', { name: 'Lea Sommer', organization: ORGANIZATION }))).toBeVisible();
});

test('shows a closed link for a replaced invitation and leads to the sign-in', async ({ page }) => {
  await openMyItems(page);
  const first = await invite(page, 'closed');
  // a second invitation to the same address replaces the first
  const second = await invite(page, 'closed');
  expect(second.link).not.toBe(first.link);
  await signOutQuietly(page);

  await page.goto(first.link);
  await expect(page.getByText(tr('en', 'invitation.closed'))).toBeVisible();
  await expect(page.getByLabel(tr('en', 'invitation.name'), { exact: true })).toHaveCount(0);

  await tabTo(page, page.getByRole('link', { name: tr('en', 'invitation.to_login') }));
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/login$/);

  // the new link still works
  await page.goto(second.link);
  await expect(page.getByLabel(tr('en', 'invitation.name'), { exact: true })).toBeVisible();
});

test('names the empty fields and focuses the first one', async ({ page }) => {
  await openMyItems(page);
  const { link } = await invite(page, 'empty');
  await signOutQuietly(page);

  await page.goto(link);
  const name = page.getByLabel(tr('en', 'invitation.name'), { exact: true });
  await tabTo(page, name);
  await page.keyboard.press('Enter');

  await expect(name).toBeFocused();
  await expect(name).toHaveAttribute('aria-invalid', 'true');
  await expect(page.getByText(tr('en', 'invitation.name_required'))).toBeVisible();
  await expect(page.getByText(tr('en', 'invitation.password_required'))).toBeVisible();
  await expect(page).toHaveURL(/\/invitations\//);
});
