import { defineConfig, devices } from '@playwright/test';
import { AUTH_FILE } from './helpers';

// The app runs in DDEV, Playwright on the Mac. WERKBUCH_URL points it at another instance, e.g. `php artisan serve` in
// CI (with MAILPIT_URL, E2E_ARTISAN and E2E_EXEC, see global-setup.ts and global-teardown.ts).
const baseURL = process.env.WERKBUCH_URL ?? 'https://werkbuch.ddev.site';

const desktop = { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } };
const phone = { ...devices['Desktop Chrome'], viewport: { width: 390, height: 844 } };

export default defineConfig({
  testDir: './tests',
  outputDir: './test-results',
  // one shared database: everything runs one after another
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: process.env.CI ? [['list'], ['github']] : [['list']],
  globalSetup: './global-setup.ts',
  globalTeardown: './global-teardown.ts',
  use: {
    baseURL,
    ignoreHTTPSErrors: true,
    locale: 'en-GB',
    timezoneId: 'Europe/Berlin',
    trace: 'retain-on-failure',
  },
  projects: [
    // signs the e2e person in once and keeps the session (sign-in is limited per IP)
    { name: 'setup', testMatch: /auth\.setup\.ts/ },
    ...(
      [
        ['desktop-light', desktop, 'light'],
        ['desktop-dark', desktop, 'dark'],
        ['phone-light', phone, 'light'],
        ['phone-dark', phone, 'dark'],
      ] as const
    ).map(([name, device, colorScheme]) => ({
      name,
      dependencies: ['setup'],
      use: { ...device, colorScheme, storageState: AUTH_FILE },
    })),
  ],
});
