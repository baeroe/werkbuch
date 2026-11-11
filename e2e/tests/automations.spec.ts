import type { Page } from '@playwright/test';
import { expect, test } from '../fixtures';
import { allEntries, api, artisan, artisanEval, createE2eProject, createItem, pressMod, removeE2eProject, runId, tabTo, tr, variant } from '../helpers';

// The automations of a project (spec 4.13), signed in as the e2e person (org admin, English). Every test works in a
// project of its own (`E2E …`, removed in `finally`); its items come over the API. The nightly run is started by hand
// for that one project (`app:run-automations --now --project=<ULID>`, K9): the DDEV scheduler shares the database.

const projectName = (what: string) => `E2E ${what} ${variant()} ${runId()}`;

// tinker and artisan go through ddev synchronously (about two seconds each, more under load), besides the API calls:
// more than the default 30 s may pass (T19-I1)
test.describe.configure({ timeout: 90_000 });

/** The states of the default workflow, read once per page (a test reads them again and again). */
const defaultStates = new WeakMap<Page, Promise<{ id: string; name: string }[]>>();

/** The id of the state named `name` in the default workflow. */
async function stateOf(page: Page, name: string): Promise<string> {
  if (!defaultStates.has(page)) {
    defaultStates.set(
      page,
      allEntries(page, 'workflows').then((entries) => (entries.find((entry) => entry.is_default === true) as { states: { id: string; name: string }[] }).states),
    );
  }
  return (await defaultStates.get(page)!).find((state) => state.name === name)!.id;
}

async function typeOf(page: Page, name: string): Promise<string> {
  return ((await allEntries(page, 'work-item-types')).find((entry) => entry.name === name) as { id: string }).id;
}

async function itemOf(page: Page, key: string): Promise<{ state_id: string; assignee_id: string | null; created_by: string; archived_at: string | null }> {
  const response = await api(page, 'GET', `/api/v1/work-items/${key}`);
  expect(response.status(), await response.text()).toBe(200);
  return ((await response.json()) as { data: { state_id: string; assignee_id: string | null; created_by: string; archived_at: string | null } }).data;
}

async function move(page: Page, id: string, state: string): Promise<void> {
  const moved = await api(page, 'POST', `/api/v1/work-items/${id}/transition`, { to_state_id: await stateOf(page, state) });
  expect(moved.status(), await moved.text()).toBe(200);
}

async function switchOn(page: Page, project: string, key: string, settings: Record<string, unknown> = {}): Promise<void> {
  const saved = await api(page, 'PUT', `/api/v1/projects/${project}/automations/${key}`, { enabled: true, settings });
  expect(saved.status(), await saved.text()).toBe(200);
}

/** The activity of an item on its page names the automation that acted. */
async function expectReason(page: Page, key: string, reason: string): Promise<void> {
  await page.goto(`/items/${key}`);
  const timeline = page.getByRole('region', { name: tr('en', 'items.activity.title') }).getByRole('list', { name: tr('en', 'items.activity.list') });
  await expect(timeline).toContainText(tr('en', `items.activity.reason.${reason}`));
}

/** Removes the project from a page outside it: the item page would load its item again and report the 404. */
async function cleanUp(page: Page, identifier: string) {
  await page.goto('/my-items');
  await removeE2eProject(page, identifier);
}

test('switches Assignee beim Start on with the keyboard; a person who starts an item becomes its assignee', async ({ page }) => {
  const project = await createE2eProject(page, projectName('assign on start'), { types: ['Task'] });
  try {
    await page.goto(`/projects/${project.identifier}/settings/automations`);
    const title = tr('en', 'automations.assign_on_start.title');
    const toggle = page.getByRole('switch', { name: title, exact: true });
    await expect(toggle).toHaveAttribute('aria-checked', 'false');
    await tabTo(page, toggle, { max: 80 });
    const puts: string[] = [];
    page.on('request', (request) => {
      if (request.method() === 'PUT' && request.url().endsWith(`/automations/assign_on_start`)) puts.push(request.url());
    });
    await page.keyboard.press('Space');
    await expect(toggle).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByText(tr('en', 'automations.saved.on', { name: title }), { exact: true })).toBeVisible();
    // once: the toast is the answer of the one call
    await expect
      .poll(async () => {
        const response = await api(page, 'GET', `/api/v1/projects/${project.id}/automations`);
        return ((await response.json()) as { data: { key: string; enabled: boolean }[] }).data.find((entry) => entry.key === 'assign_on_start')?.enabled;
      })
      .toBe(true);
    expect(puts).toHaveLength(1);

    const item = await createItem(page, { project_id: project.id, title: 'E2E Startseite bauen' });
    expect((await itemOf(page, item.key)).assignee_id).toBeNull();
    await move(page, item.id, 'In Progress');

    const started = await itemOf(page, item.key);
    expect(started.assignee_id).toBe(started.created_by);
    await expectReason(page, item.key, 'assign_on_start');
  } finally {
    await cleanUp(page, project.identifier);
  }
});

test('relates an item it references, keyboard only', async ({ page }) => {
  // the relation waits on the queue (up to 90 s, as the acceptance specs do, K18): a full run backs it up
  test.setTimeout(150_000);
  // "Erwähnte Items verknüpfen" is on in a new project (A452): a # in a comment relates both items after the commit
  const project = await createE2eProject(page, projectName('link references'), { types: ['Task'] });
  try {
    const target = await createItem(page, { project_id: project.id, title: 'E2E Impressum prüfen' });
    const item = await createItem(page, { project_id: project.id, title: 'E2E Datenschutz prüfen' });
    await page.goto(`/items/${item.key}`);
    await expect(page.getByRole('heading', { level: 1, name: 'E2E Datenschutz prüfen' })).toBeVisible();
    const relations = page.getByRole('region', { name: tr('en', 'items.detail.relations.title') });
    await expect(relations.getByText(tr('en', 'items.detail.relations.empty'))).toBeVisible();

    await page.keyboard.press('m');
    const editor = page.getByRole('textbox', { name: tr('en', 'editor.label.comment') });
    await expect(editor).toBeFocused();
    // the key finds the item at once (no index needed)
    await page.keyboard.type(`Hängt an #${target.key}`);
    await expect(page.getByRole('option', { name: new RegExp(target.key) })).toBeVisible();
    await page.keyboard.press('Enter');
    await expect(editor.locator('.rt-ref')).toContainText(target.key);
    await pressMod(page, 'Enter');
    await expect(page.getByRole('status').filter({ hasText: tr('en', 'items.comments.sent') })).toBeVisible();

    // the relation comes from the queue, live on the page, and stands on both ends
    await expect(relations.getByText(target.key)).toBeVisible({ timeout: 90_000 });
    const relationsOf = async (key: string) => ((await (await api(page, 'GET', `/api/v1/work-items/${key}/relations`)).json()) as { data: unknown[] }).data.length;
    expect(await relationsOf(item.key)).toBe(1);
    expect(await relationsOf(target.key)).toBe(1);
  } finally {
    await page.goto('/my-items');
    await removeE2eProject(page, project.identifier);
  }
});

test('Eltern schließen closes the epic when its last child is done', async ({ page }) => {
  const project = await createE2eProject(page, projectName('close parent'), { types: ['Task', 'Epic'] });
  try {
    await switchOn(page, project.id, 'close_parent');
    const epic = await createItem(page, { project_id: project.id, type_id: await typeOf(page, 'Epic'), title: 'E2E Relaunch' });
    const first = await createItem(page, { project_id: project.id, title: 'E2E Startseite', parent_id: epic.id });
    const second = await createItem(page, { project_id: project.id, title: 'E2E Kontakt', parent_id: epic.id });
    const backlog = await stateOf(page, 'Backlog');

    await move(page, first.id, 'Done');
    expect((await itemOf(page, epic.key)).state_id).toBe(backlog);
    await move(page, second.id, 'Done');
    expect((await itemOf(page, epic.key)).state_id).toBe(await stateOf(page, 'Done'));
    await expectReason(page, epic.key, 'close_parent');
  } finally {
    await cleanUp(page, project.identifier);
  }
});

test('Auto-Archiv archives an item closed long ago', async ({ page }) => {
  const project = await createE2eProject(page, projectName('auto archive'), { types: ['Task'] });
  try {
    await switchOn(page, project.id, 'auto_archive', { days: 30 });
    const done = await stateOf(page, 'Done');
    const old = await createItem(page, { project_id: project.id, title: 'E2E Alte Rechnung', state_id: done });
    const recent = await createItem(page, { project_id: project.id, title: 'E2E Neue Rechnung', state_id: done });
    // the server's clock cannot be set: the item was closed 40 days ago
    expect(artisanEval(`App\\Models\\WorkItem::query()->whereKey('${old.id}')->update(['closed_at' => now()->subDays(40)]); echo 'ok';`)).toBe('ok');

    artisan('app:run-automations', '--now', `--project=${project.id}`);

    expect((await itemOf(page, old.key)).archived_at).not.toBeNull();
    expect((await itemOf(page, recent.key)).archived_at).toBeNull();
    await expectReason(page, old.key, 'auto_archive');
  } finally {
    await cleanUp(page, project.identifier);
  }
});
