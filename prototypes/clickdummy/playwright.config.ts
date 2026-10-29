/*
 * Playwright, two projects, each with a server of its own:
 *   flows   the seven flows and the phone check (e2e/flows.spec.ts) against a dev server on port 5199, so a dev
 *           server on 5173/5174 keeps running beside them
 *   review  the review build (e2e/review.spec.ts): pnpm build:review, served statically on port 5198
 *           (scripts/serve.mjs) the way an artifact host serves it
 * Only the servers of the projects that run start: `--project flows` neither builds nor serves the review build.
 * Every test starts in a fresh browser context: empty localStorage, so the seed data and Mara Lindqvist signed in.
 *
 *   pnpm e2e                              both projects (CI)
 *   pnpm e2e:flows                        the flows (= pnpm e2e --project flows)
 *   pnpm e2e:review                       the review build (= pnpm e2e --project review)
 *   pnpm e2e:flows -g "Flow 3"            one flow
 *
 * Chromium comes from Playwright's own cache (`pnpm exec playwright install chromium` once).
 */

import { defineConfig } from '@playwright/test';

const DEV_PORT = 5199;
const REVIEW_PORT = 5198;

/**
 * The projects named on the command line: `--project flows`, `--project=review`, `--project flows review`. None named
 * means all of them run. The runner reads this file with its own arguments; workers have none, but they start no
 * servers either.
 */
function namedProjects(argv: readonly string[]): string[] {
  const names: string[] = [];
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg.startsWith('--project=')) names.push(arg.slice('--project='.length));
    else if (arg === '--project') for (let next = index + 1; next < argv.length && !argv[next].startsWith('-'); next += 1) names.push(argv[next]);
  }
  return names;
}
const named = namedProjects(process.argv);
const runs = (project: string) => named.length === 0 || named.includes(project);

// no device preset: its user agent names Windows, and the app would read mod as Strg while ControlOrMeta presses ⌘ on
// a Mac. With the browser's own user agent, the app and Playwright agree on the platform.
const browser = { browserName: 'chromium', viewport: { width: 1440, height: 900 } } as const;

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    // the demo is German and lives in Berlin time; CI machines run in UTC
    locale: 'de-DE',
    timezoneId: 'Europe/Berlin',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'flows', testMatch: 'flows.spec.ts', use: { ...browser, baseURL: `http://localhost:${DEV_PORT}` } },
    { name: 'review', testMatch: 'review.spec.ts', use: { ...browser, baseURL: `http://localhost:${REVIEW_PORT}` } },
  ],
  webServer: [
    ...(runs('flows')
      ? [
          {
            command: `pnpm dev --port ${DEV_PORT} --strictPort`,
            url: `http://localhost:${DEV_PORT}`,
            reuseExistingServer: false,
            timeout: 60_000,
          },
        ]
      : []),
    ...(runs('review')
      ? [
          {
            command: `pnpm build:review && node scripts/serve.mjs dist-review ${REVIEW_PORT}`,
            url: `http://localhost:${REVIEW_PORT}/sandbox.html`,
            reuseExistingServer: false,
            timeout: 180_000,
          },
        ]
      : []),
  ],
});
