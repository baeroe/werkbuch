import { expect, test } from '../fixtures';
import { createE2eProject, createItem, removeE2eProject, runId, searchToken, variant, waitForSearch } from '../helpers';

// The search with the keyboard only, signed in as the e2e person (playwright.config.ts), in English. Every item of a
// spec carries the search token of its run and variant: all variants share one index.

const name = (what: string) => `E2E ${what} ${variant()} ${runId()}`;

test('indexes a new item for the search', async ({ page }) => {
  await page.goto('/my-items');
  const { id, identifier } = await createE2eProject(page, name('search index'));
  try {
    const item = await createItem(page, { project_id: id, title: `E2E Kontaktformular ${searchToken()}` });
    const data = await waitForSearch(page, `${searchToken()} kontakt`, (answer) => answer.items.some((hit) => hit.id === item.id));
    expect(data.items[0].key).toBe(item.key);
  } finally {
    await removeE2eProject(page, identifier);
  }
});
