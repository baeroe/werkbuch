import type { Page } from '@playwright/test';
import { expect, test } from '../fixtures';
import { api, arrowTo, createE2eView, openNavigation, pressMod, removeE2eView, runId, tabTo, tr, variant } from '../helpers';

// The views overview and the views of the sidebar, with the keyboard only, signed in as the e2e person (org admin,
// English). Every test saves its own view over the API (`E2E <variant> <run> …`, removed in `finally`; the e2e seeder
// removes what an aborted run left).

const viewName = (what: string) => `E2E ${variant()} ${runId()} ${what}`;

/** The id of the view the address shows. */
const viewIdOf = (page: Page) => new URL(page.url()).pathname.split('/').at(-1)!;

/** The overview once its rows are there. */
async function openOverview(page: Page) {
  await page.goto('/views');
  const list = page.getByRole('list', { name: tr('en', 'views.list_label') });
  await expect(list).toBeVisible();
  return list;
}

test('creates a view from the overview with the keyboard and lands on it', async ({ page }) => {
  const name = viewName('new');
  // the list may be empty (no view of the demo data, the other variants' views come and go)
  await page.goto('/views');
  await expect(page.getByText(tr('en', 'views.loading'))).toHaveCount(0);
  let id: string | null = null;
  try {
    // the button of the heading (an empty list offers a second one)
    await tabTo(page, page.getByRole('main').getByRole('button', { name: tr('en', 'views.new'), exact: true }).first(), { max: 80 });
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog', { name: tr('en', 'views.dialog.new_title') });
    await expect(dialog).toBeVisible();
    const field = dialog.getByRole('textbox', { name: tr('en', 'views.fields.name') });
    await expect(field).toBeFocused();
    await page.keyboard.type(name);
    // the layout: the pressed segment is the tab stop, the arrows move to the others
    await tabTo(page, dialog.getByRole('button', { name: tr('en', 'items.layout.list'), exact: true }));
    await arrowTo(page, dialog.getByRole('button', { name: tr('en', 'items.layout.board'), exact: true }), 'ArrowRight');
    await page.keyboard.press('Space');
    await expect(dialog.getByRole('button', { name: tr('en', 'items.layout.board'), exact: true })).toHaveAttribute('aria-pressed', 'true');
    await pressMod(page, 'Enter');

    await expect(page).toHaveURL(/\/views\/[0-9a-z]{26}$/);
    id = viewIdOf(page);
    await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();
    const saved = await api(page, 'GET', `/api/v1/views/${id}`);
    expect(saved.status()).toBe(200);
    const { data } = (await saved.json()) as { data: { name: string; display: { layout: string }; filter: unknown } };
    expect(data).toMatchObject({ name, display: { layout: 'board' }, filter: { version: 1, conditions: [] } });
  } finally {
    if (id) await removeE2eView(page, id);
  }
});

test('stars a view and opens it from the sidebar', async ({ page }) => {
  const view = await createE2eView(page, { name: 'starred' });
  const name = viewName('starred');
  try {
    await openOverview(page);
    await tabTo(page, page.getByRole('button', { name: tr('en', 'ui.favorite_star.add', { name }), exact: true }), { max: 250 });
    await page.keyboard.press('Enter');
    await expect(page.getByRole('button', { name: tr('en', 'ui.favorite_star.remove', { name }), exact: true })).toBeFocused();

    const navigation = await openNavigation(page, 'en', { backwards: true });
    const link = navigation.getByRole('link', { name, exact: true });
    await expect(link).toHaveAttribute('href', `/views/${view.id}`);
    await tabTo(page, link, { backwards: true, max: 250 });
    await page.keyboard.press('Enter');

    await expect(page).toHaveURL(new RegExp(`/views/${view.id}$`));
    await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();
  } finally {
    await removeE2eView(page, view.id);
  }
});

test('deletes an own view and undoes it', async ({ page }) => {
  // two views, so the row that goes has a neighbour that takes the focus
  const first = await createE2eView(page, { name: 'undo a' });
  const second = await createE2eView(page, { name: 'undo b' });
  const name = viewName('undo a');
  try {
    const list = await openOverview(page);
    await tabTo(page, list.getByRole('button', { name: tr('en', 'views.row.delete', { name }), exact: true }), { max: 250 });
    await page.keyboard.press('Enter');

    await expect(list.getByRole('link', { name, exact: true })).toHaveCount(0);
    await expect(page.getByText(tr('en', 'views.deleted', { name }), { exact: true })).toBeVisible();
    // the row went with the button: the focus is on the link of a neighbour, not on the page
    await expect(list.locator('a:focus')).toHaveCount(1);

    await pressMod(page, 'z');
    await expect(list.getByRole('link', { name, exact: true })).toBeVisible();
    // nothing was deleted
    expect((await api(page, 'GET', `/api/v1/views/${first.id}`)).status()).toBe(200);
  } finally {
    await removeE2eView(page, first.id);
    await removeE2eView(page, second.id);
  }
});
