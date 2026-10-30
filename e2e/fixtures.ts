/*
 * What every spec shares: the test with its guard against errors the page reports (as in the clickdummy), and the
 * collection of the frontend coverage of the Istanbul build (`pnpm build:coverage`, merged in global-teardown.ts).
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test as base, type Page } from '@playwright/test';
import { ROOT } from './helpers';

export { expect };

/** Off with E2E_COVERAGE=0, e.g. against a normal build. */
export const COVERAGE = process.env.E2E_COVERAGE !== '0';

const COVERAGE_DIR = path.join(ROOT, 'coverage/e2e');

type Coverage = Record<string, unknown>;

declare global {
  interface Window {
    __coverage__?: Coverage;
    __werkbuchCoverage?: (coverage: Coverage) => void;
  }
}

/** Where a document that unloads leaves its counters for the next one. */
const STASH = '__werkbuchCoverage';

type PageCoverage = { coverage: Coverage | null; left: Coverage | null };

/** `window.__coverage__` of a page and what an unloaded document left; once more after a navigation still running. */
async function coverageOf(page: Page): Promise<PageCoverage> {
  const read = () =>
    page.evaluate((key): PageCoverage => {
      const left = sessionStorage.getItem(key);
      sessionStorage.removeItem(key);
      return { coverage: window.__coverage__ ?? null, left: left ? (JSON.parse(left) as Coverage) : null };
    }, STASH);
  try {
    return await read();
  } catch {
    await page.waitForLoadState();
    return read();
  }
}

export const test = base.extend<{ allowedErrors: RegExp[]; pageErrors: string[]; coverage: void }>({
  /**
   * Errors a test expects, e.g. the browser's note on a 404 the test asks for: each entry matches
   * `console error: <text> (<url>)`.
   */
  allowedErrors: async ({}, use) => use([]),

  /** Fails the test on errors the page reports: console errors and uncaught exceptions, except the allowed ones. */
  pageErrors: [
    async ({ page, allowedErrors }, use) => {
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(`page error: ${error.message}`));
      page.on('console', (message) => {
        if (message.type() === 'error') errors.push(`console error: ${message.text()} (${message.location().url})`);
      });
      await use(errors);
      expect(
        errors.filter((error) => !allowedErrors.some((allowed) => allowed.test(error))),
        'the page reported errors',
      ).toEqual([]);
    },
    { auto: true },
  ],

  /**
   * Writes the coverage of every page of the app to coverage/e2e/<testId>-<n>.json: after the test, and for every
   * document a full reload replaced (its counters go with it). Such a document leaves its counters in sessionStorage on
   * `pagehide`; the next document hands them over through a binding (a binding call during the unload itself is lost).
   */
  coverage: [
    async ({ context, baseURL }, use, info) => {
      if (!COVERAGE) return use();

      let count = 0;
      const write = (coverage: Coverage) => {
        mkdirSync(COVERAGE_DIR, { recursive: true });
        writeFileSync(path.join(COVERAGE_DIR, `${info.testId}-${count++}.json`), JSON.stringify(coverage));
      };

      await context.exposeBinding('__werkbuchCoverage', (_source, coverage: Coverage) => write(coverage));
      await context.addInitScript((key) => {
        window.addEventListener('pagehide', () => {
          if (window.__coverage__) sessionStorage.setItem(key, JSON.stringify(window.__coverage__));
        });
        const left = sessionStorage.getItem(key);
        if (left) {
          sessionStorage.removeItem(key);
          window.__werkbuchCoverage?.(JSON.parse(left) as Coverage);
        }
      }, STASH);

      await use();

      for (const page of context.pages()) {
        if (!baseURL || !page.url().startsWith(baseURL)) continue;
        const { coverage, left } = await coverageOf(page);
        if (!coverage) throw new Error(`${page.url()} has no window.__coverage__: run \`ddev exec pnpm build:coverage\` first.`);
        write(coverage);
        if (left) write(left);
      }
    },
    { auto: true },
  ],
});
