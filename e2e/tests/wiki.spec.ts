import type { Locator, Page } from '@playwright/test';
import { expect, test } from '../fixtures';
import { api, arrowTo, createE2ePage, createE2eProject, isPhone, openNavigation, pasteFile, PEOPLE, pngBytes, pressMod, removeE2eProject, runId, tabTo, tr, variant } from '../helpers';

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

test('opens the versions with the keyboard and restores one', async ({ page }) => {
  const project = await createE2eProject(page, projectName('wiki versions'));
  const paragraph = (text: string) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] });
  try {
    const notes = await createE2ePage(page, project.id, { title: 'Release notes', content_json: paragraph('First draft.') });
    // saved over at once, asking to keep the stored state: version 1 stays as a version (A307)
    const saved = await api(page, 'PATCH', `/api/v1/pages/${notes.id}`, { title: 'Release notes', content_json: paragraph('Second draft.'), base_version: 1, keep_current: true });
    expect(saved.status(), await saved.text()).toBe(200);
    await page.goto(`/projects/${project.identifier}/wiki/${notes.id}`);
    const editor = page.getByRole('textbox', { name: tr('en', 'editor.label.page') });
    await expect(editor).toHaveText('Second draft.');

    // the palette's command opens the versions
    await pressMod(page, 'k');
    const palette = page.getByRole('dialog', { name: tr('en', 'palette.title') });
    await expect(palette.getByRole('combobox', { name: tr('en', 'palette.input') })).toBeFocused();
    await page.keyboard.type(tr('en', 'wiki.versions.command'));
    await expect(palette.getByRole('option', { name: new RegExp(`^${tr('en', 'wiki.versions.command')}`) })).toBeVisible();
    await page.keyboard.press('Enter');

    const dialog = page.getByRole('dialog', { name: tr('en', 'wiki.versions.title', { title: 'Release notes' }) });
    await expect(dialog).toBeVisible();
    const first = dialog.getByRole('radio', { name: /^Version 1, / });
    await expect(first).toBeChecked();
    await expect(dialog.getByRole('region', { name: tr('en', 'wiki.versions.preview') })).toContainText('First draft.');
    const restore = dialog.getByRole('button', { name: tr('en', 'wiki.versions.restore') });
    await tabTo(page, restore);
    await page.keyboard.press('Enter');

    await expect(page.getByText(tr('en', 'wiki.versions.restored.title', { number: 1 }))).toBeVisible();
    await expect(dialog).toBeHidden();
    // the restored text is the page's newest version, and the editor shows it
    await expect(editor).toHaveText('First draft.');
    const stored = await storedPage(page, notes.id);
    expect(stored.content).toBe('First draft.');
    expect(stored.version).toBe(3);
  } finally {
    await removeE2eProject(page, project.identifier);
  }
});

test('moves a page with Verschieben nach … and deletes a subtree with undo', async ({ page }) => {
  const project = await createE2eProject(page, projectName('wiki move'));
  try {
    const handbook = await createE2ePage(page, project.id, { title: 'Handbook' });
    await createE2ePage(page, project.id, { title: 'Processes', parent_id: handbook.id });
    const notes = await createE2ePage(page, project.id, { title: 'Notes' });
    await createE2ePage(page, project.id, { title: 'Technology' });
    await page.goto(`/projects/${project.identifier}/wiki/${notes.id}`);
    await expect(page.getByRole('textbox', { name: tr('en', 'wiki.page.title_label') })).toHaveValue('Notes');
    const tree = page.getByRole('tree', { name: tr('en', 'wiki.tree.label') });
    const row = (name: string) => tree.getByRole('treeitem', { name, exact: true });

    // the page's menu: "Move to …"
    const more = page.getByRole('main').getByRole('button', { name: tr('en', 'wiki.page.more') });
    await tabTo(page, more, { max: 80 });
    await page.keyboard.press('Enter');
    await arrowTo(page, page.getByRole('menuitem', { name: tr('en', 'wiki.move.menu') }));
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog', { name: tr('en', 'wiki.move.title', { title: 'Notes' }) });
    await expect(dialog).toBeVisible();
    const under = dialog.getByRole('combobox', { name: `${tr('en', 'wiki.move.parent')}: ${tr('en', 'wiki.move.top')}` });
    await tabTo(page, under);
    await page.keyboard.press('Enter');
    const search = page.getByRole('combobox', { name: tr('en', 'wiki.move.search') });
    await expect(search).toBeFocused();
    await page.keyboard.type('Handbook');
    // Handbook itself, and Processes below it; the first is highlighted
    const first = page.getByRole('option').first();
    await expect(first).toHaveAccessibleName(/^Handbook/);
    await expect(first).toHaveAttribute('data-highlighted', '');
    await page.keyboard.press('Enter');
    await expect(dialog.getByRole('combobox', { name: `${tr('en', 'wiki.move.parent')}: Handbook` })).toBeFocused();
    await pressMod(page, 'Enter');

    await expect(dialog).toBeHidden();
    await expect(page.getByText(tr('en', 'wiki.move.done.title', { title: 'Notes' }))).toBeVisible();
    await expect
      .poll(async () => ((await (await api(page, 'GET', `/api/v1/pages/${notes.id}`)).json()) as { data: { parent_id: string | null } }).data.parent_id)
      .toBe(handbook.id);
    if (!isPhone(page)) await expect(row('Notes')).toHaveAttribute('aria-level', '2');

    // the parent page: ⌘⌫ asks, and names what goes along
    await page.goto(`/projects/${project.identifier}/wiki/${handbook.id}`);
    await expect(page.getByRole('textbox', { name: tr('en', 'wiki.page.title_label') })).toHaveValue('Handbook');
    await tabTo(page, page.getByRole('main').getByRole('button', { name: tr('en', 'wiki.page.more') }), { max: 80 });
    await pressMod(page, 'Backspace');
    const ask = page.getByRole('alertdialog', { name: tr('en', 'wiki.delete.title_with', { title: 'Handbook', subpages: '2 subpages' }) });
    await expect(ask).toBeVisible();
    await expect(ask).toContainText('“Processes” and “Notes”');
    const confirm = ask.getByRole('button', { name: tr('en', 'wiki.delete.confirm_many', { count: 3 }) });
    await tabTo(page, confirm);
    await page.keyboard.press('Enter');

    // gone at once, the overview instead; ⌘Z brings the pages and the page back
    const done = tr('en', 'wiki.delete.done_with', { title: 'Handbook', subpages: '2 subpages' });
    await expect(page.getByText(done)).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`/projects/${project.identifier}/wiki$`));
    await expect(row('Handbook')).toHaveCount(0);
    await expect(page.getByRole('heading', { level: 1, name: tr('en', 'wiki.title') })).toBeFocused();
    await pressMod(page, 'z');
    await expect(page).toHaveURL(new RegExp(`/projects/${project.identifier}/wiki/${handbook.id}$`));
    await expect(page.getByRole('textbox', { name: tr('en', 'wiki.page.title_label') })).toHaveValue('Handbook');
    expect((await api(page, 'GET', `/api/v1/pages/${handbook.id}`)).status()).toBe(200);

    if (!isPhone(page)) {
      // ⌘⌫ on a row of the tree takes that row's page; the focus lands on the row of its parent
      await tabTo(page, row('Handbook'), { max: 80 });
      await page.keyboard.press('ArrowDown');
      await expect(row('Processes')).toBeFocused();
      await pressMod(page, 'Backspace');
      const single = page.getByRole('alertdialog', { name: tr('en', 'wiki.delete.title', { title: 'Processes' }) });
      await tabTo(page, single.getByRole('button', { name: tr('en', 'wiki.delete.confirm') }));
      await page.keyboard.press('Enter');
      await expect(row('Processes')).toHaveCount(0);
      await expect(row('Handbook')).toBeFocused();
      await expect(page).toHaveURL(new RegExp(`/projects/${project.identifier}/wiki/${handbook.id}$`));
      await pressMod(page, 'z');
      await expect(row('Processes')).toBeVisible();
    }

    // again, and this time the toast runs out: the subtree is deleted on the server
    await tabTo(page, page.getByRole('main').getByRole('button', { name: tr('en', 'wiki.page.more') }), { max: 80 });
    await pressMod(page, 'Backspace');
    await tabTo(page, confirm);
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(new RegExp(`/projects/${project.identifier}/wiki$`));
    await expect.poll(async () => (await api(page, 'GET', `/api/v1/pages/${notes.id}`)).status(), { timeout: 15_000 }).toBe(404);
    await expect(row('Technology')).toBeVisible();
    await expect(row('Handbook')).toHaveCount(0);
  } finally {
    await removeE2eProject(page, project.identifier);
  }
});
