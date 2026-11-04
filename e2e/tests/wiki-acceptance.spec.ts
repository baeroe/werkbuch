import type { Browser, Page } from '@playwright/test';
import { expect, test } from '../fixtures';
import { allEntries, api, channelHeld, createE2ePage, createE2eProject, isPhone, pasteFile, PEOPLE, pngBytes, removeE2eProject, runId, signedInContext, tabTo, tr, variant } from '../helpers';

// The acceptance of phase 9 (Flow 5, success criterion 5): two people on the same wiki page, the e2e person (Erik Ende,
// English, org admin, who makes the project) and Mara Lindqvist (German, a member over the API, a browser context of
// her own). Every test works in a project of its own (`E2E <variant> <run> …`, removed in `finally`) with its own pages
// (`createE2ePage`); the demo wiki is never touched. A conflict is never left to timing (K6): Erik's save is held at
// the door (`page.route`) until Mara's is stored, then it meets the 409. Changes of the other person come through the
// outbox, the queue `live` and Reverb: the specs wait for them with a timeout, never with a fixed pause.

const projectName = (what: string) => `E2E ${variant()} ${runId()} ${what}`;

/** How long a change may take through the queue worker and Reverb to the other browser. */
const LIVE = { timeout: 20_000 };

// a second context, the way through the queue and Reverb: more than the default 30 s may pass in a test
test.describe.configure({ timeout: 90_000 });

const paragraph = (text: string) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] });

/** Adds a demo person to the project with the role, over the API. */
async function addMember(page: Page, projectId: string, person: { email: string }, role: 'member' | 'viewer'): Promise<void> {
  const user = (await allEntries(page, 'users')).find((entry) => entry.email === person.email) as { id: string };
  const added = await api(page, 'POST', `/api/v1/projects/${projectId}/members`, { user_id: user.id, role });
  expect(added.status(), await added.text()).toBe(201);
}

/** A page as the server stores it now. */
async function storedPage(page: Page, id: string): Promise<{ title: string; content: string | null; version: number }> {
  const response = await api(page, 'GET', `/api/v1/pages/${id}`);
  expect(response.status(), await response.text()).toBe(200);
  return ((await response.json()) as { data: { title: string; content: string | null; version: number } }).data;
}

async function versionCount(page: Page, id: string): Promise<number> {
  const response = await api(page, 'GET', `/api/v1/pages/${id}/versions`);
  expect(response.status(), await response.text()).toBe(200);
  return ((await response.json()) as { meta: { total: number } }).meta.total;
}

/**
 * Holds the first save (`PATCH`) of the page in `page` at the door: `sent` resolves once it is on its way, `release()`
 * lets it through. Every later save passes.
 */
async function holdFirstSave(page: Page, pageId: string): Promise<{ sent: Promise<void>; release: () => void }> {
  let release = () => {};
  const open = new Promise<void>((resolve) => (release = resolve));
  let onSent = () => {};
  const sent = new Promise<void>((resolve) => (onSent = resolve));
  let held = false;
  await page.route(`**/api/v1/pages/${pageId}`, async (route) => {
    if (route.request().method() !== 'PATCH' || held) return route.fallback();
    held = true;
    onSent();
    await open;
    return route.fallback();
  });
  return { sent, release };
}

/** Opens the page, waits until it holds the project's live channel, and puts the focus into its text. */
async function openPage(page: Page, locale: 'en' | 'de', project: { id: string; identifier: string }, pageId: string, title: string) {
  const held = channelHeld(page, `private-project.${project.id}`);
  await page.goto(`/projects/${project.identifier}/wiki/${pageId}`);
  const titleField = page.getByRole('textbox', { name: tr(locale, 'wiki.page.title_label') });
  await expect(titleField).toHaveValue(title);
  await held;
  const editor = page.getByRole('textbox', { name: tr(locale, 'editor.label.page') });
  await tabTo(page, editor, { max: 120 });
  return { editor, status: page.locator('[data-save-status]').getByRole('status') };
}

/** Marks the document, so a test can tell that the page did not load again. */
async function markDocument(page: Page): Promise<void> {
  await page.evaluate(() => ((window as Window & { __wiki?: boolean }).__wiki = true));
}

async function stillTheSameDocument(page: Page): Promise<void> {
  expect(await page.evaluate(() => (window as Window & { __wiki?: boolean }).__wiki)).toBe(true);
}

/**
 * Erik and Mara on the same page with text; Erik types first, his save is held until Mara's is stored, then it meets
 * the conflict: the banner names Mara. Answers both sides for the rest of the test.
 */
async function conflict(page: Page, browser: Browser, what: string, allowedErrors: RegExp[]) {
  const project = await createE2eProject(page, projectName(what), { visibility: 'private' });
  await addMember(page, project.id, PEOPLE.mara, 'member');
  const other = await signedInContext(browser, PEOPLE.mara);
  const notes = await createE2ePage(page, project.id, { title: 'Release notes', content_json: paragraph('Erster Stand.') });
  // Erik's save meets Mara's: the 409 `page_conflict` this test is about (the browser reports it)
  allowedErrors.push(new RegExp(`^console error: .*status of 409 .*/api/v1/pages/${notes.id}\\)$`));

  const mara = await openPage(other.page, 'de', project, notes.id, 'Release notes');
  const erik = await openPage(page, 'en', project, notes.id, 'Release notes');
  await markDocument(other.page);

  // Erik types on version 1 first; his save waits at the door until Mara's is stored. Typed after it, live would have
  // shown him Mara's version already, and his text on top of it is no conflict at all
  const door = await holdFirstSave(page, notes.id);
  await page.keyboard.type('Von Erik. ');
  await expect(erik.editor).toHaveText('Von Erik. Erster Stand.');
  await door.sent;

  await other.page.keyboard.type('Von Mara. ');
  await expect.poll(async () => (await storedPage(page, notes.id)).content, { timeout: 10_000 }).toBe('Von Mara. Erster Stand.');
  await expect(mara.status).toHaveText(tr('de', 'wiki.save.saved'));
  // Mara overwrote the state Erik made: it is kept as a version (A307)
  expect(await versionCount(page, notes.id)).toBe(1);

  // Erik's save reaches the server after Mara's: refused, the banner names her (in Erik's language, A151), his text stays
  door.release();
  const banner = page.getByRole('alert').filter({ hasText: tr('en', 'wiki.conflict.text') });
  await expect(banner).toContainText(tr('en', 'problem.detail.page_conflict', { name: PEOPLE.mara.name }));
  await expect(erik.editor).toHaveText('Von Erik. Erster Stand.');
  await expect(erik.status).toHaveText(tr('en', 'wiki.save.failed'));
  expect((await storedPage(page, notes.id)).content).toBe('Von Mara. Erster Stand.');

  return { project, other, notes, erik, mara, banner };
}

test('Flow 5: two people edit the same page; the later save meets the conflict, Meine Fassung übernehmen keeps the other version', async ({ page, browser, allowedErrors }) => {
  let flow: Awaited<ReturnType<typeof conflict>> | undefined;
  let identifier: string | undefined;
  try {
    flow = await conflict(page, browser, 'wiki flow 5', allowedErrors);
    identifier = flow.project.identifier;
    const { erik, mara, banner, notes, other } = flow;

    // "Keep my version" with the keyboard: the banner stands above the text, the focus goes back into it
    await tabTo(page, banner.getByRole('button', { name: tr('en', 'wiki.conflict.keep_mine') }), { backwards: true, max: 20 });
    await page.keyboard.press('Enter');
    await expect(banner).toBeHidden();
    await expect(erik.editor).toBeFocused();
    await expect(erik.status).toHaveText(tr('en', 'wiki.save.saved'), { timeout: 10_000 });
    const stored = await storedPage(page, notes.id);
    expect(stored).toMatchObject({ content: 'Von Erik. Erster Stand.', version: 3 });

    // one version more, and it holds Mara's text
    expect(await versionCount(page, notes.id)).toBe(2);
    await tabTo(page, page.getByRole('button', { name: tr('en', 'wiki.versions.open') }), { backwards: true, max: 40 });
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog', { name: tr('en', 'wiki.versions.title', { title: 'Release notes' }) });
    const newest = dialog.getByRole('radio', { name: new RegExp(`^Version 2, ${PEOPLE.mara.name}, `) });
    await expect(newest).toBeChecked();
    await expect(dialog.getByRole('region', { name: tr('en', 'wiki.versions.preview') })).toContainText('Von Mara. Erster Stand.');
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();

    // Mara typed nothing since her save: her window shows Erik's version without loading again
    await expect(mara.editor).toHaveText('Von Erik. Erster Stand.', LIVE);
    await stillTheSameDocument(other.page);
  } finally {
    await flow?.other.context.close();
    if (identifier) await removeE2eProject(page, identifier);
  }
});

test('Neu laden takes the other version, and undo brings the own text back', async ({ page, browser, allowedErrors }) => {
  let flow: Awaited<ReturnType<typeof conflict>> | undefined;
  let identifier: string | undefined;
  try {
    flow = await conflict(page, browser, 'wiki reload', allowedErrors);
    identifier = flow.project.identifier;
    const { erik, banner, notes } = flow;

    await tabTo(page, banner.getByRole('button', { name: tr('en', 'common.reload'), exact: true }), { backwards: true, max: 20 });
    await page.keyboard.press('Enter');
    await expect(banner).toBeHidden();
    await expect(erik.editor).toHaveText('Von Mara. Erster Stand.');
    await expect(erik.editor).toBeFocused();
    const dropped = page.getByText(tr('en', 'wiki.conflict.dropped.title'));
    await expect(dropped).toBeVisible();

    // undo from the toast: Erik's text and the banner are back; nothing went to the server
    await page.getByRole('button', { name: tr('en', 'common.undo'), exact: true }).click();
    await expect(erik.editor).toHaveText('Von Erik. Erster Stand.');
    await expect(banner).toContainText(tr('en', 'problem.detail.page_conflict', { name: PEOPLE.mara.name }));
    expect(await storedPage(page, notes.id)).toMatchObject({ content: 'Von Mara. Erster Stand.', version: 2 });
  } finally {
    await flow?.other.context.close();
    if (identifier) await removeE2eProject(page, identifier);
  }
});

test('Erfolgskriterium 5: an image pasted into a wiki page shows for members and is 404 for an outsider', async ({ page, browser }) => {
  // private (K7): an outsider of a public project reads it as a viewer
  const project = await createE2eProject(page, projectName('wiki image access'), { visibility: 'private' });
  let mara: Awaited<ReturnType<typeof signedInContext>> | undefined;
  let ida: Awaited<ReturnType<typeof signedInContext>> | undefined;
  try {
    await addMember(page, project.id, PEOPLE.mara, 'member');
    const plan = await createE2ePage(page, project.id, { title: 'Floor plan' });
    const { editor } = await openPage(page, 'en', project, plan.id, 'Floor plan');
    await page.keyboard.type('Second floor:');
    await pasteFile(editor, { name: 'floor.png', type: 'image/png', bytes: pngBytes(48, 32) });
    await expect(editor.getByRole('img', { name: 'floor.png' })).toBeVisible();
    await expect(page.getByRole('progressbar')).toHaveCount(0);
    await expect.poll(async () => (await storedPage(page, plan.id)).content, { timeout: 15_000 }).toMatch(/^Second floor:\s+!\[floor\.png\]\(attachment:[0-9a-z]{26}\)\s*$/);
    const attachment = /attachment:([0-9a-z]{26})/.exec((await storedPage(page, plan.id)).content!)![1];
    const url = `/attachments/${attachment}`;

    // Mara, a member, sees the picture on the page and loads the file
    mara = await signedInContext(browser, PEOPLE.mara);
    await mara.page.goto(`/projects/${project.identifier}/wiki/${plan.id}`);
    const picture = mara.page.getByRole('textbox', { name: tr('de', 'editor.label.page') }).getByRole('img', { name: 'floor.png' });
    await expect(picture).toBeVisible();
    await expect.poll(() => picture.evaluate((element: HTMLImageElement) => (element.complete ? element.naturalWidth : 0)), { timeout: 15_000 }).toBeGreaterThan(0);
    const forMara = await api(mara.page, 'GET', url);
    expect(forMara.status()).toBe(200);
    expect(forMara.headers()['content-type']).toBe('image/png');

    // Ida is no member of the private project: the file, the page and the wiki are not there for her
    ida = await signedInContext(browser, PEOPLE.ida);
    expect((await api(ida.page, 'GET', url)).status()).toBe(404);
    expect((await api(ida.page, 'GET', `${url}/preview`)).status()).toBe(404);
    expect((await api(ida.page, 'GET', `/api/v1/pages/${plan.id}`)).status()).toBe(404);
    expect((await api(ida.page, 'GET', `/api/v1/attachments/${attachment}`)).status()).toBe(404);
  } finally {
    await mara?.context.close();
    await ida?.context.close();
    await removeE2eProject(page, project.identifier);
  }
});

test('a viewer reads the page and its versions and cannot edit', async ({ page, browser }) => {
  const project = await createE2eProject(page, projectName('wiki viewer'), { visibility: 'private' });
  let theo: Awaited<ReturnType<typeof signedInContext>> | undefined;
  try {
    // Theo, not Mara: Mara is an org admin and edits every wiki
    await addMember(page, project.id, PEOPLE.theo, 'viewer');
    const notes = await createE2ePage(page, project.id, { title: 'Release notes', content_json: paragraph('Erster Stand.') });
    await createE2ePage(page, project.id, { title: 'Glossar' });
    const saved = await api(page, 'PATCH', `/api/v1/pages/${notes.id}`, { title: 'Release notes', content_json: paragraph('Zweiter Stand.'), base_version: 1, keep_current: true });
    expect(saved.status(), await saved.text()).toBe(200);

    theo = await signedInContext(browser, PEOPLE.theo);
    const view = theo.page;
    await view.goto(`/projects/${project.identifier}/wiki/${notes.id}`);
    const main = view.getByRole('main');
    await expect(main.getByRole('heading', { level: 1, name: 'Release notes' })).toBeVisible();
    await expect(main.getByText('Zweiter Stand.')).toBeVisible();
    // why, in words: no title field, no editor, no save state, no menu of the page
    await expect(main.getByRole('article').getByText(tr('de', 'permissions.reason.wiki_edit.read_only', { project: project.identifier }))).toBeVisible();
    await expect(main.getByRole('textbox')).toHaveCount(0);
    await expect(main.locator('[data-save-status]')).toHaveCount(0);
    await expect(main.getByRole('button', { name: tr('de', 'wiki.page.more') })).toHaveCount(0);
    await expect(main.getByRole('button', { name: tr('de', 'wiki.new'), exact: true })).toHaveAttribute('aria-disabled', 'true');
    if (!isPhone(view)) {
      // the tree lists the pages, without a handle to drag them
      const tree = view.getByRole('tree', { name: tr('de', 'wiki.tree.label') });
      await expect(tree.getByRole('treeitem', { name: 'Glossar', exact: true })).toBeVisible();
      await expect(tree.locator('[data-drag-handle]')).toHaveCount(0);
    }

    // the versions read like for anybody; restoring is locked, and says why
    await tabTo(view, main.getByRole('button', { name: tr('de', 'wiki.versions.open') }), { max: 120 });
    await view.keyboard.press('Enter');
    const dialog = view.getByRole('dialog', { name: tr('de', 'wiki.versions.title', { title: 'Release notes' }) });
    await expect(dialog.getByRole('radio', { name: new RegExp(`^Version 1, ${PEOPLE.e2e.name}, `) })).toBeChecked();
    await expect(dialog.getByRole('region', { name: tr('de', 'wiki.versions.preview') })).toContainText('Erster Stand.');
    await expect(dialog.getByRole('button', { name: tr('de', 'wiki.versions.restore') })).toHaveAttribute('aria-disabled', 'true');
    await view.keyboard.press('Escape');
    await expect(dialog).toBeHidden();

    // the server agrees: a viewer's save is refused
    const refused = await api(view, 'PATCH', `/api/v1/pages/${notes.id}`, { content_json: paragraph('Von Theo.') });
    expect(refused.status()).toBe(403);
    expect((await storedPage(page, notes.id)).content).toBe('Zweiter Stand.');
  } finally {
    await theo?.context.close();
    await removeE2eProject(page, project.identifier);
  }
});

test('a page deleted by someone else says so and keeps unsaved text to copy', async ({ page, browser, allowedErrors }) => {
  const project = await createE2eProject(page, projectName('wiki deleted'), { visibility: 'private' });
  let mara: Awaited<ReturnType<typeof signedInContext>> | undefined;
  try {
    await addMember(page, project.id, PEOPLE.mara, 'member');
    const notes = await createE2ePage(page, project.id, { title: 'Release notes', content_json: paragraph('Erster Stand.') });
    await createE2ePage(page, project.id, { title: 'Glossar' });
    // Erik's save is held until the page is gone (K5): it meets the 404 then, which the browser reports
    allowedErrors.push(new RegExp(`^console error: .*status of 404 .*/api/v1/pages/${notes.id}\\)$`));
    mara = await signedInContext(browser, PEOPLE.mara);

    const { editor } = await openPage(page, 'en', project, notes.id, 'Release notes');
    const door = await holdFirstSave(page, notes.id);
    await page.keyboard.type('Nicht gespeichert. ');
    await expect(editor).toHaveText('Nicht gespeichert. Erster Stand.');
    await door.sent;

    // from here on, every answer Erik's tab gets about the page (its detail, its versions): the gone rule (A298, K5)
    // allows exactly one, the held save meeting the 404, and no new try after it (T19-M1/M2)
    const aboutNotes: string[] = [];
    page.on('response', (response) => {
      if (new URL(response.url()).pathname.startsWith(`/api/v1/pages/${notes.id}`)) {
        aboutNotes.push(`${response.request().method()} ${new URL(response.url()).pathname} ${response.status()}`);
      }
    });

    // Mara deletes the page over the API while Erik's text is on its way
    const deleted = await api(mara.page, 'DELETE', `/api/v1/pages/${notes.id}`);
    expect(deleted.status(), await deleted.text()).toBe(200);

    const main = page.getByRole('main');
    await expect(main.getByRole('heading', { level: 1, name: tr('en', 'wiki.page.deleted.title') })).toBeVisible(LIVE);
    const parked = main.getByRole('alert').filter({ hasText: tr('en', 'wiki.page.unsaved.title') });
    await expect(parked).toContainText('Nicht gespeichert. Erster Stand.');
    await expect(main.getByRole('textbox')).toHaveCount(0);

    // the held save meets the 404 now: no error toast, no new try, the text stays
    const answered = page.waitForResponse((response) => response.url().endsWith(`/api/v1/pages/${notes.id}`) && response.request().method() === 'PATCH');
    door.release();
    expect((await answered).status()).toBe(404);
    await expect(page.getByText(tr('en', 'wiki.save.not_saved', { title: 'Release notes' }))).toHaveCount(0);
    await expect(parked).toContainText('Nicht gespeichert. Erster Stand.');
    if (!isPhone(page)) await expect(page.getByRole('tree', { name: tr('en', 'wiki.tree.label') }).getByRole('treeitem', { name: 'Release notes', exact: true })).toHaveCount(0);

    // "Copy" puts the title and the text on the clipboard
    await tabTo(page, parked.getByRole('button', { name: tr('en', 'common.copy') }), { max: 120 });
    await page.keyboard.press('Enter');
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe('Release notes\n\nNicht gespeichert. Erster Stand.');
    expect(aboutNotes).toEqual([`PATCH /api/v1/pages/${notes.id} 404`]);
  } finally {
    await mara?.context.close();
    await removeE2eProject(page, project.identifier);
  }
});
