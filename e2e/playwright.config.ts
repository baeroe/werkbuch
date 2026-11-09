import { defineConfig, devices } from '@playwright/test';
import { AUTH_FILE, docsAuthFile } from './helpers';

// The app runs in DDEV, Playwright on the Mac. WERKBUCH_URL points it at another instance, e.g. `php artisan serve` in
// CI (with MAILPIT_URL, E2E_ARTISAN and E2E_EXEC, see global-setup.ts and global-teardown.ts).
const baseURL = process.env.WERKBUCH_URL ?? 'https://werkbuch.ddev.site';

const desktop = { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } };

// Screenshots of the docs (docs/public/screenshots, committed): pnpm --dir e2e docs:screenshots, never in CI. Each
// language seeds its own demo, signs Mara in and takes its shots; the last project sets the e2e data back
// (tests/docs-seed.setup.ts). One project per language: date inputs follow the browser's UI language (--lang).
const DOCS = Boolean(process.env.DOCS_SCREENSHOTS);
const docsSeed = (language: 'de' | 'en', after: string[]) => ({
  name: `docs-seed-${language}`,
  testMatch: /docs-seed\.setup\.ts/,
  grep: new RegExp(`seed the ${language} demo`),
  dependencies: after,
});
const docsShots = (language: 'de' | 'en') => {
  const locale = language === 'de' ? 'de-DE' : 'en-GB';
  return {
    name: `docs-screenshots-${language}`,
    testMatch: /docs-screenshots\.spec\.ts/,
    grep: new RegExp(`docs-${language} `),
    dependencies: [`docs-seed-${language}`],
    use: {
      ...desktop,
      deviceScaleFactor: 1,
      colorScheme: 'light' as const,
      locale,
      storageState: docsAuthFile(language),
      launchOptions: { args: [`--lang=${locale}`] },
    },
  };
};
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
  projects: DOCS
    ? [
        { ...docsSeed('de', []), teardown: 'docs-reset' },
        docsShots('de'),
        docsSeed('en', ['docs-screenshots-de']),
        docsShots('en'),
        { name: 'docs-reset', testMatch: /docs-seed\.setup\.ts/, grep: /reset the e2e data/ },
      ]
    : [
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
          // the docs screenshots run only with DOCS_SCREENSHOTS (above)
          testIgnore: /\/docs-[a-z-]+\.(spec|setup)\.ts$/,
          use: { ...device, colorScheme, storageState: AUTH_FILE },
        })),
      ],
});
