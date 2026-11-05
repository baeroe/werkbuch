import { expect, test } from '../fixtures';
import { api, createE2eProject, createE2eTemplate, pressMod, removeE2eProject, runId, tabTo, tr, variant } from '../helpers';

// The templates of a project, with the keyboard only, signed in as the e2e person (org admin, English). Every test
// works in its own project `E2E <variant> <run> …` with its own templates, removed with the project in `finally`. A
// schedule starts in the future (A351): the server's clock cannot be set in e2e, and nothing may come due meanwhile.

const projectName = (what: string) => `E2E ${variant()} ${runId()} ${what}`;

/** Every Monday at 09:00 from a Monday next year: nothing runs while the test runs. */
const weekly = { frequency: 'weekly', interval: 1, weekdays: [1], time: '09:00', starts_on: '2027-06-07', ends: { type: 'never' }, paused: false };

test('lists templates and deletes one with undo, keyboard only', async ({ page }) => {
  const project = await createE2eProject(page, projectName('templates list'));
  try {
    await createE2eTemplate(page, project.id, { name: 'Weekly check', title: 'Check KW {week}', schedule: weekly });
    await createE2eTemplate(page, project.id, { name: 'Ad hoc report', title: 'Report' });
    await page.goto(`/projects/${project.identifier}/templates`);

    const list = page.getByRole('list', { name: tr('en', 'templates.list_label', { project: projectName('templates list') }) });
    await expect(list.getByRole('link')).toHaveText(['Ad hoc report', 'Weekly check']);
    const weeklyRow = list.getByRole('listitem').filter({ has: page.getByRole('link', { name: 'Weekly check', exact: true }) });
    await expect(weeklyRow).toContainText('Weekly on Monday at 09:00');
    // 2027-06-07 09:00 in the organisation's zone (Berlin, summer time)
    await expect(weeklyRow.locator('time')).toHaveAttribute('datetime', /^2027-06-07T07:00:00(\.0+)?Z$/);
    await expect(list.getByRole('listitem').filter({ hasText: 'Ad hoc report' })).toContainText(tr('en', 'templates.no_schedule'));

    // delete the first row: it goes at once, the focus moves to the next row, mod+z brings it back
    await tabTo(page, list.getByRole('button', { name: tr('en', 'templates.row.delete', { name: 'Ad hoc report' }), exact: true }), { max: 120 });
    await page.keyboard.press('Enter');
    await expect(list.getByRole('link', { name: 'Ad hoc report', exact: true })).toHaveCount(0);
    await expect(page.getByText(tr('en', 'templates.deleted', { name: 'Ad hoc report' }), { exact: true })).toBeVisible();
    await expect(list.getByRole('link', { name: 'Weekly check', exact: true })).toBeFocused();
    await pressMod(page, 'z');
    await expect(list.getByRole('link', { name: 'Ad hoc report', exact: true })).toBeVisible();

    // delete the other row and let the toast run out: the template is gone on the server, the focus on "New template"
    await tabTo(page, list.getByRole('button', { name: tr('en', 'templates.row.delete', { name: 'Weekly check' }), exact: true }), { max: 20 });
    await page.keyboard.press('Enter');
    await expect(list.getByRole('link', { name: 'Weekly check', exact: true })).toHaveCount(0);
    await expect(list.getByRole('link', { name: 'Ad hoc report', exact: true })).toBeFocused();
    await expect
      .poll(
        async () => {
          const response = await api(page, 'GET', `/api/v1/projects/${project.id}/templates`);
          return ((await response.json()) as { data: { name: string }[] }).data.map((template) => template.name);
        },
        { timeout: 15_000 },
      )
      .toEqual(['Ad hoc report']);

    await tabTo(page, list.getByRole('button', { name: tr('en', 'templates.row.delete', { name: 'Ad hoc report' }), exact: true }), { max: 20 });
    await page.keyboard.press('Enter');
    await expect(page.getByText(tr('en', 'templates.empty.title'), { exact: true })).toBeVisible();
    await expect(page.getByRole('main').getByRole('button', { name: tr('en', 'templates.new'), exact: true }).first()).toBeFocused();
  } finally {
    await removeE2eProject(page, project.identifier);
  }
});
