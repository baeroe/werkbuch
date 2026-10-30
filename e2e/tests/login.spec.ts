import { expect, test } from '../fixtures';
import { login, PEOPLE, signOut, tr } from '../helpers';

// without a session; four sign-ins per project keep a run below the limit of the IP (config/werkbuch.php)
test.use({ storageState: { cookies: [], origins: [] } });

const BACKGROUND = { light: 'oklch(0.975 0.004 250)', dark: 'oklch(0.235 0.02 258)' };

test('signs in and out with the keyboard only, in English', async ({ page }) => {
  await page.goto('/login');
  await login(page, PEOPLE.e2e.email, PEOPLE.e2e.password);

  await expect(page).toHaveURL(/\/my-items$/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(tr('en', 'items.my.title'));

  await signOut(page, 'en', PEOPLE.e2e.name);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(tr('en', 'login.title'));

  await page.goto('/my-items');
  await expect(page).toHaveURL(/\/login$/);
});

test('shows the sign-in in German when the language cookie says so', async ({ page, context, baseURL }) => {
  await context.addCookies([{ name: 'locale', value: 'de', url: baseURL! }]);
  await page.goto('/login');

  await expect(page.getByRole('heading', { level: 1 })).toHaveText(tr('de', 'login.title'));
  await expect(page.locator('html')).toHaveAttribute('lang', 'de');
});

test('switches to the language of the account after signing in, and keeps it after signing out', async ({ page }) => {
  // first someone else in the same browser: the next person starts with an empty query cache and no errors
  await page.goto('/login');
  await login(page, PEOPLE.e2e.email, PEOPLE.e2e.password);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(tr('en', 'items.my.title'));
  await signOut(page, 'en', PEOPLE.e2e.name);

  await expect(page.getByRole('heading', { level: 1 })).toHaveText(tr('en', 'login.title'));
  // a mark on this document: a reload takes it away
  await page.evaluate(() => Object.assign(window, { __beforeSignIn: true }));
  await login(page, PEOPLE.mara.email, PEOPLE.mara.password);

  await expect(page).toHaveURL(/\/my-items$/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(tr('de', 'items.my.title'));
  await expect(page.locator('html')).toHaveAttribute('lang', 'de');
  // the whole page speaks German: the visit that changed the language reloaded it instead of mixing languages
  expect(await page.evaluate(() => '__beforeSignIn' in window)).toBe(false);
  await expect(page.getByRole('link', { name: tr('de', 'shell.nav.inbox') }).first()).toBeAttached();

  // the profile menu names the new person (signOut finds it by her name)
  await signOut(page, 'de', PEOPLE.mara.name);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(tr('de', 'login.title'));
  await expect(page.locator('html')).toHaveAttribute('lang', 'de');
});

test('names the reason at the email field for a wrong password', async ({ page }) => {
  await page.goto('/login');
  await login(page, PEOPLE.theo.email, 'not-the-password');

  const email = page.getByLabel(tr('en', 'login.email'));
  await expect(email).toHaveAttribute('aria-invalid', 'true');
  await expect(email).toBeFocused();
  await expect(page).toHaveURL(/\/login$/);
});

test('paints the theme of the system before the first render, without horizontal scroll', async ({ page, browser, baseURL }, info) => {
  const scheme = info.project.use.colorScheme === 'dark' ? 'dark' : 'light';
  // the token as the browser resolves it (the build writes it shorter, e.g. `oklch(97.5% .004 250)`)
  const background = () => getComputedStyle(document.body).backgroundColor;

  // without any script: the tokens follow the system on their own
  const plain = await browser.newContext({ baseURL, ignoreHTTPSErrors: true, javaScriptEnabled: false, colorScheme: scheme });
  const before = await plain.newPage();
  await before.goto('/login');
  expect(await before.evaluate(background)).toBe(BACKGROUND[scheme]);
  await plain.close();

  await page.goto('/login');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(tr('en', 'login.title'));
  expect(await page.evaluate(background)).toBe(BACKGROUND[scheme]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
