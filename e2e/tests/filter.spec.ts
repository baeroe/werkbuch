import type { Locator, Page } from '@playwright/test';
import { expect, test } from '../fixtures';
import { allEntries, arrowTo, createE2eProject, createItem, removeE2eProject, runId, tabTo, tr, variant } from '../helpers';

// The filter bar of an item list with the keyboard only, signed in as the e2e person (playwright.config.ts), in English.
// Every test only reads: they share one project (`E2E …`, removed after them) with a few items over the API, named per
// worker (a worker that starts again after a failure must not meet the identifier of the one before, still purging).

const name = (worker: number) => `E2E filter ${variant()} ${runId()} ${worker}`;

let shared: { id: string; identifier: string };
/** The label of the number property `effort` (Task has it), as the catalog names it. */
let effort: string;

test.beforeAll(async ({ browser }, workerInfo) => {
  const page = await browser.newPage();
  await page.goto('/my-items');
  shared = await createE2eProject(page, name(workerInfo.workerIndex), { types: ['Task'] });
  effort = String((await allEntries(page, 'properties')).find((entry) => entry.key === 'effort')!.label);
  const items = [
    { title: 'Login breaks', priority: 'urgent', values: { effort: 8 } },
    { title: 'Swap the logo', priority: 'high', values: { effort: 3 } },
    { title: 'Check the footer', priority: 'none' },
    { title: 'Form sends twice', priority: 'urgent' },
    { title: 'Rework the start page', priority: 'low' },
  ];
  for (const item of items) await createItem(page, { project_id: shared.id, ...item });
  await page.close();
});

test.afterAll(async ({ browser }) => {
  const page = await browser.newPage();
  await page.goto('/my-items');
  await removeE2eProject(page, shared.identifier);
  await page.close();
});

/** The row of an item by its title. */
const row = (page: Page, title: string) => page.getByRole('group', { name: new RegExp(`^${shared.identifier}-\\d+ ${title}`) });

/** The polite status region of the list, where a new result is announced. */
const announcer = (page: Page) => page.getByRole('status', { name: tr('en', 'items.announce.label') });

/** Opens the list of the shared project, all five items there, the focus nowhere in particular. */
async function openList(page: Page, query = '') {
  await page.goto(`/projects/${shared.identifier}${query}`);
  await expect(page.getByRole('combobox', { name: tr('en', 'items.filter.add.label') })).toBeVisible();
  if (query === '') await expect(row(page, 'Rework the start page')).toBeVisible();
}

/** Waits for the search field of an open list to have the focus, then types into it. */
async function typeInList(page: Page, list: string, text: string) {
  await expect(page.getByRole('combobox', { name: list })).toBeFocused();
  await page.keyboard.type(text);
}

async function expectRows(page: Page, shown: string[], hidden: string[]) {
  for (const title of shown) await expect(row(page, title)).toBeVisible();
  for (const title of hidden) await expect(row(page, title)).toHaveCount(0);
}

test('filters by priority with f', async ({ page }) => {
  await openList(page);
  await page.keyboard.press('f');
  await typeInList(page, tr('en', 'items.filter.add.search'), 'prio');
  await page.keyboard.press('Enter');
  await typeInList(page, tr('en', 'items.filter.value.search', { field: tr('en', 'items.filter.field.priority') }), 'urgent');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Escape');

  await expect(page.getByRole('group', { name: 'Filter: Priority is Urgent' })).toBeVisible();
  await expectRows(page, ['Login breaks', 'Form sends twice'], ['Swap the logo', 'Check the footer', 'Rework the start page']);
  await expect(announcer(page)).toHaveText(tr('en', 'items.announce.result.count.other', { count: '2' }));
});

test('filters by a property of the project', async ({ page }) => {
  await openList(page);
  await page.keyboard.press('f');
  await typeInList(page, tr('en', 'items.filter.add.search'), effort);
  await page.keyboard.press('Enter');
  // the number waits in its field; first the operator: "greater than"
  const field = page.getByRole('textbox', { name: `${effort} ${tr('en', 'items.filter.op.is')}` });
  await expect(field).toBeFocused();
  await tabTo(page, page.getByRole('button', { name: tr('en', 'items.filter.chip.operator', { operator: tr('en', 'items.filter.op.is') }) }), { backwards: true, max: 3 });
  await page.keyboard.press('Enter');
  await arrowTo(page, page.getByRole('menuitemradio', { name: tr('en', 'items.filter.op.gt') }));
  await page.keyboard.press('Enter');
  // the unfinished condition stays and asks for its value
  const greater = page.getByRole('textbox', { name: `${effort} ${tr('en', 'items.filter.op.gt')}` });
  await expect(greater).toBeFocused();
  await page.keyboard.type('5');
  await page.keyboard.press('Enter');

  await expect(page.getByRole('group', { name: `Filter: ${effort} greater than 5` })).toBeVisible();
  await expectRows(page, ['Login breaks'], ['Swap the logo', 'Check the footer', 'Form sends twice', 'Rework the start page']);
  await expect(announcer(page)).toHaveText(tr('en', 'items.announce.result.count.one'));
});

test('filters by title with /', async ({ page }) => {
  await openList(page);
  await page.keyboard.press('/');
  const search = page.getByRole('searchbox', { name: tr('en', 'items.filter.search.label') });
  await expect(search).toBeFocused();
  await page.keyboard.type('logo');
  await page.keyboard.press('Enter');
  await expectRows(page, ['Swap the logo'], ['Login breaks', 'Check the footer']);
  // the first Escape empties the search and shows every item again
  await page.keyboard.press('Escape');
  await expect(search).toHaveValue('');
  await expectRows(page, ['Login breaks', 'Check the footer'], []);
});

test('keeps the filter in the address and on reload', async ({ page }) => {
  await openList(page);
  await page.keyboard.press('/');
  await page.keyboard.type('the');
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\?filter=/);
  const filter = new URL(page.url()).searchParams.get('filter');
  expect(JSON.parse(filter!)).toEqual([{ field: 'title', op: 'contains', value: 'the' }]);
  await expectRows(page, ['Swap the logo', 'Check the footer', 'Rework the start page'], ['Login breaks', 'Form sends twice']);

  await page.reload();
  await expect(page.getByRole('searchbox', { name: tr('en', 'items.filter.search.label') })).toHaveValue('the');
  await expectRows(page, ['Swap the logo', 'Check the footer', 'Rework the start page'], ['Login breaks', 'Form sends twice']);
});

test('shows an empty state when nothing matches and offers to drop the filter', async ({ page }) => {
  const conditions = [{ field: 'priority', op: 'is', value: 'medium' }];
  await openList(page, `?filter=${encodeURIComponent(JSON.stringify(conditions))}`);
  await expect(page.getByText(tr('en', 'items.empty.filtered.title'), { exact: true })).toBeVisible();
  await expect(page.getByRole('group', { name: 'Filter: Priority is Medium' })).toBeVisible();
  const reset: Locator = page.getByRole('button', { name: tr('en', 'items.empty.filtered.reset') });
  await tabTo(page, reset, { max: 60 });
  await page.keyboard.press('Enter');
  await expectRows(page, ['Login breaks', 'Rework the start page'], []);
  await expect(page.getByRole('group', { name: /^Filter:/ })).toHaveCount(0);
  await expect(page).toHaveURL(new RegExp(`/projects/${shared.identifier}$`));
});
