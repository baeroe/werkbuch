import type { Page } from '@playwright/test';
import { expect, test } from '../fixtures';
import { allEntries, api, arrowTo, createE2eRunner, pressMod, removeE2eRunner, runId, tabTo, tr, variant } from '../helpers';

// Bot → Agent and the steps of the agents in a workflow (WEBU-27, spec 7.4, 10.4) as the e2e person (Erik Ende, org
// admin), in English, keyboard only. What a test changes it brings itself over the API: one bot per Playwright project
// (`e2e-agent-<variant>`, Erik responsible), found again by its handle in every run, reactivated if needed and with its
// agent set back to off (accounts are never deleted, so runs do not pile up bots), a runner `E2E …` (revoked in
// `finally`), or a workflow `E2E …` (removed in `finally`, the e2e seeder removes what an aborted run left).

const label = (key: string, params: Record<string, string | number> = {}) => tr('en', key, params);
const prefix = () => `E2E ${variant()} ${runId()}`;

/** The agent of a bot as it starts: off, every runner, Claude Code with its default model. */
async function resetAgent(page: Page, id: string): Promise<void> {
  const reset = await api(page, 'PUT', `/api/v1/bots/${id}/agent`, { enabled: false, runner_ids: [], cli: 'claude', model: 'sonnet', models: {} });
  expect(reset.status(), await reset.text()).toBe(200);
}

/**
 * The bot of this Playwright project that can be an agent: Erik is responsible for it. Made once, then found by its
 * handle; a run that broke off may have left it deactivated or as an agent.
 */
async function agentBot(page: Page): Promise<{ id: string; name: string }> {
  await page.goto('/my-items');
  const me = (await (await api(page, 'GET', '/api/v1/me')).json()) as { data: { id: string } };
  const handle = `e2e-agent-${variant()}`;
  const name = `E2E ${variant()} Agent`;
  let bot = (await allEntries(page, 'bots')).find((entry) => entry.handle === handle) as { id: string; disabled_at: string | null; owner_id: string | null } | undefined;
  if (!bot) {
    const created = await api(page, 'POST', '/api/v1/bots', { name, handle, description: '', owner_id: me.data.id });
    expect(created.status(), await created.text()).toBe(201);
    bot = ((await created.json()) as { data: { id: string; disabled_at: null; owner_id: string } }).data;
  }
  if (bot.disabled_at !== null) {
    const reactivated = await api(page, 'POST', `/api/v1/users/${bot.id}/reactivate`);
    expect(reactivated.status(), await reactivated.text()).toBeLessThan(300);
  }
  const named = await api(page, 'PATCH', `/api/v1/users/${bot.id}`, { name, owner_id: me.data.id });
  expect(named.status(), await named.text()).toBe(200);
  await resetAgent(page, bot.id);
  return { id: bot.id, name };
}

test('sets up a bot as an agent with the keyboard: on, one runner as its pool, Codex, saved with mod+enter', async ({ page }) => {
  const bot = await agentBot(page);
  const runner = await createE2eRunner(page, 'agent pool');
  try {
    await page.goto('/settings/bots');
    const card = page.getByRole('article', { name: bot.name, exact: true });
    await expect(card).toContainText(label('settings.bots.agent.off'));
    await tabTo(page, card.getByRole('link', { name: `${label('settings.bots.agent.set_up')} ${label('settings.bots.agent.for', { name: bot.name })}` }), { max: 150 });
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(new RegExp(`/settings/bots\\?agent=${bot.id}$`));
    await expect(page.getByRole('heading', { level: 2, name: label('settings.bot_agent.title', { name: bot.name }) })).toBeVisible();

    // on, with this runner only
    const enabled = page.getByRole('switch', { name: label('settings.bot_agent.enabled') });
    await tabTo(page, enabled);
    await page.keyboard.press('Space');
    await expect(enabled).toBeChecked();
    await expect(page.getByText(label('settings.bot_agent.pool.all'))).toBeVisible();
    const pool = page.getByRole('checkbox', { name: runner.name, exact: true });
    await tabTo(page, pool);
    await page.keyboard.press('Space');
    await expect(pool).toBeChecked();
    await expect(page.getByText(label('settings.bot_agent.pool.chosen.one'))).toBeVisible();

    // Codex: the default model follows, and the page says so; the runner reports no CLI
    // the segments are one tab stop (the pressed one); the arrows move between them
    const clis = page.getByRole('group', { name: label('settings.bot_agent.cli.label'), exact: true });
    await tabTo(page, clis.getByRole('button', { name: 'Claude Code', exact: true }));
    const codex = clis.getByRole('button', { name: 'Codex', exact: true });
    await arrowTo(page, codex, 'ArrowRight', 3);
    await page.keyboard.press('Enter');
    await expect(codex).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByText(label('settings.bot_agent.models_adjusted.title'))).toBeVisible();
    await expect(page.getByText(label('settings.bot_agent.cli.missing', { cli: 'Codex' }))).toBeVisible();

    await pressMod(page, 'Enter');
    await expect(page.getByText(label('settings.bot_agent.saved', { name: bot.name }))).toBeVisible();
    const saved = (await (await api(page, 'GET', `/api/v1/bots/${bot.id}/agent`)).json()) as { data: { enabled: boolean; runner_ids: string[]; cli: string; model: string } };
    expect(saved.data).toMatchObject({ enabled: true, runner_ids: [runner.id], cli: 'codex', model: 'gpt-5-codex' });

    // back to the list: the card says what the agent does
    await tabTo(page, page.getByRole('link', { name: label('settings.bot_agent.back') }), { backwards: true, max: 80 });
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/settings\/bots$/);
    await expect(page.getByRole('article', { name: bot.name, exact: true })).toContainText(label('settings.bots.agent.on', { cli: 'Codex', model: 'gpt-5-codex', runners: runner.name }));
  } finally {
    await removeE2eRunner(page, runner.id);
    await resetAgent(page, bot.id);
  }
});

test('sets the steps of the agents in a workflow with the keyboard: takes the proposal and saves it', async ({ page }) => {
  await page.goto('/my-items');
  const name = `${prefix()} Agents`;
  let id: string | null = null;
  try {
    const created = await api(page, 'POST', '/api/v1/workflows', {
      name,
      description: '',
      is_default: false,
      is_free: true,
      initial_state_id: 'a',
      states: [
        { id: 'a', name: 'Open', icon: 'circle', category: 'unstarted', position: 0 },
        { id: 'b', name: 'Doing', icon: 'half', category: 'started', position: 1 },
        { id: 'c', name: 'In review', icon: 'three-quarter', category: 'started', position: 2 },
        { id: 'd', name: 'Done', icon: 'check', category: 'completed', position: 3 },
      ],
      transitions: [],
    });
    expect(created.status(), await created.text()).toBe(201);
    const workflow = ((await created.json()) as { data: { id: string; states: { id: string; name: string }[] } }).data;
    id = workflow.id;
    const idOf = (state: string) => workflow.states.find((entry) => entry.name === state)!.id;

    await page.goto(`/settings/workflows?workflow=${workflow.id}`);
    const agents = page.getByRole('region', { name: label('settings.workflows.agents.title') });
    await expect(agents.getByText(label('settings.workflows.agents.missing_all'))).toBeVisible();
    await expect(agents.getByText(label('settings.workflows.agents.proposal', { name: 'In review' }))).toBeVisible();

    await tabTo(page, agents.getByRole('button', { name: label('settings.workflows.agents.suggest') }), { max: 120 });
    await page.keyboard.press('Enter');
    // the button goes with the proposal taken: the focus is on the first step
    const working = agents.getByRole('combobox', { name: new RegExp(`^${label('settings.workflows.agents.status_for', { step: label('catalog.agent_step.working') })}`) });
    await expect(working).toBeFocused();
    await expect(working).toContainText('Doing');
    await expect(agents.getByText(label('settings.workflows.agents.missing_all'))).toHaveCount(0);

    await pressMod(page, 'Enter');
    await expect(page.getByText(label('settings.workflows.editor.saved', { name }))).toBeVisible();
    const stored = (await (await api(page, 'GET', `/api/v1/workflows/${workflow.id}`)).json()) as { data: { agent_states: Record<string, string | null> } };
    expect(stored.data.agent_states).toEqual({ working: idOf('Doing'), review: idOf('In review'), correction: idOf('Open'), merged: idOf('Done'), ready: null });
  } finally {
    if (id) {
      const removed = await api(page, 'DELETE', `/api/v1/workflows/${id}`);
      expect([204, 404], await removed.text()).toContain(removed.status());
    }
  }
});
