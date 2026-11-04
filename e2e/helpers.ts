/*
 * What the specs share: the texts of the app, the people of the seeders, the keyboard sign-in and the mails in Mailpit.
 */

import { execFileSync } from 'node:child_process';
import { createHash, createHmac } from 'node:crypto';
import { crc32, deflateSync } from 'node:zlib';
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
  mara: { email: 'mara@feldwerk.example.com', password: DEMO_PASSWORD, name: 'Mara Lindqvist', locale: 'de' as const },
  theo: { email: 'theo@feldwerk.example.com', password: DEMO_PASSWORD, name: 'Theo Okafor', locale: 'de' as const },
  lene: { email: 'lene@feldwerk.example.com', password: DEMO_PASSWORD, name: 'Lene Vogt', locale: 'de' as const },
  ida: { email: 'ida@feldwerk.example.com', password: DEMO_PASSWORD, name: 'Ida Brenner', locale: 'de' as const },
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
  /** One inbox per variant for the inbox and live specs (A289): the seeder empties it on every run. */
  inbox: Object.fromEntries(
    VARIANTS.map((project) => [project, { email: `inbox-${project}@example.com`, password: E2E_PASSWORD, name: `Inge Inbox ${project}`, locale: 'en' as const }]),
  ) as Record<string, { email: string; password: string; name: string; locale: 'en' }>,
};

/**
 * Five characters `[A-Z0-9]` from `Date.now()`, the same for the whole run (global setup draws it, the workers inherit
 * it through the environment): makes names and handles unique per run.
 */
export function runId(): string {
  process.env.E2E_RUN_ID ??= Date.now().toString(36).toUpperCase().slice(-5);
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
 * language, time zone, color scheme) and the clipboard, and its one page. The first time an account signs in during a
 * run, the cache is emptied first (sign-in is limited per IP); its session is kept in `e2e/.auth/<email>.json`, so later
 * specs use it without signing in again. The page of the sign-in stays the page of the test: closing the only page of a
 * fresh context and opening another can hang in Chromium (`Target.createTarget`). Close the context at the end of the
 * test.
 */
export async function signedInContext(
  browser: Browser,
  person: { email: string; password: string; locale?: 'de' | 'en' },
): Promise<{ context: BrowserContext; page: Page }> {
  const { baseURL, ignoreHTTPSErrors, viewport, locale, timezoneId, colorScheme } = test.info().project.use;
  const options = { baseURL, ignoreHTTPSErrors, viewport, locale, timezoneId, colorScheme, permissions: ['clipboard-read', 'clipboard-write'] };
  const file = path.join(ACCOUNT_AUTH_DIR, `${person.email}.json`);
  if (existsSync(file)) {
    const context = await browser.newContext({ ...options, storageState: file });
    return { context, page: await context.newPage() };
  }

  artisan('cache:clear');
  // without a state of its own, Playwright hands a new context the one of the project (the e2e person's session)
  const context = await browser.newContext({ ...options, storageState: { cookies: [], origins: [] } });
  const page = await context.newPage();
  await page.goto('/login');
  await login(page, person.email, person.password);
  await expect(page).toHaveURL(/\/my-items$/);
  // an account in another language than the sign-in page loads the page anew right after the visit: wait for that load,
  // or the test's first `goto` is interrupted by it
  await expect(page.locator('html')).toHaveAttribute('lang', person.locale ?? 'en');
  await context.storageState({ path: file });
  return { context, page };
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
  /** The IDs of every mail to `email` (with `subject`: only those whose subject holds it), newest first. */
  async idsTo(email: string, subject?: string): Promise<string[]> {
    const api = await request.newContext({ baseURL: MAILPIT_URL, ignoreHTTPSErrors: true });
    try {
      const query = `to:"${email}"${subject === undefined ? '' : ` subject:"${subject}"`}`;
      const search = await api.get('/api/v1/search', { params: { query } });
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

  /** The newest mail to `email` (with `subject`: whose subject holds it) whose ID is not in `before` (from `idsTo`), or null. */
  async newTo(email: string, before: readonly string[], subject?: string): Promise<{ html: string; subject: string } | null> {
    const id = (await mailpit.idsTo(email, subject)).find((candidate) => !before.includes(candidate));
    if (id === undefined) return null;
    const api = await request.newContext({ baseURL: MAILPIT_URL, ignoreHTTPSErrors: true });
    try {
      const message = await api.get(`/api/v1/message/${id}`);
      expect(message.ok(), await message.text()).toBe(true);
      const { HTML, Subject } = (await message.json()) as { HTML: string; Subject: string };
      return { html: HTML, subject: Subject };
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
  const { url, headers } = await sessionRequest(page, path);
  return page.request.fetch(url, { method, data: body, headers });
}

/** The address and the headers of a request in the page's session: JSON, the CSRF token of its cookie, a `Referer` (Sanctum). */
async function sessionRequest(page: Page, path: string): Promise<{ url: string; headers: Record<string, string> }> {
  const baseURL = test.info().project.use.baseURL!;
  const token = (await page.context().cookies(baseURL)).find((cookie) => cookie.name === 'XSRF-TOKEN');
  return {
    url: new URL(path, baseURL).toString(),
    headers: { Accept: 'application/json', Referer: `${baseURL}/`, ...(token && { 'X-XSRF-TOKEN': decodeURIComponent(token.value) }) },
  };
}

/** Every entry of a catalog (`labels`, `properties` …), following the cursor to the last page, so "not in the list" never passes on a first page. */
export async function allEntries(page: Page, path: string): Promise<Record<string, unknown>[]> {
  const entries: Record<string, unknown>[] = [];
  let cursor: string | null = null;
  do {
    const response = await api(page, 'GET', `/api/v1/${path}?per_page=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
    expect(response.status(), await response.text()).toBe(200);
    const body = (await response.json()) as { data: Record<string, unknown>[]; meta: { next_cursor: string | null } };
    entries.push(...body.data);
    cursor = body.meta.next_cursor;
  } while (cursor !== null);
  return entries;
}

/** Deletes the entries of a catalog whose name (or label) starts with `prefix`, whatever a spec left (cleanup in `finally`). */
export async function removeCatalogEntries(page: Page, path: string, field: 'name' | 'label', prefix: string): Promise<void> {
  for (const entry of (await allEntries(page, path)).filter((item) => String(item[field]).startsWith(prefix))) {
    const removed = await api(page, 'DELETE', `/api/v1/${path}/${String(entry.id)}`);
    // 200 with what happened (labels, types …), 204 without (workflows)
    expect([200, 204], await removed.text()).toContain(removed.status());
  }
}

/** A short code per Playwright project: keeps the identifiers of `createE2eProject()` within ten characters. */
const VARIANT_CODE: Record<string, string> = { 'desktop-light': 'A', 'desktop-dark': 'B', 'phone-light': 'C', 'phone-dark': 'D' };

/** Makes sure the context of the page has the CSRF cookie `api()` reads: a spec that has not loaded a page yet starts without it. */
async function ensureCsrfCookie(page: Page): Promise<void> {
  const baseURL = test.info().project.use.baseURL!;
  if ((await page.context().cookies(baseURL)).some((cookie) => cookie.name === 'XSRF-TOKEN')) return;
  const response = await page.request.get(new URL('/sanctum/csrf-cookie', baseURL).toString(), { headers: { Referer: `${baseURL}/` } });
  expect(response.status(), await response.text()).toBe(204);
}

/** The id of the catalog entry named `name` (`workflows`, `work-item-types`), failing with the names there are. */
async function catalogId(page: Page, path: string, name: string): Promise<string> {
  const entries = await allEntries(page, path);
  const entry = entries.find((item) => item.name === name);
  if (!entry) throw new Error(`No entry "${name}" in ${path}; there are ${entries.map((item) => String(item.name)).join(', ')}`);
  return String(entry.id);
}

/** How many identifiers createE2eProject tries for one name before it gives up. */
const MAX_IDENTIFIER_ATTEMPTS = 10;

/**
 * The identifier of the `attempt`-th try for a project name: `E<run><variant>` and three Base36 characters of a hash of
 * the name (and the attempt from the second try on). Ten characters at most, a letter first.
 */
export function e2eIdentifier(name: string, attempt: number): string {
  const hash = createHash('sha1').update(attempt === 0 ? name : `${name}#${attempt}`).digest('hex').slice(0, 8);
  return `E${runId()}${VARIANT_CODE[variant()]}${parseInt(hash, 16).toString(36).toUpperCase().slice(-3).padStart(3, '0')}`;
}

/**
 * Creates a project for a spec over the API, as the signed-in person: named `name` (start it with `E2E `, the e2e seeder
 * removes those projects before the next run), with an identifier of its own `E<run><variant><name hash>` (nine or ten
 * characters); it tries the next identifier while the one before is taken: three characters of a hash collide now and
 * then within a run and variant. The default workflow and every active type unless `options.workflow` (the name of a
 * workflow) and `options.types` (type names, the first is the default type) say otherwise; `options.visibility` is sent
 * only when set (the API creates public projects by default). Answers its id and identifier; clean up with
 * `removeE2eProject()` in a `finally`.
 */
export async function createE2eProject(
  page: Page,
  name: string,
  options: { workflow?: string; types?: string[]; visibility?: 'public' | 'private' } = {},
): Promise<{ id: string; identifier: string }> {
  // only `E2E …` projects are cleaned up after an aborted run (E2eSeeder); a name serves one project per run and variant
  if (!name.startsWith('E2E ')) throw new Error(`createE2eProject: "${name}" does not start with "E2E "`);
  await ensureCsrfCookie(page);
  const types = options.types && (await Promise.all(options.types.map((type) => catalogId(page, 'work-item-types', type))));
  const workflowId = options.workflow && (await catalogId(page, 'workflows', options.workflow));
  for (let attempt = 0; attempt < MAX_IDENTIFIER_ATTEMPTS; attempt++) {
    const response = await api(page, 'POST', '/api/v1/projects', {
      name,
      identifier: e2eIdentifier(name, attempt),
      ...(workflowId && { workflow_id: workflowId }),
      ...(types && { enabled_type_ids: types, default_type_id: types[0] }),
      ...(options.visibility && { visibility: options.visibility }),
    });
    if (response.status() === 422) {
      const body = (await response.json()) as { errors?: Record<string, unknown> };
      if (body.errors?.identifier) continue;
      expect(response.status(), JSON.stringify(body)).toBe(201);
    }
    expect(response.status(), await response.text()).toBe(201);
    const { data } = (await response.json()) as { data: { id: string; identifier: string } };
    return { id: data.id, identifier: data.identifier };
  }
  throw new Error(`createE2eProject: no free identifier for "${name}" after ${MAX_IDENTIFIER_ATTEMPTS} tries`);
}

/**
 * Creates a work item over the API (`POST /api/v1/work-items`, the fields of its input: `project_id`, `type_id`, `title`,
 * `description`, `assignee_id`, `priority`, `label_ids`, `start_date`, `due_date`, `parent_id`, `values`, `state_id`);
 * answers its id and key.
 */
export async function createItem(page: Page, input: Record<string, unknown>): Promise<{ id: string; key: string }> {
  await ensureCsrfCookie(page);
  const response = await api(page, 'POST', '/api/v1/work-items', input);
  expect(response.status(), await response.text()).toBe(201);
  const { data } = (await response.json()) as { data: { id: string; key: string } };
  return { id: data.id, key: data.key };
}

/**
 * Deletes a project of a spec with its items (cleanup in `finally`): the answer is 202, the purge runs in the queue; a
 * project that is gone already (404) is fine.
 */
export async function removeE2eProject(page: Page, identifier: string): Promise<void> {
  await ensureCsrfCookie(page);
  const response = await api(page, 'DELETE', `/api/v1/projects/${identifier}`);
  expect([202, 404], await response.text()).toContain(response.status());
}

/**
 * Saves a view for a spec over the API, as the signed-in person: named `E2E <variant> <run> <name>` (the e2e seeder
 * removes those views before the next run), with the filter and display given, else none and a list grouped by
 * status. Answers its id; clean up with `removeE2eView()` in a `finally`.
 */
export async function createE2eView(
  page: Page,
  input: { name: string; filter?: { version: 1; conditions: readonly unknown[] }; display?: Record<string, unknown> },
): Promise<{ id: string }> {
  await ensureCsrfCookie(page);
  const response = await api(page, 'POST', '/api/v1/views', {
    name: `E2E ${variant()} ${runId()} ${input.name}`.slice(0, 60),
    icon: 'list-todo',
    filter: input.filter ?? { version: 1, conditions: [] },
    display: input.display ?? { layout: 'list', group_by: 'state', sort: { field: 'rank', direction: 'asc' }, fields: ['key', 'state', 'priority'], show_sub_items: true },
  });
  expect(response.status(), await response.text()).toBe(201);
  const { data } = (await response.json()) as { data: { id: string } };
  return { id: data.id };
}

/** Deletes a view of a spec (cleanup in `finally`): 204, or 404 for one that is gone already. */
export async function removeE2eView(page: Page, id: string): Promise<void> {
  await ensureCsrfCookie(page);
  const response = await api(page, 'DELETE', `/api/v1/views/${id}`);
  expect([204, 404], await response.text()).toContain(response.status());
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
 * suggests, the default workflow and the active types it preselects, ⌘↵. Answers the identifier. Name it `E2E …`: the
 * e2e seeder removes those projects before every run.
 */
export async function createProjectFromSidebar(page: Page, name: string): Promise<string> {
  const navigation = await openNavigation(page, 'en');
  await tabTo(page, navigation.getByRole('link', { name: tr('en', 'shell.nav.create_project') }));
  await page.keyboard.press('Enter');

  const dialog = page.getByRole('dialog', { name: tr('en', 'projects.create.title') });
  await expect(dialog).toBeVisible();
  // the address asked for the dialog once and keeps nothing of it
  await expect(page).toHaveURL(/\/projects$/);
  // the form waits for the workflows and types, then the name takes the focus
  await expect(dialog.getByRole('combobox', { name: new RegExp(`^${tr('en', 'projects.create.workflow')}`) })).toBeVisible();
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

/**
 * A word of eight lowercase letters that is the same for every item of this run and variant (the variants share one
 * search index): derived from `sha1(runId:variant)`, digits mapped to letters so Meilisearch reads it as one word.
 */
export function searchToken(): string {
  const hex = createHash('sha1').update(`${runId()}:${variant()}`).digest('hex').slice(0, 8);
  return hex.replace(/[0-9]/g, (digit) => 'ghijklmnop'[Number(digit)]);
}

export type SearchData = {
  items: { id: string; key: string; title: string }[];
  projects: { id: string; identifier: string }[];
  people: { id: string }[];
  views: { id: string }[];
  key_match: string | null;
};

/** Asks `GET /api/v1/search?q=` every 250 ms until `found` holds (the index follows the queue); fails with the last answer. */
export async function waitForSearch(page: Page, q: string, found: (data: SearchData) => boolean, timeout = 20_000): Promise<SearchData> {
  const until = Date.now() + timeout;
  let last: SearchData | string = 'no answer';
  for (;;) {
    const response = await api(page, 'GET', `/api/v1/search?q=${encodeURIComponent(q)}`);
    if (response.status() === 200) {
      const body = (await response.json()) as { data: SearchData };
      last = body.data;
      if (found(last)) return last;
    } else {
      last = `${response.status()} ${await response.text()}`;
    }
    if (Date.now() > until) throw new Error(`waitForSearch "${q}" found nothing after ${timeout} ms: ${JSON.stringify(last)}`);
    await page.waitForTimeout(250);
  }
}

/** A notification as `GET /api/v1/notifications` gives it (the fields the specs read). */
export type StoredNotification = {
  id: string;
  event: string;
  work_item_id: string | null;
  project_id: string | null;
  actor_id: string | null;
  data: Record<string, unknown>;
  read_at: string | null;
  mailed_at: string | null;
};

/**
 * Asks `GET /api/v1/notifications` of the signed-in person of `page` every 250 ms until one of the newest 100 matches
 * `found` (notifications follow the queue `notifications`) and returns it; fails with the last answer.
 */
export async function waitForNotification(page: Page, found: (notification: StoredNotification) => boolean, timeout = 20_000): Promise<StoredNotification> {
  const until = Date.now() + timeout;
  let last: StoredNotification[] | string = 'no answer';
  for (;;) {
    const response = await api(page, 'GET', '/api/v1/notifications?per_page=100');
    if (response.status() === 200) {
      last = ((await response.json()) as { data: StoredNotification[] }).data;
      const match = last.find(found);
      if (match) return match;
    } else {
      last = `${response.status()} ${await response.text()}`;
    }
    if (Date.now() > until) throw new Error(`waitForNotification found nothing after ${timeout} ms: ${JSON.stringify(last)}`);
    await page.waitForTimeout(250);
  }
}

/** A file a spec hands to the page or the API: its name, type and content. */
export type TestFile = { name: string; type: string; bytes: Buffer };

/** A PNG of `width` × `height` pixels in memory (RGB, a colour that changes along the rows), e.g. for `pasteFile()`. */
export function pngBytes(width: number, height: number): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([length, body, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  // eight bits per channel, colour type 2 (RGB), no interlace
  header.set([8, 2, 0, 0, 0], 8);
  // every row starts with filter byte 0
  const rows = Buffer.alloc(height * (width * 3 + 1));
  for (let y = 0; y < height; y += 1) {
    const start = y * (width * 3 + 1);
    for (let x = 0; x < width; x += 1) rows.set([40, (y * 255) / Math.max(height - 1, 1), 160], start + 1 + x * 3);
  }
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', header), chunk('IDAT', deflateSync(rows)), chunk('IEND', Buffer.alloc(0))]);
}

/**
 * Pastes `file` into `target` (an editor) as a browser does: a `paste` event whose clipboard holds the file and, with
 * `html`, that HTML as well (Chrome's "Copy image" brings `<img src>` along with the picture). jsdom knows no
 * ClipboardEvent, so pasting is only checked in Playwright.
 */
export async function pasteFile(target: Locator, file: TestFile & { html?: string }): Promise<void> {
  await target.evaluate(
    (element, { name, type, base64, html }) => {
      const data = new DataTransfer();
      data.items.add(new File([Uint8Array.from(atob(base64), (char) => char.charCodeAt(0))], name, { type }));
      if (html !== undefined) data.setData('text/html', html);
      element.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
    },
    { name: file.name, type: file.type, base64: file.bytes.toString('base64'), html: file.html },
  );
}

/**
 * Uploads `file` into a project over the API (`POST /api/v1/attachments`, multipart) with the session of the page:
 * `inline` for a text (it belongs to nobody until a text names it), `file` for the file list of `itemId`. Answers the
 * attachment's id.
 */
export async function uploadViaApi(page: Page, projectId: string, file: TestFile, kind: 'inline' | 'file' = 'inline', itemId?: string): Promise<{ id: string }> {
  await ensureCsrfCookie(page);
  const { url, headers } = await sessionRequest(page, '/api/v1/attachments');
  const response = await page.request.fetch(url, {
    method: 'POST',
    multipart: {
      project_id: projectId,
      kind,
      ...(itemId && { work_item_id: itemId }),
      file: { name: file.name, mimeType: file.type, buffer: file.bytes },
    },
    headers,
  });
  expect(response.status(), await response.text()).toBe(201);
  const { data } = (await response.json()) as { data: { id: string } };
  return { id: data.id };
}
