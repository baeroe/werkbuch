import { expect, test } from '../fixtures';
import { artisan, login, PEOPLE, tabTo, totp, tr, variant } from '../helpers';

// without the shared session: every test signs in itself, as the two-factor account of its project (the seeder sets its
// recovery codes back every run)
test.use({ storageState: { cookies: [], origins: [] } });

// three sign-ins per project, four projects within a minute: the limit per IP would strike; the limits are tested in Pest.
// Emptying the cache also forgets the codes used before: a code counts once per secret within its window, and the
// two-factor accounts of all projects share one secret (E2eSeeder::TOTP_SECRET).
test.beforeAll(() => artisan('cache:clear'));

/** Signs in with the password and lands on the challenge, with the field for the code of the app focused. */
async function reachChallenge(page: import('@playwright/test').Page): Promise<void> {
  const person = PEOPLE.twoFactor[variant()]!;
  await page.goto('/login');
  await login(page, person.email, person.password);
  await expect(page).toHaveURL(/\/two-factor-challenge$/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(tr('en', 'two_factor_challenge.title'));
  await expect(page.getByLabel(tr('en', 'two_factor_challenge.code'))).toBeFocused();
}

test('asks for the code after the password and signs in with it', async ({ page }) => {
  await reachChallenge(page);

  await page.keyboard.type(totp(PEOPLE.twoFactor[variant()]!.secret));
  await page.keyboard.press('Enter');

  await expect(page).toHaveURL(/\/my-items$/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(tr('en', 'items.my.title'));
});

test('signs in with a recovery code', async ({ page }) => {
  await reachChallenge(page);

  await tabTo(page, page.getByRole('button', { name: tr('en', 'two_factor_challenge.use_recovery_code') }));
  await page.keyboard.press('Space');
  await expect(page.getByLabel(tr('en', 'two_factor_challenge.recovery_code'))).toBeFocused();
  await page.keyboard.type(PEOPLE.twoFactor[variant()]!.recoveryCodes[0]!);
  await page.keyboard.press('Enter');

  await expect(page).toHaveURL(/\/my-items$/);
});

test('names a wrong code at the field', async ({ page }) => {
  await reachChallenge(page);
  // a code no window of the server accepts (the previous, current and next one are taken out)
  const valid = [-30_000, 0, 30_000].map((shift) => totp(PEOPLE.twoFactor[variant()]!.secret, Date.now() + shift));
  const wrong = ['000000', '111111', '222222', '333333'].find((code) => !valid.includes(code))!;

  await page.keyboard.type(wrong);
  await page.keyboard.press('Enter');

  const code = page.getByLabel(tr('en', 'two_factor_challenge.code'));
  await expect(code).toHaveAttribute('aria-invalid', 'true');
  await expect(page.getByText(tr('en', 'field.code.wrong'))).toBeVisible();
  await expect(code).toBeFocused();
  await expect(page).toHaveURL(/\/two-factor-challenge$/);
});
