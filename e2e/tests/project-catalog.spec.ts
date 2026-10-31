import type { Page } from '@playwright/test';
import { expect, test } from '../fixtures';
import { allEntries, api, arrowTo, openNavigation, pressMod, removeCatalogEntries, runId, tabTo, tr, variant } from '../helpers';

// Signed in as the e2e person (Erik Ende, org admin), in English, with the keyboard only: the workflow and the types of
// a project, in the dialog "New project" and in the project settings. Projects and workflows of a test are called
// `E2E …` and go again over the API in `finally`; the e2e seeder removes what a broken run left. No default changes
// (P18): the seeded "Agentur-Freigabe" and "Kundenwunsch" are only picked, never saved.

/** A short code per Playwright project, so identifiers stay within ten characters. */
const CODE: Record<string, string> = { 'desktop-light': 'A', 'desktop-dark': 'B', 'phone-light': 'C', 'phone-dark': 'D' };

/** `<letter><run><variant>`: an identifier no other test and no other run uses. */
const identifierFor = (letter: string) => `${letter}${runId()}${CODE[variant()]}`;

const prefix = () => `E2E ${variant()} ${runId()}`;

type Project = { id: string; identifier: string; workflow_id: string; enabled_type_ids: string[]; default_type_id: string };

async function readProject(page: Page, identifier: string): Promise<Project> {
  const response = await api(page, 'GET', `/api/v1/projects/${identifier}`);
  expect(response.status(), await response.text()).toBe(200);
  return ((await response.json()) as { data: Project }).data;
}

/** A project of this run over the API, as the signed-in person. */
async function createProject(page: Page, letter: string, body: Record<string, unknown> = {}): Promise<Project> {
  await page.goto('/my-items');
  const response = await api(page, 'POST', '/api/v1/projects', { name: `${prefix()} ${letter}`, identifier: identifierFor(letter), visibility: 'public', ...body });
  expect(response.status(), await response.text()).toBe(201);
  return ((await response.json()) as { data: Project }).data;
}

/** The ids of the catalog entries by name. */
async function idsByName(page: Page, path: string): Promise<Record<string, string>> {
  return Object.fromEntries((await allEntries(page, path)).map((entry) => [String(entry.name), String(entry.id)]));
}

async function removeProject(page: Page, identifier: string): Promise<void> {
  const project = await api(page, 'GET', `/api/v1/projects/${identifier}`);
  if (project.status() !== 200) return;
  const removed = await api(page, 'DELETE', `/api/v1/projects/${identifier}`);
  expect(removed.status(), await removed.text()).toBe(202);
}

test('creates a project with the agency workflow and the types it picks', async ({ page }) => {
  const identifier = identifierFor('C');
  await page.goto('/my-items');
  try {
    const navigation = await openNavigation(page, 'en');
    await tabTo(page, navigation.getByRole('link', { name: tr('en', 'shell.nav.create_project') }));
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog', { name: tr('en', 'projects.create.title') });
    const workflow = dialog.getByRole('combobox', { name: new RegExp(`^${tr('en', 'projects.create.workflow')}`) });
    // the form waits for the workflows and types; the default workflow is preselected, the name has the focus
    await expect(workflow).toHaveText('Standard');
    await expect(dialog.getByRole('textbox', { name: tr('en', 'projects.create.name') })).toBeFocused();
    await page.keyboard.type(`${prefix()} C`);
    await page.keyboard.press('Tab');
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.type(identifier);

    await tabTo(page, workflow);
    await page.keyboard.press('Enter');
    await arrowTo(page, page.getByRole('option', { name: 'Agentur-Freigabe', exact: true }));
    await page.keyboard.press('Enter');
    await expect(workflow).toHaveText('Agentur-Freigabe');

    // every active type is ticked: the customer wish goes, Task stays on top as the default type
    const wish = dialog.getByRole('checkbox', { name: 'Kundenwunsch', exact: true });
    await expect(wish).toHaveAttribute('aria-checked', 'true');
    await tabTo(page, wish);
    await page.keyboard.press('Space');
    await expect(wish).toHaveAttribute('aria-checked', 'false');
    await expect(dialog.getByText(tr('en', 'projects.create.default_type', { name: 'Task' }))).toBeVisible();
    await pressMod(page, 'Enter');

    await expect(page.getByText(tr('en', 'projects.created', { identifier }))).toBeVisible();
    await expect(dialog).toBeHidden();
    const workflows = await idsByName(page, 'workflows');
    const types = await idsByName(page, 'work-item-types');
    const created = await readProject(page, identifier);
    expect(created.workflow_id).toBe(workflows['Agentur-Freigabe']);
    // never the whole list: earlier variants of this run may have left active `E2E` types the dialog ticked as well
    expect(created.enabled_type_ids).toEqual(expect.arrayContaining([types.Task, types.Bug, types.Epic]));
    expect(created.enabled_type_ids).not.toContain(types.Kundenwunsch);
    expect(created.default_type_id).toBe(types.Task);
  } finally {
    await removeProject(page, identifier);
  }
});

test('assigns a workflow with restricted transitions to a project', async ({ page }) => {
  const name = `${prefix()} Matrix`;
  const project = await createProject(page, 'W');
  const cell = (from: string, to: string) => page.getByRole('checkbox', { name: tr('en', 'settings.workflows.matrix.cell', { from, to }), exact: true });
  try {
    // the workflow: a matrix with one transition less than all of them
    await page.goto('/settings/workflows?workflow=new');
    await tabTo(page, page.getByRole('textbox', { name: tr('en', 'settings.catalog.name'), exact: true }), { max: 100 });
    await page.keyboard.type(name);
    const free = page.getByRole('switch', { name: tr('en', 'settings.workflows.editor.free') });
    await tabTo(page, free);
    await page.keyboard.press('Space');
    await expect(free).toHaveAttribute('aria-checked', 'false');
    await tabTo(page, cell('Backlog', 'Backlog'), { max: 100 });
    await page.keyboard.press('End');
    await expect(cell('Backlog', 'Cancelled')).toBeFocused();
    await page.keyboard.press('Space');
    await expect(cell('Backlog', 'Cancelled')).toHaveAttribute('aria-checked', 'false');
    await pressMod(page, 'Enter');
    await expect(page.getByText(tr('en', 'settings.workflows.editor.saved', { name }))).toBeVisible();
    const stored = (await allEntries(page, 'workflows')).find((workflow) => workflow.name === name)!;
    const states = (stored.states as unknown[]).length;
    expect(stored.transitions).toHaveLength(states * (states - 1) - 1);

    // the project takes it
    await page.goto(`/projects/${project.identifier}/settings/workflow`);
    await expect(page.getByRole('heading', { level: 3, name: 'Standard', exact: true })).toBeVisible();
    const choice = page.getByRole('combobox', { name: new RegExp(`^${tr('en', 'settings.project.workflow.new_workflow')}`) });
    await tabTo(page, choice, { max: 100 });
    await page.keyboard.press('Enter');
    await arrowTo(page, page.getByRole('option', { name, exact: true }), 'ArrowDown', 40);
    await page.keyboard.press('Enter');
    await expect(choice).toHaveText(name);
    await tabTo(page, page.getByRole('button', { name: tr('en', 'settings.project.workflow.switch_open') }));
    await page.keyboard.press('Enter');

    const dialog = page.getByRole('dialog', { name: tr('en', 'settings.project.workflow.confirm_title', { name }) });
    await expect(dialog).toContainText(tr('en', 'settings.project.workflow.confirm_text', { identifier: project.identifier, from: 'Standard', state: 'Backlog' }));
    await pressMod(page, 'Enter');
    await expect(page.getByText(tr('en', 'settings.project.workflow.switched'), { exact: true })).toBeVisible();
    await expect(dialog).toBeHidden();
    const heading = page.getByRole('heading', { level: 3, name, exact: true });
    await expect(heading).toBeFocused();
    await expect(page.getByText(`${tr('en', 'settings.project.workflow.transitions_matrix.other', { count: states * (states - 1) - 1 })} `, { exact: false })).toBeVisible();
    expect((await readProject(page, project.identifier)).workflow_id).toBe(stored.id);
  } finally {
    // the workflow can only go once no project uses it, the project in deletion included
    const standard = (await allEntries(page, 'workflows')).find((workflow) => workflow.is_default === true)!;
    const back = await api(page, 'PUT', `/api/v1/projects/${project.identifier}/workflow`, { workflow_id: standard.id, mapping: {} });
    expect(back.status(), await back.text()).toBe(200);
    await removeProject(page, project.identifier);
    await removeCatalogEntries(page, 'workflows', 'name', prefix());
  }
});

test('switches a type on and makes it the default', async ({ page }) => {
  await page.goto('/my-items');
  const types = await idsByName(page, 'work-item-types');
  const project = await createProject(page, 'T', { enabled_type_ids: [types.Task], default_type_id: types.Task });
  const use = (type: string) => page.getByRole('checkbox', { name: tr('en', 'settings.project.types.use', { name: type }), exact: true });
  const asDefault = (type: string) => page.getByRole('radio', { name: tr('en', 'settings.project.types.as_default', { name: type }), exact: true });
  try {
    await page.goto(`/projects/${project.identifier}/settings/types`);
    await expect(use('Task')).toHaveAttribute('aria-checked', 'true');
    // the only type that is on stays on
    await expect(page.getByText(tr('en', 'settings.project.types.last'))).toBeVisible();

    await tabTo(page, use('Bug'), { max: 100 });
    await page.keyboard.press('Space');
    await expect(use('Bug')).toHaveAttribute('aria-checked', 'true');
    // Tab reaches the chosen default; the arrow moves the choice to the next type that is on
    await tabTo(page, asDefault('Task'), { backwards: true });
    await arrowTo(page, asDefault('Bug'));
    await expect(asDefault('Bug')).toBeChecked();
    await pressMod(page, 'Enter');

    await expect(page.getByText(tr('en', 'settings.project.types.saved'), { exact: true })).toBeVisible();
    const saved = await readProject(page, project.identifier);
    expect(saved.enabled_type_ids).toEqual([types.Task, types.Bug]);
    expect(saved.default_type_id).toBe(types.Bug);
  } finally {
    await removeProject(page, project.identifier);
  }
});
