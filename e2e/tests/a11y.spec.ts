import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { A11Y_EXCEPTIONS } from '../a11y-exceptions';
import { A11Y_PAGES, type A11yEntry, type A11yIds } from '../a11y-pages';
import { expect, test } from '../fixtures';
import { api, artisanEval, PEOPLE, runId, signedInContext, variant } from '../helpers';

/*
 * axe on every page and state of e2e/a11y-pages.ts (A441, K15): the rules of WCAG 2.2 AA (`best-practice` stays out, it
 * is no part of WCAG), after the exceptions of e2e/a11y-exceptions.ts. Motion is reduced: a fade still running would
 * read as low contrast. With A11Y_REPORT=<file> every violation (excepted or not) is appended there as a line of JSON,
 * for the list of findings.
 */

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

/** The ids of the demo per project; resolved once per worker and project (a failed test starts a new worker). */
const resolved = new Map<string, A11yIds>();

async function json<T>(page: Page, method: string, path: string, body?: unknown): Promise<T> {
  const response = await api(page, method, path, body);
  expect(response.ok(), `${method} ${path}: ${await response.text()}`).toBe(true);
  return (await response.json()) as T;
}

type Node = { id: string; title: string; children: Node[] };
const findPage = (nodes: Node[], title: string): Node | undefined =>
  nodes.reduce<Node | undefined>((found, node) => found ?? (node.title === title ? node : findPage(node.children, title)), undefined);

/** The ids of A11yIds but the invitation, over the API in the session of the page (before it has visited anything). */
async function ids(page: Page): Promise<A11yIds> {
  const known = resolved.get(variant());
  if (known) return known;
  expect((await page.request.get('/sanctum/csrf-cookie')).ok()).toBe(true);

  const views = await json<{ data: { id: string; name: string }[] }>(page, 'GET', '/api/v1/views?per_page=100');
  const view = views.data.find((entry) => !entry.name.startsWith('E2E '));
  const pages = await json<{ data: Node[] }>(page, 'GET', '/api/v1/projects/WEB/pages');
  const wikiPage = findPage(pages.data, 'Seitenstruktur');
  const templates = await json<{ data: { id: string; schedule: unknown }[] }>(page, 'GET', '/api/v1/projects/WEB/templates?lean=1');
  const template = templates.data.find((entry) => entry.schedule !== null);
  expect(view, 'a demo view').toBeDefined();
  expect(wikiPage, 'the demo page “Seitenstruktur” of WEB').toBeDefined();
  expect(template, 'a demo template of WEB with a schedule').toBeDefined();

  const found = { view: view!.id, wikiPage: wikiPage!.id, template: template!.id, invitation: '' };
  resolved.set(variant(), found);
  return found;
}

/** The address of the invitation of this project and run. */
const invitee = () => `a11y-${variant()}-${runId().toLowerCase()}@example.com`;

/** A fresh invitation link (in the session of the page, before it signs out). */
async function invite(page: Page): Promise<string> {
  const { link } = await json<{ link: string }>(page, 'POST', '/api/v1/invitations', { email: invitee(), org_role: 'member' });
  return link;
}

/** Takes the invitation away again: there is no route that deletes one, so over artisan. */
function uninvite(): void {
  expect(artisanEval(`App\\Models\\Invitation::query()->where('email', '${invitee()}')->delete(); echo 'removed';`)).toBe('removed');
}

/**
 * That the visit reached the page of the entry and not another one (the sign-in after a lost session, a 404 for an id,
 * a 403 for a link): the component Inertia rendered, and for a section of the settings its current link in the list of
 * sections (an unknown section shows "This section does not exist" with none current).
 */
async function reached(page: Page, entry: A11yEntry): Promise<void> {
  await expect.poll(() => page.evaluate(() => (window.history.state as { page?: { component?: string } } | null)?.page?.component ?? null), { message: `the page of ${entry.name}` }).toBe(entry.page);
  if (entry.section) await expect(page.locator(`a[aria-current="page"][href="${entry.section}"]`).first()).toBeAttached();
}

/** Waits until the page has drawn what it loads: no skeleton (`Skeleton`), nothing busy, the fonts there. */
async function settle(page: Page): Promise<void> {
  await page.waitForLoadState();
  await expect(page.locator('h1').first()).toBeVisible({ timeout: 15_000 });
  await expect.poll(() => page.locator('[aria-busy="true"], span.rounded-chip.bg-line[aria-hidden="true"]').count(), { timeout: 15_000 }).toBe(0);
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  });
}

type Violation = { rule: string; impact: string | null; help: string; target: string; html: string; excepted: boolean };

/** What axe finds on the page, each node with whether an exception covers it. */
async function violations(page: Page, entry: A11yEntry): Promise<Violation[]> {
  const results = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  const nodes = results.violations.flatMap((violation) =>
    violation.nodes.map((node) => ({
      rule: violation.id,
      impact: node.impact ?? violation.impact ?? null,
      help: violation.help,
      // a selector per frame and shadow root; the app has neither, so the last one is the element
      target: String(node.target.at(-1) ?? ''),
      html: node.html,
    })),
  );
  const exceptions = A11Y_EXCEPTIONS.filter((exception) => exception.pages === undefined || exception.pages.includes(entry.name)).map(({ rule, target }) => ({ rule, target }));
  const excepted = await page.evaluate(
    ({ nodes, exceptions }) =>
      nodes.map(({ rule, target }) => {
        const element = document.querySelector(target);
        return element !== null && exceptions.some((exception) => exception.rule === rule && element.closest(exception.target) !== null);
      }),
    { nodes: nodes.map(({ rule, target }) => ({ rule, target })), exceptions },
  );
  return nodes.map((node, index) => ({ ...node, excepted: excepted[index] }));
}

/** Appends the violations of an entry to A11Y_REPORT (one line of JSON each), when it is set. */
async function report(entry: A11yEntry, found: Violation[]): Promise<void> {
  const file = process.env.A11Y_REPORT;
  if (!file || found.length === 0) return;
  const { appendFileSync } = await import('node:fs');
  appendFileSync(file, found.map((violation) => JSON.stringify({ project: variant(), entry: entry.name, ...violation }) + '\n').join(''));
}

for (const entry of A11Y_PAGES) {
  test(`${entry.name} has no violation of WCAG 2.2 AA`, async ({ page, browser, allowedErrors }) => {
    test.skip(entry.projects !== undefined && !entry.projects.includes(variant()), 'states run in desktop-light, desktop-dark and phone-light (A441)');
    // the browser reports a page that answers 403 or 404 as a console error
    if (entry.status) allowedErrors.push(new RegExp(`status of ${entry.status} `));

    const known = await ids(page);
    const invitation = entry.invites ? await invite(page) : '';
    if (entry.guest) await page.context().clearCookies();
    const other = entry.person ? await signedInContext(browser, PEOPLE[entry.person]) : null;
    const target = other?.page ?? page;
    let failed = false;
    try {
      await target.emulateMedia({ reducedMotion: 'reduce' });
      if (entry.before) await entry.before(target);
      await target.goto(entry.path({ ...known, invitation }));
      await settle(target);
      await reached(target, entry);
      if (entry.state) {
        await entry.state(target);
        await settle(target);
      }

      const found = await violations(target, entry);
      await report(entry, found);
      const open = found.filter((violation) => !violation.excepted);
      expect(open.map((violation) => `${violation.rule} (${violation.impact}): ${violation.help}\n    ${violation.target}\n    ${violation.html.slice(0, 200)}`), `axe on ${entry.name}`).toEqual([]);
    } catch (error) {
      failed = true;
      throw error;
    } finally {
      // a failure of the clean-up never hides what axe found, and the second context closes either way
      try {
        if (entry.cleanup) await entry.cleanup(target);
        if (entry.invites) uninvite();
      } catch (error) {
        if (!failed) throw error;
        test.info().annotations.push({ type: 'cleanup failed', description: String(error) });
      } finally {
        await other?.context.close();
      }
    }
  });
}
