import type { Locator, Page } from '@playwright/test';
import { expect, test } from '../fixtures';
import { api, arrowTo, createE2eProject, createItem, pasteFile, PEOPLE, pngBytes, pressMod, removeE2eProject, runId, tabTo, tr, variant } from '../helpers';

// Writing comments, signed in as the e2e person (Erik Ende, English). Each test works in a project of its own
// (`E2E …`, removed in `finally`); its items come over the API.

const name = (what: string) => `E2E comments ${what} ${variant()} ${runId()}`;

interface StoredComment {
  body: string;
  edited_at: string | null;
  reactions: { emoji: string; user_ids: string[] }[];
}

/** The comments of an item as the server holds them. */
async function commentsOf(page: Page, id: string): Promise<StoredComment[]> {
  const response = await api(page, 'GET', `/api/v1/work-items/${id}/comments`);
  expect(response.status(), await response.text()).toBe(200);
  return ((await response.json()) as { data: StoredComment[] }).data;
}

/** The texts of the comments of an item as the server holds them (Markdown). */
async function storedComments(page: Page, id: string): Promise<string[]> {
  return (await commentsOf(page, id)).map((comment) => comment.body);
}

/** Writes a comment over the API, as the e2e person. */
async function addComment(page: Page, itemId: string, body: string) {
  const response = await api(page, 'POST', `/api/v1/work-items/${itemId}/comments`, { body });
  expect(response.status(), await response.text()).toBe(201);
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

test('edits and deletes a comment with undo (mod+z)', async ({ page }) => {
  const { id, identifier } = await createE2eProject(page, name('edit'), { types: ['Task'] });
  try {
    const item = await createItem(page, { project_id: id, title: 'E2E Kommentar bearbeiten' });
    await addComment(page, item.id, 'First version.');
    await page.goto(`/items/${item.key}`);
    const card = page.getByRole('article', { name: tr('en', 'items.comments.card', { name: PEOPLE.e2e.name }) });
    await expect(card).toContainText('First version.');

    // edit from the menu of its actions: the editor takes the text, mod+enter saves, the focus goes back to the actions
    const actions = card.getByRole('button', { name: tr('en', 'items.comments.actions', { name: PEOPLE.e2e.name }) });
    await tabTo(page, actions, { max: 120 });
    await page.keyboard.press('Enter');
    await arrowTo(page, page.getByRole('menuitem', { name: tr('en', 'items.comments.edit') }));
    await page.keyboard.press('Enter');
    const editor = card.getByRole('textbox', { name: tr('en', 'items.comments.edit_label') });
    await expect(editor).toBeFocused();
    await page.keyboard.type(' Updated.');
    await pressMod(page, 'Enter');
    await expect(editor).toBeHidden();
    await expect(card).toContainText('First version. Updated.');
    await expect(card.getByText(tr('en', 'items.comments.edited'))).toBeVisible();
    // the moment of the edit for screen readers too (F26)
    await expect(card.locator('time.sr-only')).toHaveCount(1);
    await expect(actions).toBeFocused();
    expect(await storedComments(page, item.id)).toEqual(['First version. Updated.']);

    // delete: the card goes at once, mod+z brings it back, nothing went out
    await page.keyboard.press('Enter');
    await arrowTo(page, page.getByRole('menuitem', { name: tr('en', 'items.comments.delete') }));
    await page.keyboard.press('Enter');
    await expect(card).toBeHidden();
    // the last card: the focus moves on to the composer
    await expect(page.getByRole('button', { name: tr('en', 'items.comments.write') })).toBeFocused();
    await expect(page.getByText(tr('en', 'items.comments.deleted'))).toBeVisible();
    await pressMod(page, 'z');
    await expect(card).toBeVisible();
    expect(await storedComments(page, item.id)).toEqual(['First version. Updated.']);

    // deleted for good once the toast has run out
    await tabTo(page, actions, { max: 120 });
    await page.keyboard.press('Enter');
    await arrowTo(page, page.getByRole('menuitem', { name: tr('en', 'items.comments.delete') }));
    await page.keyboard.press('Enter');
    await expect(card).toBeHidden();
    await expect.poll(() => storedComments(page, item.id), { timeout: 15_000 }).toEqual([]);
    await expect(card).toBeHidden();
  } finally {
    await removeE2eProject(page, identifier);
  }
});

test('reacts with an emoji from the picker and takes it back', async ({ page }) => {
  const { id, identifier } = await createE2eProject(page, name('react'), { types: ['Task'] });
  try {
    const item = await createItem(page, { project_id: id, title: 'E2E Reaktion' });
    await addComment(page, item.id, 'Ready for review.');
    await page.goto(`/items/${item.key}`);
    const card = page.getByRole('article', { name: tr('en', 'items.comments.card', { name: PEOPLE.e2e.name }) });
    await expect(card).toContainText('Ready for review.');

    // the picker: search by name, Enter takes the first match
    const react = card.getByRole('button', { name: tr('en', 'items.comments.react') });
    await tabTo(page, react, { max: 120 });
    await page.keyboard.press('Enter');
    const search = page.getByRole('searchbox', { name: tr('en', 'ui.emoji_picker.search_label') });
    await expect(search).toBeFocused();
    await page.keyboard.type('party');
    await page.keyboard.press('Enter');
    const party = card.getByRole('button', { name: tr('en', 'items.comments.reaction.one', { emoji: '🎉', count: '1', names: PEOPLE.e2e.name }) });
    await expect(party).toHaveAttribute('aria-pressed', 'true');
    await expect.poll(async () => (await commentsOf(page, item.id))[0]?.reactions.map((reaction) => reaction.emoji)).toEqual(['🎉']);

    // pressed again with the space bar: taken back, the focus goes on to "Add reaction"
    await tabTo(page, party, { max: 10, backwards: true });
    await page.keyboard.press(' ');
    await expect(party).toBeHidden();
    await expect(react).toBeFocused();
    await expect.poll(async () => (await commentsOf(page, item.id))[0]?.reactions).toEqual([]);
  } finally {
    await removeE2eProject(page, identifier);
  }
});

test('pastes an image into a comment and sends it with mod+enter', async ({ page }) => {
  const { id, identifier } = await createE2eProject(page, name('image'), { types: ['Task'] });
  try {
    const item = await createItem(page, { project_id: id, title: 'E2E Screenshot anhängen' });
    await page.goto(`/items/${item.key}`);
    await expect(page.getByRole('button', { name: tr('en', 'items.comments.write') })).toBeVisible();

    await page.keyboard.press('m');
    const editor = page.getByRole('textbox', { name: tr('en', 'editor.label.comment') });
    await expect(editor).toBeFocused();
    await page.keyboard.type('So sieht es aus:');
    await pasteFile(editor, { name: 'fehler.png', type: 'image/png', bytes: pngBytes(48, 32) });
    await expect(editor.getByRole('img', { name: 'fehler.png' })).toBeVisible();
    // sent once the upload is done (the send waits for it)
    await expect(page.getByRole('progressbar')).toHaveCount(0);
    await pressMod(page, 'Enter');

    await expect(page.getByRole('status').filter({ hasText: tr('en', 'items.comments.sent') })).toBeVisible();
    const card = page.getByRole('article', { name: tr('en', 'items.comments.card', { name: PEOPLE.e2e.name }) });
    await expect(card.getByRole('img', { name: 'fehler.png' })).toBeVisible();
    expect(await storedComments(page, item.id)).toEqual([expect.stringMatching(/^So sieht es aus:\s*!\[fehler\.png\]\(attachment:[0-9a-z]{26}\)\s*$/)]);
  } finally {
    await removeE2eProject(page, identifier);
  }
});
