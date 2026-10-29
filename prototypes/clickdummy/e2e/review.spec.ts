/*
 * The review build (pnpm build:review), served as a static host serves it (scripts/serve.mjs): index.html is the
 * fragment of scripts/artifact.mjs in a page skeleton, the rest are the files of dist-review/. It runs where an
 * artifact runs: only its own files, no window.print, and a localStorage that may throw.
 *
 * The app starts on its hash routes with the seed in memory; navigation, the palette and the theme work.
 */

import { expect, test as base, type Page } from '@playwright/test';

/** Fails the test on what the page reports (errors and warnings) and on any request that leaves the server or fails. */
const test = base.extend<{ problems: string[] }>({
  problems: [
    async ({ page, baseURL }, use) => {
      const problems: string[] = [];
      const own = new URL(baseURL!).origin;
      page.on('pageerror', (error) => problems.push(`page error: ${error.message}`));
      page.on('console', (message) => {
        if (message.type() === 'error' || message.type() === 'warning') problems.push(`console ${message.type()}: ${message.text()}`);
      });
      page.on('response', (response) => {
        if (response.status() >= 400) problems.push(`HTTP ${response.status()}: ${response.url()}`);
      });
      await page.route('**/*', (route) => {
        const url = new URL(route.request().url());
        if (url.origin === own || url.protocol === 'data:') return route.continue();
        problems.push(`request outside the build: ${url.href}`);
        return route.abort();
      });
      await page.addInitScript(() => {
        window.print = () => {
          throw new Error('window.print is not available in the artifact');
        };
      });
      await use(problems);
      expect(problems, 'the page reported problems').toEqual([]);
    },
    { auto: true },
  ],
});

/** Only the fonts of the build: the two families have loaded faces, and none failed. */
async function expectOwnFonts(page: Page): Promise<void> {
  const fonts = await page.evaluate(async () => {
    await document.fonts.ready;
    return [...document.fonts].map((font) => ({ family: font.family.replace(/"/g, ''), status: font.status }));
  });
  expect(fonts.filter((font) => font.status === 'error')).toEqual([]);
  for (const family of ['Figtree Variable', 'Bricolage Grotesque Variable']) {
    expect(fonts.some((font) => font.family === family && font.status === 'loaded'), `${family} loaded`).toBe(true);
  }
}

/** Opens the palette with mod+k, waits for its input and types the query. */
async function palette(page: Page, query: string): Promise<void> {
  await page.keyboard.press('ControlOrMeta+k');
  await expect(page.getByRole('combobox', { name: 'Suchen oder Befehl eingeben' })).toBeFocused();
  await page.keyboard.type(query);
}

/** „Theme wechseln …“ in the palette, then the theme by its name. */
async function chooseTheme(page: Page, theme: 'Hell' | 'Dunkel' | 'System'): Promise<void> {
  await palette(page, 'Theme');
  await expect(page.getByRole('option', { name: 'Theme wechseln …' })).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('combobox', { name: 'Theme wechseln …' })).toBeFocused();
  await page.keyboard.type(theme);
  await expect(page.getByRole('option', { name: theme })).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('Enter');
}

test('starts on its hash routes with localStorage refused; navigation, palette, theme and the skip link work', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      get() {
        throw new DOMException('The document is sandboxed and lacks the "allow-same-origin" flag.', 'SecurityError');
      },
    });
  });

  await page.goto('/');
  await expect(page).toHaveURL(/#\/my-items$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Meine Items' })).toBeVisible();
  // the seed, in memory
  await expect(page.getByRole('list', { name: 'Items' }).getByRole('listitem').first()).toBeVisible();
  await expectOwnFonts(page);

  // the palette and a route in the hash
  await palette(page, 'WEB-47');
  await expect(page.getByRole('option', { name: /^WEB-47 / })).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/#\/items\/WEB-47$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Kontaktformular sendet doppelt' })).toBeVisible();

  // a sequence and a link of the sidebar
  await page.keyboard.press('g');
  await page.keyboard.press('i');
  await expect(page).toHaveURL(/#\/inbox$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Inbox' })).toBeVisible();
  await page.getByRole('navigation', { name: 'Seitenleiste' }).getByRole('link', { name: 'Bugs in Produktion' }).click();
  await expect(page).toHaveURL(/#\/views\/v_prod_bugs$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Bugs in Produktion' })).toBeVisible();

  // the theme, chosen in the palette: it holds until reload, as storage is refused
  await chooseTheme(page, 'Dunkel');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.locator('html')).toHaveAttribute('lang', 'de');

  // a reload stays on the route; data and theme start over
  await page.reload();
  await expect(page.getByRole('heading', { level: 1, name: 'Bugs in Produktion' })).toBeVisible();
  await expect(page.locator('html')).not.toHaveAttribute('data-theme', 'dark');

  // „Zum Inhalt“, the first stop of the page, moves the focus and keeps the route
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'Zum Inhalt' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('main')).toBeFocused();
  await expect(page).toHaveURL(/#\/views\/v_prod_bugs$/);
});

test('opens on a deep link and keeps what changes while storage works', async ({ page }) => {
  await page.goto('/#/projects/APP?layout=board');
  await expect(page.getByRole('heading', { level: 1, name: 'Kunden-App' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Todo', exact: true })).toBeVisible();

  await chooseTheme(page, 'Dunkel');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

  await page.reload();
  await expect(page.getByRole('region', { name: 'Todo', exact: true })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
});

test('runs in a sandboxed frame without an origin of its own', async ({ page }) => {
  await page.goto('/sandbox.html');
  const frame = page.frameLocator('iframe');
  await expect(frame.getByRole('heading', { level: 1, name: 'Meine Items' })).toBeVisible();
  // localStorage throws in there; the seed lives in memory
  await expect(frame.getByRole('list', { name: 'Items' }).getByRole('listitem').first()).toBeVisible();

  await frame.getByRole('navigation', { name: 'Seitenleiste' }).getByRole('link', { name: /^Inbox/ }).click();
  await expect(frame.getByRole('heading', { level: 1, name: 'Inbox' })).toBeVisible();
  const app = page.frames().find((candidate) => candidate !== page.mainFrame())!;
  expect(app.url()).toMatch(/#\/inbox$/);
  expect(await app.evaluate(() => window.origin)).toBe('null');

  await frame.getByRole('button', { name: 'Suchen …' }).click();
  await expect(frame.getByRole('combobox', { name: 'Suchen oder Befehl eingeben' })).toBeFocused();
  await page.keyboard.type('Seitenstruktur');
  await frame.getByRole('option', { name: 'Seitenstruktur Wiki WEB' }).click();
  await expect(frame.getByRole('article', { name: 'Seitenstruktur' })).toBeVisible();
  expect(app.url()).toMatch(/#\/projects\/WEB\/wiki\/pg_web_structure$/);
});
