import type { Locator, Page } from '@playwright/test';
import { expect, test } from '../fixtures';
import { api, arrowTo, channelHeld, createE2ePage, createE2eProject, createItem, isPhone, pasteFile, PEOPLE, pngBytes, pressMod, removeE2eProject, runId, tabTo, tr, uploadViaApi, variant } from '../helpers';

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

    // the composer stands on top, newest first: the next comment lands right under it, above the first (WEBU-37)
    await page.keyboard.type('Only in Safari.');
    await pressMod(page, 'Enter');
    const timeline = page.getByRole('list', { name: tr('en', 'items.activity.list') });
    const cards = timeline.getByRole('article', { name: tr('en', 'items.comments.card', { name: PEOPLE.e2e.name }) });
    await expect(cards).toHaveCount(2);
    await expect(cards.nth(0)).toContainText('Only in Safari.');
    await expect(cards.nth(1)).toContainText('Reproducible on iOS 18.');
    const composerBottom = await page.locator('[data-comment-composer]').evaluate((box) => box.getBoundingClientRect().bottom);
    const timelineTop = await timeline.evaluate((list) => list.getBoundingClientRect().top);
    expect(composerBottom).toBeLessThan(timelineTop);
    await expect(editor).toBeFocused();
  } finally {
    await removeE2eProject(page, identifier);
  }
});

test('keeps the comment being read in place when a comment comes in on top', async ({ page }) => {
  test.setTimeout(90_000);
  const { id, identifier } = await createE2eProject(page, name('live'), { types: ['Task'] });
  try {
    const item = await createItem(page, { project_id: id, title: 'E2E Neueste zuerst' });
    for (let number = 1; number <= 12; number += 1) {
      await addComment(page, item.id, `Note ${String(number).padStart(2, '0')}: the form sends twice, checked again in another browser.`);
    }
    const held = channelHeld(page, `private-work-item.${item.id}`);
    await page.goto(`/items/${item.key}`);
    await held;
    const timeline = page.getByRole('list', { name: tr('en', 'items.activity.list') });
    const cards = timeline.getByRole('article');
    await expect(cards).toHaveCount(12);
    // newest first, the composer above them
    await expect(cards.nth(0)).toContainText('Note 12');

    // reading further down: note 07 at the top of the window
    const reading = cards.filter({ hasText: 'Note 07:' });
    await reading.evaluate((card) => card.scrollIntoView({ block: 'start' }));
    const top = async () => (await reading.boundingBox())!.y;
    await expect.poll(top).toBeLessThan(200);
    const before = await top();

    // another tab writes (a request without the socket of this one): the comment comes in live, on top, out of sight
    await addComment(page, item.id, 'Arrived live.');
    await expect(cards).toHaveCount(13, { timeout: 20_000 });
    await expect(cards.nth(0)).toContainText('Arrived live.');
    // the comment being read has not moved
    expect(Math.abs((await top()) - before)).toBeLessThan(2);
    expect((await cards.nth(0).boundingBox())!.y).toBeLessThan(0);
  } finally {
    await removeE2eProject(page, identifier);
  }
});

test('writes a comment with a table from /, adds a column with alt+F10 and sends it with mod+enter', async ({ page }) => {
  const { id, identifier } = await createE2eProject(page, name('table'), { types: ['Task'] });
  try {
    const item = await createItem(page, { project_id: id, title: 'E2E Tabelle im Kommentar' });
    await page.goto(`/items/${item.key}`);
    await expect(page.getByRole('heading', { level: 1, name: 'E2E Tabelle im Kommentar' })).toBeVisible();
    await expect(page.getByRole('button', { name: tr('en', 'items.comments.write') })).toBeVisible();

    await page.keyboard.press('m');
    const editor = page.getByRole('textbox', { name: tr('en', 'editor.label.comment') });
    await expect(editor).toBeFocused();
    // a comment takes a table from / too (WEBU-11)
    await page.keyboard.type('/');
    await expect(page.getByRole('listbox', { name: tr('en', 'editor.slash.label') }).getByRole('option', { name: new RegExp(`^${tr('en', 'editor.slash.table')}`) })).toBeVisible();
    await page.keyboard.type(tr('en', 'editor.slash.table'));
    await page.keyboard.press('Enter');
    await expect(editor.locator('table')).toBeVisible();
    await page.keyboard.type('Browser');

    // a column more from the menu of the table, the focus back in the cell
    await page.keyboard.press('Alt+F10');
    const menu = page.getByRole('menu');
    await expect(menu).toBeVisible();
    await arrowTo(page, menu.getByRole('menuitem', { name: tr('en', 'editor.table.column_after') }));
    await page.keyboard.press('Enter');
    await expect(menu).toBeHidden();
    await expect(editor).toBeFocused();
    await expect(editor.locator('table tr').first().locator('th, td')).toHaveCount(4);

    await pressMod(page, 'Enter');
    await expect(page.getByRole('status').filter({ hasText: tr('en', 'items.comments.sent') })).toBeVisible();
    // the card shows the table, and the server holds it as Markdown
    const card = page.getByRole('article', { name: tr('en', 'items.comments.card', { name: PEOPLE.e2e.name }) });
    await expect(card.locator('table tr').first().locator('th, td')).toHaveCount(4);
    await expect(card.locator('table')).toContainText('Browser');
    const [body] = await storedComments(page, item.id);
    expect(body).toContain('| Browser |');
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

/**
 * The widths of its paragraph (from its own down to 120 px) at which the glyph of a reference or a file chip stands on
 * another line than the first character of its text, measured on the glyph and on that character alone.
 */
async function glyphApart(chip: Locator): Promise<number[]> {
  return chip.evaluate((element) => {
    const block = element.closest('p') as HTMLElement;
    const glyph = element.querySelector('svg')!;
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, { acceptNode: (node) => (node.textContent!.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP) });
    const text = walker.nextNode()!;
    const range = document.createRange();
    range.setStart(text, 0);
    range.setEnd(text, 1);
    const apart: number[] = [];
    for (let width = Math.floor(block.getBoundingClientRect().width); width >= 120; width -= 1) {
      block.style.width = `${width}px`;
      const one = glyph.getBoundingClientRect();
      const two = range.getClientRects()[0]!;
      if (!(two.top < one.bottom && one.top < two.bottom)) apart.push(width);
    }
    block.style.width = '';
    return apart;
  });
}

test('wraps a long page reference and a long file name inside the card (WEBU-14)', async ({ page }) => {
  const { id, identifier } = await createE2eProject(page, name('wrap'), { types: ['Task'] });
  try {
    const item = await createItem(page, { project_id: id, title: 'E2E Lange Verweise' });
    const title = 'E2E Rahmenvertrag Betrieb & Support: Konditionen, Leistungsscheine und Eskalationsstufen im Regelbetrieb';
    const wiki = await createE2ePage(page, id, { title });
    const fileName = 'e2e-rahmenvertrag-betrieb-und-support-konditionen-leistungsscheine-entwurf.txt';
    const file = await uploadViaApi(page, id, { name: fileName, type: 'text/plain', bytes: Buffer.from('Entwurf\n') });
    await addComment(page, item.id, `Siehe [Vertrag](page:${wiki.id}). Dazu [${fileName}](attachment:${file.id}).`);

    await page.goto(`/items/${item.key}`);
    const card = page.locator('[data-comment-card]');
    const reference = card.locator('a.rt-ref');
    await expect(reference).toHaveText(title);
    await expect(card.locator('.rt-file a')).toHaveText(fileName);

    // nothing runs over the card or the page: the title and the name wrap like text
    const widths = await card.evaluate((element) => ({ scroll: element.scrollWidth, client: element.clientWidth }));
    expect(widths.scroll).toBeLessThanOrEqual(widths.client);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    for (const chip of [reference, card.locator('.rt-file')]) {
      const outside = await chip.evaluate((element) => {
        const box = element.closest('[data-comment-card]')!.getBoundingClientRect();
        return [...element.getClientRects()].some((line) => line.right > box.right + 0.5 || line.left < box.left - 0.5);
      });
      expect(outside).toBe(false);
    }
    // the glyph stays on the line of the first word, never alone at the end of one: at every width of the paragraph
    for (const chip of [reference, card.locator('.rt-file a')]) {
      expect(await glyphApart(chip)).toEqual([]);
    }
    // a click on the chip outside its link selects it while reading too (ProseMirror), but only an editable text
    // frames the selection: no frame stays in the card
    const chip = card.locator('.rt-file');
    await chip.locator('.rt-file-size').click();
    await expect(card.locator('.ProseMirror-selectednode')).toHaveCount(1);
    expect(await chip.evaluate((element) => getComputedStyle(element).outlineStyle)).toBe('none');
    if (isPhone(page)) {
      // at 390 px the title takes more than one line, the period stays after it
      expect(await reference.evaluate((element) => element.getClientRects().length)).toBeGreaterThan(1);
      expect(await card.locator('.rt-file').evaluate((element) => element.getClientRects().length)).toBeGreaterThan(1);
    }

    // while editing the comment, the selected chip shows its frame (a solid outline in the colour of the focus ring)
    await card.getByRole('button', { name: tr('en', 'items.comments.actions', { name: PEOPLE.e2e.name }) }).click();
    await page.getByRole('menuitem', { name: tr('en', 'items.comments.edit') }).click();
    const editing = card.getByRole('textbox', { name: tr('en', 'items.comments.edit_label') });
    await expect(editing).toBeVisible();
    const editedChip = editing.locator('.rt-file');
    await editedChip.locator('.rt-file-size').click();
    await expect.poll(() => editedChip.evaluate((element) => getComputedStyle(element).outlineStyle)).toBe('solid');
    expect(await editedChip.evaluate((element) => getComputedStyle(element).outlineColor)).toBe(
      await page.evaluate(() => {
        const probe = document.createElement('span');
        probe.style.color = 'var(--focus-ring)';
        document.body.append(probe);
        const colour = getComputedStyle(probe).color;
        probe.remove();
        return colour;
      }),
    );
  } finally {
    await removeE2eProject(page, identifier);
  }
});
