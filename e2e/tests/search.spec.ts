import type { Locator, Page } from '@playwright/test';
import { expect, test } from '../fixtures';
import {
  api,
  createE2eProject,
  createE2eView,
  createItem,
  e2eIdentifier,
  PEOPLE,
  pressMod,
  removeE2eProject,
  removeE2eView,
  runId,
  searchToken,
  signedInContext,
  tabTo,
  tr,
  variant,
  waitForSearch,
} from '../helpers';

// The search with the keyboard only, signed in as the e2e person (playwright.config.ts), in English. Every item of a
// spec carries the search token of its run and variant: all variants share one index. The token goes before the
// partial word of a query (Meilisearch reads only the last word as a prefix), and every test adds words of its own, so
// no test finds the items of another.

const name = (what: string) => `E2E ${what} ${variant()} ${runId()}`;

/** Opens the palette with ⌘K and waits until its input has the focus. */
async function openPalette(page: Page, locale: 'de' | 'en' = 'en'): Promise<Locator> {
  await pressMod(page, 'k');
  const palette = page.getByRole('dialog', { name: tr(locale, 'palette.title') });
  await expect(palette.getByRole('combobox', { name: tr(locale, 'palette.input') })).toBeFocused();
  return palette;
}

/** The field editor `label` with its value, as the panel names it ("Status: Done"). */
const field = (scope: Locator, label: string, value: string) =>
  scope.getByRole('combobox', { name: new RegExp(`^${tr('en', 'items.fields.picker.name', { label, value })}`) });

/** Opens the palette's sub-list of an item command with its key and waits until its input has the focus. */
async function subList(page: Page, key: string, label: string): Promise<Locator> {
  await page.keyboard.press(key);
  const palette = page.getByRole('dialog', { name: tr('en', 'palette.title') });
  await expect(palette.getByRole('combobox', { name: tr('en', label) })).toBeFocused();
  return palette;
}

/**
 * Removes the project of a test from a page outside it: an item page would load its item again after the delete and
 * report the 404.
 */
async function cleanUp(page: Page, identifier: string) {
  await page.goto('/my-items');
  await removeE2eProject(page, identifier);
}

test('indexes a new item for the search', async ({ page }) => {
  await page.goto('/my-items');
  const { id, identifier } = await createE2eProject(page, name('search index'));
  try {
    const item = await createItem(page, { project_id: id, title: `E2E Kontaktformular ${searchToken()}` });
    const data = await waitForSearch(page, `${searchToken()} kontakt`, (answer) => answer.items.some((hit) => hit.id === item.id));
    expect(data.items[0].key).toBe(item.key);
  } finally {
    await removeE2eProject(page, identifier);
  }
});

test('Flow 1: finds the item over the palette and closes it with the resolution set', async ({ page }) => {
  await page.goto('/my-items');
  const { id, identifier } = await createE2eProject(page, name('search flow'), { types: ['Task'] });
  try {
    const title = `E2E Kontaktformular sendet doppelt ${searchToken()}`;
    const item = await createItem(page, { project_id: id, title });
    // "doppelt" tells this item from the one of the first test; "kontakt" is the partial word of Flow 1
    const query = `${searchToken()} doppelt kontakt`;
    // the page loaded before the project: its list of projects lacks it, and the item page loads that list again
    await waitForSearch(page, query, (data) => data.items.some((hit) => hit.id === item.id));

    const palette = await openPalette(page);
    await page.keyboard.type(query);
    const items = palette.getByRole('group', { name: tr('en', 'palette.section.items') });
    const hit = items.getByRole('option').first();
    await expect(hit).toContainText(item.key);
    await expect(hit).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('Enter');

    await expect(page).toHaveURL(new RegExp(`/items/${item.key}$`));
    const heading = page.getByRole('heading', { level: 1, name: title });
    await expect(heading).toBeVisible();
    await expect(palette).toBeHidden();

    // the item commands act once what they read is there (before, their keys say "One moment")
    const fields = page.getByRole('complementary', { name: tr('en', 'items.detail.fields.label') });
    await expect(fields.getByRole('combobox', { name: new RegExp(`^${tr('en', 'items.fields.state.label')}: `) })).toBeVisible();
    const commands = await openPalette(page);
    await expect(commands.getByRole('option', { name: new RegExp(`^${tr('en', 'shortcuts.item.state')}`) })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(commands).toBeHidden();

    await subList(page, 's', 'shortcuts.item.state');
    await page.keyboard.type('done');
    await page.keyboard.press('Enter');

    const dialog = page.getByRole('dialog', { name: tr('en', 'items.fields.resolution.title', { subject: item.key, state: 'Done' }) });
    await expect(dialog).toBeVisible();
    const done = dialog.getByRole('radio', { name: /^Done/ });
    await expect(done).toBeChecked();
    await expect(done).toBeFocused();
    await page.keyboard.press('Enter');

    await expect(dialog).toBeHidden();
    await expect(field(fields, tr('en', 'items.fields.state.label'), 'Done')).toBeVisible();
    await expect(fields.getByText(tr('en', 'items.detail.fields.resolution'), { exact: true }).locator('xpath=following-sibling::dd[1]')).toHaveText('Done');
  } finally {
    await cleanUp(page, identifier);
  }
});

test('jumps to an item over its former key', async ({ page }) => {
  await page.goto('/my-items');
  const project = await createE2eProject(page, name('former key'), { types: ['Task'] });
  let identifier = project.identifier;
  try {
    const title = `E2E Leitsystem ${searchToken()}`;
    const item = await createItem(page, { project_id: project.id, title });
    for (let attempt = 0; identifier === project.identifier; attempt++) {
      expect(attempt, 'a free identifier').toBeLessThan(10);
      const response = await api(page, 'PATCH', `/api/v1/projects/${project.id}`, { identifier: e2eIdentifier(name('former key renamed'), attempt) });
      if (response.status() === 422) continue;
      expect(response.status(), await response.text()).toBe(200);
      identifier = ((await response.json()) as { data: { identifier: string } }).data.identifier;
    }
    const number = item.key.split('-')[1];

    await openPalette(page);
    // Enter right after typing: a typed key jumps before the search answers
    await page.keyboard.type(item.key);
    await page.keyboard.press('Enter');

    await expect(page).toHaveURL(new RegExp(`/items/${identifier}-${number}$`));
    await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible();
  } finally {
    await cleanUp(page, identifier);
  }
});

test('finds a project and a view by name', async ({ page }) => {
  await page.goto('/my-items');
  const word = `Suchprojekt ${searchToken()}`;
  const project = await createE2eProject(page, `E2E ${word} ${variant()} ${runId()}`);
  let view: { id: string } | undefined;
  try {
    view = await createE2eView(page, { name: word });
    const query = `${searchToken()} suchprojekt`;
    await waitForSearch(page, query, (data) => data.projects.some((hit) => hit.id === project.id) && data.views.some((hit) => hit.id === view!.id));

    const palette = await openPalette(page);
    await page.keyboard.type(query);
    const projects = palette.getByRole('group', { name: tr('en', 'palette.section.projects') });
    const views = palette.getByRole('group', { name: tr('en', 'palette.section.views') });
    const projectHit = projects.getByRole('option', { name: new RegExp(project.identifier) });
    const viewHit = views.getByRole('option');
    await expect(projectHit).toHaveAttribute('aria-selected', 'true');
    await expect(viewHit).toHaveCount(1);
    await expect(palette.getByRole('option')).toHaveCount(2);

    await page.keyboard.press('ArrowDown');
    await expect(viewHit).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('Enter');

    await expect(page).toHaveURL(new RegExp(`/views/${view.id}$`));
    await expect(palette).toBeHidden();
  } finally {
    await page.goto('/my-items');
    if (view) await removeE2eView(page, view.id);
    await removeE2eProject(page, project.identifier);
  }
});

test('shows Ida no item of a private project she is not in', async ({ page, browser, allowedErrors }) => {
  await page.goto('/my-items');
  const { id, identifier } = await createE2eProject(page, name('search private'), { types: ['Task'], visibility: 'private' });
  // signed in inside the try: a sign-in that fails still removes the project
  let ida: Awaited<ReturnType<typeof signedInContext>> | undefined;
  try {
    ida = await signedInContext(browser, PEOPLE.ida);
    const item = await createItem(page, { project_id: id, title: `E2E Geheimsache ${searchToken()}` });
    // the key of this item jumps to the 404 page, as the test asks (the browser reports it), nothing else may
    allowedErrors.push(new RegExp(`^\\[ida@feldwerk\\.example\\.com\\] console error: .*status of 404 .*/items/${item.key}\\)$`));
    const query = `${searchToken()} geheimsache`;
    // the e2e person (org admin) finds it: it is in the index
    await waitForSearch(page, query, (data) => data.items.some((hit) => hit.id === item.id));

    await ida.page.goto('/my-items');
    await expect(ida.page.getByRole('heading', { level: 1, name: tr('de', 'items.my.title') })).toBeVisible();
    const palette = await openPalette(ida.page, 'de');
    await ida.page.keyboard.type(query);
    await expect(palette.getByText(tr('de', 'palette.no_results', { query }))).toBeVisible();
    await expect(palette.getByRole('group', { name: tr('de', 'palette.section.items') })).toHaveCount(0);
    await expect(palette.getByText(item.key)).toHaveCount(0);

    // the key of the item jumps like any unknown key: to the 404, never to the item (Backspace empties the input: ⌃A
    // on a Mac host moves to the start of the line instead of selecting)
    for (let left = query.length; left > 0; left--) await ida.page.keyboard.press('Backspace');
    await expect(palette.getByRole('combobox', { name: tr('de', 'palette.input') })).toHaveValue('');
    await ida.page.keyboard.type(item.key);
    await ida.page.keyboard.press('Enter');
    await expect(ida.page).toHaveURL(new RegExp(`/items/${item.key}$`));
    await expect(ida.page.getByRole('heading', { level: 1, name: tr('de', 'errors.page.not_found.title') })).toBeVisible();
    await expect(ida.page.getByText('Geheimsache')).toHaveCount(0);
  } finally {
    await ida?.context.close();
    await removeE2eProject(page, identifier);
  }
});

test('searches from the 404 page', async ({ page, allowedErrors }) => {
  allowedErrors.push(/status of 404 .*\/items\/ZZZ-1\)$/);
  await page.goto('/items/ZZZ-1');
  const main = page.locator('main');
  await expect(main.getByRole('heading', { level: 1 })).toHaveText(tr('en', 'errors.page.not_found.title'));

  await tabTo(page, main.getByRole('button', { name: tr('en', 'errors.page.not_found.search'), exact: true }));
  await page.keyboard.press('Enter');

  const palette = page.getByRole('dialog', { name: tr('en', 'palette.title') });
  await expect(palette.getByRole('combobox', { name: tr('en', 'palette.input') })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(palette).toBeHidden();
});
