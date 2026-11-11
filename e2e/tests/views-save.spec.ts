import type { Page } from '@playwright/test';
import { expect, test } from '../fixtures';
import { arrowTo, createE2eProject, createE2eView, createItem, PEOPLE, pressMod, removeE2eProject, removeE2eView, runId, signedInContext, tabTo, tr, variant } from '../helpers';

// Saving, discarding and copying what a list shows, with the keyboard only, signed in as the e2e person (org admin,
// English); the last test as Lene (member, German), who may not change the view of somebody else. One public project
// (`E2E …`, removed after the tests) with three items over the API; the views of the tests are named `E2E …` too.

const name = (worker: number) => `E2E save ${variant()} ${runId()} ${worker}`;
const viewName = (what: string) => `E2E ${variant()} ${runId()} ${what}`;

let shared: { id: string; identifier: string };

test.beforeAll(async ({ browser }, workerInfo) => {
  const page = await browser.newPage();
  await page.goto('/my-items');
  shared = await createE2eProject(page, name(workerInfo.workerIndex), { types: ['Task'] });
  for (const title of ['Swap the logo', 'Check the footer', 'Rework the start page']) await createItem(page, { project_id: shared.id, title });
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

/** A view of the shared project, grouped by status. */
const projectView = (what: string) =>
  ({
    name: what,
    filter: { version: 1 as const, conditions: [{ field: 'project', op: 'is', value: shared.id }] },
    display: { layout: 'list', group_by: 'state', sort: { field: 'rank', direction: 'asc' }, fields: ['key', 'state'], show_sub_items: true },
  }) as const;

/** The id of the view the address shows. */
const viewIdOf = (page: Page) => new URL(page.url()).pathname.split('/').at(-1)!;

test('changes the grouping of a view, sees it as unsaved and discards it', async ({ page }) => {
  const view = await createE2eView(page, projectView('grouping'));
  try {
    await page.goto(`/views/${view.id}`);
    await expect(row(page, 'Swap the logo')).toBeVisible();

    await tabTo(page, page.getByRole('button', { name: tr('en', 'items.display.label'), exact: true }), { max: 80 });
    await page.keyboard.press('Enter');
    const menu = page.getByRole('dialog', { name: tr('en', 'items.display.label') });
    await expect(menu).toBeVisible();
    await tabTo(page, menu.getByRole('combobox', { name: new RegExp(`^${tr('en', 'items.display.group_by')}`) }));
    await page.keyboard.press('Enter');
    await arrowTo(page, page.getByRole('option', { name: tr('en', 'items.group.by.priority'), exact: true }));
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\?group=priority$/);
    await page.keyboard.press('Escape');
    await expect(menu).toBeHidden();

    await expect(page.getByText(tr('en', 'items.save.unsaved'), { exact: true })).toBeVisible();
    await tabTo(page, page.getByRole('button', { name: tr('en', 'items.save.discard'), exact: true }));
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(new RegExp(`/views/${view.id}$`));
    await expect(page.getByText(tr('en', 'items.save.unsaved'), { exact: true })).toBeHidden();
  } finally {
    await removeE2eView(page, view.id);
  }
});

test('saves a project list with a filter as a new view and finds it in the address', async ({ page }) => {
  await page.goto(`/projects/${shared.identifier}`);
  await expect(row(page, 'Swap the logo')).toBeVisible();
  await page.keyboard.press('/');
  await expect(page.getByRole('searchbox', { name: tr('en', 'items.filter.search.label') })).toBeFocused();
  await page.keyboard.type('logo');
  await page.keyboard.press('Enter');
  await expect(row(page, 'Check the footer')).toHaveCount(0);

  await tabTo(page, page.getByRole('button', { name: tr('en', 'items.save.save_as'), exact: true }));
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: tr('en', 'items.save.dialog.title') });
  const field = dialog.getByRole('textbox', { name: tr('en', 'views.fields.name') });
  await expect(field).toBeFocused();
  await expect(dialog.getByText(tr('en', 'items.save.dialog.scope', { condition: tr('en', 'items.save.scope.project', { name: name(test.info().workerIndex) }) }))).toBeVisible();
  await field.selectText();
  await page.keyboard.type(viewName('logo'));
  await pressMod(page, 'Enter');

  await expect(page).toHaveURL(/\/views\/[0-9a-z]{26}$/);
  const id = viewIdOf(page);
  try {
    await expect(page.getByRole('heading', { level: 1, name: viewName('logo') })).toBeVisible();
    // the view holds the project and the filter: the same items, nothing unsaved
    await expect(row(page, 'Swap the logo')).toBeVisible();
    await expect(row(page, 'Check the footer')).toHaveCount(0);
    await expect(page.getByText(tr('en', 'items.save.unsaved'), { exact: true })).toHaveCount(0);
  } finally {
    await removeE2eView(page, id);
  }
});

test('refuses saving the view of somebody else and saves a copy', async ({ page, browser }) => {
  const view = await createE2eView(page, projectView('team'));
  const { context, page: lene } = await signedInContext(browser, PEOPLE.lene);
  let copy: string | null = null;
  try {
    await lene.goto(`/views/${view.id}?group=priority`);
    await expect(lene.getByText(tr('de', 'items.save.unsaved'), { exact: true })).toBeVisible();
    const save = lene.getByRole('button', { name: tr('de', 'items.save.save'), exact: true });
    await expect(save).toHaveAttribute('aria-disabled', 'true');
    const reason = `${tr('de', 'problem.detail.view_creator_only', { name: PEOPLE.e2e.name, view: viewName('team') })} ${tr('de', 'items.save.copy_instead')}`;
    await expect(save).toHaveAccessibleDescription(reason);

    await tabTo(lene, lene.getByRole('button', { name: tr('de', 'items.save.save_as'), exact: true }));
    await lene.keyboard.press('Enter');
    const dialog = lene.getByRole('dialog', { name: tr('de', 'items.save.dialog.title') });
    await expect(dialog.getByRole('textbox', { name: tr('de', 'views.fields.name') })).toHaveValue(tr('de', 'views.copy_name', { name: viewName('team') }));
    await pressMod(lene, 'Enter');
    await expect(lene).toHaveURL(/\/views\/[0-9a-z]{26}$/);
    copy = viewIdOf(lene);
    expect(copy).not.toBe(view.id);
    await expect(lene.getByRole('heading', { level: 1, name: tr('de', 'views.copy_name', { name: viewName('team') }) })).toBeVisible();
    // the copy is Lene's, with the grouping she chose: nothing unsaved, and hers to save
    await expect(lene.getByText(tr('de', 'items.save.unsaved'), { exact: true })).toHaveCount(0);
  } finally {
    await context.close();
    if (copy) await removeE2eView(page, copy);
    await removeE2eView(page, view.id);
  }
});
