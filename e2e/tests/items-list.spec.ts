import type { Page } from '@playwright/test';
import { expect, test } from '../fixtures';
import { allEntries, api, createE2eProject, createE2eView, createItem, isPhone, removeE2eProject, removeE2eView, runId, tabTo, tr, variant } from '../helpers';

// The item list of a project with the keyboard only, signed in as the e2e person (playwright.config.ts), in English.
// The tests that only read share one project (`E2E …`, removed after them) with 30 items over the API: 20 in Backlog
// (the start state), 10 in In Progress; the others work in a project of their own.

const name = (what: string) => `E2E list ${what} ${variant()} ${runId()}`;

/** The id of a state of the default workflow. */
async function stateOf(page: Page, state: string): Promise<string> {
  const workflow = (await allEntries(page, 'workflows')).find((entry) => entry.is_default === true) as { states: { id: string; name: string }[] };
  return workflow.states.find((entry) => entry.name === state)!.id;
}

/** A project with 30 items: "Item 1" … "Item 20" in Backlog, "Item 21" … "Item 30" in In Progress. */
async function projectWithItems(page: Page, what: string): Promise<{ id: string; identifier: string }> {
  const project = await createE2eProject(page, name(what), { types: ['Task'] });
  const progress = await stateOf(page, 'In Progress');
  for (let number = 1; number <= 30; number += 1) {
    await createItem(page, { project_id: project.id, title: `Item ${number}`, ...(number > 20 && { state_id: progress }) });
  }
  return project;
}

/** The heading of a group: its name, then its count as the server says it. */
const heading = (page: Page, group: string, count: number) =>
  page.getByRole('button', { name: new RegExp(`^${group}.*${tr('en', 'items.group.count.other', { count: String(count) })}`) });

/** The row of an item by its key. */
const row = (page: Page, key: string) => page.getByRole('group', { name: new RegExp(`^${key} `) });

/** Opens the list and puts the focus on its first row. */
async function openList(page: Page, identifier: string) {
  await page.goto(`/projects/${identifier}`);
  await expect(heading(page, 'Backlog', 20)).toBeVisible();
  await expect(row(page, `${identifier}-1`)).toBeVisible();
  await tabTo(page, row(page, `${identifier}-1`), { max: 80 });
}

// one project for the tests that only read it: every item created is an event the queue worker of DDEV handles one
// at a time, and a mail of another spec waits behind them. Named per worker: a worker that starts again after a failed
// test runs `beforeAll` once more, and the project of the first one would hold the identifier
let shared: { id: string; identifier: string; name: string };

test.beforeAll(async ({ browser }, workerInfo) => {
  const page = await browser.newPage();
  await page.goto('/my-items');
  const what = `shared ${workerInfo.workerIndex}`;
  shared = { ...(await projectWithItems(page, what)), name: name(what) };
  await page.close();
});

test.afterAll(async ({ browser }) => {
  // nothing to remove when beforeAll failed before the project existed
  if (!shared) return;
  const page = await browser.newPage();
  await page.goto('/my-items');
  await removeE2eProject(page, shared.identifier);
  await page.close();
});

test('lists the items of a project grouped by status, with the counts of the server', async ({ page }) => {
  const { identifier } = shared;
  await page.goto(`/projects/${identifier}`);
  await expect(page.getByRole('heading', { level: 1, name: shared.name })).toBeVisible();
  await expect(heading(page, 'Backlog', 20)).toBeVisible();
  await expect(heading(page, 'In Progress', 10)).toBeVisible();
  // the rows in their manual order
  await expect(row(page, `${identifier}-1`)).toBeVisible();
  await expect(row(page, `${identifier}-2`)).toBeVisible();
});

test('moves through the list with j and k, opens the preview with space and the page with Enter', async ({ page }) => {
  const { identifier } = shared;
  await openList(page, identifier);
  await page.keyboard.press('j');
  await expect(row(page, `${identifier}-2`)).toBeFocused();
  await page.keyboard.press('j');
  await page.keyboard.press('k');
  await expect(row(page, `${identifier}-2`)).toBeFocused();

  await page.keyboard.press(' ');
  const preview = page.getByRole('complementary', { name: tr('en', 'items.peek.label') });
  await expect(preview.getByRole('heading', { name: 'Item 2' })).toBeVisible();
  await page.keyboard.press('Escape');
  if (isPhone(page)) await page.keyboard.press('Escape');
  await expect(preview).toBeHidden();
  await expect(row(page, `${identifier}-2`)).toBeFocused();

  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(new RegExp(`/items/${identifier}-2$`));
  await expect(page.getByRole('heading', { level: 1, name: 'Item 2' })).toBeVisible();
});

test('collapses a group from the keyboard', async ({ page }) => {
  const { identifier } = shared;
  await openList(page, identifier);
  // ← goes to the heading of the row's group; Enter folds it and opens it again
  await page.keyboard.press('ArrowLeft');
  const backlog = heading(page, 'Backlog', 20);
  await expect(backlog).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(backlog).toHaveAttribute('aria-expanded', 'false');
  await expect(row(page, `${identifier}-1`)).toBeHidden();
  await page.keyboard.press('Enter');
  await expect(backlog).toHaveAttribute('aria-expanded', 'true');
  await expect(row(page, `${identifier}-1`)).toBeVisible();
});

test('switches to the board with 2 and back with 1, also in the address', async ({ page }) => {
  const { identifier } = shared;
  await openList(page, identifier);
  await page.keyboard.press('2');
  await expect(page).toHaveURL(new RegExp(`/projects/${identifier}\\?layout=board$`));
  const layouts = page.getByRole('group', { name: tr('en', 'items.screen.layout') }).filter({ visible: true });
  await expect(layouts.getByRole('button', { name: new RegExp(tr('en', 'items.layout.board')) })).toHaveAttribute('aria-pressed', 'true');

  // a reload keeps the layout of the address: the items stand as cards
  await page.reload();
  await expect(layouts.getByRole('button', { name: new RegExp(tr('en', 'items.layout.board')) })).toHaveAttribute('aria-pressed', 'true');
  const card = page.getByRole('article', { name: new RegExp(`^${identifier}-1 `) });
  await expect(card).toBeVisible();
  await tabTo(page, card, { max: 80 });

  await page.keyboard.press('1');
  await expect(page).toHaveURL(new RegExp(`/projects/${identifier}$`));
  await expect(layouts.getByRole('button', { name: new RegExp(tr('en', 'items.layout.list')) })).toHaveAttribute('aria-pressed', 'true');
  await expect(row(page, `${identifier}-1`)).toBeFocused();
});

test('opens a former identifier at the current address', async ({ page }) => {
  await page.goto('/my-items');
  const { identifier } = await createE2eProject(page, name('renamed'), { types: ['Task'] });
  const renamed = `${identifier.slice(0, -1)}${identifier.endsWith('X') ? 'Y' : 'X'}`;
  try {
    const response = await api(page, 'PATCH', `/api/v1/projects/${identifier}`, { identifier: renamed });
    expect(response.status(), await response.text()).toBe(200);
    await page.goto(`/projects/${identifier}?layout=board`);
    await expect(page).toHaveURL(new RegExp(`/projects/${renamed}\\?layout=board$`));
    await expect(page.getByRole('heading', { level: 1, name: name('renamed') })).toBeVisible();
  } finally {
    await removeE2eProject(page, renamed);
  }
});

test('switches between the lists of my items with their tabs', async ({ page }) => {
  await page.goto('/my-items');
  const tabs = page.getByRole('navigation', { name: tr('en', 'items.my.title') });
  await expect(tabs.getByRole('link', { name: tr('en', 'items.my.tab.assigned'), exact: true })).toHaveAttribute('aria-current', 'page');

  await tabTo(page, tabs.getByRole('link', { name: tr('en', 'items.my.tab.created'), exact: true }), { max: 80 });
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/created$/);
  await expect(tabs.getByRole('link', { name: tr('en', 'items.my.tab.created'), exact: true })).toHaveAttribute('aria-current', 'page');

  await tabTo(page, tabs.getByRole('link', { name: tr('en', 'items.my.tab.subscribed'), exact: true }), { max: 80 });
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/subscribed$/);
  await expect(tabs.getByRole('link', { name: tr('en', 'items.my.tab.subscribed'), exact: true })).toHaveAttribute('aria-current', 'page');
});

test('shows the items of a saved view', async ({ page }) => {
  await page.goto('/my-items');
  const project = await createE2eProject(page, name('view'), { types: ['Task'] });
  await createItem(page, { project_id: project.id, title: 'Item in view' });
  const view = await createE2eView(page, { name: 'list', filter: { version: 1, conditions: [{ field: 'project', op: 'is', value: project.id }] } });
  try {
    await page.goto(`/views/${view.id}`);
    await expect(page.getByRole('heading', { level: 1, name: `E2E ${variant()} ${runId()} list` })).toBeVisible();
    await expect(row(page, `${project.identifier}-1`)).toBeVisible();
  } finally {
    await removeE2eView(page, view.id);
    await removeE2eProject(page, project.identifier);
  }
});

test('shows the list with 44 px rows', async ({ page }) => {
  test.skip(!isPhone(page), 'the touch targets of the phone');
  const { identifier } = shared;
  await page.goto(`/projects/${identifier}`);
  const first = row(page, `${identifier}-1`);
  await expect(first).toBeVisible();
  expect((await first.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  expect((await heading(page, 'Backlog', 20).boundingBox())!.height).toBeGreaterThanOrEqual(44);
});
