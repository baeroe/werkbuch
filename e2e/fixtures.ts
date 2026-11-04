/*
 * What every spec shares: the test with its guard against errors the page reports (as in the clickdummy), and the
 * collection of the frontend coverage of the Istanbul build (`pnpm build:coverage`, merged in global-teardown.ts).
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test as base, type Page } from '@playwright/test';
import { accountPageErrors, ROOT, watchPageErrors } from './helpers';

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
  /** The clipboard is there for every page, as in a browser a person uses: specs read what "Copy" put on it. */
  permissions: async ({}, use) => use(['clipboard-read', 'clipboard-write']),

  /**
   * Errors a test expects, e.g. the browser's note on a 404 the test asks for: each entry matches
   * `console error: <text> (<url>)`.
   */
  allowedErrors: async ({}, use) => use([]),

  /**
   * Fails the test on errors the page reports, and the pages of other people the test signed in (`signedInContext`,
   * `accountPageErrors`): console errors and uncaught exceptions, except the allowed ones.
   */
  pageErrors: [
    async ({ page, allowedErrors }, use) => {
      const errors: string[] = [];
      watchPageErrors(page, errors);
      // what a page of another person reported before this test (an earlier test, a beforeAll) is not this test's
      accountPageErrors.length = 0;
      await use(errors);
      expect(
        [...errors, ...accountPageErrors].filter((error) => !allowedErrors.some((allowed) => allowed.test(error))),
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
        // only documents of the app have counters and a storage: `about:blank` (where a spec leaves the app) has neither,
        // and reading its sessionStorage throws
        if (!location.protocol.startsWith('http')) return;
        window.addEventListener('pagehide', () => {
          if (!window.__coverage__) return;
          // sessionStorage holds about 5 MB: a larger `__coverage__` (the editor's) must turn the test red, not lose its
          // coverage silently. A console message during `pagehide` never reaches the test, so the failure is left as a
          // marker and the next document reports it.
          try {
            sessionStorage.setItem(key, JSON.stringify(window.__coverage__));
          } catch (error) {
            const reason = error instanceof Error ? error.message : String(error);
            try {
              sessionStorage.removeItem(key);
              sessionStorage.setItem(`${key}:failed`, reason);
            } catch {
              // the marker could not be written either: the only trace left is this message (it rarely reaches a test)
              console.error(`coverage stash exceeds sessionStorage: ${reason}`);
            }
          }
        });
        const failed = sessionStorage.getItem(`${key}:failed`);
        if (failed) {
          sessionStorage.removeItem(`${key}:failed`);
          console.error(`coverage stash exceeds sessionStorage: ${failed}`);
        }
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
