import type { Page } from '@playwright/test';
import { expect, test } from '../fixtures';
import { createE2eProject, createItem, removeE2eProject, runId, tabTo, tr, variant } from '../helpers';
import { plus, range, shown, stateId, today, typeId } from '../timelineHelpers';

// The timeline of a project with the keyboard only, signed in as the e2e person (playwright.config.ts), in English.
// Each test works in a project of its own (`E2E …`, removed after it) with an epic, and its children, over the API.

const name = (what: string) => `E2E timeline ${what} ${variant()} ${runId()}`;

/** An epic's row on the axis, named by its key. */
const row = (page: Page, key: string) => page.getByRole('group', { name: new RegExp(`^${key} `) });
const status = (page: Page) => page.getByRole('status', { name: tr('en', 'items.timeline.announcements') });

test('moves an epic by a week with shift+right at month zoom', async ({ page }) => {
  await page.goto('/my-items');
  const project = await createE2eProject(page, name('move'), { types: ['Task', 'Epic'] });
  try {
    const epic = await createItem(page, { project_id: project.id, type_id: await typeId(page, 'Epic'), title: 'Relaunch', start_date: '2026-10-01', due_date: '2026-11-15' });
    // from the list, 4 takes the focus to the epic on the timeline
    await page.goto(`/projects/${project.identifier}`);
    const listRow = page.locator(`[data-row-id="${epic.id}"]`);
    await expect(listRow).toHaveAttribute('tabindex', '0');
    await tabTo(page, listRow, { max: 80 });
    await page.keyboard.press('4');
    await expect(row(page, epic.key)).toBeFocused();
    await expect(page.getByRole('button', { name: tr('en', 'items.timeline.zoom.month'), exact: true })).toHaveAttribute('aria-pressed', 'true');

    // a unit of the month zoom is a week: the bar moves at once, its dates are saved once the key rests
    await page.keyboard.press('Shift+ArrowRight');
    await expect(row(page, epic.key)).toHaveAccessibleName(`${epic.key} Relaunch, ${range('2026-10-08', '2026-11-22')}`);
    await expect(status(page)).toHaveText(tr('en', 'items.timeline.saved', { key: epic.key, range: range('2026-10-08', '2026-11-22') }));
    await expect(row(page, epic.key)).toBeFocused();

    // the item's page has the due date a week later
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(new RegExp(`/items/${epic.key}$`));
    await expect(page.getByRole('complementary', { name: tr('en', 'items.detail.fields.label') }).getByText(shown('2026-11-22'))).toBeVisible();
  } finally {
    await removeE2eProject(page, project.identifier);
  }
});

test('keeps the focus on an epic that moves past another of its project', async ({ page }) => {
  await page.goto('/my-items');
  const project = await createE2eProject(page, name('overtake'), { types: ['Task', 'Epic'] });
  try {
    const epicType = await typeId(page, 'Epic');
    const first = await createItem(page, { project_id: project.id, type_id: epicType, title: 'Discovery', start_date: '2026-10-01', due_date: '2026-10-05' });
    const second = await createItem(page, { project_id: project.id, type_id: epicType, title: 'Design', start_date: '2026-10-05', due_date: '2026-10-20' });
    await page.goto(`/projects/${project.identifier}?layout=timeline`);
    const rows = page.getByRole('region', { name: name('overtake'), exact: true }).getByRole('group');
    await expect(rows).toHaveCount(2);
    await expect(rows.first()).toHaveAccessibleName(new RegExp(`^${first.key} `));
    await tabTo(page, row(page, first.key), { max: 80 });

    // a week later it starts after the second epic: once saved, the rows sort anew and the moved one keeps the focus
    await page.keyboard.press('Shift+ArrowRight');
    await expect(status(page)).toHaveText(tr('en', 'items.timeline.saved', { key: first.key, range: range('2026-10-08', '2026-10-12') }));
    await expect(rows.first()).toHaveAccessibleName(new RegExp(`^${second.key} `));
    await expect(rows.last()).toHaveAccessibleName(`${first.key} Discovery, ${range('2026-10-08', '2026-10-12')}`);
    await expect(row(page, first.key)).toBeFocused();

    // the keys go on from there
    await page.keyboard.press('Shift+ArrowLeft');
    await expect(status(page)).toHaveText(tr('en', 'items.timeline.saved', { key: first.key, range: range('2026-10-01', '2026-10-05') }));
    await expect(rows.first()).toHaveAccessibleName(new RegExp(`^${first.key} `));
    await expect(row(page, first.key)).toBeFocused();
  } finally {
    await removeE2eProject(page, project.identifier);
  }
});

test('moves the due date of an epic with alt+right and alt+left', async ({ page }) => {
  await page.goto('/my-items');
  const project = await createE2eProject(page, name('length'), { types: ['Task', 'Epic'] });
  try {
    const epic = await createItem(page, { project_id: project.id, type_id: await typeId(page, 'Epic'), title: 'Migration', start_date: '2026-10-01', due_date: '2026-10-20' });
    await page.goto(`/projects/${project.identifier}?layout=timeline`);
    await expect(row(page, epic.key)).toBeVisible();
    await tabTo(page, row(page, epic.key), { max: 80 });

    // at month zoom a unit is a week: alt+→ moves the due date only, alt+← takes it back
    await page.keyboard.press('Alt+ArrowRight');
    await expect(status(page)).toHaveText(tr('en', 'items.timeline.saved', { key: epic.key, range: range('2026-10-01', '2026-10-27') }));
    await expect(row(page, epic.key)).toBeFocused();
    await page.keyboard.press('Alt+ArrowLeft');
    await page.keyboard.press('Alt+ArrowLeft');
    await expect(status(page)).toHaveText(tr('en', 'items.timeline.saved', { key: epic.key, range: range('2026-10-01', '2026-10-13') }));
    await expect(row(page, epic.key)).toHaveAccessibleName(`${epic.key} Migration, ${range('2026-10-01', '2026-10-13')}`);

    // the server has the shorter epic
    await page.reload();
    await expect(row(page, epic.key)).toHaveAccessibleName(`${epic.key} Migration, ${range('2026-10-01', '2026-10-13')}`);
  } finally {
    await removeE2eProject(page, project.identifier);
  }
});

test('plans an epic without dates from the side list', async ({ page }) => {
  await page.goto('/my-items');
  const project = await createE2eProject(page, name('plan'), { types: ['Task', 'Epic'] });
  try {
    const epic = await createItem(page, { project_id: project.id, type_id: await typeId(page, 'Epic'), title: 'Journal' });
    await page.goto(`/projects/${project.identifier}?layout=timeline`);
    const side = page.getByRole('complementary', { name: tr('en', 'items.timeline.unplanned.title') });
    await expect(side.getByRole('article', { name: `${epic.key} Journal, ${tr('en', 'items.timeline.no_dates')}` })).toBeVisible();
    await expect(page.getByText(tr('en', 'items.timeline.none_dated'))).toBeVisible();

    const plan = side.getByRole('button', { name: tr('en', 'items.timeline.unplanned.plan_named', { key: epic.key }) });
    await tabTo(page, plan, { max: 80 });
    await page.keyboard.press('Enter');

    // two weeks from today on the axis, in the region of the project; the focus went along
    const start = await today(page);
    const planned = page.getByRole('region', { name: name('plan'), exact: true }).getByRole('group', { name: new RegExp(`^${epic.key} `) });
    await expect(planned).toHaveAccessibleName(`${epic.key} Journal, ${range(start, plus(start, 13))}`);
    await expect(planned).toBeFocused();
    await expect(side.getByText(tr('en', 'items.timeline.unplanned.all_dated'))).toBeVisible();
    await expect(status(page)).toHaveText(tr('en', 'items.timeline.saved', { key: epic.key, range: range(start, plus(start, 13)) }));

    await page.reload();
    await expect(row(page, epic.key)).toHaveAccessibleName(`${epic.key} Journal, ${range(start, plus(start, 13))}`);
  } finally {
    await removeE2eProject(page, project.identifier);
  }
});

test('shows the progress of an epic with a done child', async ({ page }) => {
  await page.goto('/my-items');
  const project = await createE2eProject(page, name('progress'), { types: ['Task', 'Epic'] });
  try {
    const epic = await createItem(page, { project_id: project.id, type_id: await typeId(page, 'Epic'), title: 'Relaunch', start_date: '2026-10-01', due_date: '2026-11-15' });
    await createItem(page, { project_id: project.id, title: 'Header', parent_id: epic.id, state_id: await stateId(page, 'Done') });
    await createItem(page, { project_id: project.id, title: 'Footer', parent_id: epic.id });
    await page.goto(`/projects/${project.identifier}?layout=timeline`);

    const epicRow = row(page, epic.key);
    await expect(epicRow).toHaveAccessibleName(`${epic.key} Relaunch, ${range('2026-10-01', '2026-11-15')}, ${tr('en', 'items.timeline.progress', { done: 1, total: 2 })}`);
    await expect(epicRow.locator('[data-progress]')).toHaveAttribute('style', /width: 50%/);
    // the children are no epics: they do not stand on the timeline
    await expect(page.getByText('Header')).toHaveCount(0);
  } finally {
    await removeE2eProject(page, project.identifier);
  }
});
