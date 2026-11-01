import type { Page } from '@playwright/test';
import { expect, test } from '../fixtures';
import { allEntries, api, arrowTo, createE2eProject, createItem, pressMod, removeCatalogEntries, removeE2eProject, runId, tabTo, tr, variant } from '../helpers';

// Signed in as the e2e person (Erik Ende, org admin), in English, with the keyboard only: the one question for states
// that hold items (R26), when a project switches its workflow and when a workflow loses a state. Projects, items and
// workflows of a test are called `E2E …`; the project goes back to the default workflow and away, the workflows go over
// the API in `finally` (the e2e seeder removes what a broken run left). No default changes (A71).

const prefix = () => `E2E ${variant()} ${runId()}`;

type State = { id: string; name: string; category: string; position: number };
type Workflow = { id: string; name: string; is_default: boolean; states: State[] };

const workflows = async (page: Page) => (await allEntries(page, 'workflows')) as unknown as Workflow[];
const workflowNamed = async (page: Page, name: string) => (await workflows(page)).find((workflow) => workflow.name === name)!;
const stateOf = (workflow: Workflow, name: string) => workflow.states.find((state) => state.name === name)!.id;

/** A free workflow of this run over the API, with the states named, in their order, the first one the start. */
async function createWorkflow(page: Page, name: string, states: [string, string][]): Promise<Workflow> {
  await page.goto('/my-items');
  const created = await api(page, 'POST', '/api/v1/workflows', {
    name,
    description: '',
    is_default: false,
    is_free: true,
    initial_state_id: 's0',
    states: states.map(([state, category], position) => ({ id: `s${position}`, name: state, icon: 'circle', category, position })),
    transitions: [],
  });
  expect(created.status(), await created.text()).toBe(201);
  return ((await created.json()) as { data: Workflow }).data;
}

async function stateIdOf(page: Page, key: string): Promise<string> {
  const response = await api(page, 'GET', `/api/v1/work-items/${key}`);
  expect(response.status(), await response.text()).toBe(200);
  return ((await response.json()) as { data: { state_id: string } }).data.state_id;
}

/**
 * Cleanup: the project goes back to the default workflow (its items to Backlog) so that no project holds the workflows
 * of the test any more, then the project goes, then the workflows. Every step runs.
 */
async function cleanUp(page: Page, identifier: string): Promise<void> {
  try {
    const standard = (await workflows(page)).find((workflow) => workflow.is_default)!;
    const project = await api(page, 'GET', `/api/v1/projects/${identifier}`);
    if (project.status() === 200) {
      const { workflow_id } = ((await project.json()) as { data: { workflow_id: string } }).data;
      const used = (await workflows(page)).find((workflow) => workflow.id === workflow_id)!;
      if (!used.is_default) {
        const mapping = Object.fromEntries(used.states.map((state) => [state.id, stateOf(standard, 'Backlog')]));
        const back = await api(page, 'PUT', `/api/v1/projects/${identifier}/workflow`, { workflow_id: standard.id, mapping });
        expect(back.status(), await back.text()).toBe(200);
      }
    }
  } finally {
    try {
      await removeE2eProject(page, identifier);
    } finally {
      await removeCatalogEntries(page, 'workflows', 'name', prefix());
    }
  }
}

test('switches the workflow of a project and maps its states', async ({ page }) => {
  const target = `${prefix()} Ziel`;
  await createWorkflow(page, target, [
    ['Backlog', 'backlog'],
    ['Ready', 'unstarted'],
    ['Working', 'started'],
    ['Shipped', 'completed'],
    ['Dropped', 'canceled'],
  ]);
  const project = await createE2eProject(page, `${prefix()} Switch`);
  try {
    const standard = (await workflows(page)).find((workflow) => workflow.is_default)!;
    const todo = await createItem(page, { project_id: project.id, title: `${prefix()} waits`, state_id: stateOf(standard, 'Todo') });
    const doing = await createItem(page, { project_id: project.id, title: `${prefix()} runs`, state_id: stateOf(standard, 'In Progress') });

    await page.goto(`/projects/${project.identifier}/settings/workflow`);
    await expect(page.getByText(tr('en', 'settings.project.workflow.switch_description'))).toBeVisible();
    const choice = page.getByRole('combobox', { name: new RegExp(`^${tr('en', 'settings.project.workflow.new_workflow')}`) });
    await tabTo(page, choice, { max: 100 });
    await page.keyboard.press('Enter');
    await arrowTo(page, page.getByRole('option', { name: target, exact: true }), 'ArrowDown', 40);
    await page.keyboard.press('Enter');
    await expect(choice).toHaveText(target);
    const open = page.getByRole('button', { name: tr('en', 'settings.project.workflow.switch_open') });
    // the button waits for the count of the items
    await expect(open).not.toHaveAttribute('aria-disabled', 'true');
    await tabTo(page, open);
    await page.keyboard.press('Enter');

    // a row per state with items, each with its proposal: the first state of its category
    const dialog = page.getByRole('dialog', { name: tr('en', 'settings.project.workflow.confirm_title', { name: target }) });
    await expect(dialog).toContainText(tr('en', 'settings.project.workflow.mapping_text', { identifier: project.identifier, from: standard.name }));
    const rows = dialog.getByRole('list', { name: tr('en', 'settings.state_mapping.rows') }).getByRole('listitem');
    await expect(rows).toHaveCount(2);
    await expect(rows.nth(0)).toContainText(`Todo${tr('en', 'settings.state_mapping.items.one', { count: '1' })}`);
    const todoTarget = dialog.getByRole('combobox', { name: tr('en', 'settings.state_mapping.target', { name: 'Todo' }) });
    const doingTarget = dialog.getByRole('combobox', { name: tr('en', 'settings.state_mapping.target', { name: 'In Progress' }) });
    await expect(todoTarget).toHaveText('Ready');
    await expect(doingTarget).toHaveText('Working');

    // the waiting item goes to work as well; In Progress goes to Shipped, which closes it
    await tabTo(page, todoTarget);
    await page.keyboard.press('Enter');
    await arrowTo(page, page.getByRole('option', { name: 'Working', exact: true }));
    await page.keyboard.press('Enter');
    await expect(todoTarget).toHaveText('Working');
    await tabTo(page, doingTarget);
    await page.keyboard.press('Enter');
    await arrowTo(page, page.getByRole('option', { name: 'Shipped', exact: true }));
    await page.keyboard.press('Enter');
    await expect(doingTarget).toHaveText('Shipped');
    await expect(dialog.getByRole('status')).toContainText(tr('en', 'settings.state_mapping.effect.closed.one', { count: '1' }));
    await pressMod(page, 'Enter');

    await expect(page.getByText(tr('en', 'settings.project.workflow.switched'), { exact: true })).toBeVisible();
    await expect(dialog).toBeHidden();
    await expect(page.getByRole('heading', { level: 3, name: target, exact: true })).toBeFocused();

    // the items carry the new states, and their history names the switch
    const switched = await workflowNamed(page, target);
    expect(await stateIdOf(page, todo.key)).toBe(stateOf(switched, 'Working'));
    expect(await stateIdOf(page, doing.key)).toBe(stateOf(switched, 'Shipped'));
    const history = await api(page, 'GET', `/api/v1/work-items/${todo.key}/history`);
    expect(history.status(), await history.text()).toBe(200);
    const entries = ((await history.json()) as { data: { type: string; reason: string | null; states: { old: { name: string }; new: { name: string } } | null }[] }).data;
    expect(entries.at(-1)).toMatchObject({ type: 'work_item.state_changed', reason: 'workflow_changed', states: { old: { name: 'Todo' }, new: { name: 'Working' } } });
  } finally {
    await cleanUp(page, project.identifier);
  }
});

test('asks for a new state when a used one is removed', async ({ page }) => {
  const name = `${prefix()} Abbau`;
  const workflow = await createWorkflow(page, name, [
    ['Open', 'unstarted'],
    ['Check', 'started'],
    ['Doing', 'started'],
    ['Done', 'completed'],
  ]);
  const project = await createE2eProject(page, `${prefix()} Remove`, { workflow: name });
  try {
    const item = await createItem(page, { project_id: project.id, title: `${prefix()} checked`, state_id: stateOf(workflow, 'Check') });

    await page.goto(`/settings/workflows?workflow=${workflow.id}`);
    await tabTo(page, page.getByRole('button', { name: tr('en', 'settings.workflows.state.remove', { name: 'Check' }), exact: true }), { max: 150 });
    await page.keyboard.press('Enter');
    await expect(page.getByRole('button', { name: tr('en', 'settings.workflows.state.remove', { name: 'Check' }), exact: true })).toHaveCount(0);
    await pressMod(page, 'Enter');

    // the save waits for the question: Check still holds an item
    const dialog = page.getByRole('dialog', { name: tr('en', 'settings.workflows.mapping.title') });
    await expect(dialog).toContainText(tr('en', 'settings.workflows.mapping.one_state.one', { name, count: '1' }));
    const checkTarget = dialog.getByRole('combobox', { name: tr('en', 'settings.state_mapping.target', { name: 'Check' }) });
    await expect(checkTarget).toHaveText('Doing');
    await tabTo(page, checkTarget);
    await page.keyboard.press('Enter');
    await arrowTo(page, page.getByRole('option', { name: 'Open', exact: true }), 'ArrowUp');
    await page.keyboard.press('Enter');
    await expect(checkTarget).toHaveText('Open');
    await pressMod(page, 'Enter');

    await expect(page.getByText(tr('en', 'settings.workflows.editor.saved', { name }), { exact: true })).toBeVisible();
    await expect(page.getByText(tr('en', 'settings.workflows.editor.moved.one', { count: '1' }), { exact: true })).toBeVisible();
    await expect(dialog).toBeHidden();
    const saved = await workflowNamed(page, name);
    expect(saved.states.map((state) => state.name)).toEqual(['Open', 'Doing', 'Done']);
    expect(await stateIdOf(page, item.key)).toBe(stateOf(saved, 'Open'));
  } finally {
    await cleanUp(page, project.identifier);
  }
});
