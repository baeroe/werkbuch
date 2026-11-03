import type { Locator, Page } from '@playwright/test';
import { expect, test } from '../fixtures';
import {
  api,
  createE2eProject,
  createItem,
  isPhone,
  PEOPLE,
  pasteFile,
  pngBytes,
  pressMod,
  removeE2eProject,
  runId,
  signedInContext,
  tabTo,
  tr,
  uploadViaApi,
  variant,
} from '../helpers';

// The acceptance of phase 7 (editor, comments, attachments) end to end, signed in as the e2e person in English: Flow 4
// (a mention in a comment), pictures pasted into the description and a comment (also in the form of Chrome's "Copy
// image"), an image of another project refused, no picture for someone who may not read it, an SVG only as a download
// and a comment on the phone. Each test works in a project of its own (`E2E …`, removed in `finally`).

const name = (what: string) => `E2E content ${what} ${variant()} ${runId()}`;

/** What Chrome puts beside the picture on "Copy image": nothing but the `<img>` of the page it came from. */
const CHROME_COPY_IMAGE = '<meta charset="utf-8"><img src="https://picsum.example.com/plakat.png" alt="">';

/** The comments of an item as the server holds them (Markdown). */
async function storedComments(page: Page, id: string): Promise<string[]> {
  const response = await api(page, 'GET', `/api/v1/work-items/${id}/comments`);
  expect(response.status(), await response.text()).toBe(200);
  return ((await response.json()) as { data: { body: string }[] }).data.map((comment) => comment.body);
}

/** The Markdown of an item's description as the server holds it. */
async function storedDescription(page: Page, id: string): Promise<string | null> {
  const response = await api(page, 'GET', `/api/v1/work-items/${id}`);
  expect(response.status(), await response.text()).toBe(200);
  return ((await response.json()) as { data: { description: string | null } }).data.description;
}

/** Whether a picture has loaded: complete, with its width in pixels (0 for one that broke). */
function loadedWidth(image: Locator): Promise<number> {
  return image.evaluate((element: HTMLImageElement) => (element.complete ? element.naturalWidth : 0));
}

/** Opens the page of an item, once its rights let it be commented and edited. */
async function openItem(page: Page, key: string, title: string) {
  await page.goto(`/items/${key}`);
  await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible();
  const opener = page.getByRole('button', { name: tr('en', 'items.comments.write') });
  await expect(opener).toBeVisible();
  return { opener };
}

test('Flow 4: mentions Mara with @ma in a comment, and Mara watches the item', async ({ page }) => {
  const { id, identifier } = await createE2eProject(page, name('mention'), { types: ['Task'] });
  try {
    const item = await createItem(page, { project_id: id, title: 'E2E Funkmast abnehmen' });
    await openItem(page, item.key, 'E2E Funkmast abnehmen');

    await page.keyboard.press('m');
    const editor = page.getByRole('textbox', { name: tr('en', 'editor.label.comment') });
    await expect(editor).toBeFocused();
    await page.keyboard.type('Hallo @ma');
    // the list of people who may be mentioned in the project, Mara first; Enter takes her
    await expect(page.getByRole('option').first()).toContainText(PEOPLE.mara.name);
    await page.keyboard.press('Enter');
    await page.keyboard.type('bitte abnehmen.');
    await pressMod(page, 'Enter');

    await expect(page.getByRole('status').filter({ hasText: tr('en', 'items.comments.sent') })).toBeVisible();
    const card = page.getByRole('article', { name: tr('en', 'items.comments.card', { name: PEOPLE.e2e.name }) });
    await expect(card.locator('.rt-mention')).toHaveText('@mara');
    expect(await storedComments(page, item.id)).toEqual(['Hallo @mara bitte abnehmen.']);

    // the mention made Mara a watcher of the item (her notification comes with phase 8)
    const subscribers = await api(page, 'GET', `/api/v1/work-items/${item.id}/subscribers`);
    expect(subscribers.status(), await subscribers.text()).toBe(200);
    const handles = ((await subscribers.json()) as { data: { handle: string }[] }).data.map((user) => user.handle);
    expect(handles).toContain('mara');
  } finally {
    await page.goto('/my-items');
    await removeE2eProject(page, identifier);
  }
});

test('pastes an image into the description and into a comment', async ({ page }) => {
  const { id, identifier } = await createE2eProject(page, name('paste'), { types: ['Task'] });
  try {
    const item = await createItem(page, { project_id: id, title: 'E2E Plakat gestalten' });
    const { opener } = await openItem(page, item.key, 'E2E Plakat gestalten');

    // the description: Chrome's "Copy image" brings the picture with HTML that holds nothing but the <img>
    const description = page.getByRole('region', { name: tr('en', 'items.detail.description.title') });
    const editor = description.getByRole('textbox', { name: tr('en', 'editor.label.description') });
    await tabTo(page, editor, { max: 120 });
    await page.keyboard.type('Entwurf:');
    await pasteFile(editor, { name: 'plakat.png', type: 'image/png', bytes: pngBytes(48, 32), html: CHROME_COPY_IMAGE });
    await expect(description.getByRole('img', { name: 'plakat.png' })).toBeVisible();
    // the picture of the page it came from never comes along (A236): the uploaded file is the picture
    await expect.poll(() => storedDescription(page, item.id), { timeout: 15_000 }).toMatch(/^Entwurf:\s+!\[plakat\.png\]\(attachment:[0-9a-z]{26}\)\s*$/);

    await page.reload();
    const saved = page.getByRole('region', { name: tr('en', 'items.detail.description.title') }).getByRole('img', { name: 'plakat.png' });
    await expect(saved).toBeVisible();
    // a preview (made in the queue) or the file itself, with the session's cookie
    await expect.poll(() => loadedWidth(saved), { timeout: 15_000 }).toBeGreaterThan(0);

    // the comment: a screenshot, a file without HTML
    await opener.click();
    const composer = page.getByRole('textbox', { name: tr('en', 'editor.label.comment') });
    await expect(composer).toBeFocused();
    await page.keyboard.type('So sieht es gedruckt aus:');
    await pasteFile(composer, { name: 'druck.png', type: 'image/png', bytes: pngBytes(40, 30) });
    await expect(page.getByRole('img', { name: 'druck.png' })).toBeVisible();
    // the upload is done once its progress bar is gone; until then sending is refused (editor.upload.pending)
    await expect(page.getByRole('progressbar')).toHaveCount(0);
    await pressMod(page, 'Enter');

    await expect(page.getByRole('status').filter({ hasText: tr('en', 'items.comments.sent') })).toBeVisible();
    const card = page.getByRole('article', { name: tr('en', 'items.comments.card', { name: PEOPLE.e2e.name }) });
    const picture = card.getByRole('img', { name: 'druck.png' });
    await expect(picture).toBeVisible();
    await expect.poll(() => loadedWidth(picture), { timeout: 15_000 }).toBeGreaterThan(0);
    expect(await storedComments(page, item.id)).toEqual([expect.stringMatching(/^So sieht es gedruckt aus:\s+!\[druck\.png\]\(attachment:[0-9a-z]{26}\)\s*$/)]);

    // and after a reload still there
    await page.reload();
    await expect.poll(() => loadedWidth(card.getByRole('img', { name: 'druck.png' })), { timeout: 15_000 }).toBeGreaterThan(0);
  } finally {
    await page.goto('/my-items');
    await removeE2eProject(page, identifier);
  }
});

test('refuses an image of another project in the description', async ({ page, allowedErrors }) => {
  // the browser's note on the refused save
  allowedErrors.push(/status of 422 .*\/api\/v1\/work-items\//);
  const other = await createE2eProject(page, name('foreign source'), { types: ['Task'] });
  const own = await createE2eProject(page, name('foreign target'), { types: ['Task'] });
  try {
    const { id: attachmentId } = await uploadViaApi(page, other.id, { name: 'fremd.png', type: 'image/png', bytes: pngBytes(24, 24) });
    const item = await createItem(page, { project_id: own.id, title: 'E2E Fremdes Bild' });

    // over REST: the image of the other project is a 422 at the field, nothing is saved
    const refused = await api(page, 'PATCH', `/api/v1/work-items/${item.id}`, { description: `![fremd.png](attachment:${attachmentId})` });
    expect(refused.status(), await refused.text()).toBe(422);
    expect(((await refused.json()) as { errors: Record<string, string[]> }).errors.description).toEqual([tr('en', 'field.rich_text.attachment')]);
    expect(await storedDescription(page, item.id)).toBeNull();

    // in the editor: text copied from an item of the other project (its HTML names the attachment)
    await openItem(page, item.key, 'E2E Fremdes Bild');
    const description = page.getByRole('region', { name: tr('en', 'items.detail.description.title') });
    const editor = description.getByRole('textbox', { name: tr('en', 'editor.label.description') });
    await tabTo(page, editor, { max: 120 });
    await editor.evaluate((element, html) => {
      const data = new DataTransfer();
      data.setData('text/html', html);
      element.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
    }, `<p>Vorlage:</p><img data-attachment-id="${attachmentId}" alt="fremd.png">`);
    await expect(description.getByRole('img', { name: 'fremd.png' })).toBeVisible();
    // the server refuses the text: its sentence under the editor, which says it is invalid
    await expect(description.getByText(tr('en', 'field.rich_text.attachment'))).toBeVisible();
    await expect(editor).toHaveAttribute('aria-invalid', 'true');
    expect(await storedDescription(page, item.id)).toBeNull();

    // without the image the text goes through
    await expect(editor).toBeFocused();
    // ProseMirror reads its Mod key from navigator.platform (the host's), unlike the app's shortcuts (pressMod): so
    // the host's ControlOrMeta selects everything
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.type('Ohne Bild.');
    await expect(editor).not.toHaveAttribute('aria-invalid', 'true');
    await expect.poll(() => storedDescription(page, item.id), { timeout: 15_000 }).toBe('Ohne Bild.');
  } finally {
    await page.goto('/my-items');
    await removeE2eProject(page, own.identifier);
    await removeE2eProject(page, other.identifier);
  }
});

test('gives Ida neither the image nor its preview', async ({ page, browser }) => {
  // Ida is a member of WEB only: a private project of the e2e person is unknown to her
  const { id, identifier } = await createE2eProject(page, name('private'), { types: ['Task'], visibility: 'private' });
  let ida: Awaited<ReturnType<typeof signedInContext>> | undefined;
  try {
    ida = await signedInContext(browser, PEOPLE.ida);
    const item = await createItem(page, { project_id: id, title: 'E2E Geheimer Plan' });
    const { id: attachmentId } = await uploadViaApi(page, id, { name: 'plan.png', type: 'image/png', bytes: pngBytes(64, 48) });
    const described = await api(page, 'PATCH', `/api/v1/work-items/${item.id}`, { description: `![plan.png](attachment:${attachmentId})` });
    expect(described.status(), await described.text()).toBe(200);

    // the e2e person reads the picture and, once the queue made it, its preview
    expect((await api(page, 'GET', `/attachments/${attachmentId}`)).status()).toBe(200);
    await expect.poll(async () => (await api(page, 'GET', `/attachments/${attachmentId}/preview`)).status(), { timeout: 30_000 }).toBe(200);

    // Ida: everything is unknown, never forbidden (a 403 would tell that it exists)
    for (const path of [`/attachments/${attachmentId}`, `/attachments/${attachmentId}/preview`, `/attachments/${attachmentId}?download=1`]) {
      expect((await api(ida.page, 'GET', path)).status(), path).toBe(404);
    }
    const metadata = await api(ida.page, 'GET', `/api/v1/attachments/${attachmentId}`);
    expect(metadata.status(), await metadata.text()).toBe(404);
    const itemPage = await ida.page.goto(`/items/${item.key}`);
    expect(itemPage?.status()).toBe(404);
    await expect(ida.page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(ida.page.getByRole('img', { name: 'plan.png' })).toHaveCount(0);
  } finally {
    await ida?.context.close();
    await removeE2eProject(page, identifier);
  }
});

test('downloads an SVG instead of showing it', async ({ page }) => {
  const { id, identifier } = await createE2eProject(page, name('svg'), { types: ['Task'] });
  try {
    const item = await createItem(page, { project_id: id, title: 'E2E Logo prüfen' });
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><script>alert(1)</script><rect width="10" height="10"/></svg>';
    const { id: attachmentId } = await uploadViaApi(page, id, { name: 'logo.svg', type: 'image/svg+xml', bytes: Buffer.from(svg) }, 'file', item.id);

    const response = await api(page, 'GET', `/attachments/${attachmentId}`);
    expect(response.status()).toBe(200);
    const headers = response.headers();
    expect(headers['content-type']).toBe('application/octet-stream');
    expect(headers['content-disposition']).toMatch(/^attachment; filename\*=UTF-8''logo\.svg$/);
    expect(headers['x-content-type-options']).toBe('nosniff');
    expect(headers['content-security-policy']).toContain('sandbox');
    // no preview of what is no picture
    expect((await api(page, 'GET', `/attachments/${attachmentId}/preview`)).status()).toBe(404);
  } finally {
    await removeE2eProject(page, identifier);
  }
});

test('comments on the phone', async ({ page }) => {
  // the phone projects only (K22): the desktop writes comments in comments.spec.ts
  test.skip(!isPhone(page), 'only on the phone');
  const { id, identifier } = await createE2eProject(page, name('phone'), { types: ['Task'] });
  try {
    const item = await createItem(page, { project_id: id, title: 'E2E Vor Ort prüfen' });
    const { opener } = await openItem(page, item.key, 'E2E Vor Ort prüfen');

    await opener.click();
    const composer = page.getByRole('textbox', { name: tr('en', 'editor.label.comment') });
    await expect(composer).toBeFocused();
    await page.keyboard.type('Mast steht, Kabel fehlt.');
    const send = page.getByRole('button', { name: tr('en', 'items.comments.send'), exact: true });
    await expect(send).toBeInViewport();
    // a target a finger can hit
    expect((await send.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await send.click();

    await expect(page.getByRole('status').filter({ hasText: tr('en', 'items.comments.sent') })).toBeVisible();
    await expect(page.getByRole('article', { name: tr('en', 'items.comments.card', { name: PEOPLE.e2e.name }) })).toContainText('Mast steht, Kabel fehlt.');
    expect(await storedComments(page, item.id)).toEqual(['Mast steht, Kabel fehlt.']);
  } finally {
    await page.goto('/my-items');
    await removeE2eProject(page, identifier);
  }
});
