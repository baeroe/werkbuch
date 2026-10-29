/*
 * Playwright: the flows of the clickdummy (e2e/flows.spec.ts) against a dev server of their own on port 5199, so a dev
 * server on 5173/5174 keeps running beside them. Every test starts in a fresh browser context: empty localStorage,
 * so the seed data and Mara Lindqvist as the signed-in person.
 *
 *   pnpm e2e                      all flows
 *   pnpm e2e -g "Flow 3"          one of them
 *
 * Chromium comes from Playwright's own cache (`pnpm exec playwright install chromium` once).
 */

import { defineConfig } from '@playwright/test';

const PORT = 5199;

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
    // the demo is German and lives in Berlin time; CI machines run in UTC
    locale: 'de-DE',
    timezoneId: 'Europe/Berlin',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  // no device preset: its user agent names Windows, and the app would read mod as Strg while ControlOrMeta presses ⌘ on
  // a Mac. With the browser's own user agent, the app and Playwright agree on the platform.
  projects: [{ name: 'chromium', use: { browserName: 'chromium', viewport: { width: 1440, height: 900 } } }],
  webServer: {
    command: `pnpm dev --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
