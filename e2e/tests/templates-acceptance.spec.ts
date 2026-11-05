import type { Page } from '@playwright/test';
import { expect, test } from '../fixtures';
import { allEntries, api, artisan, channelHeld, createE2eProject, createE2eTemplate, makeTemplateDue, PEOPLE, removeE2eProject, runId, signedInContext, tr, variant, waitForNotification } from '../helpers';

// The acceptance of phase 10 (success criterion 3, flow 6): a due template creates its item once, as the default bot
// "Automation", however often the scheduler runs; a template that fails at run time tells the lead of its project live.
// The server's clock cannot be set in e2e: `makeTemplateDue()` gives the template a term that is due already (K10), and
// `app:run-templates --now --template=…` runs that one template only (K9: the DDEV scheduler works on the same database
// and may run it first, so the specs check the item and the log, never the output of the command). Each test works in a
// project of its own (`E2E …`, removed in `finally`) whose lead is the inbox account of the variant (A289).

const name = (what: string) => `E2E accept ${what} ${variant()} ${runId()}`;

/** How long a change may take through the queue worker and Reverb to the other browser. */
const LIVE = { timeout: 20_000 };

// a second context and the way through the queues: more than the default 30 s may pass
test.describe.configure({ timeout: 90_000 });

type Inbox = (typeof PEOPLE.inbox)[string];

/** A project of the test whose lead is the inbox account of the variant (a member of it); the e2e person administers it. */
async function projectLedByInbox(page: Page, what: string, types: string[]) {
  const project = await createE2eProject(page, name(what), { types });
  const inbox: Inbox = PEOPLE.inbox[variant()]!;
  const person = (await allEntries(page, 'users')).find((entry) => entry.email === inbox.email) as { id: string };
  const added = await api(page, 'POST', `/api/v1/projects/${project.id}/members`, { user_id: person.id, role: 'member' });
  expect(added.status(), await added.text()).toBe(201);
  const led = await api(page, 'PATCH', `/api/v1/projects/${project.id}`, { lead_id: person.id });
  expect(led.status(), await led.text()).toBe(200);
  return { project, inbox, person };
}

/** Runs the due template on the server, in this process. */
const runTemplate = (id: string) => artisan('app:run-templates', '--now', `--template=${id}`);

/** The items of a project as the server holds them. */
async function itemsOf(page: Page, projectId: string): Promise<{ key: string; title: string; created_by: string; template_id: string | null }[]> {
  const response = await api(page, 'GET', `/api/v1/work-items?filter[project]=${projectId}&per_page=100`);
  expect(response.status(), await response.text()).toBe(200);
  return ((await response.json()) as { data: { key: string; title: string; created_by: string; template_id: string | null }[] }).data;
}

test('Erfolgskriterium 3: a due template creates its item once, as the default bot', async ({ page }) => {
  const { project } = await projectLedByInbox(page, 'schedule', ['Task']);
  try {
    const bot = (await allEntries(page, 'users')).find((entry) => entry.handle === 'automation') as { id: string };
    const template = await createE2eTemplate(page, project.id, { name: 'Maintenance', title: 'E2E maintenance {year}' });
    makeTemplateDue(template.id);

    // twice: the term runs once
    runTemplate(template.id);
    runTemplate(template.id);
    const items = await itemsOf(page, project.id);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ key: `${project.identifier}-1`, created_by: bot.id, template_id: template.id });
    expect(items[0]!.title).toMatch(/^E2E maintenance \d{4}$/);

    // one item in the list of the project
    await page.goto(`/projects/${project.identifier}`);
    await expect(page.getByRole('link', { name: /E2E maintenance \d{4}/ })).toHaveCount(1);

    // its history names the bot "Automation"
    await page.goto(`/items/${project.identifier}-1`);
    const history = page.getByRole('list', { name: tr('en', 'items.activity.list') });
    await expect(history).toContainText('Automation');
    await expect(history).toContainText(tr('en', 'items.activity.created'));

    // the log of the template: one scheduled run, with the item
    await page.goto(`/projects/${project.identifier}/templates/${template.id}`);
    const runs = page.getByRole('list', { name: tr('en', 'templates.runs.label'), exact: true }).getByRole('listitem');
    await expect(runs).toHaveCount(1);
    await expect(runs).toContainText(tr('en', 'templates.runs.created'));
    await expect(runs).toContainText(tr('en', 'templates.runs.scheduled'));
    await expect(runs.getByRole('link', { name: new RegExp(`${project.identifier}-1`) })).toBeVisible();
  } finally {
    await removeE2eProject(page, project.identifier);
  }
});

test('a template that fails at run time tells the lead live', async ({ page, browser }) => {
  // Kundenwunsch asks for the customer, which the template leaves out (A349): the run is refused
  const { project, inbox, person } = await projectLedByInbox(page, 'failed run', ['Task', 'Kundenwunsch']);
  const lead = await signedInContext(browser, inbox);
  try {
    const kundenwunsch = (await allEntries(page, 'work-item-types')).find((entry) => entry.name === 'Kundenwunsch') as { id: string };
    const template = await createE2eTemplate(page, project.id, { name: 'Customer request', title: 'E2E request {year}', type: kundenwunsch.id });
    const error = tr('en', 'templates.run.required_missing.one', { properties: 'Kunde' });

    // the lead on her inbox, holding her own live channel; a mark on the document tells it never loaded again
    const held = channelHeld(lead.page, `presence-user.${person.id}`);
    await lead.page.goto('/inbox');
    await expect(lead.page.getByRole('heading', { level: 1, name: tr('en', 'inbox.title') })).toBeVisible();
    await held;
    await lead.page.evaluate(() => ((window as Window & { __accept?: boolean }).__accept = true));

    makeTemplateDue(template.id);
    runTemplate(template.id);
    expect(await itemsOf(page, project.id)).toHaveLength(0);
    const notification = await waitForNotification(lead.page, (each) => each.event === 'template_run_failed' && each.data.template_id === template.id);
    expect(notification.data.error).toBe(error);

    // live: the row and the badge, without loading the page again
    const row = lead.page.getByRole('link').filter({ hasText: tr('en', 'inbox.kind.template_run_failed') }).filter({ hasText: error });
    await expect(row).toBeVisible(LIVE);
    await expect(async () => {
      const response = await api(lead.page, 'GET', '/api/v1/notifications?unread_only=1&per_page=1');
      const count = ((await response.json()) as { meta: { total: number } }).meta.total;
      expect(count).toBeGreaterThan(0);
      const link = lead.page.getByRole('link', { name: /^Inbox(, \d+ unread)?$/ }).filter({ visible: true });
      await expect(link).toHaveAccessibleName(tr('en', 'shell.nav.inbox_unread', { count }), { timeout: 1_000 });
      await expect(link.locator('[data-inbox-badge]')).toHaveText(count > 99 ? '99+' : String(count), { timeout: 1_000 });
    }).toPass(LIVE);
    expect(await lead.page.evaluate(() => (window as Window & { __accept?: boolean }).__accept)).toBe(true);

    // the row leads to the template, whose log names the error
    await row.click();
    await expect(lead.page).toHaveURL(new RegExp(`/projects/${project.identifier}/templates/${template.id}$`));
    const runs = lead.page.getByRole('list', { name: tr('en', 'templates.runs.label'), exact: true }).getByRole('listitem');
    await expect(runs).toHaveCount(1);
    await expect(runs).toContainText(tr('en', 'templates.runs.failed', { error }));
  } finally {
    await lead.page.goto('/my-items').catch(() => {});
    await lead.context.close().catch(() => {});
    await removeE2eProject(page, project.identifier);
  }
});
