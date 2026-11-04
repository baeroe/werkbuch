import type { Page } from '@playwright/test';
import { expect, test } from '../fixtures';
import { api, createE2ePage, createE2eProject, createItem, removeE2eProject, runId, searchToken, tabTo, tr, variant, waitForSearch } from '../helpers';

// The rich text editor in the description of an item, signed in as the e2e person in English: pictures pasted, files
// chosen over `/`, code highlighting, `@` and `#` with the keyboard. jsdom knows no ClipboardEvent and no file choice,
// so pasting and choosing files are only checked here. Each test works in a project of its own (`E2E …`, removed in
// `finally`); its items and files are made by the test.

const name = (what: string) => `E2E ${what} ${variant()} ${runId()}`;

/** A PNG of one pixel. */
const PIXEL = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

/** Opens the page of an item and puts the focus into its description, once that can be edited. */
async function editDescription(page: Page, key: string, title: string) {
  await page.goto(`/items/${key}`);
  await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible();
  const section = page.getByRole('region', { name: tr('en', 'items.detail.description.title') });
  const editor = section.getByRole('textbox', { name: tr('en', 'editor.label.description') });
  await tabTo(page, editor, { max: 120 });
  return { section, editor };
}

/** The Markdown of an item's description as the server holds it. */
async function storedDescription(page: Page, id: string): Promise<string | null> {
  const response = await api(page, 'GET', `/api/v1/work-items/${id}`);
  expect(response.status(), await response.text()).toBe(200);
  return ((await response.json()) as { data: { description: string | null } }).data.description;
}

test('pastes an image into the description and shows it after a reload', async ({ page }) => {
  const { id, identifier } = await createE2eProject(page, name('paste'), { types: ['Task'] });
  try {
    const item = await createItem(page, { project_id: id, title: 'E2E Plakat drucken' });
    const { section, editor } = await editDescription(page, item.key, 'E2E Plakat drucken');
    await page.keyboard.type('Entwurf:');

    // what a browser hands over when a screenshot is pasted: a file, no HTML
    await editor.evaluate((element, base64) => {
      const data = new DataTransfer();
      data.items.add(new File([Uint8Array.from(atob(base64), (char) => char.charCodeAt(0))], 'plakat.png', { type: 'image/png' }));
      element.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
    }, PIXEL);
    await expect(section.getByRole('img', { name: 'plakat.png' })).toBeVisible();
    // the description saves the image node: the attachment's id, never a path
    await expect.poll(() => storedDescription(page, item.id)).toMatch(/!\[plakat\.png\]\(attachment:[0-9a-z]{26}\)/);

    await page.reload();
    const image = page.getByRole('region', { name: tr('en', 'items.detail.description.title') }).getByRole('img', { name: 'plakat.png' });
    await expect(image).toBeVisible();
    // the picture itself loads, with the session's cookie
    await expect.poll(() => image.evaluate((element: HTMLImageElement) => element.complete && element.naturalWidth)).toBe(1);
  } finally {
    await page.goto('/my-items');
    await removeE2eProject(page, identifier);
  }
});

test('chooses a file over / and downloads it', async ({ page }) => {
  const { id, identifier } = await createE2eProject(page, name('file'), { types: ['Task'] });
  try {
    const item = await createItem(page, { project_id: id, title: 'E2E Treffen planen' });
    const { section } = await editDescription(page, item.key, 'E2E Treffen planen');

    await page.keyboard.type('/file');
    await expect(page.getByRole('option', { name: tr('en', 'editor.slash.file') })).toBeVisible();
    const chooser = page.waitForEvent('filechooser');
    await page.keyboard.press('Enter');
    await (await chooser).setFiles({ name: 'notizen.txt', mimeType: 'text/plain', buffer: Buffer.from('Treffpunkt 9 Uhr am Funkmast.') });

    const link = section.getByRole('link', { name: 'notizen.txt' });
    await expect(link).toBeVisible();
    await expect.poll(() => storedDescription(page, item.id)).toMatch(/\[notizen\.txt\]\(attachment:[0-9a-z]{26}\)/);

    const download = page.waitForEvent('download');
    await link.click();
    const file = await download;
    expect(file.suggestedFilename()).toBe('notizen.txt');
    const stream = await file.createReadStream();
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(chunk as Buffer);
    expect(Buffer.concat(chunks).toString()).toBe('Treffpunkt 9 Uhr am Funkmast.');
  } finally {
    await page.goto('/my-items');
    await removeE2eProject(page, identifier);
  }
});

test('highlights code typed after ``` and a language', async ({ page }) => {
  const { id, identifier } = await createE2eProject(page, name('code'), { types: ['Task'] });
  try {
    const item = await createItem(page, { project_id: id, title: 'E2E Skript prüfen' });
    const { section } = await editDescription(page, item.key, 'E2E Skript prüfen');

    await page.keyboard.type('```typescript ');
    await page.keyboard.type('const answer = 42;');
    const code = section.locator('pre code');
    await expect(code.locator('.hljs-keyword', { hasText: 'const' })).toBeVisible();
    await expect(code.locator('.hljs-number', { hasText: '42' })).toBeVisible();
    // the highlighting is decoration only: the server stores the text and the language
    await expect.poll(() => storedDescription(page, item.id)).toBe('```typescript\nconst answer = 42;\n```');
  } finally {
    await page.goto('/my-items');
    await removeE2eProject(page, identifier);
  }
});

test('mentions over @ and refers over #', async ({ page }) => {
  const { id, identifier } = await createE2eProject(page, name('refs'), { types: ['Task'] });
  try {
    const target = await createItem(page, { project_id: id, title: `E2E Funkmast aufstellen ${searchToken()}` });
    await waitForSearch(page, searchToken(), (data) => data.items.some((hit) => hit.id === target.id));
    const item = await createItem(page, { project_id: id, title: 'E2E Abnahme vorbereiten' });
    const { section } = await editDescription(page, item.key, 'E2E Abnahme vorbereiten');

    await page.keyboard.type('Bitte @mara');
    // the list narrows as the handle is typed: only Mara is left
    await expect(page.getByRole('option')).toHaveCount(1);
    await expect(page.getByRole('option', { name: /Mara Lindqvist/ })).toBeVisible();
    await page.keyboard.press('Enter');
    await page.keyboard.type('prüfen, siehe #');
    // without a word the list asks for one (under the list; the editor's live region says it too)
    await expect(page.locator('p', { hasText: tr('en', 'editor.reference.hint') })).toBeVisible();
    await expect(section.locator('[data-editor-announcer]')).toHaveText(tr('en', 'editor.reference.hint'));
    await page.keyboard.type(searchToken());
    await expect(page.getByRole('option')).toHaveCount(1);
    await expect(page.getByRole('option', { name: new RegExp(target.key) })).toBeVisible();
    await page.keyboard.press('Enter');

    await expect(section.locator('.rt-mention')).toHaveText('@mara');
    await expect(section.locator('.rt-ref')).toContainText(target.key);
    // Markdown names the handle and the key the item has now
    await expect.poll(() => storedDescription(page, item.id)).toMatch(new RegExp(`^Bitte @mara prüfen, siehe ${target.key}\\s*$`));
  } finally {
    await page.goto('/my-items');
    await removeE2eProject(page, identifier);
  }
});

test('refers to a wiki page with # in a description', async ({ page }) => {
  const { id, identifier } = await createE2eProject(page, name('page refs'), { types: ['Task'] });
  try {
    const target = await createE2ePage(page, id, { title: `E2E Leuchtfeuer ${searchToken()}` });
    // `#` takes one word (a blank ends the list): the token alone
    await waitForSearch(page, searchToken(), (data) => data.pages.some((hit) => hit.id === target.id));
    const item = await createItem(page, { project_id: id, title: 'E2E Seite verlinken' });
    const { section, editor } = await editDescription(page, item.key, 'E2E Seite verlinken');

    await page.keyboard.type(`Mehr dazu in #${searchToken()}`);
    const menu = page.getByRole('listbox', { name: tr('en', 'editor.reference.label') });
    const pages = menu.getByRole('group', { name: tr('en', 'editor.reference.pages') });
    await expect(pages.getByRole('option')).toHaveCount(1);
    await expect(pages.getByRole('option', { name: new RegExp(`E2E Leuchtfeuer ${searchToken()}`) })).toContainText(tr('en', 'wiki.place', { identifier }));
    // no item has the token: the list holds the page alone, under its heading
    await expect(menu.getByRole('group', { name: tr('en', 'editor.reference.items') })).toHaveCount(0);
    await page.keyboard.press('Enter');

    // while editing: the title the page has now, no link
    await expect(section.locator('.rt-ref')).toHaveText(`E2E Leuchtfeuer ${searchToken()}`);
    await expect(section.locator('a.rt-ref')).toHaveCount(0);
    // the stored text names the page by its id; its Markdown carries the title the page has now
    await expect.poll(() => storedDescription(page, item.id)).toMatch(new RegExp(`^Mehr dazu in \\[E2E Leuchtfeuer ${searchToken()}\\]\\(page:${target.id}\\)\\s*$`));

    // read where no one edits (a comment): a link into the wiki of the project
    await editor.blur();
    const comment = await api(page, 'POST', `/api/v1/work-items/${item.id}/comments`, { body: `Siehe [x](page:${target.id})` });
    expect(comment.status(), await comment.text()).toBe(201);
    await page.reload();
    const link = page.locator('[data-comment-card] a.rt-ref');
    // screen readers hear the wiki the page is in (T18-M2)
    await expect(link).toHaveAccessibleName(`E2E Leuchtfeuer ${searchToken()}, ${tr('en', 'wiki.place', { identifier })}`);
    await link.focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(new RegExp(`/projects/${identifier}/wiki/${target.id}$`));
    await expect(page.getByRole('textbox', { name: tr('en', 'wiki.page.title_label') })).toHaveValue(`E2E Leuchtfeuer ${searchToken()}`);
  } finally {
    await page.goto('/my-items');
    await removeE2eProject(page, identifier);
  }
});
