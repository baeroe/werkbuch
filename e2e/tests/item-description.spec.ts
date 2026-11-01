import type { Page } from '@playwright/test';
import { expect, test } from '../fixtures';
import { allEntries, api, createE2eProject, createItem, PEOPLE, pressMod, removeE2eProject, runId, signedInContext, tabTo, tr, variant, type Locale } from '../helpers';

// The description of an item on its page, with the keyboard only. The e2e person (Erik Ende, English) and Mara
// Lindqvist (org admin, German, a browser context of her own) edit the same description: the second save meets the
// first and says so (409 `description_conflict`), and nothing typed is lost without the banner. Each test works in a
// project of its own (`E2E …`, removed in `finally`); its items come over the API.

const name = (what: string) => `E2E ${what} ${variant()} ${runId()}`;

/** Opens the page of an item and puts the focus into its description, once that can be edited. */
async function editDescription(page: Page, locale: Locale, key: string, title: string) {
  await page.goto(`/items/${key}`);
  await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible();
  const section = page.getByRole('region', { name: tr(locale, 'items.detail.description.title') });
  const editor = section.getByRole('textbox', { name: tr(locale, 'editor.label.description') });
  await tabTo(page, editor, { max: 120 });
  return { section, editor, status: section.getByRole('status') };
}

/** The Markdown of an item's description as the server holds it. */
async function storedDescription(page: Page, id: string): Promise<string | null> {
  const response = await api(page, 'GET', `/api/v1/work-items/${id}`);
  expect(response.status(), await response.text()).toBe(200);
  return ((await response.json()) as { data: { description: string | null } }).data.description;
}

test('warns the second editor of a description and keeps both versions', async ({ page, browser }) => {
  const { id, identifier } = await createE2eProject(page, name('conflict'), { types: ['Task'] });
  const other = await signedInContext(browser, PEOPLE.mara);
  try {
    const item = await createItem(page, { project_id: id, title: 'E2E Startseite umbauen', description: 'Erster Stand.' });

    // both open the item; Mara's window loads before Erik saves
    const mara = await editDescription(other.page, 'de', item.key, 'E2E Startseite umbauen');
    const erik = await editDescription(page, 'en', item.key, 'E2E Startseite umbauen');

    await page.keyboard.type('Von Erik. ');
    await expect(erik.status).toHaveText(tr('en', 'items.detail.description.saved'));
    expect(await storedDescription(page, item.id)).toBe('Von Erik. Erster Stand.');

    // Mara types on her older version: her save is refused, the banner names Erik, her text stays
    await other.page.keyboard.type('Von Mara. ');
    const banner = mara.section.getByRole('alert');
    // the sentence is the server's (`problem.detail.description_conflict`); it names whoever saved last
    await expect(banner).toContainText(PEOPLE.e2e.name);
    await expect(banner).toContainText(tr('de', 'items.detail.description.conflict'));
    await expect(mara.editor).toHaveText('Von Mara. Erster Stand.');
    expect(await storedDescription(page, item.id)).toBe('Von Erik. Erster Stand.');

    await tabTo(other.page, banner.getByRole('button', { name: tr('de', 'items.detail.description.keep_mine') }), { backwards: true, max: 10 });
    await other.page.keyboard.press('Enter');
    await expect(banner).toBeHidden();
    await expect(mara.status).toHaveText(tr('de', 'items.detail.description.saved'));
    expect(await storedDescription(page, item.id)).toBe('Von Mara. Erster Stand.');

    // Erik's window shows Mara's version once it loads again
    await page.reload();
    await expect(page.getByRole('region', { name: tr('en', 'items.detail.description.title') }).getByRole('textbox')).toHaveText('Von Mara. Erster Stand.');

    // the history has both changes, Erik's first
    const users = await allEntries(page, 'users');
    const idOf = (person: { name: string }) => String(users.find((user) => user.name === person.name)!.id);
    const history = await api(page, 'GET', `/api/v1/work-items/${item.id}/history`);
    expect(history.status(), await history.text()).toBe(200);
    const changes = ((await history.json()) as { data: { type: string; actor_id: string; changes: Record<string, unknown> | null }[] }).data.filter(
      (entry) => entry.type === 'work_item.updated' && entry.changes !== null && 'description' in entry.changes,
    );
    expect(changes.map((entry) => entry.actor_id)).toEqual([idOf(PEOPLE.e2e), idOf(PEOPLE.mara)]);
  } finally {
    await other.context.close();
    await page.goto('/my-items');
    await removeE2eProject(page, identifier);
  }
});

test('writes a heading and a checklist with Markdown shortcuts', async ({ page }) => {
  const { id, identifier } = await createE2eProject(page, name('markdown'), { types: ['Task'] });
  try {
    const item = await createItem(page, { project_id: id, title: 'E2E Formular testen' });
    const { editor, status } = await editDescription(page, 'en', item.key, 'E2E Formular testen');

    await page.keyboard.type('## Ablauf');
    await page.keyboard.press('Enter');
    await page.keyboard.type('[ ] Formular absenden');
    await expect(editor.getByRole('heading', { name: 'Ablauf' })).toBeVisible();
    await expect(editor.getByRole('checkbox')).toHaveCount(1);

    // ⌘↵ saves at once
    await pressMod(page, 'Enter');
    await expect(status).toHaveText(tr('en', 'items.detail.description.saved'));
    expect(await storedDescription(page, item.id)).toBe('## Ablauf\n\n- [ ] Formular absenden');
  } finally {
    await page.goto('/my-items');
    await removeE2eProject(page, identifier);
  }
});
