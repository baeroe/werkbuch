import type { Locator, Page } from '@playwright/test';
import { expect, test } from '../fixtures';
import { api, createE2eProject, createItem, pressMod, removeE2eProject, runId, tabTo, tr, variant } from '../helpers';

// Writing comments, signed in as the e2e person (Erik Ende, English). Each test works in a project of its own
// (`E2E …`, removed in `finally`); its items come over the API.

const name = (what: string) => `E2E comments ${what} ${variant()} ${runId()}`;

/** The texts of the comments of an item as the server holds them (Markdown). */
async function storedComments(page: Page, id: string): Promise<string[]> {
  const response = await api(page, 'GET', `/api/v1/work-items/${id}/comments`);
  expect(response.status(), await response.text()).toBe(200);
  return ((await response.json()) as { data: { body: string }[] }).data.map((comment) => comment.body);
}

/** Presses Escape until `target` is gone (in a field, the first Escape only leaves the field). */
async function escapeUntilHidden(page: Page, target: Locator) {
  for (let tries = 0; tries < 3 && (await target.isVisible()); tries += 1) await page.keyboard.press('Escape');
  await expect(target).toBeHidden();
}

test('writes a comment with m and mod+enter', async ({ page }) => {
  const { id, identifier } = await createE2eProject(page, name('write'), { types: ['Task'] });
  try {
    const item = await createItem(page, { project_id: id, title: 'E2E Kontaktformular prüfen' });
    await page.goto(`/items/${item.key}`);
    await expect(page.getByRole('heading', { level: 1, name: 'E2E Kontaktformular prüfen' })).toBeVisible();
    // the rights are there once the opener shows
    await expect(page.getByRole('button', { name: tr('en', 'items.comments.write') })).toBeVisible();

    await page.keyboard.press('m');
    const editor = page.getByRole('textbox', { name: tr('en', 'editor.label.comment') });
    await expect(editor).toBeFocused();
    await page.keyboard.type('Reproducible on iOS 18.');
    await pressMod(page, 'Enter');

    // sent: the editor is empty again and keeps the focus for the next comment
    await expect(page.getByRole('status').filter({ hasText: tr('en', 'items.comments.sent') })).toBeVisible();
    await expect(editor).toHaveText('');
    await expect(editor).toBeFocused();
    expect(await storedComments(page, item.id)).toEqual(['Reproducible on iOS 18.']);
  } finally {
    await removeE2eProject(page, identifier);
  }
});

test('keeps a draft over closing the preview', async ({ page }) => {
  const { id, identifier } = await createE2eProject(page, name('draft'), { types: ['Task'] });
  try {
    const item = await createItem(page, { project_id: id, title: 'E2E Entwurf behalten' });
    await page.goto(`/projects/${identifier}`);
    const row = page.getByRole('group', { name: new RegExp(`^${item.key} `) });
    await expect(row).toBeVisible();
    await tabTo(page, row, { max: 80 });
    await page.keyboard.press(' ');
    const preview = page.getByRole('complementary', { name: tr('en', 'items.peek.label') });
    await expect(preview.getByRole('heading', { name: 'E2E Entwurf behalten' })).toBeVisible();

    await preview.getByRole('button', { name: tr('en', 'items.comments.write') }).click();
    const editor = preview.getByRole('textbox', { name: tr('en', 'editor.label.comment') });
    await expect(editor).toBeFocused();
    await page.keyboard.type('Half a thought');

    // Escape leaves the editor, the next closes the preview: the text stays the item's draft
    await escapeUntilHidden(page, preview);
    await tabTo(page, row, { max: 80 });
    await page.keyboard.press(' ');
    await preview.getByRole('button', { name: tr('en', 'items.comments.continue') }).click();
    await expect(editor).toHaveText('Half a thought');
    expect(await storedComments(page, item.id)).toEqual([]);
  } finally {
    await removeE2eProject(page, identifier);
  }
});
