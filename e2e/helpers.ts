/*
 * What the specs share: the texts of the app, the people of the seeders, the keyboard sign-in and the mails in Mailpit.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, request, type Locator, type Page } from '@playwright/test';

export const ROOT = path.resolve(import.meta.dirname, '..');

/** Session of the setup project (git-ignored), shared by every test that does not sign in itself. */
export const AUTH_FILE = path.join(import.meta.dirname, '.auth/user.json');

/** Artisan of the app under test: `E2E_ARTISAN ?? 'ddev artisan'` (`php artisan` in CI). */
export function artisan(...args: string[]): void {
  const [command, ...prefix] = (process.env.E2E_ARTISAN ?? 'ddev artisan').split(/\s+/).filter(Boolean);
  execFileSync(command!, [...prefix, ...args], { cwd: ROOT, stdio: 'inherit' });
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

/** DemoSeeder::PASSWORD and E2eSeeder::PASSWORD (database/seeders). */
const DEMO_PASSWORD = 'werkbuch-demo';
const E2E_PASSWORD = 'e2e-password';

/** The people of database/seeders: the e2e account, two of the demo team (German profile), one reset account per project. */
export const PEOPLE = {
  e2e: { email: 'e2e@example.com', password: E2E_PASSWORD, name: 'Erik Ende' },
  mara: { email: 'mara@feldwerk.example.com', password: DEMO_PASSWORD, name: 'Mara Lindqvist' },
  theo: { email: 'theo@feldwerk.example.com', password: DEMO_PASSWORD, name: 'Theo Okafor' },
  reset: Object.fromEntries(
    ['desktop-light', 'desktop-dark', 'phone-light', 'phone-dark'].map((project) => [project, { email: `reset-${project}@example.com`, password: E2E_PASSWORD }]),
  ) as Record<string, { email: string; password: string }>,
};

/** Presses Tab until `target` has the focus (at most `max` times). */
export async function tabTo(page: Page, target: Locator, { max = 40, backwards = false } = {}): Promise<void> {
  for (let step = 0; step < max; step += 1) {
    if (await target.evaluate((element) => element === document.activeElement).catch(() => false)) return;
    await page.keyboard.press(backwards ? 'Shift+Tab' : 'Tab');
  }
  await expect(target).toBeFocused();
}

/** Presses `key` until `target` has the focus, e.g. arrows through a menu. */
export async function arrowTo(page: Page, target: Locator, key = 'ArrowDown', max = 12): Promise<void> {
  for (let step = 0; step < max; step += 1) {
    if (await target.evaluate((element) => element === document.activeElement).catch(() => false)) return;
    await page.keyboard.press(key);
  }
  await expect(target).toBeFocused();
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

/** The mails of Mailpit, over its API. */
export const mailpit = {
  /** The newest mail to `email` that arrived after `after`, or null. */
  async latestTo(email: string, after: Date): Promise<{ html: string } | null> {
    const api = await request.newContext({ baseURL: MAILPIT_URL, ignoreHTTPSErrors: true });
    try {
      const search = await api.get('/api/v1/search', { params: { query: `to:"${email}"` } });
      expect(search.ok(), await search.text()).toBe(true);
      const { messages } = (await search.json()) as MailpitSearch;
      const latest = messages
        .map((message) => ({ id: message.ID, created: new Date(message.Created).getTime() }))
        .filter(({ created }) => created >= after.getTime())
        .sort((a, b) => b.created - a.created)[0];
      if (!latest) return null;
      const message = await api.get(`/api/v1/message/${latest.id}`);
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
