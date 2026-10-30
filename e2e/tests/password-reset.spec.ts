import { expect, test } from '../fixtures';
import { artisan, login, mailpit, PEOPLE, tabTo, tr } from '../helpers';

// without a session; one reset account per project (the broker allows one link per address a minute)
test.use({ storageState: { cookies: [], origins: [] } });

// The four projects run within a minute: their links (6 a minute per IP) and sign-ins (20) would hit the limits of the
// IP. Emptying the cache resets them, once per project; the limits themselves are tested in Pest.
test.beforeAll(() => artisan('cache:clear'));

const NEW_PASSWORD = 'new-e2e-password';

/** Types the new password into both fields of the reset form and sends it, with the keyboard only. */
async function setPassword(page: import('@playwright/test').Page, password: string): Promise<void> {
  // the card is named "New password" as well
  await tabTo(page, page.getByLabel(tr('en', 'reset_password.password'), { exact: true }).and(page.locator('input')));
  await page.keyboard.type(password);
  await page.keyboard.press('Tab');
  await expect(page.getByLabel(tr('en', 'reset_password.confirmation'))).toBeFocused();
  await page.keyboard.type(password);
  await page.keyboard.press('Enter');
}

test('answers an unknown address like a known one, then sets a new password from the mail', async ({ page }, info) => {
  const person = PEOPLE.reset[info.project.name]!;
  const start = new Date();

  await page.goto('/forgot-password');
  await tabTo(page, page.getByLabel(tr('en', 'forgot_password.email')));
  await page.keyboard.type('nobody@example.com');
  await page.keyboard.press('Enter');
  // the same confirmation as for a known address
  await expect(page.getByText('nobody@example.com')).toBeVisible();

  await page.goto('/login');
  await tabTo(page, page.getByRole('link', { name: tr('en', 'login.forgot_link') }));
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/forgot-password$/);
  await tabTo(page, page.getByLabel(tr('en', 'forgot_password.email')));
  await page.keyboard.type(person.email);
  await page.keyboard.press('Enter');
  // the confirmation, which takes the focus
  await expect(page.getByText(person.email)).toBeVisible();
  await expect(page.getByText(person.email).locator('..')).toBeFocused();

  // a queue worker sends the mail (the `queue` daemon in DDEV, a background step in CI); once the later mail is in Mailpit, a mail to the earlier unknown address would be too
  await expect.poll(() => mailpit.latestTo(person.email, start), { timeout: 15_000 }).not.toBeNull();
  expect(await mailpit.latestTo('nobody@example.com', start)).toBeNull();

  const { html } = (await mailpit.latestTo(person.email, start))!;
  const link = /href="([^"]+\/reset-password\/[^"]+)"/.exec(html)![1]!.replaceAll('&amp;', '&');
  await page.goto(link);
  await expect(page.getByLabel(tr('en', 'reset_password.email'))).toHaveValue(person.email);
  await setPassword(page, NEW_PASSWORD);

  await expect(page).toHaveURL(/\/login$/);
  // flash.status (the text comes from lang/en/passwords.php)
  await expect(page.getByRole('status').filter({ hasText: /\S/ })).toBeVisible();

  // the same link again, still signed out: used up, the field says so and offers a new one
  await page.goto(link);
  await setPassword(page, NEW_PASSWORD);
  const email = page.getByLabel(tr('en', 'reset_password.email'));
  await expect(email).toHaveAttribute('aria-invalid', 'true');
  // the reason (lang/en/passwords.php) is the field's description, and the field has the focus
  await expect(email).toHaveAccessibleDescription(/\S/);
  await expect(email).toBeFocused();
  await expect(page.getByRole('link', { name: tr('en', 'reset_password.request_new') })).toHaveAttribute('href', '/forgot-password');

  await page.goto('/login');
  await login(page, person.email, NEW_PASSWORD);
  await expect(page).toHaveURL(/\/my-items$/);
});
