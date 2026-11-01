import type { Page } from '@playwright/test';
import { expect, test } from '../fixtures';
import { allEntries, api, createE2eProject, createItem, pressMod, removeE2eProject, runId, tabTo, tr, variant } from '../helpers';

// The selection of an item list with the keyboard only, signed in as the e2e person (playwright.config.ts), in English:
// x and ⇧X select, the item commands act on all of them (one bulk call), mod+backspace archives with undo, and the
// toast names what the server refused. Each test works in a project of its own with two or three items (every item
// created is an event the queue worker handles, and a mail of another spec waits behind them).

const name = (what: string) => `E2E bulk ${what} ${variant()} ${runId()}`;

/** The id of a state of a workflow by their names. */
async function stateOf(page: Page, workflow: string, state: string): Promise<string> {
  const found = (await allEntries(page, 'workflows')).find((entry) => entry.name === workflow) as { states: { id: string; name: string }[] };
  return found.states.find((entry) => entry.name === state)!.id;
}

/** The row of an item by its key. */
const row = (page: Page, key: string) => page.getByRole('group', { name: new RegExp(`^${key} `) });

/** Opens the list of the project and puts the focus on the row of `key`. */
async function openList(page: Page, identifier: string, key: string) {
  await page.goto(`/projects/${identifier}`);
  await expect(row(page, key)).toBeVisible();
  await tabTo(page, row(page, key), { max: 80 });
}

/** The palette's search field, once it has the focus (Base UI sets it a frame late). */
async function paletteOpen(page: Page) {
  await expect(page.getByRole('dialog').getByRole('combobox')).toBeFocused();
}

test('selects three items with x and sets their priority with p', async ({ page }) => {
  const { id, identifier } = await createE2eProject(page, name('priority'), { types: ['Task'] });
  try {
    const items = [];
    for (const title of ['E2E Kopfzeile', 'E2E Fußzeile', 'E2E Seitenleiste']) items.push(await createItem(page, { project_id: id, title }));
    await openList(page, identifier, items[0]!.key);

    // x selects the row under the cursor, j moves on
    await page.keyboard.press('x');
    await page.keyboard.press('j');
    await page.keyboard.press('x');
    await page.keyboard.press('j');
    await page.keyboard.press('x');
    const bar = page.getByRole('group', { name: tr('en', 'items.bulk.label') });
    await expect(bar).toContainText(tr('en', 'items.bulk.of_total', { total: 3 }));

    await page.keyboard.press('p');
    await paletteOpen(page);
    await page.keyboard.type('high');
    await page.keyboard.press('Enter');
    const subject = tr('en', 'items.bulk.subject.other', { count: 3 });
    await expect(page.getByText(tr('en', 'items.commands.done', { key: subject, what: tr('en', 'items.commands.what.priority', { priority: 'High' }) }))).toBeVisible();

    // all three changed on the server
    for (const item of items) {
      const stored = (await (await api(page, 'GET', `/api/v1/work-items/${item.id}`)).json()) as { data: { priority: string } };
      expect(stored.data.priority).toBe('high');
    }
  } finally {
    await removeE2eProject(page, identifier);
  }
});

test('selects a range with shift+x, archives with mod+backspace and undoes with mod+z', async ({ page }) => {
  const { id, identifier } = await createE2eProject(page, name('archive'), { types: ['Task'] });
  try {
    const done = await stateOf(page, 'Standard', 'Done');
    const items = [];
    for (const title of ['E2E Impressum', 'E2E Datenschutz', 'E2E Cookie-Hinweis']) items.push(await createItem(page, { project_id: id, title, state_id: done }));
    await openList(page, identifier, items[0]!.key);

    // x marks the start, ⇧X selects up to the cursor
    await page.keyboard.press('x');
    await page.keyboard.press('j');
    await page.keyboard.press('j');
    await page.keyboard.press('Shift+X');
    const bar = page.getByRole('group', { name: tr('en', 'items.bulk.label') });
    await expect(bar).toContainText(tr('en', 'items.bulk.of_total', { total: 3 }));

    // all closed: archived, out of the list at once
    await pressMod(page, 'Backspace');
    await expect(page.getByText(tr('en', 'items.commands.archived', { key: tr('en', 'items.bulk.subject.other', { count: 3 }) }))).toBeVisible();
    for (const item of items) await expect(row(page, item.key)).toBeHidden();
    await expect(bar).toBeHidden();

    // undone: back in the list, and nothing reached the server
    await pressMod(page, 'z');
    for (const item of items) await expect(row(page, item.key)).toBeVisible();
    for (const item of items) {
      const stored = (await (await api(page, 'GET', `/api/v1/work-items/${item.id}`)).json()) as { data: { archived_at: string | null } };
      expect(stored.data.archived_at).toBeNull();
    }
  } finally {
    await removeE2eProject(page, identifier);
  }
});

test('names the item a bulk change refuses', async ({ page }) => {
  const { id, identifier } = await createE2eProject(page, name('refused'), { workflow: 'Agentur-Freigabe', types: ['Task'] });
  try {
    const state = (name: string) => stateOf(page, 'Agentur-Freigabe', name);
    // one item awaits the customer's approval (Done may follow), the other is still Todo (it may not)
    const approved = await createItem(page, { project_id: id, title: 'E2E Startseite freigeben', state_id: await state('Todo') });
    for (const next of ['In Progress', 'Review', 'Kundenfreigabe']) {
      const moved = await api(page, 'POST', `/api/v1/work-items/${approved.id}/transition`, { to_state_id: await state(next) });
      expect(moved.status(), await moved.text()).toBe(200);
    }
    const early = await createItem(page, { project_id: id, title: 'E2E Kontaktseite', state_id: await state('Todo') });
    // Todo comes before Kundenfreigabe in the list (grouped by status)
    await openList(page, identifier, early.key);

    await page.keyboard.press('x');
    await page.keyboard.press('j');
    await expect(row(page, approved.key)).toBeFocused();
    await page.keyboard.press('x');
    await expect(page.getByRole('group', { name: tr('en', 'items.bulk.label') })).toContainText(tr('en', 'items.bulk.of_total', { total: 2 }));

    // Done for both: the resolution first, then the server moves one and refuses the other
    await page.keyboard.press('s');
    await paletteOpen(page);
    await page.keyboard.type('done');
    await page.keyboard.press('Enter');
    const question = page.getByRole('dialog', { name: new RegExp('Done') });
    await expect(question).toBeVisible();
    await expect(question.locator(':focus')).toHaveCount(1);
    await page.keyboard.press('Enter');

    const toast = page.getByText(tr('en', 'items.bulk.some', { updated: 1, count: 2, done: tr('en', 'items.bulk.done.changed') }));
    await expect(toast).toBeVisible();
    await expect(page.getByText(`${early.key}: ${tr('en', 'problem.reason.transition_not_allowed')}`)).toBeVisible();
  } finally {
    await removeE2eProject(page, identifier);
  }
});
