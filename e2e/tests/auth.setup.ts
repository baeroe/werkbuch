import { expect, test as setup } from '../fixtures';
import { AUTH_FILE, login, PEOPLE } from '../helpers';

// One sign-in for the whole run (sign-in is limited per IP): every test that does not sign in itself starts with this
// session (playwright.config.ts).
setup('sign in', async ({ page }) => {
  await page.goto('/login');
  await login(page, PEOPLE.e2e.email, PEOPLE.e2e.password);
  await expect(page).toHaveURL(/\/my-items$/);
  await page.context().storageState({ path: AUTH_FILE });
});
