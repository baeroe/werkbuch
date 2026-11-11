import type { Page } from '@playwright/test';
import { expect, test } from '../fixtures';
import { allEntries, createE2eProject, createItem, isPhone, pressMod, removeE2eProject, runId, tabTo, tr, variant } from '../helpers';

// The table of a project with the keyboard only, signed in as the e2e person (playwright.config.ts), in English. Each
// test works in a project of its own (`E2E …`, removed after it) with two items over the API.

const name = (what: string) => `E2E table ${what} ${variant()} ${runId()}`;

/** A cell of the grid: its item and its column (0 is the key and title). */
const cell = (page: Page, id: string, column: number) => page.locator(`[data-item-id="${id}"][data-column="${column}"]`);

/** Opens the table of a project with the fields given and puts the focus on the cell of the first item, its tab stop. */
async function openTable(page: Page, identifier: string, first: string, query: string) {
  await page.goto(`/projects/${identifier}?layout=table&${query}`);
  await expect(page.getByRole('grid', { name: tr('en', 'items.table.label') })).toBeVisible();
  await expect(cell(page, first, 0)).toHaveAttribute('tabindex', '0');
  await tabTo(page, cell(page, first, 0), { max: 80 });
}

test('edits the priority of an item in the table with the keyboard', async ({ page }) => {
  await page.goto('/my-items');
  const project = await createE2eProject(page, name('priority'), { types: ['Task'] });
  try {
    const login = await createItem(page, { project_id: project.id, title: 'Login form' });
    const reset = await createItem(page, { project_id: project.id, title: 'Password reset' });
    // sorted by priority: the item that becomes urgent moves to the top
    await openTable(page, project.identifier, login.id, 'fields=key,priority&sort=priority:asc');

    await page.keyboard.press('ArrowDown');
    await expect(cell(page, reset.id, 0)).toBeFocused();
    await page.keyboard.press('ArrowRight');
    await expect(cell(page, reset.id, 1)).toBeFocused();
    await page.keyboard.press('Enter');
    const search = page.getByPlaceholder(tr('en', 'items.fields.priority.placeholder'));
    await expect(search).toBeFocused();
    await page.keyboard.type('Urgent');
    await page.keyboard.press('Enter');

    // the row went to the top and its cell kept the focus, so the arrows go on from there
    await expect(cell(page, reset.id, 1)).toBeFocused();
    await expect(cell(page, reset.id, 1).getByRole('combobox', { name: `${tr('en', 'items.fields.priority.label')}: Urgent` })).toBeVisible();
    const rows = page.locator('tbody tr[aria-selected]');
    await expect(rows.first()).toContainText(reset.key);
    await page.keyboard.press('ArrowDown');
    await expect(cell(page, login.id, 1)).toBeFocused();

    // Escape leaves an editor and stays in the cell
    await page.keyboard.press('Enter');
    await expect(search).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(search).toHaveCount(0);
    await expect(cell(page, login.id, 1)).toBeFocused();

    // the server has it
    await page.reload();
    await expect(cell(page, reset.id, 1).getByRole('combobox', { name: `${tr('en', 'items.fields.priority.label')}: Urgent` })).toBeVisible();
  } finally {
    await removeE2eProject(page, project.identifier);
  }
});

test('jumps to the edges of the grid with Home, End and mod, and extends the selection with shift', async ({ page }) => {
  await page.goto('/my-items');
  const project = await createE2eProject(page, name('edges'), { types: ['Task'] });
  try {
    const items: { id: string; key: string }[] = [];
    for (const title of ['Login form', 'Password reset', 'Profile page']) items.push(await createItem(page, { project_id: project.id, title }));
    const [first, second, third] = [items[0]!, items[1]!, items[2]!];
    await openTable(page, project.identifier, first.id, 'fields=key,priority,assignee,due_date');

    // End and Home: the last and the first column of the row
    await page.keyboard.press('End');
    await expect(cell(page, first.id, 3)).toBeFocused();
    await page.keyboard.press('Home');
    await expect(cell(page, first.id, 0)).toBeFocused();
    // with mod: the last and the first row, in the same column
    await page.keyboard.press('ArrowRight');
    await pressMod(page, 'End');
    await expect(cell(page, third.id, 1)).toBeFocused();
    await pressMod(page, 'Home');
    await expect(cell(page, first.id, 1)).toBeFocused();

    // shift+↓ and shift+↑ grow the selection from the row of the cursor
    const bar = page.getByRole('group', { name: tr('en', 'items.bulk.label') });
    await page.keyboard.press('Shift+ArrowDown');
    await expect(cell(page, second.id, 1)).toBeFocused();
    await expect(bar).toContainText(`2 ${tr('en', 'items.bulk.of_total', { total: 3 })}`);
    await page.keyboard.press('Shift+ArrowDown');
    await expect(cell(page, third.id, 1)).toBeFocused();
    await expect(bar).toContainText(`3 ${tr('en', 'items.bulk.of_total', { total: 3 })}`);
    await page.keyboard.press('Escape');
    await expect(bar).toBeHidden();
    await page.keyboard.press('Shift+ArrowUp');
    await expect(cell(page, second.id, 1)).toBeFocused();
    await expect(bar).toContainText(`2 ${tr('en', 'items.bulk.of_total', { total: 3 })}`);
  } finally {
    await removeE2eProject(page, project.identifier);
  }
});

test('edits a property value in its cell', async ({ page }) => {
  await page.goto('/my-items');
  // a bug has the effort of the built-in catalog, and in the demo data a required environment
  const project = await createE2eProject(page, name('property'), { types: ['Bug'] });
  try {
    const catalog = (await allEntries(page, 'properties')) as { key: string; label: string; options: { id: string }[] }[];
    const effort = catalog.find((entry) => entry.key === 'effort')!;
    const environment = catalog.find((entry) => entry.key === 'environment');
    const bug = await createItem(page, { project_id: project.id, title: 'Broken link', ...(environment && { values: { environment: environment.options[0]!.id } }) });
    await openTable(page, project.identifier, bug.id, 'fields=key,property:effort');

    await page.keyboard.press('ArrowRight');
    await expect(cell(page, bug.id, 1)).toBeFocused();
    await page.keyboard.press('Enter');
    // by the label the catalog has (the demo data name it in German)
    const field = page.getByRole('textbox', { name: effort.label });
    await expect(field).toBeFocused();
    await page.keyboard.type('2.5');
    await page.keyboard.press('Enter');
    await expect(field).toHaveCount(0);
    await expect(cell(page, bug.id, 1)).toBeFocused();
    await expect(cell(page, bug.id, 1)).toHaveText('2.5');

    await page.reload();
    await expect(cell(page, bug.id, 1)).toHaveText('2.5');
  } finally {
    await removeE2eProject(page, project.identifier);
  }
});

test('scrolls a long table freely while the cell of the cursor stays rendered', async ({ page }) => {
  await page.goto('/my-items');
  const project = await createE2eProject(page, name('scroll'), { types: ['Task'] });
  try {
    const items: { id: string; key: string }[] = [];
    for (let number = 1; number <= 60; number += 1) items.push(await createItem(page, { project_id: project.id, title: `Item ${number}` }));
    // the first cell becomes the cursor; then the box scrolls far away from it
    await openTable(page, project.identifier, items[0]!.id, 'fields=key,priority');
    const box = page.locator('[data-table-scroller]');
    const view = (selector: string) =>
      box.evaluate((element, target) => {
        const rect = element.getBoundingClientRect();
        // what stands in the middle of the box: a cell of a row, not the empty height of rows left out
        const middle = document.elementFromPoint(rect.left + 100, rect.top + rect.height / 2);
        return { top: element.scrollTop, end: element.scrollHeight - element.clientHeight, cell: middle?.closest(target) !== null };
      }, selector);
    const settle = () => page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));

    // to the end: it stays there, with the last rows in view
    await box.evaluate((element) => element.scrollTo({ top: element.scrollHeight }));
    await expect(cell(page, items.at(-1)!.id, 0)).toBeInViewport();
    await settle();
    // measured until the rows have settled, not once
    await expect
      .poll(async () => {
        const end = await view('[data-cell]');
        return { cell: end.cell, scrolled: end.top > 0, atEnd: Math.abs(end.top - end.end) <= 1 };
      })
      .toEqual({ cell: true, scrolled: true, atEnd: true });
    await expect(cell(page, items.at(-1)!.id, 0)).toBeInViewport();
    // the cursor kept its cell and its focus
    await expect(cell(page, items[0]!.id, 0)).toBeFocused();

    // halfway: the box stays where it was put, and shows rows there
    const middle = await box.evaluate((element) => {
      element.scrollTop = Math.round(element.scrollHeight / 2 - element.clientHeight / 2);
      return element.scrollTop;
    });
    await expect(cell(page, items[29]!.id, 0)).toBeInViewport();
    await settle();
    await expect
      .poll(async () => {
        const halfway = await view('[data-cell]');
        return { cell: halfway.cell, stays: Math.abs(halfway.top - middle) <= 2 };
      })
      .toEqual({ cell: true, stays: true });
    await expect(cell(page, items[29]!.id, 0)).toBeInViewport();
    await expect(cell(page, items[0]!.id, 0)).toBeFocused();
  } finally {
    await removeE2eProject(page, project.identifier);
  }
});

test('keeps rows, toggles and pickers of the table at least 44 px high', async ({ page }) => {
  test.skip(!isPhone(page), 'the touch targets of the phone');
  await page.goto('/my-items');
  const project = await createE2eProject(page, name('phone'), { types: ['Task'] });
  try {
    const item = await createItem(page, { project_id: project.id, title: 'Login form' });
    await page.goto(`/projects/${project.identifier}?layout=table&fields=key,priority`);
    await expect(cell(page, item.id, 0)).toBeVisible();

    const height = async (locator: ReturnType<Page['locator']>) => (await locator.boundingBox())!.height;
    expect(await height(cell(page, item.id, 0))).toBeGreaterThanOrEqual(44);
    expect(await height(page.getByRole('button', { name: /^Backlog/ }))).toBeGreaterThanOrEqual(44);
    expect(await height(cell(page, item.id, 1).getByRole('combobox'))).toBeGreaterThanOrEqual(44);
  } finally {
    await removeE2eProject(page, project.identifier);
  }
});
