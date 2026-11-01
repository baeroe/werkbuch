import type { Page } from '@playwright/test';
import { expect, test } from '../fixtures';
import { allEntries, api, createE2eProject, createItem, pressMod, removeE2eProject, runId, tabTo, tr, variant } from '../helpers';

// The relations of an item on its page, with the keyboard only, signed in as the e2e person in English. Each test works
// in a project of its own (`E2E …`, removed in `finally`); its items come over the API. Creating a child item from the
// children section needs the create dialog and is in create-item.spec.ts (K11).

const name = (what: string) => `E2E ${what} ${variant()} ${runId()}`;

/** The relations of an item as the API has them. */
async function relationsOf(page: Page, id: string): Promise<unknown[]> {
  const response = await api(page, 'GET', `/api/v1/work-items/${id}/relations`);
  expect(response.status(), await response.text()).toBe(200);
  return ((await response.json()) as { data: unknown[] }).data;
}

test('relates two items with r and removes the relation again', async ({ page }) => {
  const { id, identifier } = await createE2eProject(page, name('relations'), { types: ['Task'] });
  try {
    const first = await createItem(page, { project_id: id, title: 'E2E Kontaktformular prüfen' });
    const second = await createItem(page, { project_id: id, title: 'E2E Mailserver einrichten' });
    // the built-in "relates" type, in the words of the catalog
    const relates = (await allEntries(page, 'relation-types')).find((entry) => entry.built_in === 'relates') as { outward_label: string };

    await page.goto(`/items/${first.key}`);
    await expect(page.getByRole('heading', { level: 1, name: 'E2E Kontaktformular prüfen' })).toBeVisible();
    const section = page.getByRole('region', { name: tr('en', 'items.detail.relations.title') });
    const add = section.getByRole('button', { name: new RegExp(`^${tr('en', 'items.detail.relations.add')}`) });
    // the button is there once the rights have loaded: r acts from then on
    await expect(add).toBeVisible();
    await expect(section.getByText(tr('en', 'items.detail.relations.empty'))).toBeVisible();

    await page.keyboard.press('r');
    const dialog = page.getByRole('dialog', { name: tr('en', 'items.detail.relations.dialog.title') });
    await expect(dialog).toBeVisible();
    // the list of items opens with the dialog; the key finds exactly that item, in any spelling
    const search = page.getByPlaceholder(tr('en', 'items.detail.relations.dialog.search'));
    await expect(search).toBeFocused();
    await page.keyboard.type(second.key.toLowerCase());
    await expect(page.getByRole('option', { name: /E2E Mailserver einrichten/ })).toBeVisible();
    await expect(page.getByRole('option')).toHaveCount(1);
    await page.keyboard.press('Enter');
    await expect(dialog.getByText(`${first.key} ${relates.outward_label} ${second.key}`)).toBeVisible();

    await pressMod(page, 'Enter');
    await expect(dialog).toBeHidden();
    await expect(page.getByText(tr('en', 'items.detail.relations.added'), { exact: true })).toBeVisible();
    await expect(section.getByRole('link', { name: new RegExp(second.key) })).toBeVisible();
    // the focus is back on "Relation"
    await expect(add).toBeFocused();
    expect(await relationsOf(page, second.id)).toHaveLength(1);

    // removed at once on the screen, on the server once the undo toast has run out (5 s)
    const remove = section.getByRole('button', { name: tr('en', 'items.detail.relations.remove', { label: relates.outward_label, key: second.key }) });
    await tabTo(page, remove, { max: 20 });
    await page.keyboard.press('Enter');
    await expect(section.getByRole('link', { name: new RegExp(second.key) })).toHaveCount(0);
    await expect(page.getByText(tr('en', 'items.detail.relations.removed', { label: relates.outward_label, key: second.key }))).toBeVisible();
    await expect(add).toBeFocused();
    await expect.poll(() => relationsOf(page, first.id), { timeout: 15_000 }).toHaveLength(0);
    expect(await relationsOf(page, second.id)).toHaveLength(0);
    await expect(section.getByText(tr('en', 'items.detail.relations.empty'))).toBeVisible();
  } finally {
    await page.goto('/my-items');
    await removeE2eProject(page, identifier);
  }
});
