import { expect, test } from '../fixtures';
import { createE2ePage, createE2eProject, createItem, pressMod, removeE2eProject, runId, searchToken, tabTo, tr, variant, waitForSearch } from '../helpers';

// The command palette with the keyboard only, signed in as the e2e person (playwright.config.ts), in English: its
// commands and the search. Items a spec searches carry the search token of its run and variant (all variants share one
// index), in front of the word typed: the search matches only the last word as a prefix.

test.beforeEach(async ({ page }) => {
  await page.goto('/my-items');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(tr('en', 'items.my.title'));
});

/** Opens the palette with mod+k and waits until its input has the focus. */
async function openPalette(page: import('@playwright/test').Page) {
  await pressMod(page, 'k');
  const palette = page.getByRole('dialog', { name: tr('en', 'palette.title') });
  await expect(palette).toBeVisible();
  await expect(palette.getByRole('combobox', { name: tr('en', 'palette.input') })).toBeFocused();
  return palette;
}

test('opens the palette with the keyboard and goes to the projects', async ({ page }) => {
  const palette = await openPalette(page);
  await expect(palette.getByRole('option', { name: new RegExp(`^${tr('en', 'commands.go.projects')}`) })).toBeVisible();

  await page.keyboard.type('all projects');
  await expect(palette.getByRole('option')).toHaveCount(1);
  await page.keyboard.press('Enter');

  await expect(page).toHaveURL(/\/projects$/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(tr('en', 'projects.title'));
  await expect(palette).toBeHidden();
});

test('lists the shortcuts of the palette in the help', async ({ page }) => {
  await page.keyboard.press('?');
  const help = page.getByRole('dialog', { name: tr('en', 'shortcuts.help.title') });
  await expect(help).toBeVisible();
  await expect(help.getByText(tr('en', 'shortcuts.shell.palette'), { exact: true })).toBeVisible();
  await expect(help.getByText(tr('en', 'shortcuts.item.create'), { exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(help).toBeHidden();
});

test('closes with Escape and mod+k, and gives the focus back', async ({ page }) => {
  const link = page.getByRole('link', { name: tr('en', 'items.empty.projects_link') });
  await tabTo(page, link);

  const palette = await openPalette(page);
  await page.keyboard.press('Escape');
  await expect(palette).toBeHidden();
  await expect(link).toBeFocused();

  await openPalette(page);
  await pressMod(page, 'k');
  await expect(palette).toBeHidden();
  await expect(link).toBeFocused();
});

test('changes the theme from its list', async ({ page }) => {
  const html = page.locator('html');
  const palette = await openPalette(page);
  await page.keyboard.type('theme');
  await page.keyboard.press('Enter');
  const themes = palette.getByRole('combobox', { name: tr('en', 'commands.theme.label') });
  await expect(themes).toBeFocused();
  await expect(themes).toHaveAttribute('placeholder', tr('en', 'commands.theme.placeholder'));

  await page.keyboard.type(tr('en', 'theme.dark'));
  await page.keyboard.press('Enter');
  await expect(palette).toBeHidden();
  await expect(html).toHaveAttribute('data-theme', 'dark');

  // back to the system's, with Backspace through the list of all commands
  await openPalette(page);
  await page.keyboard.type('theme');
  await page.keyboard.press('Enter');
  await expect(themes).toBeFocused();
  await page.keyboard.press('Backspace');
  await expect(palette.getByRole('combobox', { name: tr('en', 'palette.input') })).toBeFocused();
  await page.keyboard.type('theme');
  await page.keyboard.press('Enter');
  await page.keyboard.type(tr('en', 'theme.system'));
  await page.keyboard.press('Enter');
  await expect(palette).toBeHidden();
  await expect(html).not.toHaveAttribute('data-theme', /.+/);
});

test('says when nothing matches', async ({ page }) => {
  const palette = await openPalette(page);
  await page.keyboard.type('xyzzy');

  await expect(palette.getByText(tr('en', 'palette.no_results', { query: 'xyzzy' }), { exact: true })).toBeVisible();
  await expect(palette.getByRole('option')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(palette).toBeHidden();
});

test('searches from the palette', async ({ page }) => {
  const { id, identifier } = await createE2eProject(page, `E2E palette search ${variant()} ${runId()}`);
  try {
    const title = `E2E Leuchtturm ${searchToken()}`;
    const item = await createItem(page, { project_id: id, title });
    const query = `${searchToken()} leuchtturm`;
    await waitForSearch(page, query, (data) => data.items.some((hit) => hit.id === item.id));

    const palette = await openPalette(page);
    await page.keyboard.type(query);
    const items = palette.getByRole('group', { name: tr('en', 'palette.section.items') });
    await expect(items.getByRole('option', { name: new RegExp(item.key) })).toBeVisible();
    await expect(palette.getByRole('status')).toHaveText(tr('en', 'palette.hits.one'));
    await page.keyboard.press('Enter');

    await expect(page).toHaveURL(new RegExp(`/items/${item.key}$`));
    await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible();
    await expect(palette).toBeHidden();
  } finally {
    await removeE2eProject(page, identifier);
  }
});

test('finds a wiki page by a word of its text and opens it', async ({ page }) => {
  const { id, identifier } = await createE2eProject(page, `E2E palette wiki ${variant()} ${runId()}`);
  try {
    // the title has neither word: the page is found by its text
    const content_json = {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: `Der Wegweiser für neue Leute ${searchToken()}.` }] }],
    };
    const wikiPage = await createE2ePage(page, id, { title: 'E2E Orientierung', content_json });
    const query = `${searchToken()} wegweiser`;
    await waitForSearch(page, query, (data) => data.pages.some((hit) => hit.id === wikiPage.id));

    const palette = await openPalette(page);
    await page.keyboard.type(query);
    const pages = palette.getByRole('group', { name: tr('en', 'palette.section.pages') });
    // its title and where it lives, as in flow 5 of the clickdummy
    const hit = pages.getByRole('option', { name: `E2E Orientierung ${tr('en', 'wiki.place', { identifier })}` });
    await expect(hit).toBeVisible();
    await expect(palette.getByRole('status')).toHaveText(tr('en', 'palette.hits.one'));
    await expect(hit).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('Enter');

    await expect(page).toHaveURL(new RegExp(`/projects/${identifier}/wiki/${wikiPage.id}$`));
    await expect(page.getByRole('textbox', { name: tr('en', 'wiki.page.title_label') })).toHaveValue('E2E Orientierung');
    await expect(palette).toBeHidden();
  } finally {
    await removeE2eProject(page, identifier);
  }
});
