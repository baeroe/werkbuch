import type { Page } from '@playwright/test';
import { expect, test } from '../fixtures';
import { allEntries, api, arrowTo, pressMod, removeCatalogEntries, runId, tabTo, tr, variant } from '../helpers';

// Signed in as the e2e person (Erik Ende, org admin), in English, with the keyboard only. Every type and property a test
// creates is called `E2E <variant> <runId> …` and goes again over the API in `finally` (types first: they name the
// properties); the e2e seeder removes what a broken run left. No default of the catalog changes (P18).

/** The name every entry of this test starts with. */
const prefix = () => `E2E ${variant()} ${runId()}`;

/** A key of a property no other run has: the prefix in snake case. */
const keyOf = (rest: string) => `${prefix()} ${rest}`.toLowerCase().replace(/[^a-z0-9]+/g, '_');

async function cleanUp(page: Page): Promise<void> {
  await removeCatalogEntries(page, 'work-item-types', 'name', prefix());
  await removeCatalogEntries(page, 'properties', 'label', prefix());
}

const typeRow = (page: Page, name: string) =>
  page.getByRole('list', { name: tr('en', 'settings.org.section.types') }).getByRole('listitem').filter({ has: page.getByRole('heading', { name, exact: true }) });

const propertyRow = (page: Page, label: string) =>
  page.getByRole('list', { name: tr('en', 'settings.org.section.properties') }).getByRole('listitem').filter({ has: page.getByRole('heading', { name: label, exact: true }) });

test('creates a dropdown property and a type that requires it', async ({ page }) => {
  const label = `${prefix()} Kunde`;
  const name = `${prefix()} Wunsch`;
  await page.goto('/settings/properties');
  await expect(page.getByRole('heading', { level: 2, name: tr('en', 'settings.org.section.properties') })).toBeVisible();

  try {
    // the property: a dropdown with two options
    const createProperty = page.getByRole('button', { name: tr('en', 'settings.properties.create'), exact: true });
    await tabTo(page, createProperty);
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog', { name: tr('en', 'settings.properties.create') });
    await tabTo(page, dialog.getByRole('textbox', { name: tr('en', 'settings.properties.dialog.label') }));
    await page.keyboard.type(label);
    // the key follows the label
    await expect(dialog.getByRole('textbox', { name: tr('en', 'settings.properties.dialog.key') })).toHaveValue(keyOf('Kunde'));

    const fieldType = dialog.getByRole('combobox', { name: new RegExp(`^${tr('en', 'settings.properties.dialog.field_type')}`) });
    await tabTo(page, fieldType);
    await page.keyboard.press('Enter');
    await arrowTo(page, page.getByRole('option', { name: tr('en', 'settings.catalog.field_type.dropdown'), exact: true }));
    await page.keyboard.press('Enter');
    await expect(fieldType).toHaveText(tr('en', 'settings.catalog.field_type.dropdown'));

    const addOption = dialog.getByRole('button', { name: tr('en', 'settings.properties.options.add'), exact: true });
    await tabTo(page, addOption);
    await page.keyboard.press('Enter');
    await expect(dialog.getByRole('textbox', { name: tr('en', 'settings.properties.options.label_of', { number: 1 }) })).toBeFocused();
    await page.keyboard.type('North');
    await tabTo(page, addOption);
    await page.keyboard.press('Enter');
    await expect(dialog.getByRole('textbox', { name: tr('en', 'settings.properties.options.label_of', { number: 2 }) })).toBeFocused();
    await page.keyboard.type('South');
    await pressMod(page, 'Enter');

    await expect(page.getByText(tr('en', 'settings.properties.dialog.created', { label }))).toBeVisible();
    await expect(dialog).toBeHidden();
    await expect(createProperty).toBeFocused();
    const options = propertyRow(page, label).getByRole('list', { name: tr('en', 'settings.properties.options_of', { label }) });
    await expect(options.getByRole('listitem')).toHaveText(['North', 'South']);

    // the type: an icon by the arrows, the property added and required
    await page.goto('/settings/types');
    await expect(page.getByRole('heading', { level: 2, name: tr('en', 'settings.org.section.types') })).toBeVisible();
    const createType = page.getByRole('button', { name: tr('en', 'settings.types.create'), exact: true });
    await tabTo(page, createType);
    await page.keyboard.press('Enter');
    const typeDialog = page.getByRole('dialog', { name: tr('en', 'settings.types.create') });
    await tabTo(page, typeDialog.getByRole('textbox', { name: tr('en', 'settings.catalog.name') }));
    await page.keyboard.type(name);

    await tabTo(page, typeDialog.getByRole('radio', { name: tr('en', 'settings.catalog.type_icon.square_check') }));
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    const lightning = typeDialog.getByRole('radio', { name: tr('en', 'settings.catalog.type_icon.zap') });
    await expect(lightning).toBeFocused();
    await expect(lightning).toHaveAttribute('aria-checked', 'true');

    const add = typeDialog.getByRole('combobox', { name: tr('en', 'settings.types.dialog.add_property') });
    await tabTo(page, add);
    await page.keyboard.press('Enter');
    await arrowTo(page, page.getByRole('option', { name: label, exact: true }), 'ArrowDown', 30);
    await page.keyboard.press('Enter');
    const required = typeDialog.getByRole('checkbox', { name: tr('en', 'settings.types.dialog.required_of', { label }) });
    await tabTo(page, required, { backwards: true });
    await page.keyboard.press('Space');
    await expect(required).toBeChecked();
    await pressMod(page, 'Enter');

    await expect(page.getByText(tr('en', 'settings.types.dialog.created', { name }))).toBeVisible();
    await expect(createType).toBeFocused();
    await expect(typeRow(page, name).getByRole('list', { name: tr('en', 'settings.types.properties_of', { name }) })).toHaveText(
      tr('en', 'settings.types.required_chip', { label }),
    );

    // what the server keeps
    const property = (await allEntries(page, 'properties')).find((entry) => entry.label === label)!;
    const type = (await allEntries(page, 'work-item-types')).find((entry) => entry.name === name)!;
    expect(type.icon).toBe('zap');
    expect(type.properties).toEqual([{ property_id: property.id, required: true, position: 0 }]);
  } finally {
    await cleanUp(page);
  }
});

test('refuses the key of a core field at the field', async ({ page, allowedErrors }) => {
  allowedErrors.push(/status of 422 .*\/api\/v1\/properties/);
  await page.goto('/settings/properties');
  await expect(page.getByRole('heading', { level: 2, name: tr('en', 'settings.org.section.properties') })).toBeVisible();

  await tabTo(page, page.getByRole('button', { name: tr('en', 'settings.properties.create'), exact: true }));
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: tr('en', 'settings.properties.create') });
  await tabTo(page, dialog.getByRole('textbox', { name: tr('en', 'settings.properties.dialog.label') }));
  await page.keyboard.type('Title');
  const key = dialog.getByRole('textbox', { name: tr('en', 'settings.properties.dialog.key') });
  await expect(key).toHaveValue('title');
  await pressMod(page, 'Enter');

  await expect(dialog.getByText(tr('en', 'field.key.core'))).toBeVisible();
  await expect(key).toHaveAttribute('aria-invalid', 'true');
  await expect(key).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  expect((await allEntries(page, 'properties')).map((entry) => entry.key)).not.toContain('title');
});

test('restores an archived type', async ({ page }) => {
  const name = `${prefix()} Former`;
  try {
    const created = await api(page, 'POST', '/api/v1/work-item-types', {
      name,
      icon: 'flag',
      tone: 'sand',
      description: '',
      is_epic: false,
      properties: [],
      archived_at: '2026-10-31T08:00:00Z',
    });
    expect(created.status(), await created.text()).toBe(201);
    await page.goto('/settings/types');
    const row = typeRow(page, name);
    const badge = row.getByText(tr('en', 'settings.types.archived'), { exact: true });
    await expect(badge).toBeVisible();

    const restore = row.getByRole('button', { name: tr('en', 'settings.types.restore', { name }) });
    await tabTo(page, restore, { max: 100 });
    await page.keyboard.press('Enter');
    await expect(page.getByText(tr('en', 'settings.types.restored', { name }))).toBeVisible();
    await expect(badge).toHaveCount(0);
    // the button stays where it was, and offers deleting now
    await expect(row.getByRole('button', { name: tr('en', 'settings.types.delete', { name }) })).toBeFocused();
    expect((await allEntries(page, 'work-item-types')).find((entry) => entry.name === name)!.archived_at).toBeNull();
  } finally {
    await cleanUp(page);
  }
});

test('deletes a property after confirming', async ({ page }) => {
  const label = `${prefix()} Remove me`;
  try {
    const created = await api(page, 'POST', '/api/v1/properties', {
      key: keyOf('remove'),
      label,
      field_type: 'text',
      help: '',
      default_value: null,
      settings: {},
      options: [],
    });
    expect(created.status(), await created.text()).toBe(201);
    await page.goto('/settings/properties');
    const row = propertyRow(page, label);
    await expect(row).toBeVisible();

    // "Cancel" takes the focus first and keeps the property
    const remove = row.getByRole('button', { name: tr('en', 'settings.properties.delete', { label }) });
    await tabTo(page, remove, { max: 100 });
    await page.keyboard.press('Enter');
    const question = page.getByRole('alertdialog', { name: tr('en', 'settings.properties.delete_title', { label }) });
    await expect(question).toContainText(tr('en', 'settings.properties.delete_description'));
    await expect(question.getByRole('button', { name: tr('en', 'common.cancel'), exact: true })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(question).toBeHidden();
    await expect(row).toBeVisible();
    await expect(remove).toBeFocused();

    await page.keyboard.press('Enter');
    await tabTo(page, question.getByRole('button', { name: tr('en', 'settings.properties.delete_confirm'), exact: true }));
    await page.keyboard.press('Enter');
    await expect(page.getByText(tr('en', 'settings.properties.deleted', { label }))).toBeVisible();
    await expect(row).toHaveCount(0);
    // the focus went on to another row, not to the page
    await expect(page.locator('body')).not.toBeFocused();
    await expect(page.getByRole('list', { name: tr('en', 'settings.org.section.properties') }).locator(':focus')).toHaveCount(1);
    expect((await allEntries(page, 'properties')).map((entry) => entry.label)).not.toContain(label);
  } finally {
    await cleanUp(page);
  }
});
