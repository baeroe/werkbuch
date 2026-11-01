import type { Locator, Page } from '@playwright/test';
import { expect, test } from '../fixtures';
import { allEntries, api, arrowTo, createE2eProject, createItem, isPhone, PEOPLE, pressMod, removeE2eProject, runId, tabTo, tr, variant } from '../helpers';

// The page of an item with the keyboard only, signed in as the e2e person (playwright.config.ts), in English. Each test
// works in a project of its own (`E2E …`, removed in `finally`); its items come over the API. The item commands (s, a,
// p, mod+backspace) open the palette's sub-lists or act at once; the follow-up questions give the focus back to the title.

const name = (what: string) => `E2E ${what} ${variant()} ${runId()}`;

/** The id of the state named `state` in the workflow named `workflow`. */
async function stateId(page: Page, workflow: string, state: string): Promise<string> {
  const entry = (await allEntries(page, 'workflows')).find((item) => item.name === workflow) as { states: { id: string; name: string }[] } | undefined;
  const found = entry?.states.find((item) => item.name === state);
  if (!found) throw new Error(`No state "${state}" in workflow "${workflow}"`);
  return found.id;
}

/**
 * Opens the page of an item and waits until its fields can be changed and its commands act: the palette lists a
 * command only once what it reads is there (before, its key says "One moment").
 */
async function openItem(page: Page, key: string, title: string) {
  await page.goto(`/items/${key}`);
  const heading = page.getByRole('heading', { level: 1, name: title });
  await expect(heading).toBeVisible();
  const fields = page.getByRole('complementary', { name: tr('en', 'items.detail.fields.label') });
  await expect(fields.getByRole('combobox', { name: new RegExp(`^${tr('en', 'items.fields.state.label')}: `) })).toBeVisible();

  await pressMod(page, 'k');
  const palette = page.getByRole('dialog', { name: tr('en', 'palette.title') });
  await expect(palette.getByRole('option', { name: new RegExp(`^${tr('en', 'shortcuts.item.state')}`) })).toBeVisible();
  // "Assign …" waits for the people of the project as well
  await expect(palette.getByRole('option', { name: new RegExp(`^${tr('en', 'shortcuts.item.assignee')}`) })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(palette).toBeHidden();
  return { heading, fields };
}

/**
 * Removes the project of a test, from a page outside it: the item page would load its item again after the delete
 * (a change settling, the focus coming back) and report the 404.
 */
async function cleanUp(page: Page, identifier: string) {
  await page.goto('/my-items');
  await removeE2eProject(page, identifier);
}

/** The field editor `label` with its value, as the panel names it ("Status: Done"). */
const field = (scope: Locator, label: string, value: string) =>
  scope.getByRole('combobox', { name: new RegExp(`^${tr('en', 'items.fields.picker.name', { label, value })}`) });

/** Opens the palette's sub-list of an item command with its key and waits until its input has the focus. */
async function subList(page: Page, key: string, label: string) {
  await page.keyboard.press(key);
  const palette = page.getByRole('dialog', { name: tr('en', 'palette.title') });
  const input = palette.getByRole('combobox', { name: tr('en', label) });
  await expect(input).toBeFocused();
  return palette;
}

test('sets a closing status with the resolution prefilled', async ({ page }) => {
  const { id, identifier } = await createE2eProject(page, name('closing'), { types: ['Task'] });
  try {
    const item = await createItem(page, { project_id: id, title: 'E2E Impressum aktualisieren' });
    const { heading, fields } = await openItem(page, item.key, 'E2E Impressum aktualisieren');

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
    // a closed item names its resolution
    await expect(fields.getByText(tr('en', 'items.detail.fields.resolution'), { exact: true }).locator('xpath=following-sibling::dd[1]')).toHaveText('Done');
    // nothing else had the focus: it goes back to the title
    await expect(heading.getByRole('button')).toBeFocused();
  } finally {
    await cleanUp(page, identifier);
  }
});

test('offers only allowed states in a restricted workflow', async ({ page }) => {
  const { id, identifier } = await createE2eProject(page, name('restricted'), { workflow: 'Agentur-Freigabe', types: ['Task'] });
  try {
    const item = await createItem(page, { project_id: id, title: 'E2E Startseite freigeben', state_id: await stateId(page, 'Agentur-Freigabe', 'Todo') });
    const { fields } = await openItem(page, item.key, 'E2E Startseite freigeben');

    const palette = await subList(page, 's', 'shortcuts.item.state');
    await expect(palette.getByRole('option', { name: 'In Progress', exact: true })).toBeVisible();
    await expect(palette.getByRole('option', { name: 'Cancelled', exact: true })).toBeVisible();
    await expect(palette.getByRole('option', { name: 'Done', exact: true })).toHaveCount(0);
    await expect(palette.getByRole('option', { name: 'Review', exact: true })).toHaveCount(0);

    await page.keyboard.type('in progress');
    await page.keyboard.press('Enter');
    await expect(palette).toBeHidden();
    await expect(field(fields, tr('en', 'items.fields.state.label'), 'In Progress')).toBeVisible();
    await expect(page.getByText(tr('en', 'items.commands.done', { key: item.key, what: tr('en', 'items.commands.what.state', { state: 'In Progress' }) }))).toBeVisible();
  } finally {
    await cleanUp(page, identifier);
  }
});

test('changes assignee and priority with a and p', async ({ page }) => {
  const { id, identifier } = await createE2eProject(page, name('assignee'), { types: ['Task'] });
  try {
    const item = await createItem(page, { project_id: id, title: 'E2E Formular prüfen' });
    const { fields } = await openItem(page, item.key, 'E2E Formular prüfen');
    const assignee = tr('en', 'items.fields.assignee.label');

    if (isPhone(page)) {
      // on the phone through the fields (spec 5.1): the status, then the assignee
      await tabTo(page, field(fields, tr('en', 'items.fields.state.label'), 'Backlog'), { max: 80 });
      await page.keyboard.press('Enter');
      // typed only once the search field has the focus: before, the letters would be the page's shortcuts
      await expect(page.getByRole('combobox', { name: tr('en', 'items.fields.state.placeholder') })).toBeFocused();
      await page.keyboard.type('in progress');
      await page.keyboard.press('Enter');
      await expect(field(fields, tr('en', 'items.fields.state.label'), 'In Progress')).toBeVisible();

      await tabTo(page, field(fields, assignee, tr('en', 'items.fields.assignee.nobody')), { max: 20 });
      await page.keyboard.press('Enter');
      await expect(page.getByRole('combobox', { name: tr('en', 'items.fields.assignee.placeholder') })).toBeFocused();
      await page.keyboard.type(PEOPLE.e2e.name);
      await page.keyboard.press('Enter');
      await expect(field(fields, assignee, PEOPLE.e2e.name)).toBeVisible();
      return;
    }

    const people = await subList(page, 'a', 'shortcuts.item.assignee');
    await page.keyboard.type(PEOPLE.e2e.name);
    await page.keyboard.press('Enter');
    // the palette is gone before the next key: while it closes, the page's keys still wait
    await expect(people).toBeHidden();
    await expect(field(fields, assignee, PEOPLE.e2e.name)).toBeVisible();

    const priorities = await subList(page, 'p', 'shortcuts.item.priority');
    await page.keyboard.type('high');
    await page.keyboard.press('Enter');
    await expect(priorities).toBeHidden();
    await expect(field(fields, tr('en', 'items.fields.priority.label'), tr('en', 'priority.high'))).toBeVisible();
  } finally {
    await cleanUp(page, identifier);
  }
});

test('edits the title with e', async ({ page }) => {
  const { id, identifier } = await createE2eProject(page, name('title'), { types: ['Task'] });
  try {
    const item = await createItem(page, { project_id: id, title: 'E2E Kontaktformular sendet doppelt' });
    await openItem(page, item.key, 'E2E Kontaktformular sendet doppelt');

    await page.keyboard.press('e');
    const title = page.getByRole('textbox', { name: tr('en', 'items.detail.title.label') });
    await expect(title).toBeFocused();
    // Escape takes it back
    await page.keyboard.type(' und dreifach');
    await page.keyboard.press('Escape');
    await expect(page.getByRole('heading', { level: 1, name: 'E2E Kontaktformular sendet doppelt' })).toBeVisible();

    await page.keyboard.press('e');
    await expect(title).toBeFocused();
    await pressMod(page, 'a');
    await page.keyboard.type('E2E Kontaktformular sendet einmal');
    await page.keyboard.press('Enter');
    const heading = page.getByRole('heading', { level: 1, name: 'E2E Kontaktformular sendet einmal' });
    await expect(heading).toBeVisible();
    await expect(heading.getByRole('button')).toBeFocused();

    // stored: the page reads it again
    await page.reload();
    await expect(heading).toBeVisible();
  } finally {
    await cleanUp(page, identifier);
  }
});

test('archives a done item and restores it', async ({ page }) => {
  const { id, identifier } = await createE2eProject(page, name('archive'), { types: ['Task'] });
  try {
    const item = await createItem(page, { project_id: id, title: 'E2E Impressum erledigt', state_id: await stateId(page, 'Standard', 'Done') });
    const { heading } = await openItem(page, item.key, 'E2E Impressum erledigt');

    await tabTo(page, page.getByRole('button', { name: tr('en', 'items.detail.more') }), { max: 80 });
    await page.keyboard.press('Enter');
    const menu = page.getByRole('menu');
    await arrowTo(page, menu.getByRole('menuitem', { name: tr('en', 'items.commands.archive') }));
    await page.keyboard.press('Enter');
    await expect(page.getByText(tr('en', 'items.commands.archived', { key: item.key }))).toBeVisible();

    // archived once the undo toast has run out (5 s): read-only, with the way back
    const note = page.getByRole('status').filter({ hasText: /^Archived on/ });
    await expect(note).toBeVisible({ timeout: 10_000 });
    await expect(heading.getByRole('button')).toHaveCount(0);

    await tabTo(page, note.getByRole('button', { name: tr('en', 'items.detail.restore') }), { max: 80 });
    await page.keyboard.press('Enter');
    await expect(page.getByText(tr('en', 'items.detail.restored', { key: item.key }))).toBeVisible();
    await expect(note).toBeHidden();
    await expect(heading.getByRole('button')).toBeVisible();
  } finally {
    await cleanUp(page, identifier);
  }
});

test('deletes an item with mod+backspace and undoes it with mod+z', async ({ page }) => {
  const { id, identifier } = await createE2eProject(page, name('delete'), { types: ['Task'] });
  try {
    const item = await createItem(page, { project_id: id, title: 'E2E Altes Banner entfernen' });
    await openItem(page, item.key, 'E2E Altes Banner entfernen');

    // an open item: deleted, with the page left at once
    await pressMod(page, 'Backspace');
    await expect(page).toHaveURL(/\/my-items$/);
    await expect(page.getByText(tr('en', 'items.commands.deleted', { key: item.key }))).toBeVisible();

    await pressMod(page, 'z');
    await expect(page).toHaveURL(new RegExp(`/items/${item.key}$`));
    await expect(page.getByRole('heading', { level: 1, name: 'E2E Altes Banner entfernen' })).toBeVisible();
    const still = await api(page, 'GET', `/api/v1/work-items/${item.id}`);
    expect(still.status()).toBe(200);
  } finally {
    await cleanUp(page, identifier);
  }
});

test('opens a former key at the current address', async ({ page }) => {
  const { id, identifier } = await createE2eProject(page, name('former'), { types: ['Task'] });
  // the same length and as unique as the identifier of the project: another first letter
  const renamed = `R${identifier.slice(1)}`;
  try {
    const item = await createItem(page, { project_id: id, title: 'E2E Umbenannt' });
    const response = await api(page, 'PATCH', `/api/v1/projects/${identifier}`, { identifier: renamed });
    expect(response.status(), await response.text()).toBe(200);

    await page.goto(`/items/${item.key}`);
    await expect(page).toHaveURL(new RegExp(`/items/${renamed}-1$`));
    await expect(page.getByRole('heading', { level: 1, name: 'E2E Umbenannt' })).toBeVisible();
    await expect(page.getByRole('navigation', { name: tr('en', 'items.detail.path') }).getByText(`${renamed}-1`, { exact: true })).toBeVisible();
  } finally {
    await cleanUp(page, renamed);
  }
});
