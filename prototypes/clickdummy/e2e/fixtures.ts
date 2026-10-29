/*
 * What both Playwright projects share: the test with its guard against errors the page reports, and the palette.
 */

import { expect, test as base, type Locator, type Page } from '@playwright/test';

export { expect };

/** Fails the test on errors the page reports: console errors and uncaught exceptions. */
export const test = base.extend<{ pageErrors: string[] }>({
  pageErrors: [
    async ({ page }, use) => {
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(`page error: ${error.message}`));
      page.on('console', (message) => {
        if (message.type() === 'error') errors.push(`console error: ${message.text()}`);
      });
      await use(errors);
      expect(errors, 'the page reported errors').toEqual([]);
    },
    { auto: true },
  ],
});

/** The command palette: ⌘K on a Mac, Strg+K elsewhere. Answers the palette once its input has the focus. */
export async function openPalette(page: Page): Promise<Locator> {
  await page.keyboard.press('ControlOrMeta+k');
  const palette = page.getByRole('dialog', { name: 'Befehlspalette' });
  await expect(palette.getByRole('combobox')).toBeFocused();
  return palette;
}
