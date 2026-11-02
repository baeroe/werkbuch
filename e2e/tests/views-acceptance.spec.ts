import type { Page } from '@playwright/test';
import { expect, test } from '../fixtures';
import {
  allEntries,
  api,
  createE2eProject,
  createE2eView,
  createItem,
  openNavigation,
  pressMod,
  removeE2eProject,
  removeE2eView,
  runId,
  tabTo,
  tr,
  variant,
} from '../helpers';

// The acceptance of phase 5 (success criteria 4 and 6), with the keyboard only, signed in as the e2e person (org
// admin, English). A team view with a filter on a property of its own (the demo dropdown "Kunde", Task and Epic have
// it) shows as list, board and table the same items as `GET /api/v1/work-items?view=<id>`, and the timeline shows its
// epics with their progress. The projects (`E2E …`) and views (`E2E <variant> <run> …`) are the spec's own, removed
// after it; the demo data is only read.

const name = (what: string, worker: number) => `E2E accept ${what} ${variant()} ${runId()} ${worker}`;
const viewName = (what: string) => `E2E ${variant()} ${runId()} ${what}`;

/** The demo property "Kunde": its label and the id of "Studio Nordlicht". */
async function customer(page: Page): Promise<{ label: string; nordlicht: string; other: string }> {
  const property = (await allEntries(page, 'properties')).find((entry) => entry.key === 'customer') as { label: string; options: { id: string; label: string }[] };
  return {
    label: property.label,
    nordlicht: property.options.find((option) => option.label === 'Studio Nordlicht')!.id,
    other: property.options.find((option) => option.label !== 'Studio Nordlicht')!.id,
  };
}

async function typeId(page: Page, type: string): Promise<string> {
  return String((await allEntries(page, 'work-item-types')).find((entry) => entry.name === type)!.id);
}

async function stateId(page: Page, state: string): Promise<string> {
  const workflow = (await allEntries(page, 'workflows')).find((entry) => entry.is_default === true) as { states: { id: string; name: string }[] };
  return workflow.states.find((entry) => entry.name === state)!.id;
}

/**
 * A project with Task and Epic: "Login form" (Nordlicht), "Swap the logo" (another customer), "Check the footer" (no
 * customer), the epic "Relaunch" (Nordlicht, 1/10–15/11) with "Header" (Nordlicht, done) and "Imprint" (no customer).
 */
async function customerProject(page: Page, projectName: string) {
  const { nordlicht, other } = await customer(page);
  const project = await createE2eProject(page, projectName, { types: ['Task', 'Epic'] });
  const login = await createItem(page, { project_id: project.id, title: 'Login form', values: { customer: nordlicht } });
  await createItem(page, { project_id: project.id, title: 'Swap the logo', values: { customer: other } });
  await createItem(page, { project_id: project.id, title: 'Check the footer' });
  const epic = await createItem(page, {
    project_id: project.id,
    type_id: await typeId(page, 'Epic'),
    title: 'Relaunch',
    start_date: '2026-10-01',
    due_date: '2026-11-15',
    values: { customer: nordlicht },
  });
  await createItem(page, { project_id: project.id, title: 'Header', parent_id: epic.id, state_id: await stateId(page, 'Done'), values: { customer: nordlicht } });
  await createItem(page, { project_id: project.id, title: 'Imprint', parent_id: epic.id });
  return { ...project, login, epic };
}

/** The view of a project's Nordlicht items, as a list grouped by status. */
const nordlichtView = (projectId: string, nordlicht: string, what: string) => ({
  name: what,
  filter: {
    version: 1 as const,
    conditions: [
      { field: 'project', op: 'is', value: projectId },
      { field: 'property:customer', op: 'is', value: nordlicht },
    ],
  },
});

/** The keys `GET /api/v1/work-items?view=<id>` answers (one page holds them) over `page.request`, sorted. */
async function keysOverRest(page: Page, viewId: string): Promise<{ keys: string[]; keyOf: Map<string, string> }> {
  const response = await api(page, 'GET', `/api/v1/work-items?view=${viewId}`);
  expect(response.status(), await response.text()).toBe(200);
  const { data, meta } = (await response.json()) as { data: { id: string; key: string }[]; meta: { total: number } };
  expect(meta.total).toBe(data.length);
  return { keys: data.map((item) => item.key).sort(), keyOf: new Map(data.map((item) => [item.id, item.key])) };
}

/** The keys a layout shows, read from the ids its items carry once `count` of them stand there, sorted. */
async function shownKeys(page: Page, selector: string, attribute: string, count: number, keyOf: Map<string, string>): Promise<string[]> {
  const shown = page.locator(selector);
  await expect(shown).toHaveCount(count);
  const ids = await shown.evaluateAll((elements, name) => elements.map((element) => element.getAttribute(name)!), attribute);
  return ids.map((id) => keyOf.get(id) ?? `not over REST: ${id}`).sort();
}

const layoutButton = (page: Page, layout: 'list' | 'board' | 'table' | 'timeline') =>
  page
    .getByRole('group', { name: tr('en', 'items.screen.layout') })
    .filter({ visible: true })
    .getByRole('button', { name: new RegExp(tr('en', `items.layout.${layout}`)) });

/** A day as the app writes it in English (01/10/2026), and the range of a bar on the timeline. */
const shown = (day: string) => new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${day}T00:00:00Z`));
const range = (start: string, due: string) => tr('en', 'items.timeline.range', { start: shown(start), due: shown(due) });

// one project for the tests that only read it: every item created is an event the queue worker handles one at a time
let shared: Awaited<ReturnType<typeof customerProject>> & { name: string };

test.beforeAll(async ({ browser }, workerInfo) => {
  const page = await browser.newPage();
  await page.goto('/my-items');
  const projectName = name('shared', workerInfo.workerIndex);
  shared = { ...(await customerProject(page, projectName)), name: projectName };
  await page.close();
});

test.afterAll(async ({ browser }) => {
  const page = await browser.newPage();
  await page.goto('/my-items');
  await removeE2eProject(page, shared.identifier);
  await page.close();
});

test('shows the items of a view on a property as list, board and table as REST does, and its epics with progress on the timeline', async ({ page }) => {
  const { nordlicht } = await customer(page);
  const view = await createE2eView(page, nordlichtView(shared.id, nordlicht, 'nordlicht'));
  try {
    const { keys, keyOf } = await keysOverRest(page, view.id);
    // Login form, Relaunch and its done child Header; not the other customer, not the items without one
    expect(keys).toEqual([`${shared.identifier}-1`, `${shared.identifier}-4`, `${shared.identifier}-5`]);

    // 1: the list of the view
    await page.goto(`/views/${view.id}`);
    await expect(page.getByRole('heading', { level: 1, name: viewName('nordlicht') })).toBeVisible();
    await expect(layoutButton(page, 'list')).toHaveAttribute('aria-pressed', 'true');
    expect(await shownKeys(page, '[data-row-id]', 'data-row-id', keys.length, keyOf)).toEqual(keys);

    // 2: the board
    await page.keyboard.press('2');
    await expect(layoutButton(page, 'board')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('article', { name: new RegExp(`^${shared.login.key} `) })).toBeVisible();
    expect(await shownKeys(page, '[data-card-id]', 'data-card-id', keys.length, keyOf)).toEqual(keys);

    // 3: the table, one cell of the key per row
    await page.keyboard.press('3');
    await expect(page.getByRole('grid', { name: tr('en', 'items.table.label') })).toBeVisible();
    expect(await shownKeys(page, '[data-item-id][data-column="0"]', 'data-item-id', keys.length, keyOf)).toEqual(keys);

    // 4: the timeline has the epic of the view, with the progress of its children (one of two done)
    await page.keyboard.press('4');
    const rows = page.getByRole('region', { name: shared.name, exact: true }).getByRole('group');
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toHaveAccessibleName(
      `${shared.epic.key} Relaunch, ${range('2026-10-01', '2026-11-15')}, ${tr('en', 'items.timeline.progress', { done: 1, total: 2 })}`,
    );
    await expect(rows.first().locator('[data-progress]')).toHaveAttribute('style', /width: 50%/);
  } finally {
    await removeE2eView(page, view.id);
  }
});

test('filters with f, saves as a view, stars it and opens it from the sidebar', async ({ page }) => {
  const { label } = await customer(page);
  await page.goto(`/projects/${shared.identifier}`);
  await expect(page.getByRole('group', { name: new RegExp(`^${shared.identifier}-3 Check the footer`) })).toBeVisible();

  // f, the property, its value
  await page.keyboard.press('f');
  await expect(page.getByRole('combobox', { name: tr('en', 'items.filter.add.search') })).toBeFocused();
  await page.keyboard.type(label);
  await page.keyboard.press('Enter');
  await expect(page.getByRole('combobox', { name: tr('en', 'items.filter.value.search', { field: label }) })).toBeFocused();
  await page.keyboard.type('Nordlicht');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('group', { name: `Filter: ${label} is Studio Nordlicht` })).toBeVisible();
  await expect(page.getByRole('group', { name: new RegExp(`^${shared.identifier}-3 `) })).toHaveCount(0);
  await expect(page.getByRole('group', { name: new RegExp(`^${shared.login.key} Login form`) })).toBeVisible();

  // save as a view of its own
  await tabTo(page, page.getByRole('button', { name: tr('en', 'items.save.save_as'), exact: true }));
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: tr('en', 'items.save.dialog.title') });
  const field = dialog.getByRole('textbox', { name: tr('en', 'views.fields.name') });
  await expect(field).toBeFocused();
  await field.selectText();
  await page.keyboard.type(viewName('saved'));
  await pressMod(page, 'Enter');
  await expect(page).toHaveURL(/\/views\/[0-9a-z]{26}$/);
  const id = new URL(page.url()).pathname.split('/').at(-1)!;
  try {
    await expect(page.getByRole('heading', { level: 1, name: viewName('saved') })).toBeVisible();
    const { keys } = await keysOverRest(page, id);
    expect(keys).toEqual([`${shared.identifier}-1`, `${shared.identifier}-4`, `${shared.identifier}-5`]);

    // the star of the header puts it into the sidebar
    await tabTo(page, page.getByRole('button', { name: tr('en', 'ui.favorite_star.add', { name: viewName('saved') }), exact: true }), { max: 80 });
    await page.keyboard.press('Enter');
    await expect(page.getByRole('button', { name: tr('en', 'ui.favorite_star.remove', { name: viewName('saved') }), exact: true })).toBeFocused();

    // from elsewhere, the sidebar leads back to it
    await page.goto('/my-items');
    const navigation = await openNavigation(page, 'en');
    const link = navigation.getByRole('link', { name: viewName('saved'), exact: true });
    await expect(link).toHaveAttribute('href', `/views/${id}`);
    await tabTo(page, link, { max: 250 });
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(new RegExp(`/views/${id}$`));
    await expect(page.getByRole('heading', { level: 1, name: viewName('saved') })).toBeVisible();
    await expect(page.getByRole('group', { name: new RegExp(`^${shared.login.key} Login form`) })).toBeVisible();
    await expect(page.getByRole('group', { name: new RegExp(`^${shared.identifier}-3 `) })).toHaveCount(0);
  } finally {
    await removeE2eView(page, id);
  }
});

test('moves a card on the board and an epic on the timeline only with the keyboard', async ({ page }) => {
  await page.goto('/my-items');
  const { nordlicht } = await customer(page);
  const projectName = name('move', test.info().workerIndex);
  const project = await customerProject(page, projectName);
  const view = await createE2eView(page, nordlichtView(project.id, nordlicht, 'move'));
  try {
    await page.goto(`/views/${view.id}`);
    await expect(page.locator(`[data-row-id="${project.login.id}"]`)).toBeVisible();

    // the board: from Backlog one column to the right, the card keeps the focus
    await page.keyboard.press('2');
    const column = (state: string) => page.getByRole('region', { name: state, exact: true });
    const card = (state: string) => column(state).getByRole('article', { name: new RegExp(`^${project.login.key} `) });
    await expect(card('Backlog')).toBeVisible();
    await tabTo(page, card('Backlog'), { max: 80 });
    await page.keyboard.press('Shift+ArrowRight');
    await expect(card('Todo')).toBeFocused();
    await expect(card('Backlog')).toHaveCount(0);
    await expect(page.getByRole('status', { name: tr('en', 'items.board.announcements') })).toHaveText(
      tr('en', 'items.board.moved.state', { key: project.login.key, state: 'Todo' }),
    );

    // the timeline: the epic a week later
    await page.keyboard.press('4');
    const epic = page.getByRole('region', { name: projectName, exact: true }).getByRole('group', { name: new RegExp(`^${project.epic.key} `) });
    await expect(epic).toBeVisible();
    await tabTo(page, epic, { max: 80 });
    await page.keyboard.press('Shift+ArrowRight');
    await expect(page.getByRole('status', { name: tr('en', 'items.timeline.announcements') })).toHaveText(
      tr('en', 'items.timeline.saved', { key: project.epic.key, range: range('2026-10-08', '2026-11-22') }),
    );
    await expect(epic).toBeFocused();

    // the server has both
    const item = async (key: string) => ((await (await api(page, 'GET', `/api/v1/work-items/${key}`)).json()) as { data: Record<string, unknown> }).data;
    expect((await item(project.login.key)).state_id).toBe(await stateId(page, 'Todo'));
    expect(await item(project.epic.key)).toMatchObject({ start_date: '2026-10-08', due_date: '2026-11-22' });
  } finally {
    await removeE2eView(page, view.id);
    await removeE2eProject(page, project.identifier);
  }
});
