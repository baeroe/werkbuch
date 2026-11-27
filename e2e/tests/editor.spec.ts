import type { Locator, Page } from '@playwright/test';
import { expect, test } from '../fixtures';
import { api, arrowTo, createE2ePage, createE2eProject, createItem, pasteFile, pngBytes, removeE2eProject, runId, searchToken, tabTo, tr, uploadViaApi, variant, waitForSearch } from '../helpers';

// The rich text editor in the description of an item, signed in as the e2e person in English: pictures pasted (and
// their alternative text), files chosen over `/`, code highlighting, `@` and `#` with the keyboard, and on a wiki page a
// table from `/` with its menu (alt+F10). jsdom knows no ClipboardEvent and no file choice, so pasting and choosing
// files are only checked here. Each test works in a project of its own (`E2E …`, removed in `finally`); its items, pages
// and files are made by the test.

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

/** The outline style of an element: `none` unless something frames it (the selection of an image, WEBU-15). */
async function outlineOf(element: Locator): Promise<string> {
  return element.evaluate((node) => getComputedStyle(node).outlineStyle);
}

/** Whether an element shows the frame of a selection: a solid outline in the colour of the focus ring. */
async function framed(element: Locator): Promise<boolean> {
  return element.evaluate((node) => {
    const probe = document.createElement('span');
    probe.style.color = 'var(--focus-ring)';
    node.ownerDocument.body.append(probe);
    const ring = getComputedStyle(probe).color;
    probe.remove();
    const style = getComputedStyle(node);
    return style.outlineStyle === 'solid' && style.outlineColor === ring;
  });
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

    // while editing: the title the page has now, a link that is no tab stop (the arrows select it, WEBU-38)
    await expect(section.locator('.rt-ref')).toHaveText(`E2E Leuchtfeuer ${searchToken()}`);
    await expect(section.locator('a.rt-ref')).toHaveAttribute('tabindex', '-1');
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

/** A paragraph of Tiptap JSON: a reference (`kind` item or page) and a text after it. */
const referring = (id: string, kind: 'item' | 'page', after: string) => ({
  type: 'paragraph',
  content: [
    { type: 'reference', attrs: { id, label: null, mentionSuggestionChar: '#', kind } },
    { type: 'text', text: after },
  ],
});

test('opens a reference of a wiki page from its editor with the arrows and Enter (WEBU-38)', async ({ page }) => {
  const { id, identifier } = await createE2eProject(page, name('open refs'), { types: ['Task'] });
  try {
    const target = await createItem(page, { project_id: id, title: 'E2E Funkmast prüfen' });
    const plan = await createE2ePage(page, id, { title: 'E2E Bauplan' });
    const notes = await createE2ePage(page, id, { title: 'E2E Notizen', content_json: { type: 'doc', content: [referring(target.id, 'item', ' is open')] } });
    const links = await createE2ePage(page, id, { title: 'E2E Links', content_json: { type: 'doc', content: [referring(plan.id, 'page', ' to read')] } });
    const preview = page.getByRole('dialog', { name: tr('en', 'items.peek.label') });
    const text = page.getByRole('textbox', { name: tr('en', 'editor.label.page') });

    /** Opens a page and puts the cursor at the start of its text: from the title, Enter goes on into it. */
    const startOfText = async (pageId: string, title: string) => {
      await page.goto(`/projects/${identifier}/wiki/${pageId}`);
      const field = page.getByRole('textbox', { name: tr('en', 'wiki.page.title_label') });
      await expect(field).toHaveValue(title);
      await expect(text.locator('a.rt-ref')).toHaveCount(1);
      await tabTo(page, field, { max: 120 });
      await page.keyboard.press('Enter');
      await expect(text).toBeFocused();
    };

    // the arrow selects the reference at the start (framed), Enter opens the item in the preview; the text stays
    await startOfText(notes.id, 'E2E Notizen');
    await page.keyboard.press('ArrowRight');
    await expect(text.locator('.ProseMirror-selectednode a.rt-ref')).toContainText(target.key);
    await page.keyboard.press('Enter');
    await expect(preview.getByRole('heading', { name: 'E2E Funkmast prüfen' })).toBeVisible();
    await expect(text.locator('p')).toHaveCount(1);
    await expect(text).toContainText(`${target.key} E2E Funkmast prüfen is open`);

    // a page opens as the page
    await startOfText(links.id, 'E2E Links');
    await page.keyboard.press('ArrowRight');
    await expect(text.locator('.ProseMirror-selectednode a.rt-ref')).toHaveText('E2E Bauplan');
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(new RegExp(`/projects/${identifier}/wiki/${plan.id}$`));
    await expect(page.getByRole('textbox', { name: tr('en', 'wiki.page.title_label') })).toHaveValue('E2E Bauplan');
  } finally {
    await page.goto('/my-items');
    await removeE2eProject(page, identifier);
  }
});

test('opens a reference in a description with a click, in a new tab with a modifier (WEBU-38)', async ({ page, context }) => {
  const { id, identifier } = await createE2eProject(page, name('click refs'), { types: ['Task'] });
  try {
    const target = await createItem(page, { project_id: id, title: 'E2E Leitung verlegen' });
    const item = await createItem(page, {
      project_id: id,
      title: 'E2E Verweise klicken',
      description_json: { type: 'doc', content: [referring(target.id, 'item', ' first')] },
    });
    await page.goto(`/items/${item.key}`);
    const section = page.getByRole('region', { name: tr('en', 'items.detail.description.title') });
    await expect(section.getByRole('textbox', { name: tr('en', 'editor.label.description') })).toBeVisible();
    const link = section.getByRole('link', { name: new RegExp(target.key) });

    // a plain click opens the item in the preview, the page stays
    await link.click();
    const preview = page.getByRole('dialog', { name: tr('en', 'items.peek.label') });
    await expect(preview.getByRole('heading', { name: 'E2E Leitung verlegen' })).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`/items/${item.key}$`));
    await preview.getByRole('button', { name: tr('en', 'items.peek.close') }).click();
    await expect(preview).toHaveCount(0);

    // with a modifier the browser opens the page of the item in a new tab, no preview here
    const opened = context.waitForEvent('page');
    await link.click({ modifiers: ['ControlOrMeta'] });
    const tab = await opened;
    await expect(tab).toHaveURL(new RegExp(`/items/${target.key}$`));
    await tab.close();
    await expect(preview).toHaveCount(0);
    // the description is as it was
    await expect.poll(() => storedDescription(page, item.id)).toBe(`${target.key} first`);
  } finally {
    await page.goto('/my-items');
    await removeE2eProject(page, identifier);
  }
});

test('inserts a table over /, moves and closes the list with the keyboard and edits the table from alt+F10', async ({ page }) => {
  // the `/` list offers a table on a wiki page (`slashTable`)
  const { id, identifier } = await createE2eProject(page, name('table'), { types: ['Task'] });
  try {
    const prices = await createE2ePage(page, id, { title: 'Preise' });
    await page.goto(`/projects/${identifier}/wiki/${prices.id}`);
    const section = page.getByRole('main');
    const editor = section.getByRole('textbox', { name: tr('en', 'editor.label.page') });
    await tabTo(page, editor, { max: 120 });
    const blocks = page.getByRole('listbox', { name: tr('en', 'editor.slash.label') });

    // Escape closes the list and keeps what was typed
    await page.keyboard.type('/tab');
    await expect(blocks.getByRole('option', { name: new RegExp(`^${tr('en', 'editor.slash.table')}`) })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(blocks).toBeHidden();
    await expect(editor).toHaveText('/tab');
    for (let typed = 0; typed < 4; typed += 1) await page.keyboard.press('Backspace');

    // ↓ and ↑ walk the list (the editor keeps the focus and names the active entry), Enter takes it
    await page.keyboard.type('/');
    await expect(blocks).toBeVisible();
    const active = () => editor.getAttribute('aria-activedescendant');
    const first = await active();
    await page.keyboard.press('ArrowDown');
    await expect.poll(active).not.toBe(first);
    await page.keyboard.press('ArrowUp');
    await expect.poll(active).toBe(first);
    await page.keyboard.type('table');
    await expect(blocks.getByRole('option', { name: new RegExp(`^${tr('en', 'editor.slash.table')}`) })).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('Enter');
    await expect(blocks).toBeHidden();
    const table = section.locator('table');
    await expect(table).toBeVisible();
    const rows = await table.locator('tr').count();

    // alt+F10 in the table: its menu, the first entry focused; a row below, then a header column
    await page.keyboard.press('Alt+F10');
    const menu = page.getByRole('menu');
    await expect(menu).toBeVisible();
    await arrowTo(page, menu.getByRole('menuitem', { name: tr('en', 'editor.table.row_after') }));
    await page.keyboard.press('Enter');
    await expect(menu).toBeHidden();
    await expect(table.locator('tr')).toHaveCount(rows + 1);
    await expect(section.locator('[data-editor-announcer]')).toHaveText(tr('en', 'editor.table.done.row_added'));
    // the focus is back in the text: typing goes into the cell
    await expect(editor).toBeFocused();

    await page.keyboard.press('Alt+F10');
    await expect(menu).toBeVisible();
    await arrowTo(page, menu.getByRole('menuitemcheckbox', { name: new RegExp(`^${tr('en', 'editor.table.header_column')}`) }));
    await page.keyboard.press('Enter');
    await expect(section.locator('[data-editor-announcer]')).toHaveText(tr('en', 'editor.table.done.header_column_on'));
    await expect(table.locator('tr').nth(1).locator('th')).toHaveCount(1);

    // saved with the rows it has now
    await expect
      .poll(async () => {
        const { data } = (await (await api(page, 'GET', `/api/v1/pages/${prices.id}`)).json()) as { data: { content_json: { content?: { type: string; content?: unknown[] }[] } | null } };
        return data.content_json?.content?.find((node) => node.type === 'table')?.content?.length ?? 0;
      }, { timeout: 10_000 })
      .toBe(rows + 1);
  } finally {
    await page.goto('/my-items');
    await removeE2eProject(page, identifier);
  }
});

test('shows a pasted image large with Enter and edits its alternative text from its menu', async ({ page }) => {
  const { id, identifier } = await createE2eProject(page, name('alt'), { types: ['Task'] });
  try {
    const item = await createItem(page, { project_id: id, title: 'E2E Lageplan beschreiben' });
    const { section, editor } = await editDescription(page, item.key, 'E2E Lageplan beschreiben');
    await page.keyboard.type('Lageplan');
    await pasteFile(editor, { name: 'lageplan.png', type: 'image/png', bytes: pngBytes(40, 30) });
    await expect(section.getByRole('img', { name: 'lageplan.png' })).toBeVisible();
    await expect(section.getByRole('progressbar')).toHaveCount(0);

    // the arrows select the image as a whole, and it shows so (WEBU-15); Enter shows it large, Escape gives the focus
    // back to the text
    const picture = section.getByRole('img', { name: 'lageplan.png' });
    await expect.poll(() => outlineOf(picture)).toBe('none');
    await page.keyboard.press('ArrowDown');
    await expect.poll(() => framed(picture)).toBe(true);
    await page.keyboard.press('Enter');
    const viewer = page.getByRole('dialog', { name: 'lageplan.png' });
    await expect(viewer).toBeVisible();
    await expect(viewer.getByRole('link', { name: tr('en', 'editor.image.viewer.download') })).toHaveAttribute('href', /\?download=1$/);
    await page.keyboard.press('Escape');
    await expect(viewer).toBeHidden();
    await expect(editor).toBeFocused();

    // alt+F10 on the selected image: its menu; the alternative text from there, Enter saves it
    await page.keyboard.press('Alt+F10');
    const menu = page.getByRole('menu');
    await expect(menu).toBeVisible();
    await arrowTo(page, menu.getByRole('menuitem', { name: tr('en', 'editor.image.menu_alt') }));
    await page.keyboard.press('Enter');
    const alt = section.getByRole('textbox', { name: tr('en', 'editor.image.alt') });
    await expect(alt).toBeFocused();
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.type('Lageplan mit Zufahrt');
    await page.keyboard.press('Enter');
    await expect(alt).toHaveCount(0);
    const described = section.getByRole('img', { name: 'Lageplan mit Zufahrt' });
    await expect(described).toBeVisible();
    await expect.poll(() => storedDescription(page, item.id)).toMatch(/!\[Lageplan mit Zufahrt\]\(attachment:[0-9a-z]{26}\)/);
    // still selected after the alternative text, the frame goes once the selection moves on
    await expect.poll(() => framed(described)).toBe(true);
    await page.keyboard.press('ArrowUp');
    await expect.poll(() => outlineOf(described)).toBe('none');
  } finally {
    await page.goto('/my-items');
    await removeE2eProject(page, identifier);
  }
});

test('frames an image selected with a click and lets the frame go with the selection (WEBU-15)', async ({ page }) => {
  const { id, identifier } = await createE2eProject(page, name('frame'), { types: ['Task'] });
  try {
    const file = await uploadViaApi(page, id, { name: 'zufahrt.png', type: 'image/png', bytes: pngBytes(60, 40) });
    const item = await createItem(page, {
      project_id: id,
      title: 'E2E Zufahrt zeigen',
      description_json: {
        type: 'doc',
        content: [
          { type: 'paragraph', content: [{ type: 'text', text: 'Die Zufahrt' }] },
          { type: 'image', attrs: { attachmentId: file.id, alt: 'Zufahrt' } },
        ],
      },
    });
    const { section } = await editDescription(page, item.key, 'E2E Zufahrt zeigen');
    const picture = section.getByRole('img', { name: 'Zufahrt' });
    await expect.poll(() => picture.evaluate((element: HTMLImageElement) => element.complete && element.naturalWidth)).toBe(60);
    await expect.poll(() => outlineOf(picture)).toBe('none');

    // a click selects the image: it shows a frame, and the tab of its menu comes
    await picture.click();
    await expect.poll(() => framed(picture)).toBe(true);
    await expect(section.getByRole('button', { name: tr('en', 'editor.image.menu') })).toBeVisible();

    // the selection moves on to the text above: the frame goes
    await page.keyboard.press('ArrowUp');
    await expect.poll(() => outlineOf(picture)).toBe('none');
  } finally {
    await page.goto('/my-items');
    await removeE2eProject(page, identifier);
  }
});

test('frames the box of an image that does not load once it is selected (WEBU-15)', async ({ page, allowedErrors }) => {
  const { id, identifier } = await createE2eProject(page, name('missing'), { types: ['Task'] });
  try {
    const file = await uploadViaApi(page, id, { name: 'fehlt.png', type: 'image/png', bytes: pngBytes(20, 20) });
    const item = await createItem(page, {
      project_id: id,
      title: 'E2E Bild fehlt',
      description_json: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Davor' }] }, { type: 'image', attrs: { attachmentId: file.id, alt: 'Fehlt' } }] },
    });
    // the attachment is gone for this page: the image keeps its place as a box that says so
    allowedErrors.push(/status of 404 .*\/api\/v1\/attachments\//);
    await page.route(`**/api/v1/attachments/${file.id}`, (route) => route.fulfill({ status: 404, contentType: 'application/problem+json', body: JSON.stringify({ status: 404, reason: 'not_found' }) }));
    const { section } = await editDescription(page, item.key, 'E2E Bild fehlt');
    const box = section.locator('.rt-image-missing');
    await expect(box).toContainText(tr('en', 'editor.image.unavailable'));
    await box.click();
    await expect.poll(() => framed(box)).toBe(true);
    await page.keyboard.press('ArrowUp');
    await expect.poll(() => outlineOf(box)).toBe('none');
  } finally {
    await page.unrouteAll({ behavior: 'ignoreErrors' });
    await page.goto('/my-items');
    await removeE2eProject(page, identifier);
  }
});

test('leaves no frame on an image of a comment after it was shown large (WEBU-15)', async ({ page }) => {
  const { id, identifier } = await createE2eProject(page, name('read'), { types: ['Task'] });
  try {
    const item = await createItem(page, { project_id: id, title: 'E2E Bild lesen' });
    const file = await uploadViaApi(page, id, { name: 'lesen.png', type: 'image/png', bytes: pngBytes(60, 40) });
    const response = await api(page, 'POST', `/api/v1/work-items/${item.id}/comments`, {
      body_json: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Ansehen' }] }, { type: 'image', attrs: { attachmentId: file.id, alt: 'Lesen' } }] },
    });
    expect(response.status(), await response.text()).toBe(201);
    await page.goto(`/items/${item.key}`);
    const card = page.locator('[data-comment-card]');
    const picture = card.getByRole('img', { name: 'Lesen' });
    await expect.poll(() => picture.evaluate((element: HTMLImageElement) => element.complete && element.naturalWidth)).toBe(60);

    // a click shows it large; ProseMirror selects the clicked image while reading too, but only an editable text frames
    // the selection: after Escape no frame stays on the image
    await picture.click();
    const viewer = page.getByRole('dialog', { name: 'Lesen' });
    await expect(viewer).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(viewer).toBeHidden();
    await expect(card.locator('.ProseMirror-selectednode')).toHaveCount(1);
    expect(await outlineOf(picture)).toBe('none');
  } finally {
    await page.goto('/my-items');
    await removeE2eProject(page, identifier);
  }
});

test('shows the images of a comment large and goes through them with the arrows', async ({ page }) => {
  const { id, identifier } = await createE2eProject(page, name('viewer'), { types: ['Task'] });
  try {
    const item = await createItem(page, { project_id: id, title: 'E2E Bilder ansehen' });
    const first = await uploadViaApi(page, id, { name: 'vorher.png', type: 'image/png', bytes: pngBytes(60, 40) });
    const second = await uploadViaApi(page, id, { name: 'nachher.png', type: 'image/png', bytes: pngBytes(40, 60) });
    const image = (attachment: string, alt: string) => ({ type: 'image', attrs: { attachmentId: attachment, alt } });
    const comment = await api(page, 'POST', `/api/v1/work-items/${item.id}/comments`, {
      body_json: { type: 'doc', content: [image(first.id, 'Vorher'), { type: 'paragraph', content: [{ type: 'text', text: 'und' }] }, image(second.id, 'Nachher')] },
    });
    expect(comment.status(), await comment.text()).toBe(201);

    await page.goto(`/items/${item.key}`);
    const open = page.getByRole('link', { name: tr('en', 'editor.image.view', { name: 'Vorher' }) });
    await expect(open.getByRole('img', { name: 'Vorher' })).toBeVisible();
    await tabTo(page, open, { max: 120 });
    await page.keyboard.press('Enter');

    const viewer = page.getByRole('dialog');
    await expect(viewer).toHaveAccessibleName('Vorher');
    await expect(viewer).toContainText(tr('en', 'editor.image.viewer.counter', { index: 1, count: 2 }));
    await page.keyboard.press('ArrowRight');
    await expect(viewer).toHaveAccessibleName('Nachher');
    await expect(viewer.getByRole('img', { name: 'Nachher' })).toBeVisible();
    await page.keyboard.press('ArrowLeft');
    await expect(viewer).toHaveAccessibleName('Vorher');
    await page.keyboard.press('Escape');
    await expect(viewer).toBeHidden();
    await expect(open).toBeFocused();
  } finally {
    await page.goto('/my-items');
    await removeE2eProject(page, identifier);
  }
});
