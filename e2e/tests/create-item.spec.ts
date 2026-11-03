import type { Page } from '@playwright/test';
import { expect, test } from '../fixtures';
import { allEntries, api, arrowTo, createE2eProject, createItem, pressMod, removeCatalogEntries, removeE2eProject, runId, tabTo, tr, variant } from '../helpers';

// The create dialog with the keyboard only, signed in as the e2e person (org admin) in English. Each test works in a
// project of its own (`E2E …`, removed in `finally`); the dialog opens with `c` on a page of that project, which it
// then starts in, from "Child item" of an epic, or from "New item" of "My items". Flow 3 of the spec: a required
// property of the type is asked for at its field before the item is created. The description takes mentions and
// pasted pictures, which the new item owns once it is created.

const name = (what: string) => `E2E create ${what} ${variant()} ${runId()}`;

/** A PNG of one pixel. */
const PIXEL = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

/** The id of the entry of a catalog (`workflows`, `work-item-types`) named `entry`. */
async function idOf(page: Page, path: string, entry: string): Promise<{ id: string; states?: { id: string; name: string }[] }> {
  const found = (await allEntries(page, path)).find((item) => item.name === entry);
  if (!found) throw new Error(`No entry "${entry}" in ${path}`);
  return found as { id: string; states?: { id: string; name: string }[] };
}

/** An item as the API answers it. */
async function readItem(page: Page, key: string): Promise<{ id: string; title: string; state_id: string; parent_id: string | null; values: Record<string, unknown> }> {
  const response = await api(page, 'GET', `/api/v1/work-items/${key}`);
  expect(response.status(), await response.text()).toBe(200);
  return ((await response.json()) as { data: { id: string; title: string; state_id: string; parent_id: string | null; values: Record<string, unknown> } }).data;
}

/** Opens the settings of the project and waits until they (and the rights) have loaded: `c` acts from then on. */
async function openProject(page: Page, identifier: string): Promise<void> {
  await page.goto(`/projects/${identifier}/settings`);
  await expect(page.getByRole('textbox', { name: tr('en', 'settings.project.general.identifier') })).toHaveValue(identifier);
}

/** Presses `c` and answers the dialog once its title has the focus. */
async function openDialog(page: Page) {
  await page.keyboard.press('c');
  const dialog = page.getByRole('dialog', { name: tr('en', 'items.create.title') });
  await expect(dialog).toBeVisible();
  const title = dialog.getByRole('textbox', { name: new RegExp(`^${tr('en', 'items.create.title_label')}`) });
  await expect(title).toBeFocused();
  return { dialog, title };
}

const created = (page: Page, key: string) => page.getByText(tr('en', 'items.create.created', { key }), { exact: true });

test('asks for the customer before it creates a wish', async ({ page, allowedErrors }) => {
  allowedErrors.push(/status of 422 .*\/api\/v1\/work-items/);
  const { identifier } = await createE2eProject(page, name('wish'), { workflow: 'Agentur-Freigabe', types: ['Task', 'Kundenwunsch'] });
  try {
    await openProject(page, identifier);
    const { dialog, title } = await openDialog(page);
    await expect(dialog.getByRole('combobox', { name: new RegExp(`^${tr('en', 'items.create.project')}`) })).toContainText(name('wish'));

    // the type: Kundenwunsch, which asks for the customer
    const type = dialog.getByRole('combobox', { name: new RegExp(`^${tr('en', 'items.create.type')}`) });
    await tabTo(page, type, { backwards: true, max: 4 });
    await page.keyboard.press('Enter');
    await arrowTo(page, page.getByRole('option', { name: 'Kundenwunsch', exact: true }));
    await page.keyboard.press('Enter');
    await expect(type).toContainText('Kundenwunsch');
    const customer = dialog.getByRole('combobox', { name: /^Kunde: / });
    await expect(customer).toBeVisible();

    await tabTo(page, title, { max: 4 });
    await page.keyboard.type('E2E Export als CSV');
    await pressMod(page, 'Enter');
    // refused at the field, the focus there; the dialog stays
    await expect(customer).toHaveAttribute('aria-invalid', 'true');
    await expect(dialog.getByText(tr('en', 'field.values.required', { label: 'Kunde' }))).toBeVisible();
    await expect(customer).toBeFocused();

    await page.keyboard.press('Enter');
    await expect(page.getByRole('combobox', { name: tr('en', 'items.fields.property.search_option') })).toBeFocused();
    await page.keyboard.type('Hafenkontor');
    await page.keyboard.press('Enter');
    await expect(dialog.getByRole('combobox', { name: 'Kunde: Hafenkontor' })).toBeVisible();
    await expect(dialog.getByText(tr('en', 'field.values.required', { label: 'Kunde' }))).toHaveCount(0);

    await pressMod(page, 'Enter');
    await expect(created(page, `${identifier}-1`)).toBeVisible();
    await expect(dialog).toBeHidden();
    // in the start state of the workflow
    const backlog = (await idOf(page, 'workflows', 'Agentur-Freigabe')).states!.find((state) => state.name === 'Backlog')!;
    const item = await readItem(page, `${identifier}-1`);
    expect([item.title, item.state_id]).toEqual(['E2E Export als CSV', backlog.id]);
  } finally {
    await removeE2eProject(page, identifier);
  }
});

test('creates an item of a type with a required property', async ({ page }) => {
  // the type and its property for this test (success criterion 2.2), removed in `finally`
  const prefix = `E2E create ${variant()} ${runId()}`;
  const key = prefix.toLowerCase().replace(/[^a-z0-9]+/g, '_');
  const property = await api(page, 'POST', '/api/v1/properties', { key, label: `${prefix} Prüfer`, field_type: 'text', help: '', default_value: null, settings: {}, options: [] });
  expect(property.status(), await property.text()).toBe(201);
  let identifier: string | null = null;
  try {
    const { data } = (await property.json()) as { data: { id: string } };
    const workItemType = await api(page, 'POST', '/api/v1/work-item-types', {
      name: `${prefix} Abnahme`,
      icon: 'flag',
      tone: 'sand',
      description: '',
      is_epic: false,
      properties: [{ property_id: data.id, required: true }],
      archived_at: null,
    });
    expect(workItemType.status(), await workItemType.text()).toBe(201);
    // Task stays the default type: a default type cannot go while the project is still being purged
    ({ identifier } = await createE2eProject(page, name('required'), { types: ['Task', `${prefix} Abnahme`] }));

    await openProject(page, identifier);
    const { dialog, title } = await openDialog(page);
    const type = dialog.getByRole('combobox', { name: new RegExp(`^${tr('en', 'items.create.type')}`) });
    await tabTo(page, type, { backwards: true, max: 4 });
    await page.keyboard.press('Enter');
    await arrowTo(page, page.getByRole('option', { name: `${prefix} Abnahme`, exact: true }));
    await page.keyboard.press('Enter');
    await expect(type).toContainText(`${prefix} Abnahme`);
    await tabTo(page, title, { max: 4 });
    await expect(dialog.getByRole('heading', { name: tr('en', 'items.create.properties', { type: `${prefix} Abnahme` }) })).toBeVisible();
    await page.keyboard.type('E2E Startseite abnehmen');
    await tabTo(page, dialog.getByRole('textbox', { name: new RegExp(`^${prefix} Prüfer`) }), { max: 30 });
    await page.keyboard.type('Mara');
    await pressMod(page, 'Enter');

    await expect(created(page, `${identifier}-1`)).toBeVisible();
    await expect(dialog).toBeHidden();
    expect((await readItem(page, `${identifier}-1`)).values).toEqual({ [key]: 'Mara' });
  } finally {
    // the item first: while the purge waits in the queue it would carry the type, and deleting the type would only
    // archive it
    if (identifier) await api(page, 'DELETE', `/api/v1/work-items/${identifier}-1`);
    if (identifier) await removeE2eProject(page, identifier);
    await removeCatalogEntries(page, 'work-item-types', 'name', prefix);
    await removeCatalogEntries(page, 'properties', 'label', prefix);
  }
});

test('creates several items in a row with another one', async ({ page }) => {
  const { identifier } = await createE2eProject(page, name('several'), { types: ['Task'] });
  try {
    await openProject(page, identifier);
    const { dialog, title } = await openDialog(page);

    const another = dialog.getByRole('switch', { name: tr('en', 'items.create.another') });
    await tabTo(page, another, { backwards: true, max: 10 });
    await page.keyboard.press('Space');
    await expect(another).toHaveAttribute('aria-checked', 'true');
    await tabTo(page, title, { max: 10 });

    await page.keyboard.type('E2E Impressum prüfen');
    await pressMod(page, 'Enter');
    await expect(created(page, `${identifier}-1`)).toBeVisible();
    // the dialog stays, empty, with the focus in the title
    await expect(title).toHaveValue('');
    await expect(title).toBeFocused();

    // Enter in the title creates as well
    await page.keyboard.type('E2E Datenschutz prüfen');
    await page.keyboard.press('Enter');
    await expect(created(page, `${identifier}-2`)).toBeVisible();
    await expect(title).toHaveValue('');

    // closed empty: nothing to bring back
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(page.getByText(tr('en', 'items.create.parked'), { exact: true })).toHaveCount(0);
    expect((await readItem(page, `${identifier}-1`)).title).toBe('E2E Impressum prüfen');
    expect((await readItem(page, `${identifier}-2`)).title).toBe('E2E Datenschutz prüfen');
  } finally {
    await removeE2eProject(page, identifier);
  }
});

test('creates an item with a pasted image and a mention', async ({ page }) => {
  const { identifier } = await createE2eProject(page, name('image'), { types: ['Task'] });
  try {
    await openProject(page, identifier);
    const { dialog } = await openDialog(page);
    await page.keyboard.type('E2E Plakat abnehmen');

    // the description is written in the project of the dialog: `@` offers its people, pictures go into it
    const description = dialog.getByRole('textbox', { name: tr('en', 'editor.label.description') });
    await tabTo(page, description, { max: 4 });
    await page.keyboard.type('Bitte @mara');
    await expect(page.getByRole('option')).toHaveCount(1);
    await expect(page.getByRole('option', { name: /Mara Lindqvist/ })).toBeVisible();
    await page.keyboard.press('Enter');
    await page.keyboard.type('prüfen:');
    await expect(dialog.locator('.rt-mention')).toHaveText('@mara');

    // what a browser hands over when a screenshot is pasted: a file, no HTML
    await description.evaluate((element, base64) => {
      const data = new DataTransfer();
      data.items.add(new File([Uint8Array.from(atob(base64), (char) => char.charCodeAt(0))], 'plakat.png', { type: 'image/png' }));
      element.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
    }, PIXEL);
    await expect(dialog.getByRole('img', { name: 'plakat.png' })).toBeVisible();

    await pressMod(page, 'Enter');
    await expect(created(page, `${identifier}-1`)).toBeVisible();
    await expect(dialog).toBeHidden();

    // the item holds the mention and the picture, which now belongs to it
    const response = await api(page, 'GET', `/api/v1/work-items/${identifier}-1`);
    expect(response.status(), await response.text()).toBe(200);
    const markdown = ((await response.json()) as { data: { description: string } }).data.description;
    expect(markdown).toMatch(/^Bitte @mara prüfen:/);
    const attachment = /!\[plakat\.png\]\(attachment:([0-9a-z]{26})\)/.exec(markdown)?.[1];
    expect(attachment).toBeTruthy();
    const record = await api(page, 'GET', `/api/v1/attachments/${attachment}`);
    expect(record.status(), await record.text()).toBe(200);
    expect(((await record.json()) as { data: { owner: { type: string } | null } }).data.owner?.type).toBe('work_item');
  } finally {
    await removeE2eProject(page, identifier);
  }
});

test('opens the new item in the preview from the toast', async ({ page }) => {
  const { identifier } = await createE2eProject(page, name('preview'), { types: ['Task'] });
  try {
    await openProject(page, identifier);
    const { dialog } = await openDialog(page);
    await page.keyboard.type('E2E Footer anpassen');
    await pressMod(page, 'Enter');
    await expect(dialog).toBeHidden();

    // `c` came from nowhere: the closed dialog gives the focus to the main area (never the body); the toasts come last
    // on the page, so on from there the toast's "Open" comes after the settings
    const toast = page.getByRole('status').filter({ has: created(page, `${identifier}-1`) });
    await tabTo(page, toast.getByRole('button', { name: tr('en', 'items.create.open'), exact: true }), { max: 80 });
    await page.keyboard.press('Enter');
    const preview = page.getByRole('complementary', { name: tr('en', 'items.peek.label') });
    await expect(preview.getByRole('heading', { name: 'E2E Footer anpassen' })).toBeVisible();
  } finally {
    await removeE2eProject(page, identifier);
  }
});

test('creates a child item of an epic from its children section', async ({ page }) => {
  const { id, identifier } = await createE2eProject(page, name('child'), { types: ['Task', 'Epic'] });
  try {
    const epic = await createItem(page, { project_id: id, type_id: (await idOf(page, 'work-item-types', 'Epic')).id, title: 'E2E Relaunch Phase 2' });
    await page.goto(`/items/${epic.key}`);
    await expect(page.getByRole('heading', { level: 1, name: 'E2E Relaunch Phase 2' })).toBeVisible();
    const section = page.getByRole('region', { name: tr('en', 'items.detail.children.title') });
    const add = section.getByRole('button', { name: new RegExp(`^${tr('en', 'items.detail.children.add')}`) });
    await tabTo(page, add, { max: 80 });
    await page.keyboard.press('Enter');

    const dialog = page.getByRole('dialog', { name: tr('en', 'items.create.title') });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('combobox', { name: new RegExp(`^${tr('en', 'items.create.type')}`) })).toContainText('Task');
    await expect(dialog.getByRole('combobox', { name: `${tr('en', 'items.fields.parent.label')}: ${epic.key} E2E Relaunch Phase 2` })).toBeVisible();
    await expect(dialog.getByRole('textbox', { name: new RegExp(`^${tr('en', 'items.create.title_label')}`) })).toBeFocused();
    await page.keyboard.type('E2E Navigation umbauen');
    await pressMod(page, 'Enter');

    await expect(created(page, `${identifier}-2`)).toBeVisible();
    await expect(dialog).toBeHidden();
    await expect(section.getByRole('link', { name: new RegExp('E2E Navigation umbauen') })).toBeVisible();
    expect((await readItem(page, `${identifier}-2`)).parent_id).toBe(epic.id);
  } finally {
    await removeE2eProject(page, identifier);
  }
});

test('opens the dialog from "New item" of my items', async ({ page }) => {
  await page.goto('/my-items');
  // the one in the toolbar: the empty list has one as well, but only while nothing is assigned to the e2e person
  const button = page.locator('[data-items-toolbar]').getByRole('button', { name: new RegExp(`^${tr('en', 'commands.create.label')}`) });
  await expect(button).toBeVisible();
  await expect(button).not.toHaveAttribute('aria-disabled', 'true');
  await tabTo(page, button, { max: 80 });
  await page.keyboard.press('Enter');

  const dialog = page.getByRole('dialog', { name: tr('en', 'items.create.title') });
  await expect(dialog.getByRole('textbox', { name: new RegExp(`^${tr('en', 'items.create.title_label')}`) })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(button).toBeFocused();
});

test('gives the focus back to what had it before the palette that opened the dialog', async ({ page }) => {
  await page.goto('/my-items');
  const button = page.locator('[data-items-toolbar]').getByRole('button', { name: new RegExp(`^${tr('en', 'commands.create.label')}`) });
  await expect(button).not.toHaveAttribute('aria-disabled', 'true');
  await tabTo(page, button, { max: 80 });

  await pressMod(page, 'k');
  const palette = page.getByRole('dialog', { name: tr('en', 'palette.title') });
  await expect(palette.getByRole('combobox', { name: tr('en', 'palette.input') })).toBeFocused();
  await page.keyboard.type(tr('en', 'commands.create.label'));
  await expect(palette.getByRole('option', { name: new RegExp(`^${tr('en', 'commands.create.label')}`) })).toBeVisible();
  await page.keyboard.press('Enter');

  const dialog = page.getByRole('dialog', { name: tr('en', 'items.create.title') });
  await expect(dialog.getByRole('textbox', { name: new RegExp(`^${tr('en', 'items.create.title_label')}`) })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(button).toBeFocused();
});
