import { expect, test } from '../fixtures';
import { api, arrowTo, createE2eProject, createE2eTemplate, PEOPLE, pressMod, removeE2eProject, runId, tabTo, tr, variant } from '../helpers';

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

test('creates a template with the keyboard and runs it now', async ({ page }) => {
  const project = await createE2eProject(page, projectName('template editor'), { types: ['Task'] });
  try {
    await page.goto(`/projects/${project.identifier}/templates`);
    const create = page.getByRole('main').getByRole('button', { name: tr('en', 'templates.new'), exact: true }).first();
    // locked while the rights load
    await expect(create).not.toHaveAttribute('aria-disabled', 'true');
    await tabTo(page, create, { max: 80 });
    await page.keyboard.press('Enter');

    // a new template starts with its name
    await expect(page.getByRole('heading', { level: 1, name: tr('en', 'templates.new') })).toBeVisible();
    const name = page.getByRole('textbox', { name: tr('en', 'templates.editor.name'), exact: true });
    await expect(name).toBeFocused();
    await page.keyboard.type('Weekly report');
    const title = page.getByRole('textbox', { name: new RegExp(`^${tr('en', 'templates.editor.title')}`) });
    await tabTo(page, title, { max: 20 });
    await page.keyboard.type('E2E report {year}');
    // the server fills the placeholder: without a schedule, as now
    const preview = page.getByRole('region', { name: tr('en', 'templates.editor.preview.label') });
    await expect(preview).toContainText(tr('en', 'templates.editor.preview.now'));
    await expect(preview).toContainText(/E2E report \d{4}/);

    // mod+enter creates it, leads to its address and gives its heading the focus
    await pressMod(page, 'Enter');
    await expect(page).toHaveURL(new RegExp(`/projects/${project.identifier}/templates/[0-9a-z]{26}$`));
    await expect(page.getByRole('heading', { level: 1, name: 'Weekly report' })).toBeFocused();

    // run it now: the item comes from the bot "Automation", the toast opens it in the preview
    const run = page.getByRole('button', { name: tr('en', 'templates.editor.run') });
    await expect(run).not.toHaveAttribute('aria-disabled', 'true');
    await tabTo(page, run, { max: 20 });
    await page.keyboard.press('Enter');
    const toast = page.getByRole('status').filter({ hasText: tr('en', 'items.create.created', { key: `${project.identifier}-1` }) });
    await tabTo(page, toast.getByRole('button', { name: tr('en', 'items.create.open'), exact: true }), { max: 80 });
    await page.keyboard.press('Enter');
    const peek = page.getByRole('complementary', { name: tr('en', 'items.peek.label') });
    await expect(peek.getByRole('heading', { name: /^E2E report \d{4}$/ })).toBeVisible();
    await expect(peek.getByRole('list', { name: tr('en', 'items.activity.list') })).toContainText('Automation');
    // the log of the template shows the run by hand
    await expect(page.getByRole('list', { name: tr('en', 'templates.runs.label') }).getByRole('listitem')).toHaveCount(1);
  } finally {
    await removeE2eProject(page, project.identifier);
  }
});

test('switches a schedule on in the editor and saves it', async ({ page }) => {
  const project = await createE2eProject(page, projectName('template schedule on'), { types: ['Task'] });
  try {
    const template = await createE2eTemplate(page, project.id, { name: 'Standup notes', title: 'Standup {date}' });
    await page.goto(`/projects/${project.identifier}/templates/${template.id}`);
    const schedule = page.getByRole('region', { name: tr('en', 'templates.editor.schedule') });
    await expect(schedule).toContainText(tr('en', 'schedule.editor.none'));

    // the switch with the space bar: a weekly plan from today, with its next runs
    const on = schedule.getByRole('switch', { name: tr('en', 'schedule.editor.switch') });
    await tabTo(page, on, { max: 120 });
    await page.keyboard.press(' ');
    await expect(on).toBeChecked();
    await expect(schedule.getByRole('list', { name: tr('en', 'schedule.next.title') }).locator('time')).toHaveCount(5);

    await pressMod(page, 'Enter');
    await expect(page.getByText(tr('en', 'templates.editor.saved', { name: 'Standup notes' }), { exact: true })).toBeVisible();
    const saved = ((await (await api(page, 'GET', `/api/v1/templates/${template.id}`)).json()) as { data: { schedule: Record<string, unknown> | null; next_run_at: string | null } }).data;
    expect(saved.schedule).toMatchObject({ frequency: 'weekly', interval: 1, time: '09:00', paused: false });
    expect(saved.next_run_at).not.toBeNull();
  } finally {
    await removeE2eProject(page, project.identifier);
  }
});

test('shows the next five runs of a monthly schedule on the first Monday', async ({ page }) => {
  const project = await createE2eProject(page, projectName('template schedule'), { types: ['Task'] });
  try {
    // weekly on Saturdays at 08:00 from 2036-11-01, a Saturday: far ahead, nothing comes due (A351)
    const template = await createE2eTemplate(page, project.id, {
      name: 'Monthly report',
      title: 'Report {month_name}',
      schedule: { frequency: 'weekly', interval: 1, weekdays: [6], time: '08:00', starts_on: '2036-11-01', ends: { type: 'never' }, paused: false },
    });
    await page.goto(`/projects/${project.identifier}/templates/${template.id}`);
    const schedule = page.getByRole('region', { name: tr('en', 'templates.editor.schedule') });
    await expect(schedule.getByRole('list', { name: tr('en', 'schedule.next.title') })).toBeVisible();

    // monthly, on the first weekday of the month, Monday, at 9 o'clock: with the keyboard only
    const frequency = schedule.getByRole('group', { name: tr('en', 'schedule.editor.frequency.label') });
    // the group is one tab stop; the arrows move inside
    await tabTo(page, frequency.locator('button[tabindex="0"]'), { max: 120 });
    await arrowTo(page, frequency.getByRole('button', { name: tr('en', 'schedule.editor.frequency.monthly'), exact: true }), 'ArrowRight', 3);
    await page.keyboard.press('Enter');
    const mode = schedule.getByRole('group', { name: tr('en', 'schedule.editor.month_mode.label') });
    await tabTo(page, mode.locator('button[tabindex="0"]'), { max: 20 });
    await arrowTo(page, mode.getByRole('button', { name: tr('en', 'schedule.editor.month_mode.nth'), exact: true }), 'ArrowRight', 3);
    await page.keyboard.press('Enter');
    await expect(schedule.getByRole('combobox', { name: new RegExp(`^${tr('en', 'schedule.editor.week_of_month')}`) })).toContainText(tr('en', 'schedule.editor.ordinal.first'));
    const weekday = schedule.getByRole('combobox', { name: new RegExp(`^${tr('en', 'schedule.editor.weekday')} `) });
    await tabTo(page, weekday, { max: 20 });
    await page.keyboard.press('Enter');
    await arrowTo(page, page.getByRole('option', { name: 'Monday', exact: true }), 'ArrowUp', 8);
    await page.keyboard.press('Enter');
    await expect(weekday).toContainText('Monday');
    const time = schedule.getByRole('textbox', { name: new RegExp(`^${tr('en', 'schedule.editor.time')}`) });
    await tabTo(page, time, { max: 20 });
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.type('9');
    await page.keyboard.press('Tab');
    await expect(schedule).toContainText('Every first Monday of the month at 09:00');

    // the terms the server counts, in the zone of the organisation and the language of the person (K22)
    const zone = ((await (await api(page, 'GET', '/api/v1/organization')).json()) as { data: { timezone: string } }).data.timezone;
    const users = ((await (await api(page, 'GET', '/api/v1/users?per_page=100')).json()) as { data: { email: string | null; locale: string }[] }).data;
    const locale = users.find((user) => user.email === PEOPLE.e2e.email)!.locale === 'de' ? 'de-DE' : 'en-GB';
    const dates = schedule.getByRole('list', { name: tr('en', 'schedule.next.title') }).locator('time');
    await expect(dates).toHaveCount(5);
    await expect
      .poll(async () => {
        const instants = await dates.evaluateAll((elements) => elements.map((element) => element.getAttribute('datetime')!));
        return instants.map((instant) => new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: zone }).format(new Date(instant)));
      })
      .toEqual(['2036-11-03, 09:00', '2036-12-01, 09:00', '2037-01-05, 09:00', '2037-02-02, 09:00', '2037-03-02, 09:00']);
    const instants = await dates.evaluateAll((elements) => elements.map((element) => element.getAttribute('datetime')!));
    await expect(dates).toHaveText(instants.map((instant) => new Intl.DateTimeFormat(locale, { dateStyle: 'full', timeStyle: 'short', timeZone: zone }).format(new Date(instant))));

    // saved with mod+enter, the template keeps it
    await pressMod(page, 'Enter');
    await expect(page.getByText(tr('en', 'templates.editor.saved', { name: 'Monthly report' }), { exact: true })).toBeVisible();
    const saved = ((await (await api(page, 'GET', `/api/v1/projects/${project.id}/templates`)).json()) as { data: { schedule: Record<string, unknown> }[] }).data[0];
    expect(saved.schedule).toMatchObject({ frequency: 'monthly', nth_weekday: { n: 1, weekday: 1 }, time: '09:00', starts_on: '2036-11-01' });
  } finally {
    await removeE2eProject(page, project.identifier);
  }
});
