import type { Page } from '@playwright/test';
import { expect, test } from '../fixtures';
import { allEntries, api, artisan, artisanEval, createE2eProject, createItem, removeE2eProject, runId, tabTo, tr, variant } from '../helpers';

// The automations of a project (spec 4.13), signed in as the e2e person (org admin, English). Every test works in a
// project of its own (`E2E …`, removed in `finally`); its items come over the API. The nightly run is started by hand
// for that one project (`app:run-automations --now --project=<ULID>`, K9): the DDEV scheduler shares the database.

const projectName = (what: string) => `E2E ${what} ${variant()} ${runId()}`;

/** The id of the state named `name` in the default workflow. */
async function stateOf(page: Page, name: string): Promise<string> {
  const workflow = (await allEntries(page, 'workflows')).find((entry) => entry.is_default === true) as { states: { id: string; name: string }[] };
  return workflow.states.find((state) => state.name === name)!.id;
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
    const old = await createItem(page, { project_id: project.id, title: 'E2E Alte Rechnung', state_id: await stateOf(page, 'Done') });
    const recent = await createItem(page, { project_id: project.id, title: 'E2E Neue Rechnung', state_id: await stateOf(page, 'Done') });
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
