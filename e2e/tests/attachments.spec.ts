import type { Page } from '@playwright/test';
import { expect, test } from '../fixtures';
import { api, createE2eProject, createItem, pressMod, removeE2eProject, runId, tabTo, tr, variant } from '../helpers';

// The file list of an item on its page, signed in as the e2e person in English: files chosen with "Upload file" (the
// browser's file choice, which jsdom does not have) and downloaded from their link with Enter, removing with undo and
// for good. Each test works in a project of its own (`E2E …`, removed in `finally`); its item and files are made by the
// test.

const name = (what: string) => `E2E ${what} ${variant()} ${runId()}`;

/** A PNG of one pixel. */
const PIXEL = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

/** The file names of an item's file list as the server holds them. */
async function storedFiles(page: Page, id: string): Promise<string[]> {
  const response = await api(page, 'GET', `/api/v1/work-items/${id}?include=attachments`);
  expect(response.status(), await response.text()).toBe(200);
  return ((await response.json()) as { data: { attachments: { filename: string }[] } }).data.attachments.map((file) => file.filename);
}

/** Opens the page of an item and answers its file list, once the rights let it upload. */
async function openFiles(page: Page, key: string, title: string) {
  await page.goto(`/items/${key}`);
  await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible();
  const section = page.getByRole('region', { name: tr('en', 'items.attachments.title') });
  const upload = section.getByRole('button', { name: tr('en', 'items.attachments.upload') });
  await expect(upload).toBeVisible();
  await expect(upload).not.toHaveAttribute('aria-disabled');
  return { section, upload };
}

/** Chooses files with "Upload file", from the keyboard. */
async function chooseFiles(page: Page, upload: ReturnType<Page['locator']>, files: { name: string; mimeType: string; buffer: Buffer }[]) {
  await tabTo(page, upload, { max: 120 });
  const chooser = page.waitForEvent('filechooser');
  await page.keyboard.press('Enter');
  await (await chooser).setFiles(files);
}

test('uploads a file to the list and downloads it', async ({ page }) => {
  const { id, identifier } = await createE2eProject(page, name('files'), { types: ['Task'] });
  try {
    const item = await createItem(page, { project_id: id, title: 'E2E Angebot einholen' });
    const { section, upload } = await openFiles(page, item.key, 'E2E Angebot einholen');
    await expect(section.getByText(tr('en', 'items.attachments.empty'))).toBeVisible();

    await chooseFiles(page, upload, [
      { name: 'angebot.txt', mimeType: 'text/plain', buffer: Buffer.from('Angebot: 3 Funkmasten, Lieferung in KW 48.') },
      { name: 'skizze.png', mimeType: 'image/png', buffer: Buffer.from(PIXEL, 'base64') },
    ]);

    // each file its own result, both in the list with their size; the picture shows small
    await expect(page.getByText(tr('en', 'items.attachments.uploaded', { name: 'angebot.txt' }))).toBeVisible();
    await expect(page.getByText(tr('en', 'items.attachments.uploaded', { name: 'skizze.png' }))).toBeVisible();
    const link = section.getByRole('link', { name: /angebot\.txt/ });
    await expect(link).toBeVisible();
    await expect(link).toContainText(/42 ?bytes?$/);
    // a picture opens as itself in a new tab, its download stands beside it (F28)
    await expect(section.getByRole('link', { name: /^skizze\.png/ })).toHaveAttribute('target', '_blank');
    await expect(section.getByRole('link', { name: tr('en', 'items.attachments.download', { name: 'skizze.png' }) })).toHaveAttribute('download', 'skizze.png');
    await expect(section.locator('img')).toHaveCount(1);
    await expect(section.locator('img')).toHaveJSProperty('complete', true);
    expect(await section.locator('img').evaluate((image: HTMLImageElement) => image.naturalWidth)).toBe(1);
    await expect(section.getByRole('progressbar')).toHaveCount(0);
    expect((await storedFiles(page, item.id)).sort()).toEqual(['angebot.txt', 'skizze.png']);

    // the link downloads the file under its name, also on a reload: Tab to it and Enter
    await page.reload();
    await expect(link).toBeVisible();
    await tabTo(page, link, { max: 120 });
    const download = page.waitForEvent('download');
    await page.keyboard.press('Enter');
    const file = await download;
    expect(file.suggestedFilename()).toBe('angebot.txt');
    const stream = await file.createReadStream();
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(chunk as Buffer);
    expect(Buffer.concat(chunks).toString()).toBe('Angebot: 3 Funkmasten, Lieferung in KW 48.');
  } finally {
    await page.goto('/my-items');
    await removeE2eProject(page, identifier);
  }
});

test('removes it with undo and for good', async ({ page }) => {
  const { id, identifier } = await createE2eProject(page, name('file removal'), { types: ['Task'] });
  try {
    const item = await createItem(page, { project_id: id, title: 'E2E Vertrag ablegen' });
    const { section, upload } = await openFiles(page, item.key, 'E2E Vertrag ablegen');
    await chooseFiles(page, upload, [{ name: 'vertrag.txt', mimeType: 'text/plain', buffer: Buffer.from('Vertrag, Fassung 2.') }]);
    const link = section.getByRole('link', { name: /vertrag\.txt/ });
    await expect(link).toBeVisible();

    // gone at once with undo; mod+z brings it back, and nothing reached the server
    const remove = section.getByRole('button', { name: tr('en', 'items.attachments.remove', { name: 'vertrag.txt' }) });
    await tabTo(page, remove, { max: 40 });
    await page.keyboard.press('Enter');
    await expect(link).toHaveCount(0);
    await expect(upload).toBeFocused();
    await expect(page.getByText(tr('en', 'items.attachments.removed', { name: 'vertrag.txt' }))).toBeVisible();
    await pressMod(page, 'z');
    await expect(link).toBeVisible();
    expect(await storedFiles(page, item.id)).toEqual(['vertrag.txt']);

    // once more, and the toast runs out (5 s): the file is gone on the server and stays gone after a reload
    await tabTo(page, remove, { max: 40 });
    await page.keyboard.press('Enter');
    await expect(link).toHaveCount(0);
    await expect.poll(() => storedFiles(page, item.id), { timeout: 15_000 }).toEqual([]);
    await page.reload();
    await expect(page.getByRole('heading', { level: 1, name: 'E2E Vertrag ablegen' })).toBeVisible();
    await expect(section.getByText(tr('en', 'items.attachments.empty'))).toBeVisible();
    await expect(link).toHaveCount(0);
  } finally {
    await page.goto('/my-items');
    await removeE2eProject(page, identifier);
  }
});
