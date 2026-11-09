import { expect, test as setup } from '@playwright/test';
import { artisan, docsAuthFile, login, schedulerDaemon, syncMutagen, type DocsLocale } from '../helpers';

/*
 * The data of the docs screenshots (pnpm --dir e2e docs:screenshots, playwright.config.ts with DOCS_SCREENSHOTS): the
 * development database is set up afresh with the demo of one language before its shots, and with the e2e data at the
 * end. Both demos have the same keys, so they never share a database; freshly seeded, the demo state is there
 * (automations on, templates scheduled, webhooks active), which the E2eSeeder would pause.
 *
 * The scheduler daemon of DDEV stops before the first seed and starts again after the e2e data (docs-reset is the
 * teardown of docs-seed-de and runs after a failure too; global-teardown.ts starts it once more). Running, it would act on
 * the demo between seeding and shot at a full hour: the reminder at 08:00 in Berlin, the prune of webhook deliveries and
 * of read notifications (older than 30 and 90 days, the demo lives in October 2026), a template at its time. Stopped, the
 * seed times stay as they are: they fit the browser's clock of the shots (2026-10-28), and nothing prunes them.
 *
 * No helper that reads `variant()` or `PEOPLE` here or in docs-screenshots.spec.ts: they know only the four e2e projects.
 */

/** Mara of each demo: she speaks the language of her data (PeopleSeeder), the password is DemoSeeder::PASSWORD. */
export const DOCS_PEOPLE: Record<DocsLocale, { email: string; password: string }> = {
  de: { email: 'mara@feldwerk.example.com', password: 'werkbuch-demo' },
  en: { email: 'mara@fieldwork.example.com', password: 'werkbuch-demo' },
};

const SEEDERS: Record<DocsLocale, string> = { de: 'DemoSeeder', en: 'DemoSeederEn' };

for (const locale of ['de', 'en'] as const) {
  setup(`seed the ${locale} demo`, async ({ page }) => {
    setup.setTimeout(180_000);
    // before the demo exists, so no scheduled command ever sees it (idempotent: en runs after de)
    schedulerDaemon('stop');
    artisan('migrate:fresh', '--force', '--seed', `--seeder=${SEEDERS[locale]}`, '--no-interaction');
    // the sign-in limits of earlier runs, and the cached organization of the other demo
    artisan('cache:clear');
    syncMutagen();

    await page.goto('/login');
    await login(page, DOCS_PEOPLE[locale].email, DOCS_PEOPLE[locale].password);
    await expect(page).toHaveURL(/\/my-items$/);
    await page.context().storageState({ path: docsAuthFile(locale) });
  });
}

setup('reset the e2e data', () => {
  setup.setTimeout(180_000);
  try {
    artisan('migrate:fresh', '--force', '--seed', '--seeder=E2eSeeder', '--no-interaction');
    artisan('cache:clear');
    syncMutagen();
  } finally {
    // after the E2eSeeder paused the demo's templates and automations (K9), also when seeding failed
    schedulerDaemon('start');
  }
});
