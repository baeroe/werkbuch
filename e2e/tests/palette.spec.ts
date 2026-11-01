import { expect, test } from '../fixtures';
import { pressMod, tabTo, tr } from '../helpers';

// The command palette with the keyboard only, signed in as the e2e person (playwright.config.ts), in English. It finds
// commands only; search results come with Phase 6. The item commands need an item page (Task 21).

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

test('says when no command matches', async ({ page }) => {
  const palette = await openPalette(page);
  await page.keyboard.type('xyzzy');

  await expect(palette.getByText(tr('en', 'palette.empty'), { exact: true })).toBeVisible();
  await expect(palette.getByRole('option')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(palette).toBeHidden();
});
