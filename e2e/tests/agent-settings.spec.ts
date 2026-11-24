import type { Locator, Page } from '@playwright/test';
import { expect, test } from '../fixtures';
import { allEntries, api, arrowTo, createE2eProject, pressMod, removeCatalogEntries, removeE2eProject, runId, tabTo, tr, variant } from '../helpers';

// The settings of the agents of WEBU-32 (spec 7.3, 7.7, 10.3–10.5) as the e2e person (Erik Ende, org admin), in
// English, keyboard only: the working rules of the organization, the guidance of a type, the model of a label, the
// agents of a project and the models of a bot per kind of run. What a test changes it brings itself: the rules go back
// to the standard in `finally` (they are of the whole organization, the four projects run one after the other), a type
// and a label `E2E …` and a project `E2E …` go in `finally`, the bot `e2e-agent-<variant>` of agents-bot.spec.ts is
// found again by its handle and set back.

const label = (key: string, params: Record<string, string | number> = {}) => tr('en', key, params);
const prefix = () => `E2E ${variant()} ${runId()}`;

/**
 * The bot of this Playwright project that can be an agent (the one of agents-bot.spec.ts, by its handle): Erik is
 * responsible for it; made if it is not there yet, reactivated if a run left it deactivated.
 */
async function agentBot(page: Page): Promise<{ id: string }> {
  const me = (await (await api(page, 'GET', '/api/v1/me')).json()) as { data: { id: string } };
  const handle = `e2e-agent-${variant()}`;
  let bot = (await allEntries(page, 'bots')).find((entry) => entry.handle === handle) as { id: string; disabled_at: string | null } | undefined;
  if (!bot) {
    const created = await api(page, 'POST', '/api/v1/bots', { name: `E2E ${variant()} Agent`, handle, description: '', owner_id: me.data.id });
    expect(created.status(), await created.text()).toBe(201);
    bot = ((await created.json()) as { data: { id: string; disabled_at: null } }).data;
  }
  if (bot.disabled_at !== null) {
    const reactivated = await api(page, 'POST', `/api/v1/users/${bot.id}/reactivate`);
    expect(reactivated.status(), await reactivated.text()).toBeLessThan(300);
  }
  const owned = await api(page, 'PATCH', `/api/v1/users/${bot.id}`, { owner_id: me.data.id });
  expect(owned.status(), await owned.text()).toBe(200);
  return { id: bot.id };
}

/** Opens a select from the keyboard and takes the option. */
async function choose(page: Page, select: Locator, option: string | RegExp): Promise<void> {
  await tabTo(page, select, { max: 120 });
  await page.keyboard.press('Enter');
  await arrowTo(page, page.getByRole('option', { name: option, exact: typeof option === 'string' }), 'ArrowDown', 20);
  await page.keyboard.press('Enter');
  await expect(select).toBeFocused();
}

test('sets the working rules of a kind of run and restores the standard of another, keyboard only', async ({ page }) => {
  await page.goto('/settings/agents');
  try {
    await expect(page.getByRole('heading', { level: 2, name: label('settings.org.section.agents') })).toBeVisible();
    await expect(page.getByRole('region', { name: label('settings.agent_rules.order.title') })).toBeVisible();

    // the contract of the kind is there to read, folded
    const contract = page.getByText(label('settings.agent_rules.contract.title', { type: label('settings.runners.run.type.task') }));
    await tabTo(page, contract, { max: 80 });
    await page.keyboard.press('Enter');
    await expect(page.locator('pre[lang="en"]').first()).toBeVisible();

    // an own text for "Implement"
    const task = page.getByRole('textbox', { name: label('settings.agent_rules.label', { type: label('settings.runners.run.type.task') }) });
    await tabTo(page, task);
    await page.keyboard.press('ControlOrMeta+End');
    await page.keyboard.type(`\n${prefix()}: tests first.`);

    // "Review": a tab further, the own text goes back to the standard and comes back with undo
    const tabs = page.getByRole('tablist', { name: label('settings.agent_rules.tabs') });
    await tabTo(page, tabs.getByRole('tab', { name: label('settings.runners.run.type.task') }), { backwards: true });
    const review = tabs.getByRole('tab', { name: label('settings.runners.run.type.review') });
    await arrowTo(page, review, 'ArrowRight', 5);
    await page.keyboard.press('Enter');
    const reviewText = page.getByRole('textbox', { name: label('settings.agent_rules.label', { type: label('settings.runners.run.type.review') }) });
    await tabTo(page, reviewText);
    await page.keyboard.type(' x');
    const restore = page.getByRole('button', { name: label('settings.agent_rules.restore') });
    await tabTo(page, restore);
    await page.keyboard.press('Enter');
    await expect(reviewText).toBeFocused();
    await expect(page.getByText(label('settings.agent_rules.restored', { type: label('settings.runners.run.type.review') }))).toBeVisible();

    await pressMod(page, 'Enter');
    await expect(page.getByText(label('settings.agent_rules.saved'))).toBeVisible();
    const rules = (await (await api(page, 'GET', '/api/v1/agent-rules')).json()) as { data: { type: string; body: string; standard: boolean }[] };
    expect(rules.data.find((rule) => rule.type === 'task')).toMatchObject({ standard: false });
    expect(rules.data.find((rule) => rule.type === 'task')!.body).toContain(`${prefix()}: tests first.`);
    expect(rules.data.find((rule) => rule.type === 'review')).toMatchObject({ standard: true });
  } finally {
    for (const type of ['task', 'review']) {
      const reset = await api(page, 'PUT', `/api/v1/agent-rules/${type}`, { body: null });
      expect(reset.status(), await reset.text()).toBe(200);
    }
  }
});

test('gives a type guidance for agents and a label a model for agents, keyboard only', async ({ page }) => {
  const type = `${prefix()} Guided`;
  try {
    const created = await api(page, 'POST', '/api/v1/work-item-types', { name: type, icon: 'flag', tone: 'sand', description: '', is_epic: false, properties: [] });
    expect(created.status(), await created.text()).toBe(201);
    await page.goto('/settings/types');
    await tabTo(page, page.getByRole('button', { name: label('settings.types.edit', { name: type }) }), { max: 150 });
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog', { name: label('settings.types.edit', { name: type }) });
    await tabTo(page, dialog.getByRole('textbox', { name: new RegExp(label('settings.types.dialog.guidance_label').replace(/[()]/g, '\\$&')) }), { max: 60 });
    await page.keyboard.type('Start with a failing test.');
    await pressMod(page, 'Enter');
    await expect(page.getByText(label('settings.types.dialog.saved', { name: type }))).toBeVisible();
    expect((await allEntries(page, 'work-item-types')).find((entry) => entry.name === type)!.agent_guidance).toBe('Start with a failing test.');

    // a label with a model: the name follows the model
    await page.goto('/settings/labels');
    await tabTo(page, page.getByRole('button', { name: label('settings.labels.create'), exact: true }));
    await page.keyboard.press('Enter');
    const labelDialog = page.getByRole('dialog', { name: label('settings.labels.create') });
    await choose(page, labelDialog.getByRole('combobox', { name: new RegExp(`^${label('settings.labels.dialog.model')}`) }), 'haiku');
    const name = labelDialog.getByRole('textbox', { name: label('settings.catalog.name') });
    await expect(name).toHaveValue('Haiku Agent');
    await tabTo(page, name, { backwards: true });
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.type(`${prefix()} Haiku`);
    await pressMod(page, 'Enter');
    await expect(page.getByText(label('settings.labels.dialog.created', { name: `${prefix()} Haiku` }))).toBeVisible();
    const row = page.getByRole('list', { name: label('settings.org.section.labels') }).getByRole('listitem').filter({ has: page.getByRole('heading', { name: `${prefix()} Haiku`, exact: true }) });
    await expect(row).toContainText(label('settings.labels.model_badge', { model: 'haiku' }));
    expect((await allEntries(page, 'labels')).find((entry) => entry.name === `${prefix()} Haiku`)!.agent_model).toBe('claude:haiku');
  } finally {
    await removeCatalogEntries(page, 'work-item-types', 'name', prefix());
    await removeCatalogEntries(page, 'labels', 'name', prefix());
  }
});

test('sets the agents of a project: merge method, brakes, a model per kind of run and the text, saved with mod+enter', async ({ page }) => {
  await page.goto('/my-items');
  const project = await createE2eProject(page, `${prefix()} Agents`);
  try {
    await page.goto(`/projects/${project.identifier}/settings/agents`);
    await expect(page.getByRole('heading', { name: label('settings.project.agents.brakes.title') })).toBeVisible();

    // the merge method: the segments are one tab stop, the arrows move
    const methods = page.getByRole('group', { name: label('settings.project.agents.merge_method.label'), exact: true });
    await tabTo(page, methods.getByRole('button', { name: label('settings.project.agents.merge_method.squash') }), { max: 80 });
    const rebase = methods.getByRole('button', { name: label('settings.project.agents.merge_method.rebase') });
    await arrowTo(page, rebase, 'ArrowRight', 4);
    await page.keyboard.press('Enter');
    await expect(rebase).toHaveAttribute('aria-pressed', 'true');

    // no comment at the PR
    const comment = page.getByRole('switch', { name: label('settings.project.agents.comment_on_pr.title') });
    await tabTo(page, comment);
    await page.keyboard.press('Space');
    await expect(comment).not.toBeChecked();

    const corrections = page.getByRole('textbox', { name: label('settings.project.agents.brakes.max_corrections') });
    await tabTo(page, corrections);
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.type('5');

    await choose(page, page.getByRole('combobox', { name: new RegExp(`^${label('settings.runners.run.type.review')} `) }), 'opus');
    await expect(page.getByText(label('settings.agents.model_for_cli', { cli: 'Claude Code' }))).toBeVisible();

    await tabTo(page, page.getByRole('textbox', { name: label('settings.project.agents.instructions.label') }));
    await page.keyboard.type('Run the tests in DDEV.');

    await pressMod(page, 'Enter');
    await expect(page.getByText(label('settings.project.agents.saved'), { exact: true })).toBeVisible();
    const stored = (await (await api(page, 'GET', `/api/v1/projects/${project.id}/agents`)).json()) as { data: Record<string, unknown> };
    expect(stored.data).toMatchObject({ merge_method: 'rebase', comment_on_pr: false, max_corrections: 5, models: { review: 'claude:opus' }, instructions: 'Run the tests in DDEV.' });
  } finally {
    await removeE2eProject(page, project.identifier);
  }
});

test('chooses the model of an agent per kind of run, keyboard only', async ({ page }) => {
  await page.goto('/my-items');
  const bot = await agentBot(page);
  try {
    const reset = await api(page, 'PUT', `/api/v1/bots/${bot.id}/agent`, { enabled: false, runner_ids: [], cli: 'claude', model: 'sonnet', models: {} });
    expect(reset.status(), await reset.text()).toBe(200);
    await page.goto(`/settings/bots?agent=${bot.id}`);
    const review = page.getByRole('combobox', { name: new RegExp(`^${label('settings.runners.run.type.review')} `) });
    await expect(review).toContainText(label('settings.bot_agent.models.as_default', { model: 'sonnet' }));
    await choose(page, review, 'haiku');
    await pressMod(page, 'Enter');
    await expect(page.getByText(label('settings.bot_agent.saved_off'))).toBeVisible();
    const saved = (await (await api(page, 'GET', `/api/v1/bots/${bot.id}/agent`)).json()) as { data: { models: Record<string, string> } };
    expect(saved.data.models).toEqual({ review: 'haiku' });
  } finally {
    await api(page, 'PUT', `/api/v1/bots/${bot.id}/agent`, { enabled: false, runner_ids: [], cli: 'claude', model: 'sonnet', models: {} });
  }
});
