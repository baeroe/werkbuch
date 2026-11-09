import { mkdirSync } from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { expect, test } from '../fixtures';
import { allEntries, api, pressMod, tr } from '../helpers';
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
 * computes from now (the next runs of a schedule, the title of the next run) is answered for that day in the spec.
 *
 * Only helpers without `variant()` and `PEOPLE` (VARIANT_CODE, PEOPLE.inbox[variant()], createE2eProject …): they know
 * the four e2e projects, not docs-screenshots-<language>. A type check cannot tell; keep to `api`, `allEntries`, `tr`,
 * `pressMod`.
 */

const OUT = path.resolve(import.meta.dirname, '../../docs/public/screenshots');
const NOW = '2026-10-28T09:30:00+01:00';

/** Names of the demo data the shots open, in each language (database/seeders/Demo/Texts). */
const DEMO = {
  de: {
    item: 'Kontaktformular sendet doppelt',
    template: 'Wöchentliche Wartung',
    webhook: 'Deploy-Bot',
    table: 'Studio Nordlicht',
    timeline: 'Roadmap',
    page: 'Seitenstruktur',
    workflow: 'Agentur-Freigabe',
  },
  en: {
    item: 'Contact form sends twice',
    template: 'Weekly maintenance',
    webhook: 'Deploy bot',
    table: 'Studio Northlight',
    timeline: 'Roadmap',
    page: 'Page structure',
    workflow: 'Agency approval',
  },
} satisfies Record<DocsLocale, Record<string, string>>;

type Shot = {
  name: string;
  dark?: boolean;
  /** Only in these languages (the API reference has no German). */
  only?: DocsLocale;
  /** Opens the page and waits until it shows what the shot is about. */
  open(page: Page, locale: DocsLocale): Promise<void>;
};

/** The id of the entry of a list of the API whose `name` is `name`. */
async function idOf(page: Page, list: string, name: string): Promise<string> {
  const entry = (await allEntries(page, list)).find((row) => row.name === name);
  expect(entry, `${list} has no "${name}"`).toBeTruthy();
  return String(entry!.id);
}

type PageNode = { id: string; title: string; children: PageNode[] };

/** The id of the wiki page of WEB whose title is `title` (the tree of the API, every level). */
async function pageOf(page: Page, title: string): Promise<string> {
  const response = await api(page, 'GET', '/api/v1/projects/WEB/pages');
  expect(response.status(), await response.text()).toBe(200);
  const find = (nodes: PageNode[]): PageNode | undefined => nodes.map((node) => (node.title === title ? node : find(node.children))).find(Boolean);
  const found = find(((await response.json()) as { data: PageNode[] }).data);
  expect(found, `WEB has no page "${title}"`).toBeTruthy();
  return found!.id;
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
  {
    // my items as a list, grouped by status (by category: Mara's items run through two workflows)
    name: 'my-items',
    open: async (page) => {
      await page.goto('/my-items');
      await expect(page.locator('[data-nav-target]').filter({ hasText: 'APP-18' })).toBeVisible();
    },
  },
  {
    // the view of the client as a table with its properties
    name: 'table',
    open: async (page, locale) => {
      await page.goto('/views');
      await page.goto(`/views/${await idOf(page, 'views', DEMO[locale].table)}`);
      const grid = page.getByRole('grid');
      await expect(grid.getByRole('gridcell').filter({ hasText: 'WEB-47' })).toBeVisible();
    },
  },
  {
    // the roadmap: the epics on the timeline, today on the 28th
    name: 'timeline',
    open: async (page, locale) => {
      await page.goto('/views');
      await page.goto(`/views/${await idOf(page, 'views', DEMO[locale].timeline)}`);
      await expect(page.locator('[data-timeline-scroller]').getByText('WEB-30').first()).toBeVisible();
      await expect(page.locator('[data-layout-skeleton]')).toHaveCount(0);
    },
  },
  {
    // the inbox of Mara, three unread
    name: 'inbox',
    open: async (page, locale) => {
      await page.goto('/inbox');
      await expect(page.getByRole('article', { name: /WEB-42/ })).toBeVisible();
      await expect(page.getByRole('heading', { level: 1, name: tr(locale, 'inbox.title') })).toBeVisible();
    },
  },
  {
    // the page structure in the wiki of WEB, with its tree
    name: 'wiki',
    open: async (page, locale) => {
      await page.goto('/projects/WEB/wiki');
      await page.goto(`/projects/WEB/wiki/${await pageOf(page, DEMO[locale].page)}`);
      await expect(page.getByRole('textbox', { name: tr(locale, 'wiki.page.title_label') })).toHaveValue(DEMO[locale].page);
      await expect(page.getByRole('treeitem', { name: new RegExp(DEMO[locale].page) })).toBeVisible();
      // the reference to WEB-48 in the text is read
      await expect(page.locator('.rt-editor').getByText('WEB-48', { exact: true })).toBeVisible();
    },
  },
  {
    // the views of the team
    name: 'views',
    open: async (page, locale) => {
      await page.goto('/views');
      await expect(page.getByRole('link', { name: DEMO[locale].table, exact: true })).toBeVisible();
    },
  },
  {
    // the editor of the agency workflow with its matrix of transitions
    name: 'settings-workflow',
    open: async (page, locale) => {
      await page.goto('/settings/workflows');
      await page.goto(`/settings/workflows?workflow=${await idOf(page, 'workflows', DEMO[locale].workflow)}`);
      const matrix = page.getByRole('grid', { name: tr(locale, 'settings.workflows.matrix.label') });
      await expect(matrix).toBeVisible();
      // the matrix is the subject: it stands below the states, so the page scrolls to it
      await matrix.evaluate((grid) => grid.scrollIntoView({ block: 'center' }));
      await expect(matrix).toBeInViewport({ ratio: 1 });
    },
  },
  {
    // the automations of WEB, the demo's switched on
    name: 'automations',
    open: async (page, locale) => {
      await page.goto('/projects/WEB/settings/automations');
      await expect(page.getByRole('switch', { name: tr(locale, 'automations.auto_archive.title') })).toBeChecked();
    },
  },
  {
    // the API reference (Stoplight), in English only
    name: 'api-docs',
    only: 'en',
    open: async (page) => {
      await page.goto('/api/docs');
      await expect(page.getByText('werkbuch API').first()).toBeVisible();
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

    for (const shot of SHOTS.filter((shot) => !shot.only || shot.only === locale)) {
      test(shot.name, async ({ page }) => {
        for (const theme of shot.dark ? (['light', 'dark'] as const) : (['light'] as const)) {
          await page.emulateMedia({ colorScheme: theme });
          await shot.open(page, locale);
          // nothing loads any more, the fonts are in, neither a toast nor the banner of paused live updates stands
          await expect(page.locator('[aria-busy="true"]')).toHaveCount(0);
          await page.evaluate(() => document.fonts.ready);
          await expect(page.locator('.animate-toast-in')).toHaveCount(0);
          await expect(page.getByText(tr(locale, 'shell.live.paused_title'))).toHaveCount(0);
          await page.screenshot({
            path: path.join(OUT, locale, theme === 'light' ? `${shot.name}.png` : `${shot.name}-dark.png`),
            animations: 'disabled',
            caret: 'hide',
          });
        }
      });
    }
  });
}
