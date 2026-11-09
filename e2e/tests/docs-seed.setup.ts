import path from 'node:path';
import { expect, test as setup } from '@playwright/test';
import { artisan, login, syncMutagen } from '../helpers';

/*
 * The data of the docs screenshots (pnpm --dir e2e docs:screenshots, playwright.config.ts with DOCS_SCREENSHOTS): the
 * development database is set up afresh with the demo of one language before its shots, and with the e2e data at the
 * end. Both demos have the same keys, so they never share a database; freshly seeded, the demo state is there
 * (automations on, templates scheduled, webhooks active), which the E2eSeeder would pause. The scheduler daemon of DDEV
 * keeps running meanwhile: a template or the night may act on the demo between seeding and shot (accepted).
 *
 * No helper that reads `variant()` or `PEOPLE` here or in docs-screenshots.spec.ts: they know only the four e2e projects.
 */

export type DocsLocale = 'en' | 'de';

/** The session of Mara in the demo of a language (git-ignored, like the other sessions). */
export const docsAuthFile = (locale: DocsLocale): string => path.join(import.meta.dirname, `../.auth/docs-${locale}.json`);

/** Mara of each demo: she speaks the language of her data (PeopleSeeder), the password is DemoSeeder::PASSWORD. */
export const DOCS_PEOPLE: Record<DocsLocale, { email: string; password: string }> = {
  de: { email: 'mara@feldwerk.example.com', password: 'werkbuch-demo' },
  en: { email: 'mara@fieldwork.example.com', password: 'werkbuch-demo' },
};

const SEEDERS: Record<DocsLocale, string> = { de: 'DemoSeeder', en: 'DemoSeederEn' };

for (const locale of ['de', 'en'] as const) {
  setup(`seed the ${locale} demo`, async ({ page }) => {
    setup.setTimeout(180_000);
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
  artisan('migrate:fresh', '--force', '--seed', '--seeder=E2eSeeder', '--no-interaction');
  artisan('cache:clear');
  syncMutagen();
});
