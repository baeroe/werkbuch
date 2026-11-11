import type { Page } from '@playwright/test';
import { expect, test } from '../fixtures';
import { allEntries, api, artisanEval, createE2ePage, createE2eProject, createItem, pressMod, removeE2eProject, runId, searchToken, tabTo, tr, variant, waitForSearch } from '../helpers';

// The relations of an item on its page, with the keyboard only, signed in as the e2e person in English. Each test works
// in a project of its own (`E2E …`, removed in `finally`); its items come over the API. The item to relate is found
// through the search: by its key at once, by a word of its title once the index has it (`waitForSearch`). Creating a child item from the
// children section needs the create dialog and is in create-item.spec.ts (K11). An epic with 101 children (one per
// worker, made in beforeAll) shows how the children section pages.

const name = (what: string) => `E2E ${what} ${variant()} ${runId()}`;

/** The relations of an item as the API has them. */
async function relationsOf(page: Page, id: string): Promise<unknown[]> {
  const response = await api(page, 'GET', `/api/v1/work-items/${id}/relations`);
  expect(response.status(), await response.text()).toBe(200);
  return ((await response.json()) as { data: unknown[] }).data;
}

// an epic with 101 children, made once per worker: the epic over the API, its children without events through the
// factory (`artisanEval`): 101 items over the API would each queue three jobs on the worker that also serves the mails
// and live updates of the specs after this one. The detail embeds the first 100 (A449), the section loads the 101st from
// the list with the epic as parent. Named per worker (a worker that starts again runs beforeAll anew).
let big: { identifier: string; epic: { id: string; key: string } } | undefined;

test.beforeAll(async ({ browser }, workerInfo) => {
  // `artisan tinker` boots the app in DDEV: seconds on its own, more under load
  test.setTimeout(120_000);
  const page = await browser.newPage();
  await page.goto('/my-items');
  const project = await createE2eProject(page, name(`children ${workerInfo.workerIndex}`), { types: ['Task', 'Epic'] });
  const epicType = (await allEntries(page, 'work-item-types')).find((entry) => entry.is_epic === true && entry.archived_at === null) as { id: string };
  const epic = await createItem(page, { project_id: project.id, type_id: epicType.id, title: 'E2E Großes Epic' });
  big = { identifier: project.identifier, epic };
  const php = [
    `$epic = App\\Models\\WorkItem::findByReference('${epic.key}') ?? throw new RuntimeException('no ${epic.key}');`,
    `App\\Models\\WorkItem::factory()->childOf($epic)->count(101)->sequence(fn ($sequence) => ['title' => 'E2E Teil '.($sequence->index + 1)])->create();`,
    `echo App\\Models\\WorkItem::query()->where('parent_id', $epic->id)->count(), PHP_EOL;`,
  ].join('\n');
  expect(artisanEval(php)).toBe('101');
  await page.close();
});

test.afterAll(async ({ browser }) => {
  // nothing to remove when beforeAll failed before the project existed
  if (!big) return;
  const page = await browser.newPage();
  await page.goto('/my-items');
  await removeE2eProject(page, big.identifier);
  await page.close();
});

test('shows the first 100 children of an epic and loads the rest', async ({ page }) => {
  const { epic } = big!;
  await page.goto(`/items/${epic.key}`);
  await expect(page.getByRole('heading', { level: 1, name: 'E2E Großes Epic' })).toBeVisible();
  const section = page.getByRole('region', { name: tr('en', 'items.detail.children.title') });
  const rows = section.getByRole('listitem');
  await expect(rows).toHaveCount(100);
  await expect(section.getByText(tr('en', 'items.detail.children.shown', { shown: '100', total: '101' }))).toBeVisible();
  await expect(section.getByRole('link', { name: /E2E Teil 101\b/ })).toHaveCount(0);

  // the button loads the next page; with nothing left it goes, and the focus moves on to the child that came
  const more = section.getByRole('button', { name: tr('en', 'items.detail.children.more') });
  // busy until the first page of the list is there
  await expect(more).not.toHaveAttribute('aria-busy');
  await more.focus();
  await page.keyboard.press('Enter');
  await expect(rows).toHaveCount(101);
  await expect(more).toHaveCount(0);
  await expect(section.getByRole('link', { name: /E2E Teil 101\b/ })).toBeFocused();
});

test('relates two items with r and removes the relation again', async ({ page }) => {
  const { id, identifier } = await createE2eProject(page, name('relations'), { types: ['Task'] });
  try {
    const first = await createItem(page, { project_id: id, title: 'E2E Kontaktformular prüfen' });
    const second = await createItem(page, { project_id: id, title: 'E2E Mailserver einrichten' });
    // the built-in "relates" type, in the words of the catalog
    const relates = (await allEntries(page, 'relation-types')).find((entry) => entry.built_in === 'relates') as { outward_label: string };

    await page.goto(`/items/${first.key}`);
    await expect(page.getByRole('heading', { level: 1, name: 'E2E Kontaktformular prüfen' })).toBeVisible();
    const section = page.getByRole('region', { name: tr('en', 'items.detail.relations.title') });
    const add = section.getByRole('button', { name: new RegExp(`^${tr('en', 'items.detail.relations.add')}`) });
    // the button is there once the rights have loaded: r acts from then on
    await expect(add).toBeVisible();
    await expect(section.getByText(tr('en', 'items.detail.relations.empty'))).toBeVisible();

    await page.keyboard.press('r');
    const dialog = page.getByRole('dialog', { name: tr('en', 'items.detail.relations.dialog.title') });
    await expect(dialog).toBeVisible();
    // the list of items opens with the dialog; the key finds exactly that item, in any spelling
    const search = page.getByPlaceholder(tr('en', 'items.detail.relations.dialog.search'));
    await expect(search).toBeFocused();
    await page.keyboard.type(second.key.toLowerCase());
    await expect(page.getByRole('option', { name: /E2E Mailserver einrichten/ })).toBeVisible();
    await expect(page.getByRole('option')).toHaveCount(1);
    await page.keyboard.press('Enter');
    await expect(dialog.getByText(`${first.key} ${relates.outward_label} ${second.key}`)).toBeVisible();

    await pressMod(page, 'Enter');
    await expect(dialog).toBeHidden();
    await expect(page.getByText(tr('en', 'items.detail.relations.added'), { exact: true })).toBeVisible();
    await expect(section.getByRole('link', { name: new RegExp(second.key) })).toBeVisible();
    // the focus is back on "Relation"
    await expect(add).toBeFocused();
    expect(await relationsOf(page, second.id)).toHaveLength(1);

    // removed at once on the screen, on the server once the undo toast has run out (5 s)
    const remove = section.getByRole('button', { name: tr('en', 'items.detail.relations.remove', { label: relates.outward_label, key: second.key }) });
    await tabTo(page, remove, { max: 20 });
    await page.keyboard.press('Enter');
    await expect(section.getByRole('link', { name: new RegExp(second.key) })).toHaveCount(0);
    await expect(page.getByText(tr('en', 'items.detail.relations.removed', { label: relates.outward_label, key: second.key }))).toBeVisible();
    await expect(add).toBeFocused();
    await expect.poll(() => relationsOf(page, first.id), { timeout: 15_000 }).toHaveLength(0);
    expect(await relationsOf(page, second.id)).toHaveLength(0);
    await expect(section.getByText(tr('en', 'items.detail.relations.empty'))).toBeVisible();
  } finally {
    await page.goto('/my-items');
    await removeE2eProject(page, identifier);
  }
});

test('finds the target by a word of its title', async ({ page }) => {
  const { id, identifier } = await createE2eProject(page, name('relation search'), { types: ['Task'] });
  try {
    const first = await createItem(page, { project_id: id, title: 'E2E Funkmast aufstellen' });
    const second = await createItem(page, { project_id: id, title: `E2E Wetterstation kalibrieren ${searchToken()}` });
    // the token of this run and variant first: Meilisearch reads only the last word as a prefix
    const query = `${searchToken()} wetterst`;
    await waitForSearch(page, query, (data) => data.items.some((hit) => hit.id === second.id));

    await page.goto(`/items/${first.key}`);
    await expect(page.getByRole('heading', { level: 1, name: 'E2E Funkmast aufstellen' })).toBeVisible();
    const section = page.getByRole('region', { name: tr('en', 'items.detail.relations.title') });
    await expect(section.getByRole('button', { name: new RegExp(`^${tr('en', 'items.detail.relations.add')}`) })).toBeVisible();

    await page.keyboard.press('r');
    const dialog = page.getByRole('dialog', { name: tr('en', 'items.detail.relations.dialog.title') });
    const search = page.getByPlaceholder(tr('en', 'items.detail.relations.dialog.search'));
    await expect(search).toBeFocused();
    // nothing is asked before something is typed
    await expect(page.getByText(tr('en', 'items.detail.relations.dialog.type_to_search'))).toBeVisible();
    await page.keyboard.type(query);
    await expect(page.getByRole('option', { name: new RegExp(`E2E Wetterstation kalibrieren ${searchToken()}`) })).toBeVisible();
    await expect(page.getByRole('option')).toHaveCount(1);
    await page.keyboard.press('Enter');
    await expect(dialog.getByRole('combobox', { name: new RegExp(second.key) })).toBeVisible();

    await pressMod(page, 'Enter');
    await expect(dialog).toBeHidden();
    await expect(section.getByRole('link', { name: new RegExp(second.key) })).toBeVisible();
    expect(await relationsOf(page, first.id)).toHaveLength(1);
  } finally {
    await page.goto('/my-items');
    await removeE2eProject(page, identifier);
  }
});

test('opens a wiki page that names the item from its section', async ({ page }) => {
  await page.goto('/my-items');
  const project = await createE2eProject(page, name('wiki pages'), { types: ['Task'] });
  try {
    const item = await createItem(page, { project_id: project.id, title: 'E2E Newsletter versenden' });
    const reference = { type: 'reference', attrs: { id: item.id, label: null, mentionSuggestionChar: '#', kind: 'item' } };
    const plan = await createE2ePage(page, project.id, {
      title: 'Release plan',
      content_json: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Before the release: ' }, reference] }] },
    });

    await page.goto(`/items/${item.key}`);
    await expect(page.getByRole('heading', { level: 1, name: 'E2E Newsletter versenden' })).toBeVisible();
    const section = page.getByRole('region', { name: tr('en', 'items.detail.pages.title') });
    const link = section.getByRole('link', { name: /Release plan/ });
    await expect(link).toBeVisible();
    await tabTo(page, link, { max: 120 });
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(new RegExp(`/projects/${project.identifier}/wiki/${plan.id}$`));
    await expect(page.getByRole('textbox', { name: tr('en', 'wiki.page.title_label') })).toHaveValue('Release plan');
  } finally {
    await page.goto('/my-items');
    await removeE2eProject(page, project.identifier);
  }
});
