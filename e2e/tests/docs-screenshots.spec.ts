import { mkdirSync } from 'node:fs';
import path from 'node:path';
import type { Locator, Page } from '@playwright/test';
import { expect, test } from '../fixtures';
import { allEntries, pressMod, tr } from '../helpers';
import type { DocsLocale } from './docs-seed.setup';

/*
 * Screenshots of the docs, committed under docs/public/screenshots/{en,de}/<name>.png: the demo data of each language
 * (DemoSeeder, DemoSeederEn; tests/docs-seed.setup.ts seeds them before the shots and the e2e data after), signed in as
 * Mara, 1440 × 900, light; a shot with `dark` also as <name>-dark.png. Run: pnpm --dir e2e docs:screenshots (it sets the
 * development database back afterwards and compresses the images, e2e/optimize-screenshots.sh); then look at every
 * image before committing it.
 *
 * The demo lives in October 2026: the browser's clock stands still at 2026-10-28 09:30 in Berlin (the "today" of the
 * seed), so "overdue", "today" and "3 hours ago" read the same on every run. The server keeps its own clock: what it
 * computes from now (the next runs of a schedule, the title of the next run) is answered for that day or masked.
 *
 * Only helpers without `variant()` and `PEOPLE` (VARIANT_CODE, PEOPLE.inbox[variant()], createE2eProject …): they know
 * the four e2e projects, not docs-screenshots-<language>. A type check cannot tell; keep to `api`, `allEntries`, `tr`,
 * `pressMod`.
 */

const OUT = path.resolve(import.meta.dirname, '../../docs/public/screenshots');
const NOW = '2026-10-28T09:30:00+01:00';

/** Names of the demo data the shots open, in each language (database/seeders/Demo/Texts). */
const DEMO = {
  de: { item: 'Kontaktformular sendet doppelt', template: 'Wöchentliche Wartung', webhook: 'Deploy-Bot' },
  en: { item: 'Contact form sends twice', template: 'Weekly maintenance', webhook: 'Deploy bot' },
} satisfies Record<DocsLocale, Record<string, string>>;

type Shot = {
  name: string;
  dark?: boolean;
  /** Opens the page and waits until it shows what the shot is about; returns what to mask. */
  open(page: Page, locale: DocsLocale): Promise<Locator[] | void>;
};

/** The id of the entry of a list of the API whose `name` is `name`. */
async function idOf(page: Page, list: string, name: string): Promise<string> {
  const entry = (await allEntries(page, list)).find((row) => row.name === name);
  expect(entry, `${list} has no "${name}"`).toBeTruthy();
  return String(entry!.id);
}

/**
 * The next runs of a schedule and the title of the next run come from the server's clock, which a spec cannot stop: on
 * the page of the weekly maintenance (Mondays 09:00 in Berlin) the preview answers what the server would have answered
 * at the browser's 2026-10-28 09:30. Any other schedule goes to the server.
 */
async function answerPreviewOnTheDayOfTheSeed(page: Page): Promise<void> {
  const monday = new Date('2026-11-02T08:00:00Z');
  const runs = [0, 7, 14, 21, 28].map((days) => new Date(monday.getTime() + days * 86_400_000).toISOString().replace('.000Z', '.000000Z'));
  const filled: Record<string, string> = { date: '2026-11-02', week: '45', month: '11', month_name: 'November', quarter: '4', year: '2026' };
  await page.route('**/api/v1/templates/preview', async (route) => {
    const body = route.request().postDataJSON() as { schedule?: { frequency?: string; weekdays?: number[]; time?: string; paused?: boolean }; title?: string };
    const schedule = body.schedule ?? {};
    if (schedule.frequency !== 'weekly' || schedule.time !== '09:00' || JSON.stringify(schedule.weekdays) !== '[1]' || schedule.paused) {
      return route.continue();
    }
    const title = typeof body.title === 'string' ? body.title.replace(/\{([a-z_]+)\}/g, (match, name: string) => filled[name] ?? match) : null;
    return route.fulfill({ json: { data: { runs, title } } });
  });
}

const SHOTS: Shot[] = [
  {
    // the board of WEB by status
    name: 'board',
    open: async (page) => {
      await page.goto('/projects/WEB?layout=board');
      await expect(page.locator('[data-card-id]').filter({ hasText: 'WEB-47' })).toBeVisible();
    },
  },
  {
    // WEB-47 with its description, relations and activity
    name: 'item',
    dark: true,
    open: async (page, locale) => {
      await page.goto('/items/WEB-47');
      await expect(page.locator('[data-item-title]')).toContainText(DEMO[locale].item);
      // the reference to WEB-42 in the description is read, the history and the comments are in
      await expect(page.locator('[data-item-detail]').getByText('WEB-42', { exact: true }).first()).toBeVisible();
      await expect(page.getByRole('list', { name: tr(locale, 'items.activity.list') }).getByRole('listitem').first()).toBeVisible();
    },
  },
  {
    // the palette with the search "WEB"
    name: 'palette',
    open: async (page, locale) => {
      await page.goto('/my-items');
      await expect(page.locator('[data-nav-target]').first()).toBeVisible();
      // the rail instead of the sidebar: its grain would carry the image over 400 KB, and the palette is the subject
      await page.getByRole('button', { name: tr(locale, 'shell.sidebar.collapse') }).click();
      await expect(page.getByRole('button', { name: tr(locale, 'shell.sidebar.expand') })).toBeVisible();
      await pressMod(page, 'k');
      const input = page.getByRole('combobox', { name: tr(locale, 'palette.input') });
      await expect(input).toBeFocused();
      await page.keyboard.type('WEB');
      const dialog = page.getByRole('dialog');
      await expect(dialog.getByRole('option', { name: /WEB-\d+/ }).first()).toBeVisible();
      await expect(dialog.getByText(tr(locale, 'palette.searching'))).toHaveCount(0);
    },
  },
  {
    // the editor of the weekly maintenance with its schedule, the template active
    name: 'templates',
    open: async (page, locale) => {
      await answerPreviewOnTheDayOfTheSeed(page);
      await page.goto('/projects/WEB/templates');
      const id = await idOf(page, 'projects/WEB/templates', DEMO[locale].template);
      await page.goto(`/projects/WEB/templates/${id}`);
      await expect(page.getByRole('heading', { level: 1, name: DEMO[locale].template })).toBeVisible();
      const runs = page.getByRole('list', { name: tr(locale, 'schedule.next.title') });
      await expect(runs.getByRole('listitem')).toHaveCount(5);
      await expect(page.getByRole('region', { name: tr(locale, 'templates.editor.preview.label') })).toContainText('45');
    },
  },
  {
    // the log of the deploy bot, the webhook active
    name: 'webhooks',
    open: async (page, locale) => {
      await page.goto('/settings/webhooks');
      const id = await idOf(page, 'webhooks', DEMO[locale].webhook);
      await page.goto(`/settings/webhooks?deliveries=${id}`);
      await expect(page.getByRole('heading', { name: tr(locale, 'settings.webhooks.deliveries_of', { name: DEMO[locale].webhook }) })).toBeVisible();
      await expect(page.getByText(tr(locale, 'settings.webhooks.log.resend'), { exact: true }).first()).toBeVisible();
    },
  },
];

for (const locale of ['de', 'en'] as const) {
  // project docs-screenshots-<locale> runs the group docs-<locale> (grep in playwright.config.ts)
  test.describe(`docs-${locale}`, () => {
    test.beforeAll(() => mkdirSync(path.join(OUT, locale), { recursive: true }));
    test.beforeEach(async ({ page }) => {
      await page.clock.setFixedTime(new Date(NOW));
    });

    for (const shot of SHOTS) {
      test(shot.name, async ({ page }) => {
        for (const theme of shot.dark ? (['light', 'dark'] as const) : (['light'] as const)) {
          await page.emulateMedia({ colorScheme: theme });
          const mask = (await shot.open(page, locale)) ?? [];
          // nothing loads any more, the fonts are in, neither a toast nor the banner of paused live updates stands
          await expect(page.locator('[aria-busy="true"]')).toHaveCount(0);
          await page.evaluate(() => document.fonts.ready);
          await expect(page.locator('.animate-toast-in')).toHaveCount(0);
          await expect(page.getByText(tr(locale, 'shell.live.paused_title'))).toHaveCount(0);
          await page.screenshot({
            path: path.join(OUT, locale, theme === 'light' ? `${shot.name}.png` : `${shot.name}-dark.png`),
            animations: 'disabled',
            caret: 'hide',
            mask,
          });
        }
      });
    }
  });
}
