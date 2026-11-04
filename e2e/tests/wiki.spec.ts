import type { Locator, Page } from '@playwright/test';
import { expect, test } from '../fixtures';
import { api, createE2ePage, createE2eProject, isPhone, openNavigation, pasteFile, PEOPLE, pngBytes, removeE2eProject, runId, tabTo, tr, variant } from '../helpers';

// The wiki of a project with the keyboard only, signed in as the e2e person (org admin, English). Every test makes its
// own project `E2E <variant> <run> …` with its own pages (`createE2ePage`) and removes it in `finally`; the demo wiki
// is never changed.

const projectName = (what: string) => `E2E ${variant()} ${runId()} ${what}`;
const pageIdOf = (page: Page) => new URL(page.url()).pathname.split('/').at(-1)!;

/** A page as the server stores it now: its title and its text as Markdown. */
async function storedPage(page: Page, id: string): Promise<{ title: string; content: string | null; version: number }> {
  const response = await api(page, 'GET', `/api/v1/pages/${id}`);
  expect(response.status()).toBe(200);
  return ((await response.json()) as { data: { title: string; content: string | null; version: number } }).data;
}

function loadedWidth(image: Locator): Promise<number> {
  return image.evaluate((element: HTMLImageElement) => (element.complete ? element.naturalWidth : 0));
}

test('opens the wiki from the sidebar and walks the tree with the keyboard', async ({ page }) => {
  const project = await createE2eProject(page, projectName('wiki tree'));
  try {
    const handbook = await createE2ePage(page, project.id, { title: 'Handbook' });
    await createE2ePage(page, project.id, { title: 'Processes', parent_id: handbook.id });
    const tech = await createE2ePage(page, project.id, { title: 'Technology' });
    // starred, the project stands in the sidebar; on its own list it starts open with its areas
    const star = await api(page, 'POST', '/api/v1/favorites/toggle', { kind: 'project', id: project.id });
    expect(star.status()).toBe(200);
    await page.goto(`/projects/${project.identifier}`);

    const navigation = await openNavigation(page, 'en');
    await tabTo(page, navigation.getByRole('link', { name: tr('en', 'shell.nav.project_wiki'), exact: true }), { max: 120 });
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(new RegExp(`/projects/${project.identifier}/wiki$`));
    await expect(page.getByRole('heading', { level: 1, name: tr('en', 'wiki.title') })).toBeVisible();

    const tree = page.getByRole('tree', { name: tr('en', 'wiki.tree.label') });
    const row = (name: string) => tree.getByRole('treeitem', { name, exact: true });
    // one tab stop: the first page while none is open
    await tabTo(page, row('Handbook'), { max: 60 });
    await expect(row('Processes')).toHaveAttribute('tabindex', '-1');
    await page.keyboard.press('ArrowDown');
    await expect(row('Processes')).toBeFocused();
    await expect(row('Processes')).toHaveAttribute('aria-level', '2');
    await page.keyboard.press('ArrowLeft');
    await expect(row('Handbook')).toBeFocused();
    await page.keyboard.press('ArrowLeft');
    await expect(row('Handbook')).toHaveAttribute('aria-expanded', 'false');
    await expect(row('Processes')).toHaveCount(0);
    await page.keyboard.press('ArrowRight');
    await expect(row('Processes')).toBeVisible();
    await page.keyboard.press('End');
    await expect(row('Technology')).toBeFocused();
    await page.keyboard.press('Enter');

    await expect(page).toHaveURL(new RegExp(`/projects/${project.identifier}/wiki/${tech.id}$`));
    await expect(page.getByRole('textbox', { name: tr('en', 'wiki.page.title_label') })).toHaveValue('Technology');
    // from lg on the tree stays beside the page and marks it; below that the page shows alone
    if (isPhone(page)) await expect(tree).toBeHidden();
    else await expect(row('Technology')).toHaveAttribute('aria-current', 'page');
  } finally {
    await removeE2eProject(page, project.identifier);
  }
});

test('creates a page with the keyboard: New page, then the title typed over', async ({ page }) => {
  const project = await createE2eProject(page, projectName('wiki create'));
  try {
    await page.goto(`/projects/${project.identifier}/wiki`);
    await expect(page.getByText(tr('en', 'wiki.empty.title'))).toBeVisible();
    const create = page.getByRole('main').getByRole('button', { name: tr('en', 'wiki.new'), exact: true });
    // the rights are there: the button is no longer off
    await expect(create).not.toHaveAttribute('aria-disabled', 'true');
    await tabTo(page, create, { max: 120 });
    await page.keyboard.press('Enter');

    // the new page opens; the wish to select its title leaves the address at once
    await expect(page).toHaveURL(new RegExp(`/projects/${project.identifier}/wiki/[0-9a-z]{26}$`));
    await expect(page.getByText(tr('en', 'wiki.created.title')).first()).toBeVisible();
    const title = page.getByRole('textbox', { name: tr('en', 'wiki.page.title_label') });
    await expect(title).toBeFocused();
    await page.keyboard.type('Imprint');
    await expect(title).toHaveValue('Imprint');

    // the title saves itself after a pause in typing; the tree follows
    await expect(page.locator('[data-save-status]').getByRole('status')).toHaveText(tr('en', 'wiki.save.saved'), { timeout: 10_000 });
    const stored = await api(page, 'GET', `/api/v1/pages/${pageIdOf(page)}`);
    expect(stored.status()).toBe(200);
    const { data } = (await stored.json()) as { data: { title: string; project_id: string; parent_id: string | null } };
    expect(data).toMatchObject({ title: 'Imprint', project_id: project.id, parent_id: null });
    if (!isPhone(page)) await expect(page.getByRole('tree', { name: tr('en', 'wiki.tree.label') }).getByRole('treeitem', { name: 'Imprint' })).toHaveAttribute('aria-current', 'page');
  } finally {
    await removeE2eProject(page, project.identifier);
  }
});

test('types into a page, saves by itself and keeps the text after reloading', async ({ page }) => {
  const project = await createE2eProject(page, projectName('wiki save'));
  try {
    const onboarding = await createE2ePage(page, project.id, { title: 'Onboarding' });
    await page.goto(`/projects/${project.identifier}/wiki/${onboarding.id}`);
    const title = page.getByRole('textbox', { name: tr('en', 'wiki.page.title_label') });
    await expect(title).toHaveValue('Onboarding');
    await tabTo(page, title, { max: 120 });
    // the text field's own select-all (the host's key, like the editor's own keys)
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.type('Onboarding checklist');
    // Enter goes on from the title into the text
    await page.keyboard.press('Enter');
    const editor = page.getByRole('textbox', { name: tr('en', 'editor.label.page') });
    await expect(editor).toBeFocused();
    await page.keyboard.type('Laptop on day one, accounts on day two.');

    // no button: the page saves after a pause, says so in its status region and gives the time beside it
    const status = page.locator('[data-save-status]');
    await expect(status.getByRole('status')).toHaveText(tr('en', 'wiki.save.saved'), { timeout: 10_000 });
    await expect(status.locator('time')).toHaveText(tr('en', 'wiki.save.just_now'));
    await expect.poll(async () => (await storedPage(page, onboarding.id)).content, { timeout: 10_000 }).toBe('Laptop on day one, accounts on day two.');
    expect((await storedPage(page, onboarding.id)).title).toBe('Onboarding checklist');

    await page.reload();
    await expect(page.getByRole('textbox', { name: tr('en', 'wiki.page.title_label') })).toHaveValue('Onboarding checklist');
    await expect(page.getByRole('textbox', { name: tr('en', 'editor.label.page') })).toHaveText('Laptop on day one, accounts on day two.');
    // saved by the e2e person, who is now the last to change it
    await expect(page.getByText(new RegExp(`^Last changed by ${PEOPLE.e2e.name} on `))).toBeVisible();
  } finally {
    await removeE2eProject(page, project.identifier);
  }
});

test('pastes an image into a page', async ({ page }) => {
  const project = await createE2eProject(page, projectName('wiki image'));
  try {
    const plan = await createE2ePage(page, project.id, { title: 'Floor plan' });
    await page.goto(`/projects/${project.identifier}/wiki/${plan.id}`);
    const editor = page.getByRole('textbox', { name: tr('en', 'editor.label.page') });
    await tabTo(page, editor, { max: 120 });
    await page.keyboard.type('Second floor:');
    await pasteFile(editor, { name: 'floor.png', type: 'image/png', bytes: pngBytes(48, 32) });
    await expect(editor.getByRole('img', { name: 'floor.png' })).toBeVisible();
    // the upload is done once its progress bar is gone; the page saves it with the text, which makes it the page's
    await expect(page.getByRole('progressbar')).toHaveCount(0);
    await expect.poll(async () => (await storedPage(page, plan.id)).content, { timeout: 15_000 }).toMatch(/^Second floor:\s+!\[floor\.png\]\(attachment:[0-9a-z]{26}\)\s*$/);

    await page.reload();
    const saved = page.getByRole('textbox', { name: tr('en', 'editor.label.page') }).getByRole('img', { name: 'floor.png' });
    await expect(saved).toBeVisible();
    await expect.poll(() => loadedWidth(saved), { timeout: 15_000 }).toBeGreaterThan(0);
  } finally {
    await removeE2eProject(page, project.identifier);
  }
});
