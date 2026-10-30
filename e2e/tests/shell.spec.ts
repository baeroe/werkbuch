import { expect, test } from '../fixtures';
import { arrowTo, isPhone, openProfileMenu, PEOPLE, tabTo, tr } from '../helpers';

// signed in as the e2e person (playwright.config.ts), in English. Never sign out for real here: that ends the shared
// session of every later test.

/** The browser's note on the 404 of a place that arrives with a later phase (the 404 page shows instead). */
const notFound = (path: string) => new RegExp(`status of 404 .*\\(https?://[^/]+${path}\\)$`);

test.beforeEach(async ({ page }) => {
  await page.goto('/my-items');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(tr('en', 'items.my.title'));
});

test('starts with "Skip to content" and lists the shortcuts with ?', async ({ page }) => {
  await page.keyboard.press('Tab');
  const skip = page.getByRole('link', { name: tr('en', 'shell.skip_to_content') });
  await expect(skip).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('main#main')).toBeFocused();

  await page.keyboard.press('?');
  const help = page.getByRole('dialog', { name: tr('en', 'shortcuts.help.title') });
  await expect(help).toBeVisible();
  await expect(help.getByText(tr('en', 'shortcuts.shell.go.inbox'), { exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(help).toBeHidden();
});

test('goes to projects with g p and shows the 404 page inside the shell', async ({ page, allowedErrors }) => {
  allowedErrors.push(notFound('/projects'));
  await page.keyboard.press('g');
  await page.keyboard.press('p');

  await expect(page).toHaveURL(/\/projects$/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(tr('en', 'errors.page.not_found.title'));
  if (isPhone(page)) {
    await expect(page.getByRole('button', { name: tr('en', 'shell.mobile.open_navigation') })).toBeVisible();
  } else {
    await expect(page.getByRole('navigation', { name: tr('en', 'shell.sidebar.label') })).toBeVisible();
  }

  await tabTo(page, page.getByRole('link', { name: tr('en', 'errors.page.not_found.open_my_items') }));
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/my-items$/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(tr('en', 'items.my.title'));
});

test('reaches the other main places with their g sequences', async ({ page, allowedErrors }) => {
  allowedErrors.push(notFound('/inbox'), notFound('/views'));
  for (const [key, path] of [
    ['i', '/inbox'],
    ['v', '/views'],
    ['m', '/my-items'],
  ] as const) {
    await page.keyboard.press('g');
    await page.keyboard.press(key);
    await expect(page).toHaveURL(new RegExp(`${path}$`));
  }
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(tr('en', 'items.my.title'));
});

test('opens the navigation drawer on the phone', async ({ page, allowedErrors }) => {
  allowedErrors.push(notFound('/projects'));
  test.skip(!isPhone(page), 'the drawer is the navigation below md');

  const open = page.getByRole('button', { name: tr('en', 'shell.mobile.open_navigation') });
  await tabTo(page, open);
  await page.keyboard.press('Enter');
  const drawer = page.getByRole('dialog', { name: tr('en', 'shell.mobile.navigation') });
  await expect(drawer).toBeVisible();
  await expect(drawer.getByRole('link', { name: tr('en', 'shell.nav.my_items') })).toHaveAttribute('aria-current', 'page');

  await page.keyboard.press('Escape');
  await expect(drawer).toBeHidden();
  await expect(open).toBeFocused();

  // a chosen link closes the drawer
  await page.keyboard.press('Enter');
  await expect(drawer).toBeVisible();
  await tabTo(page, drawer.getByRole('link', { name: tr('en', 'shell.nav.all_projects') }));
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/projects$/);
  await expect(drawer).toBeHidden();
});

test('collapses the sidebar to the rail and back', async ({ page }) => {
  test.skip(isPhone(page), 'the sidebar shows from md on');

  await tabTo(page, page.getByRole('button', { name: tr('en', 'shell.sidebar.collapse') }));
  await page.keyboard.press('Enter');
  const expand = page.getByRole('button', { name: tr('en', 'shell.sidebar.expand') });
  await expect(expand).toBeVisible();

  // the rail: icons with their names, the profile behind the avatar
  const rail = page.getByRole('navigation', { name: tr('en', 'shell.sidebar.label') });
  await expect(rail.getByRole('link', { name: tr('en', 'shell.nav.my_items') })).toHaveAttribute('aria-current', 'page');
  await tabTo(page, rail.getByRole('button', { name: tr('en', 'shell.profile.label_named', { name: PEOPLE.e2e.name }) }));
  await page.keyboard.press('Enter');
  await expect(page.getByRole('menu')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu')).toBeHidden();

  await tabTo(page, expand, { backwards: true });
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: tr('en', 'shell.sidebar.collapse') })).toBeVisible();
});

test('switches the theme from the profile menu and keeps it after reload', async ({ page }) => {
  const choose = async (theme: 'theme.dark' | 'theme.system') => {
    const menu = await openProfileMenu(page, 'en', PEOPLE.e2e.name);
    await arrowTo(page, menu.getByRole('menuitemradio', { name: tr('en', theme) }));
    await page.keyboard.press('Enter');
  };

  await choose('theme.dark');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

  await choose('theme.system');
  await expect(page.locator('html')).not.toHaveAttribute('data-theme', /.*/);
});

test('says so in a toast when signing out fails, and stays', async ({ page, allowedErrors }) => {
  // the request never reaches the server, so the shared session lives on
  await page.route('**/logout', (route) => route.fulfill({ status: 500, body: 'down' }));
  allowedErrors.push(/status of 500 .*\/logout\)$/);

  const menu = await openProfileMenu(page, 'en', PEOPLE.e2e.name);
  await arrowTo(page, menu.getByRole('menuitem', { name: tr('en', 'shell.profile.logout') }));
  await page.keyboard.press('Enter');

  await expect(page.getByText(tr('en', 'shell.profile.logout_failed'))).toBeVisible();
  await expect(page).toHaveURL(/\/my-items$/);
});

test('loads everything from its own origin', async ({ page, baseURL }) => {
  const foreign: string[] = [];
  page.on('request', (request) => {
    const url = request.url();
    if (!url.startsWith(baseURL!) && !url.startsWith('data:')) foreign.push(url);
  });

  await page.reload();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(tr('en', 'items.my.title'));
  const fonts = await page.evaluate(async () => {
    const figtree = await document.fonts.load('16px "Figtree Variable"');
    const bricolage = await document.fonts.load('700 16px "Bricolage Grotesque Variable"');
    return {
      loaded: figtree.length > 0 && bricolage.length > 0,
      figtree: document.fonts.check('16px "Figtree Variable"'),
      bricolage: document.fonts.check('700 16px "Bricolage Grotesque Variable"'),
    };
  });

  expect(fonts).toEqual({ loaded: true, figtree: true, bricolage: true });
  expect(foreign).toEqual([]);
});
