/*
 * What the specs share: the texts of the app, the people of the seeders, the keyboard sign-in and the mails in Mailpit.
 */

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, request, test, type APIResponse, type Locator, type Page } from '@playwright/test';

export const ROOT = path.resolve(import.meta.dirname, '..');

/** Session of the setup project (git-ignored), shared by every test that does not sign in itself. */
export const AUTH_FILE = path.join(import.meta.dirname, '.auth/user.json');

/** Artisan of the app under test: `E2E_ARTISAN ?? 'ddev artisan'` (`php artisan` in CI). */
export function artisan(...args: string[]): void {
  const [command, ...prefix] = (process.env.E2E_ARTISAN ?? 'ddev artisan').split(/\s+/).filter(Boolean);
  execFileSync(command!, [...prefix, ...args], { cwd: ROOT, stdio: 'inherit' });
}

/**
 * Against DDEV (`E2E_EXEC ?? 'ddev exec'` starts with `ddev`): waits until Mutagen has synced the Mac and the container
 * both ways. Mutagen syncs in the background, seconds late: right after `ddev exec pnpm build:coverage` the Mac may still
 * have the old public/build or none at all (Vite emptied it, the new files are on their way), and the coverage/e2e the
 * Mac writes reaches the container late. Elsewhere (CI, DDEV without Mutagen) it does nothing.
 */
export function syncMutagen(): void {
  if ((process.env.E2E_EXEC ?? 'ddev exec').split(/\s+/).find(Boolean) !== 'ddev') return;
  try {
    execFileSync('ddev', ['mutagen', 'sync'], { cwd: ROOT, stdio: 'ignore' });
  } catch {
    // no Mutagen: the files are there already
  }
}

export type Locale = 'en' | 'de';

const texts: Partial<Record<Locale, Record<string, string>>> = {};

/** The text of `key` in lang/<locale>.json with its `:params` filled in: the specs never copy a text of the UI. */
export function tr(locale: Locale, key: string, params: Record<string, string | number> = {}): string {
  texts[locale] ??= JSON.parse(readFileSync(path.join(ROOT, `lang/${locale}.json`), 'utf8')) as Record<string, string>;
  const text = texts[locale][key];
  if (text === undefined) throw new Error(`lang/${locale}.json has no key "${key}"`);
  return Object.entries(params).reduce((result, [name, value]) => result.replaceAll(`:${name}`, String(value)), text);
}

const frameworkTexts: Partial<Record<string, Record<string, string>>> = {};

/** The text of `key` in the framework group lang/<locale>/<group>.php (single-quoted strings, as Laravel writes them). */
export function trFramework(locale: Locale, group: string, key: string): string {
  const file = `lang/${locale}/${group}.php`;
  frameworkTexts[file] ??= Object.fromEntries(
    [...readFileSync(path.join(ROOT, file), 'utf8').matchAll(/'([\w.]+)'\s*=>\s*'((?:[^'\\]|\\.)*)'/g)].map(([, name, text]) => [
      name!,
      text!.replace(/\\(['\\])/g, '$1'),
    ]),
  );
  const text = frameworkTexts[file][key];
  if (text === undefined) throw new Error(`${file} has no key "${key}"`);
  return text;
}

/** DemoSeeder::PASSWORD, E2eSeeder::PASSWORD, E2eSeeder::TOTP_SECRET (database/seeders). */
const DEMO_PASSWORD = 'werkbuch-demo';
const E2E_PASSWORD = 'e2e-password';
const TOTP_SECRET = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP';

const VARIANTS = ['desktop-light', 'desktop-dark', 'phone-light', 'phone-dark'];

/** E2eSeeder::recoveryCodes(): eight codes `xxxxxxxxxx-xxxxxxxxxx`, derived from the name of the Playwright project. */
function recoveryCodes(project: string): string[] {
  return Array.from({ length: 8 }, (_, index) => {
    const hash = createHash('sha256').update(`${project}:${index + 1}`).digest('hex');
    return `${hash.slice(0, 10)}-${hash.slice(10, 20)}`;
  });
}

/**
 * The people of database/seeders: the e2e account (org admin), two of the demo team (German profile), and per Playwright
 * project one account to reset the password, one for the password change and the 2FA setup (`security`) and one with
 * confirmed 2FA (`twoFactor`); every run sets them back.
 */
export const PEOPLE = {
  e2e: { email: 'e2e@example.com', password: E2E_PASSWORD, name: 'Erik Ende' },
  mara: { email: 'mara@feldwerk.example.com', password: DEMO_PASSWORD, name: 'Mara Lindqvist' },
  theo: { email: 'theo@feldwerk.example.com', password: DEMO_PASSWORD, name: 'Theo Okafor' },
  reset: Object.fromEntries(VARIANTS.map((project) => [project, { email: `reset-${project}@example.com`, password: E2E_PASSWORD }])) as Record<
    string,
    { email: string; password: string }
  >,
  security: Object.fromEntries(VARIANTS.map((project) => [project, { email: `security-${project}@example.com`, password: E2E_PASSWORD }])) as Record<
    string,
    { email: string; password: string }
  >,
  twoFactor: Object.fromEntries(
    VARIANTS.map((project) => [project, { email: `twofactor-${project}@example.com`, password: E2E_PASSWORD, secret: TOTP_SECRET, recoveryCodes: recoveryCodes(project) }]),
  ) as Record<string, { email: string; password: string; secret: string; recoveryCodes: string[] }>,
};

/**
 * Five characters `[A-Z0-9]` from `Date.now()`, the same for the whole run (global setup draws it, the workers inherit
 * it through the environment): makes names and handles unique per run.
 */
export function runId(): string {
  process.env.E2E_RUN_ID ??= Date.now().toString(36).toUpperCase().slice(-5).padStart(5, '0');
  return process.env.E2E_RUN_ID;
}

/** The name of the Playwright project of the running test, e.g. `desktop-light`. */
export function variant(): string {
  return test.info().project.name;
}

/**
 * Whether `target` has the focus once the focus has settled. Base UI moves the focus one animation frame late (floating-ui's
 * `enqueueFocus`): into a menu that just opened, and to the first item when the arrows wrap around. Read at once,
 * `document.activeElement` is still the element before, and the next key would skip past the target.
 */
async function focusSettledOn(page: Page, target: Locator): Promise<boolean> {
  // two frames: the first one runs the focus Base UI queued, the second one comes after it
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  return target.evaluate((element) => element === document.activeElement).catch(() => false);
}

/** Presses `key` until `target` has the focus (at most `max` times), checking only once the focus has settled. */
async function pressUntilFocused(page: Page, target: Locator, key: string, max: number): Promise<void> {
  for (let step = 0; step < max; step += 1) {
    if (await focusSettledOn(page, target)) return;
    await page.keyboard.press(key);
  }
  await expect(target).toBeFocused();
}

/** Presses Tab until `target` has the focus (at most `max` times). */
export async function tabTo(page: Page, target: Locator, { max = 40, backwards = false } = {}): Promise<void> {
  await pressUntilFocused(page, target, backwards ? 'Shift+Tab' : 'Tab', max);
}

/** Presses `key` until `target` has the focus, e.g. arrows through a menu. */
export async function arrowTo(page: Page, target: Locator, key = 'ArrowDown', max = 12): Promise<void> {
  await pressUntilFocused(page, target, key, max);
}

/** Signs in on the open sign-in page with the keyboard only: Tab into the address, type, Tab, type, Enter. */
export async function login(page: Page, email: string, password: string): Promise<void> {
  const emailField = page.locator('input[name="email"]');
  await tabTo(page, emailField);
  await page.keyboard.type(email);
  await page.keyboard.press('Tab');
  await expect(page.locator('input[name="password"]')).toBeFocused();
  await page.keyboard.type(password);
  await page.keyboard.press('Enter');
}

const MAILPIT_URL = process.env.MAILPIT_URL ?? 'https://werkbuch.ddev.site:8026';

type MailpitSearch = { messages: { ID: string; Created: string }[] };

/**
 * The mails of Mailpit, over its API. Nothing compares times: the clock of the Mac and the one of the containers may
 * differ, so a mail counts as new when its ID was not there before.
 */
export const mailpit = {
  /** The IDs of every mail to `email`, newest first. */
  async idsTo(email: string): Promise<string[]> {
    const api = await request.newContext({ baseURL: MAILPIT_URL, ignoreHTTPSErrors: true });
    try {
      const search = await api.get('/api/v1/search', { params: { query: `to:"${email}"` } });
      expect(search.ok(), await search.text()).toBe(true);
      const { messages } = (await search.json()) as MailpitSearch;
      return messages
        .map((message) => ({ id: message.ID, created: new Date(message.Created).getTime() }))
        .sort((a, b) => b.created - a.created)
        .map(({ id }) => id);
    } finally {
      await api.dispose();
    }
  },

  /** The newest mail to `email` whose ID is not in `before` (from `idsTo`), or null. */
  async newTo(email: string, before: readonly string[]): Promise<{ html: string } | null> {
    const id = (await mailpit.idsTo(email)).find((candidate) => !before.includes(candidate));
    if (id === undefined) return null;
    const api = await request.newContext({ baseURL: MAILPIT_URL, ignoreHTTPSErrors: true });
    try {
      const message = await api.get(`/api/v1/message/${id}`);
      expect(message.ok(), await message.text()).toBe(true);
      const { HTML } = (await message.json()) as { HTML: string };
      return { html: HTML };
    } finally {
      await api.dispose();
    }
  },
};

/** Below md the sidebar lives in the drawer of the top bar. */
export function isPhone(page: Page): boolean {
  return (page.viewportSize()?.width ?? 1440) < 768;
}

/** Opens the profile menu of `name` with the keyboard (on the phone through the drawer). */
export async function openProfileMenu(page: Page, locale: Locale, name: string): Promise<Locator> {
  if (isPhone(page)) {
    await tabTo(page, page.getByRole('button', { name: tr(locale, 'shell.mobile.open_navigation') }));
    await page.keyboard.press('Enter');
    await expect(page.getByRole('dialog', { name: tr(locale, 'shell.mobile.navigation') })).toBeVisible();
  }
  await tabTo(page, page.getByRole('button', { name, exact: true }));
  await page.keyboard.press('Enter');
  const menu = page.getByRole('menu');
  await expect(menu).toBeVisible();
  return menu;
}

/** Signs out through the profile menu, with the keyboard only. */
export async function signOut(page: Page, locale: Locale, name: string): Promise<void> {
  const menu = await openProfileMenu(page, locale, name);
  await arrowTo(page, menu.getByRole('menuitem', { name: tr(locale, 'shell.profile.logout') }));
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/login$/);
}

/**
 * A call of the REST API with the session of the page (the cookies of its context, CSRF token from the cookie), so a
 * spec can set something up as the signed-in person without going through the screens. Sanctum treats the call as
 * coming from the app (stateful) because of the `Referer`.
 */
export async function api(page: Page, method: string, path: string, body?: unknown): Promise<APIResponse> {
  const baseURL = test.info().project.use.baseURL!;
  const token = (await page.context().cookies(baseURL)).find((cookie) => cookie.name === 'XSRF-TOKEN');
  return page.request.fetch(new URL(path, baseURL).toString(), {
    method,
    data: body,
    headers: { Accept: 'application/json', Referer: `${baseURL}/`, ...(token && { 'X-XSRF-TOKEN': decodeURIComponent(token.value) }) },
  });
}
