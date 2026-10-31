import type { Page } from '@playwright/test';
import { expect, test } from '../fixtures';
import { allEntries, api, arrowTo, PEOPLE, pressMod, removeCatalogEntries, runId, signedInContext, tabTo, tr, variant } from '../helpers';

// Signed in as the e2e person (Erik Ende, org admin), in English, with the keyboard only. Every workflow a test creates
// is called `E2E <variant> <runId> …` and goes again over the API in `finally`; the e2e seeder removes what a broken run
// left. The seeded "Agentur-Freigabe" is only read, never saved, and no default changes (P18): the variants share one
// database.

/** The name every workflow of this test starts with. */
const prefix = () => `E2E ${variant()} ${runId()}`;

const cleanUp = (page: Page) => removeCatalogEntries(page, 'workflows', 'name', prefix());

const card = (page: Page, name: string) => page.getByRole('article', { name, exact: true });
const cell = (page: Page, from: string, to: string) => page.getByRole('checkbox', { name: tr('en', 'settings.workflows.matrix.cell', { from, to }), exact: true });
const issues = (page: Page) => page.locator('#workflow-issues');
const leaveQuestion = (page: Page) => page.getByRole('alertdialog', { name: tr('en', 'settings.frame.leave_title') });

async function openList(page: Page): Promise<void> {
  await page.goto('/settings/workflows');
  await expect(page.getByRole('heading', { level: 2, name: tr('en', 'settings.org.section.workflows') })).toBeVisible();
}

/** A workflow of this run over the API: free, three statuses. */
async function createWorkflow(page: Page, name: string): Promise<void> {
  const created = await api(page, 'POST', '/api/v1/workflows', {
    name,
    description: '',
    is_default: false,
    is_free: true,
    initial_state_id: 'a',
    states: [
      { id: 'a', name: 'Open', icon: 'circle', category: 'unstarted', position: 0 },
      { id: 'b', name: 'Doing', icon: 'half', category: 'started', position: 1 },
      { id: 'c', name: 'Done', icon: 'check', category: 'completed', position: 2 },
    ],
    transitions: [],
  });
  expect(created.status(), await created.text()).toBe(201);
}

test('refuses Agentur-Freigabe without the transition into Review (flow 7)', async ({ page }) => {
  const puts: string[] = [];
  page.on('request', (request) => {
    if (request.method() === 'PUT' && request.url().includes('/api/v1/workflows/')) puts.push(request.url());
  });
  await openList(page);

  await tabTo(page, page.getByRole('link', { name: `${tr('en', 'settings.workflows.edit')} Agentur-Freigabe`, exact: true }), { max: 100 });
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/settings\/workflows\?workflow=[0-9a-z]{26}$/);
  const grid = page.getByRole('grid', { name: tr('en', 'settings.workflows.matrix.label') });
  await expect(grid).toBeVisible();
  await expect(issues(page)).toContainText(tr('en', 'settings.workflows.issues.none'));

  // the grid is one tab stop; the arrows walk to In Progress → Review, Space takes the transition away
  await tabTo(page, cell(page, 'Backlog', 'Backlog'), { max: 100 });
  await arrowTo(page, cell(page, 'In Progress', 'Backlog'), 'ArrowDown');
  await arrowTo(page, cell(page, 'In Progress', 'Review'), 'ArrowRight');
  await expect(cell(page, 'In Progress', 'Review')).toHaveAttribute('aria-checked', 'true');
  await page.keyboard.press('Space');
  await expect(cell(page, 'In Progress', 'Review')).toHaveAttribute('aria-checked', 'false');

  for (const name of ['Review', 'Kundenfreigabe', 'Done']) {
    await expect(issues(page)).toContainText(tr('en', 'settings.workflows.issue.unreachable', { name }));
  }
  // ⌘↵ sends nothing and takes the focus to the findings
  await pressMod(page, 'Enter');
  await expect(issues(page)).toBeFocused();
  await expect(issues(page)).toHaveAttribute('role', 'alert');
  expect(puts).toEqual([]);
  const agency = (await allEntries(page, 'workflows')).find((workflow) => workflow.name === 'Agentur-Freigabe')!;
  expect(agency.transitions).toHaveLength(14);

  // leaving asks first, and "Discard" goes on to the list
  await tabTo(page, page.getByRole('link', { name: tr('en', 'settings.workflows.editor.back'), exact: true }), { backwards: true, max: 100 });
  await page.keyboard.press('Enter');
  await expect(leaveQuestion(page)).toContainText(tr('en', 'settings.frame.leave_description', { what: tr('en', 'settings.workflows.editor.leave_what') }));
  await tabTo(page, leaveQuestion(page).getByRole('button', { name: tr('en', 'settings.frame.leave_confirm') }));
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/settings\/workflows$/);
  await expect(card(page, 'Agentur-Freigabe')).toBeVisible();
  expect(puts).toEqual([]);
});

test('creates a workflow with a transition matrix', async ({ page }) => {
  const name = `${prefix()} Flow`;
  await openList(page);

  try {
    await tabTo(page, page.getByRole('link', { name: tr('en', 'settings.workflows.create'), exact: true }), { max: 100 });
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/settings\/workflows\?workflow=new$/);
    await tabTo(page, page.getByRole('textbox', { name: tr('en', 'settings.catalog.name'), exact: true }), { max: 100 });
    await page.keyboard.type(name);

    // off with the free transitions: the matrix starts with every one allowed
    const free = page.getByRole('switch', { name: tr('en', 'settings.workflows.editor.free') });
    await tabTo(page, free);
    await page.keyboard.press('Space');
    await expect(free).toHaveAttribute('aria-checked', 'false');
    await tabTo(page, cell(page, 'Backlog', 'Backlog'), { max: 100 });
    // Backlog may no longer move straight to Done or Cancelled
    await page.keyboard.press('End');
    await expect(cell(page, 'Backlog', 'Cancelled')).toBeFocused();
    await page.keyboard.press('Space');
    await arrowTo(page, cell(page, 'Backlog', 'Done'), 'ArrowLeft');
    await page.keyboard.press('Space');
    await expect(cell(page, 'Backlog', 'Done')).toHaveAttribute('aria-checked', 'false');
    await expect(cell(page, 'Backlog', 'Cancelled')).toHaveAttribute('aria-checked', 'false');
    await pressMod(page, 'Enter');

    await expect(page.getByText(tr('en', 'settings.workflows.editor.saved', { name }))).toBeVisible();
    await expect(page).toHaveURL(/\/settings\/workflows\?workflow=[0-9a-z]{26}$/);
    await expect(page.getByRole('heading', { level: 2, name, exact: true })).toBeFocused();
    const stored = (await allEntries(page, 'workflows')).find((workflow) => workflow.name === name)!;
    expect(stored.is_free).toBe(false);
    expect(stored.transitions).toHaveLength(18);
    expect(page.url()).toContain(`?workflow=${String(stored.id)}`);

    await tabTo(page, page.getByRole('link', { name: tr('en', 'settings.workflows.editor.back'), exact: true }), { backwards: true, max: 100 });
    await page.keyboard.press('Enter');
    await expect(card(page, name)).toContainText(tr('en', 'settings.workflows.matrix_badge'));
    await expect(card(page, name)).toContainText(tr('en', 'settings.workflows.transitions_count.other', { count: 18 }));
  } finally {
    await cleanUp(page);
  }
});

test('duplicates a workflow and deletes the copy with undo', async ({ page }) => {
  const source = `${prefix()} Source`;
  const copy = tr('en', 'settings.workflows.copy_name', { name: source });
  try {
    await createWorkflow(page, source);
    await openList(page);

    await tabTo(page, card(page, source).getByRole('link', { name: `${tr('en', 'settings.workflows.duplicate')} ${source}`, exact: true }), { max: 150 });
    await page.keyboard.press('Enter');
    // Inertia puts the parameters of the address in its own order
    await expect(page).toHaveURL(/[?&]workflow=new(&|$)/);
    expect(new URL(page.url()).searchParams.get('from')).toMatch(/^[0-9a-z]{26}$/);
    await expect(page.getByRole('textbox', { name: tr('en', 'settings.catalog.name'), exact: true })).toHaveValue(copy);
    await pressMod(page, 'Enter');
    await expect(page.getByText(tr('en', 'settings.workflows.editor.saved', { name: copy }))).toBeVisible();
    await expect(page).toHaveURL(/\?workflow=[0-9a-z]{26}$/);
    const entries = await allEntries(page, 'workflows');
    const original = entries.find((workflow) => workflow.name === source)!;
    const duplicate = entries.find((workflow) => workflow.name === copy)!;
    const names = (workflow: Record<string, unknown>) => (workflow.states as { name: string }[]).map((state) => state.name);
    const ids = (workflow: Record<string, unknown>) => (workflow.states as { id: string }[]).map((state) => state.id);
    expect(names(duplicate)).toEqual(names(original));
    expect(ids(duplicate).some((id) => ids(original).includes(id))).toBe(false);

    // delete the copy, take it back with ⌘Z, then delete it for good
    await tabTo(page, page.getByRole('link', { name: tr('en', 'settings.workflows.editor.back'), exact: true }), { backwards: true, max: 100 });
    await page.keyboard.press('Enter');
    const remove = card(page, copy).getByRole('button', { name: `${tr('en', 'settings.workflows.delete')} ${copy}`, exact: true });
    await tabTo(page, remove, { max: 150 });
    await page.keyboard.press('Enter');
    await expect(card(page, copy)).toHaveCount(0);
    const undo = page.getByRole('status').filter({ hasText: tr('en', 'settings.workflows.deleted', { name: copy }) });
    await expect(undo.getByRole('button', { name: tr('en', 'common.undo'), exact: true })).toBeVisible();
    await expect(page.locator('body')).not.toBeFocused();
    await pressMod(page, 'z');
    await expect(card(page, copy)).toBeVisible();

    await tabTo(page, remove, { max: 150 });
    const deleted = page.waitForResponse((response) => response.request().method() === 'DELETE' && response.url().includes('/api/v1/workflows/'));
    await page.keyboard.press('Enter');
    await expect(card(page, copy)).toHaveCount(0);
    expect((await deleted).status()).toBe(204);
    expect((await allEntries(page, 'workflows')).map((workflow) => workflow.name)).not.toContain(copy);
  } finally {
    await cleanUp(page);
  }
});

test('asks before leaving unsaved changes', async ({ page }) => {
  await openList(page);
  // into the editor inside the app, so Back stays in the document
  await tabTo(page, page.getByRole('link', { name: `${tr('en', 'settings.workflows.edit')} Agentur-Freigabe`, exact: true }), { max: 100 });
  await page.keyboard.press('Enter');
  const name = page.getByRole('textbox', { name: tr('en', 'settings.catalog.name'), exact: true });
  await expect(name).toHaveValue('Agentur-Freigabe');

  // typing is a user activation: only after one may a page stop Back
  // Tab selects the whole value: the arrow puts the caret at its end
  await tabTo(page, name, { max: 100 });
  await page.keyboard.press('ArrowRight');
  await page.keyboard.type(' edited');
  await page.evaluate(() => history.back());
  await expect(leaveQuestion(page)).toBeVisible();
  await tabTo(page, leaveQuestion(page).getByRole('button', { name: tr('en', 'settings.frame.leave_cancel') }));
  await page.keyboard.press('Enter');
  await expect(leaveQuestion(page)).toBeHidden();
  await expect(page).toHaveURL(/\?workflow=[0-9a-z]{26}$/);
  await expect(name).toHaveValue('Agentur-Freigabe edited');

  await page.evaluate(() => history.back());
  await tabTo(page, leaveQuestion(page).getByRole('button', { name: tr('en', 'settings.frame.leave_confirm') }));
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/settings\/workflows$/);
  await expect(card(page, 'Agentur-Freigabe')).toBeVisible();
  expect((await allEntries(page, 'workflows')).map((workflow) => workflow.name)).not.toContain('Agentur-Freigabe edited');
});

test('shows a member the workflows read-only', async ({ browser }) => {
  // Lene is a member with a German profile
  const { context, page } = await signedInContext(browser, PEOPLE.lene);
  try {
    await page.goto('/settings/workflows');
    await expect(page.getByRole('heading', { level: 2, name: tr('de', 'settings.org.section.workflows') })).toBeVisible();
    await expect(page.getByText(tr('de', 'settings.access.read_only'), { exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: tr('de', 'settings.workflows.create') })).toHaveCount(0);
    await expect(card(page, 'Agentur-Freigabe').getByRole('button')).toHaveCount(0);

    await tabTo(page, page.getByRole('link', { name: `${tr('de', 'settings.workflows.view')} Agentur-Freigabe`, exact: true }), { max: 100 });
    await page.keyboard.press('Enter');
    await expect(page.getByRole('textbox', { name: tr('de', 'settings.catalog.name'), exact: true })).toHaveAttribute('readonly', '');
    await expect(page.getByRole('grid', { name: tr('de', 'settings.workflows.matrix.label') })).toHaveAttribute('aria-readonly', 'true');
    await expect(page.getByRole('button', { name: tr('de', 'settings.frame.save') })).toHaveCount(0);

    // a link to a new workflow brings the reason and the way back, not an empty form
    await page.goto('/settings/workflows?workflow=new');
    await expect(page.getByText(tr('de', 'settings.workflows.editor.members_new.title'))).toBeVisible();
    await expect(page.locator('#main').getByRole('textbox')).toHaveCount(0);
  } finally {
    await context.close();
  }
});
