import type { Page } from '@playwright/test';
import { expect, test } from '../fixtures';
import { allEntries, arrowTo, PEOPLE, pressMod, removeCatalogEntries, runId, signedInContext, tabTo, tr, variant } from '../helpers';

// Signed in as the e2e person (Erik Ende, org admin), in English, with the keyboard only. Every entry a test creates is
// called `E2E <variant> <runId> …` and goes again over the API in `finally`; the e2e seeder removes what a broken run
// left. The defaults of the catalogs stay as they are (P18): the variants share one database.

/** The name every entry of this test starts with. */
const prefix = () => `E2E ${variant()} ${runId()}`;

/** Deletes the entries of a catalog whose name (or label) starts with the prefix of this test, whatever it left. */
const removeEntries = (page: Page, path: string, field: 'name' | 'label') => removeCatalogEntries(page, path, field, prefix());

/** Puts `text` into the focused field instead of what is there. */
async function replaceText(page: Page, text: string): Promise<void> {
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.type(text);
}

test('creates, renames and deletes a label with undo', async ({ page }) => {
  const name = `${prefix()} Label`;
  const renamed = `${prefix()} Renamed`;
  await page.goto('/settings/general');

  try {
    // to the section through the list of the settings
    const sections = page.getByRole('navigation', { name: tr('en', 'settings.org.nav_label') });
    await tabTo(page, sections.getByRole('link', { name: tr('en', 'settings.org.section.labels'), exact: true }));
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/settings\/labels$/);
    await expect(page.getByRole('heading', { level: 2, name: tr('en', 'settings.org.section.labels') })).toBeVisible();

    const create = page.getByRole('button', { name: tr('en', 'settings.labels.create'), exact: true });
    await tabTo(page, create);
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog', { name: tr('en', 'settings.labels.create') });
    const nameField = dialog.getByRole('textbox', { name: tr('en', 'settings.catalog.name') });
    await tabTo(page, nameField);
    await page.keyboard.type(name);

    // the tone from its menu: the choice stays open, Escape closes it
    const tone = (key: string) =>
      dialog.getByRole('button', { name: tr('en', 'settings.catalog.tone_named', { label: tr('en', 'settings.labels.dialog.color_label'), tone: tr('en', key) }) });
    await tabTo(page, tone('settings.catalog.tone.sky'));
    await page.keyboard.press('Enter');
    await arrowTo(page, page.getByRole('menuitemradio', { name: tr('en', 'settings.catalog.tone.moss') }));
    await page.keyboard.press('Enter');
    await page.keyboard.press('Escape');
    await expect(page.getByRole('menu')).toBeHidden();
    await expect(tone('settings.catalog.tone.moss')).toBeFocused();

    await tabTo(page, nameField, { backwards: true });
    await page.keyboard.press('Enter');
    await expect(page.getByText(tr('en', 'settings.labels.dialog.created', { name }))).toBeVisible();
    await expect(dialog).toBeHidden();
    await expect(create).toBeFocused();
    const list = page.getByRole('list', { name: tr('en', 'settings.org.section.labels') });
    const row = (label: string) => list.getByRole('listitem').filter({ has: page.getByRole('heading', { name: label, exact: true }) });
    await expect(row(name)).toContainText(tr('en', 'settings.catalog.tone.moss'));

    // rename
    await tabTo(page, row(name).getByRole('button', { name: tr('en', 'settings.labels.edit', { name }) }));
    await page.keyboard.press('Enter');
    const edit = page.getByRole('dialog', { name: tr('en', 'settings.labels.edit', { name }) });
    await tabTo(page, edit.getByRole('textbox', { name: tr('en', 'settings.catalog.name') }));
    await replaceText(page, renamed);
    await page.keyboard.press('Enter');
    await expect(page.getByText(tr('en', 'settings.labels.dialog.saved', { name: renamed }))).toBeVisible();
    await expect(row(renamed).getByRole('button', { name: tr('en', 'settings.labels.edit', { name: renamed }) })).toBeFocused();
    await expect(row(name)).toHaveCount(0);

    // delete, take it back with ⌘Z
    const remove = row(renamed).getByRole('button', { name: tr('en', 'settings.labels.delete', { name: renamed }) });
    await tabTo(page, remove);
    await page.keyboard.press('Enter');
    await expect(row(renamed)).toHaveCount(0);
    const undo = page.getByRole('status').filter({ hasText: tr('en', 'settings.labels.deleted', { name: renamed }) });
    await expect(undo.getByRole('button', { name: tr('en', 'common.undo'), exact: true })).toBeVisible();
    // the focus went on to the next row, not to the top of the page
    await expect(page.locator('body')).not.toBeFocused();
    await pressMod(page, 'z');
    await expect(row(renamed)).toBeVisible();

    // delete for good: the call goes out when the toast runs out
    await tabTo(page, remove);
    const deleted = page.waitForResponse((response) => response.request().method() === 'DELETE' && response.url().includes('/api/v1/labels/'));
    await page.keyboard.press('Enter');
    await expect(row(renamed)).toHaveCount(0);
    expect((await deleted).status()).toBe(200);
    expect((await allEntries(page, 'labels')).map((label) => label.name)).not.toContain(renamed);
  } finally {
    await removeEntries(page, 'labels', 'name');
  }
});

test('creates a symmetric relation type and cannot delete a built-in one', async ({ page }) => {
  const name = `${prefix()} Relation`;
  await page.goto('/settings/relation-types');
  await expect(page.getByRole('heading', { level: 2, name: tr('en', 'settings.org.section.relation_types') })).toBeVisible();

  try {
    const create = page.getByRole('button', { name: tr('en', 'settings.relation_types.create'), exact: true });
    await tabTo(page, create);
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog', { name: tr('en', 'settings.relation_types.create') });
    await tabTo(page, dialog.getByRole('textbox', { name: tr('en', 'settings.catalog.name') }));
    await page.keyboard.type(name);
    const outward = dialog.getByRole('textbox', { name: tr('en', 'settings.relation_types.dialog.outward'), exact: true });
    await tabTo(page, outward);
    await page.keyboard.type('pairs with');

    const symmetric = dialog.getByRole('switch', { name: tr('en', 'settings.relation_types.dialog.symmetric') });
    const inward = dialog.getByRole('textbox', { name: tr('en', 'settings.relation_types.dialog.inward') });
    await tabTo(page, symmetric);
    await page.keyboard.press('Space');
    await expect(inward).toHaveCount(0);
    // off again: the opposite direction comes back with the focus; on again for a symmetric type
    await page.keyboard.press('Space');
    await expect(inward).toBeFocused();
    await tabTo(page, symmetric, { backwards: true });
    await page.keyboard.press('Space');
    await expect(inward).toHaveCount(0);
    await pressMod(page, 'Enter');

    await expect(page.getByText(tr('en', 'settings.relation_types.dialog.created', { name }))).toBeVisible();
    await expect(create).toBeFocused();
    const list = page.getByRole('list', { name: tr('en', 'settings.org.section.relation_types') });
    const row = (typeName: string) => list.getByRole('listitem').filter({ has: page.getByRole('heading', { name: typeName, exact: true }) });
    await expect(row(name)).toContainText(tr('en', 'settings.relation_types.symmetric'));
    await expect(row(name)).toContainText('Item A pairs with Item B');

    // the built-in "blocks" of the demo data: the delete button says why it is locked, and does nothing
    const blocks = row('blockiert');
    await expect(blocks).toContainText(tr('en', 'settings.relation_types.built_in'));
    const reason = tr('en', 'settings.relation_types.built_in_reason', { name: 'blockiert' });
    const locked = blocks.getByRole('button', { name: tr('en', 'settings.relation_types.delete', { name: 'blockiert' }) });
    await tabTo(page, locked);
    await expect(locked).toHaveAttribute('aria-disabled', 'true');
    await expect(locked).toHaveAccessibleDescription(reason);
    await expect(page.getByText(reason).filter({ visible: true })).toBeVisible();
    await page.keyboard.press('Enter');
    await expect(blocks).toBeVisible();
    await expect(page.getByRole('status').filter({ hasText: tr('en', 'common.undo') })).toHaveCount(0);
  } finally {
    await removeEntries(page, 'relation-types', 'name');
  }
});

test('creates a resolution and archives it', async ({ page }) => {
  const label = `${prefix()} Resolution`;
  await page.goto('/settings/resolutions');
  await expect(page.getByRole('heading', { level: 2, name: tr('en', 'settings.org.section.resolutions') })).toBeVisible();

  try {
    await tabTo(page, page.getByRole('button', { name: tr('en', 'settings.resolutions.create'), exact: true }));
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog', { name: tr('en', 'settings.resolutions.create') });
    await tabTo(page, dialog.getByRole('textbox', { name: tr('en', 'settings.resolutions.dialog.label') }));
    await page.keyboard.type(label);
    // no default: the defaults of the catalog stay as they are (P18)
    await expect(dialog.getByRole('combobox', { name: new RegExp(`^${tr('en', 'settings.resolutions.dialog.default_for')}`) })).toHaveText(
      tr('en', 'settings.resolutions.dialog.no_default'),
    );
    await page.keyboard.press('Enter');
    await expect(page.getByText(tr('en', 'settings.resolutions.dialog.created', { label }))).toBeVisible();

    const list = page.getByRole('list', { name: tr('en', 'settings.org.section.resolutions') });
    const row = list.getByRole('listitem').filter({ has: page.getByRole('heading', { name: label, exact: true }) });
    await expect(row).toBeVisible();
    await expect(row).not.toContainText(tr('en', 'settings.resolutions.archived'));

    const edit = row.getByRole('button', { name: tr('en', 'settings.resolutions.edit', { label }) });
    await tabTo(page, edit);
    await page.keyboard.press('Enter');
    const editing = page.getByRole('dialog', { name: tr('en', 'settings.resolutions.edit', { label }) });
    const archive = editing.getByRole('switch', { name: tr('en', 'settings.resolutions.archived') });
    await tabTo(page, archive);
    await page.keyboard.press('Space');
    await expect(archive).toHaveAttribute('aria-checked', 'true');
    await pressMod(page, 'Enter');

    await expect(page.getByText(tr('en', 'settings.resolutions.dialog.saved', { label }))).toBeVisible();
    await expect(row).toContainText(tr('en', 'settings.resolutions.archived'));
    await expect(edit).toBeFocused();
  } finally {
    await removeEntries(page, 'resolutions', 'label');
  }
});

test('lets a member read the catalogs only', async ({ browser }) => {
  // Lene is a member with a German profile
  const { context, page } = await signedInContext(browser, PEOPLE.lene);
  try {
    await page.goto('/settings/labels');
    await expect(page.getByRole('heading', { level: 2, name: tr('de', 'settings.org.section.labels') })).toBeVisible();
    await expect(page.getByText(tr('de', 'settings.access.read_only'), { exact: true })).toBeVisible();
    const first = page.getByRole('list', { name: tr('de', 'settings.org.section.labels') }).getByRole('heading').first();
    await expect(first).toBeVisible();
    const name = (await first.textContent())!;
    await expect(page.getByRole('button', { name: tr('de', 'settings.labels.create') })).toHaveCount(0);
    await expect(page.getByRole('button', { name: tr('de', 'settings.labels.edit', { name }) })).toHaveCount(0);
    await expect(page.getByRole('button', { name: tr('de', 'settings.labels.delete', { name }) })).toHaveCount(0);
  } finally {
    await context.close();
  }
});

test('shows the error of a list that fails to load and loads it again', async ({ page, allowedErrors }) => {
  allowedErrors.push(/status of 503 .*\/api\/v1\/labels/);
  let failed = false;
  await page.route('**/api/v1/labels*', (route) => {
    if (failed) return route.continue();
    failed = true;
    return route.fulfill({ status: 503 });
  });
  await page.goto('/settings/labels');

  await expect(page.getByText(tr('en', 'settings.labels.load_failed'))).toBeVisible();
  await tabTo(page, page.getByRole('button', { name: tr('en', 'common.retry'), exact: true }));
  await page.keyboard.press('Enter');
  await expect(page.getByRole('list', { name: tr('en', 'settings.org.section.labels') }).getByRole('listitem').first()).toBeVisible();
});
