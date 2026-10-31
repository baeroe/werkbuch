/*
 * What the specs share: the texts of the app, the people of the seeders, the keyboard sign-in and the mails in Mailpit.
 */

import { execFileSync } from 'node:child_process';
import { createHash, createHmac } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { expect, request, test, type APIResponse, type Browser, type BrowserContext, type Locator, type Page } from '@playwright/test';

export const ROOT = path.resolve(import.meta.dirname, '..');

/** Session of the setup project (git-ignored), shared by every test that does not sign in itself. */
export const AUTH_FILE = path.join(import.meta.dirname, '.auth/user.json');

/** The sessions of `signedInContext()`, one file per account (`<email>.json`, git-ignored). */
const ACCOUNT_AUTH_DIR = path.join(import.meta.dirname, '.auth');

/** Before a run (global-setup.ts): the sessions of the accounts of the last run go, the seeder has set them back. */
export function forgetAccountSessions(): void {
  if (!existsSync(ACCOUNT_AUTH_DIR)) return;
  for (const file of readdirSync(ACCOUNT_AUTH_DIR)) {
    if (file.includes('@')) rmSync(path.join(ACCOUNT_AUTH_DIR, file));
  }
}

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
 * The people of database/seeders: the e2e account (org admin), four of the demo team (German profile; Mara is org admin,
 * Theo, Lene and Ida are members; Ida is in WEB, not in the private OPS), and per Playwright
 * project one account to reset the password, one for the password change and the 2FA setup (`security`) and one with
 * confirmed 2FA (`twoFactor`); every run sets them back.
 */
export const PEOPLE = {
  e2e: { email: 'e2e@example.com', password: E2E_PASSWORD, name: 'Erik Ende' },
  mara: { email: 'mara@feldwerk.example.com', password: DEMO_PASSWORD, name: 'Mara Lindqvist' },
  theo: { email: 'theo@feldwerk.example.com', password: DEMO_PASSWORD, name: 'Theo Okafor' },
  lene: { email: 'lene@feldwerk.example.com', password: DEMO_PASSWORD, name: 'Lene Vogt' },
  ida: { email: 'ida@feldwerk.example.com', password: DEMO_PASSWORD, name: 'Ida Brenner' },
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

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/**
 * The code an authenticator app shows for `secret` (Base32) at `at` (RFC 6238: HMAC-SHA-1, 30 seconds, six digits), e.g.
 * for the two-factor accounts of the seeder (`PEOPLE.twoFactor[…].secret`).
 */
export function totp(secret: string, at = Date.now()): string {
  const bits = [...secret.replace(/=+$/, '').toUpperCase()]
    .map((char) => {
      const value = BASE32.indexOf(char);
      if (value < 0) throw new Error(`"${char}" is no Base32 character`);
      return value.toString(2).padStart(5, '0');
    })
    .join('');
  const key = Buffer.from((bits.match(/.{8}/g) ?? []).map((byte) => parseInt(byte, 2)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(at / 30_000)));
  const hmac = createHmac('sha1', key).update(counter).digest();
  const offset = hmac[hmac.length - 1]! & 0x0f;
  return String((hmac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).padStart(6, '0');
}

/**
 * A browser context of its own, signed in as `person`, with the settings of the running project (address, viewport,
 * language, time zone, color scheme) and the clipboard. The first time an account signs in during a run, the cache is
 * emptied first (sign-in is limited per IP); its session is kept in `e2e/.auth/<email>.json`, so later specs use it
 * without signing in again. Close it at the end of the test.
 */
export async function signedInContext(browser: Browser, person: { email: string; password: string }): Promise<BrowserContext> {
  const { baseURL, ignoreHTTPSErrors, viewport, locale, timezoneId, colorScheme } = test.info().project.use;
  const options = { baseURL, ignoreHTTPSErrors, viewport, locale, timezoneId, colorScheme, permissions: ['clipboard-read', 'clipboard-write'] };
  const file = path.join(ACCOUNT_AUTH_DIR, `${person.email}.json`);
  if (existsSync(file)) return browser.newContext({ ...options, storageState: file });

  artisan('cache:clear');
  // without a state of its own, Playwright hands a new context the one of the project (the e2e person's session)
  const context = await browser.newContext({ ...options, storageState: { cookies: [], origins: [] } });
  const page = await context.newPage();
  await page.goto('/login');
  await login(page, person.email, person.password);
  await expect(page).toHaveURL(/\/my-items$/);
  await context.storageState({ path: file });
  await page.close();
  return context;
}

/**
 * Presses `mod+<key>` as the app reads it: ⌘ where the page takes itself for a Mac, Ctrl elsewhere. The page decides by
 * its own platform (`lib/platform.ts`), and Playwright's desktop devices pass for Windows even on a Mac, so the host's
 * `ControlOrMeta` can miss.
 */
export async function pressMod(page: Page, key: string): Promise<void> {
  const mac = await page.evaluate(() =>
    /mac|iphone|ipad|ipod/i.test((navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform || navigator.platform || ''),
  );
  await page.keyboard.press(`${mac ? 'Meta' : 'Control'}+${key}`);
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

/**
 * Opens the drawer of the top bar on the phone, where the sidebar lives; on the desktop the sidebar is there already.
 * `backwards` tabs up to the menu from a place further down the page.
 */
export async function openNavigation(page: Page, locale: Locale, { backwards = false } = {}): Promise<Locator> {
  if (!isPhone(page)) return page.getByRole('navigation', { name: tr(locale, 'shell.sidebar.label') });
  await tabTo(page, page.getByRole('button', { name: tr(locale, 'shell.mobile.open_navigation') }), { backwards, max: 150 });
  await page.keyboard.press('Enter');
  const drawer = page.getByRole('dialog', { name: tr(locale, 'shell.mobile.navigation') });
  await expect(drawer).toBeVisible();
  return drawer;
}

/**
 * Creates a project with the keyboard only: "Create project" in the sidebar, the name, the identifier the dialog
 * suggests, ⌘↵. Answers the identifier. Name it `E2E …`: the e2e seeder removes those projects before every run.
 */
export async function createProjectFromSidebar(page: Page, name: string): Promise<string> {
  const navigation = await openNavigation(page, 'en');
  await tabTo(page, navigation.getByRole('link', { name: tr('en', 'shell.nav.create_project') }));
  await page.keyboard.press('Enter');

  const dialog = page.getByRole('dialog', { name: tr('en', 'projects.create.title') });
  await expect(dialog).toBeVisible();
  // the address asked for the dialog once and keeps nothing of it
  await expect(page).toHaveURL(/\/projects$/);
  const nameField = dialog.getByRole('textbox', { name: tr('en', 'projects.create.name') });
  await expect(nameField).toBeFocused();
  await page.keyboard.type(name);
  const identifier = await dialog.getByRole('textbox', { name: tr('en', 'projects.create.identifier') }).inputValue();
  expect(identifier, 'the suggestion of the dialog').toMatch(/^[A-Z][A-Z0-9]{1,9}$/);
  await expect(dialog.getByText(tr('en', 'projects.create.identifier_suggested'), { exact: false })).toBeVisible();

  await pressMod(page, 'Enter');
  await expect(page.getByText(tr('en', 'projects.created', { identifier }))).toBeVisible();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('list', { name: tr('en', 'projects.list_label') }).getByRole('listitem').filter({ hasText: name })).toBeVisible();
  return identifier;
}
