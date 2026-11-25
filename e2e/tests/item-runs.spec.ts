import type { Page } from '@playwright/test';
import { expect, test } from '../fixtures';
import { allEntries, api, artisanEval, createE2eFakeRunner, createE2eProject, createItem, PEOPLE, removeE2eProject, removeE2eRunner, runId, tabTo, tr, variant } from '../helpers';

// The runs of an agent at an item (WEBU-28, spec 6.4, 10.6) as the e2e person (Erik Ende, org admin), in English. No
// machine and no CLI run here: a false runner of the spec speaks the runner protocol (`/api/runner/*`), claims the run
// werkbuch queues when the item is assigned to the agent, sends lines of the log, hears the cancel in its heartbeat and
// reports its results. Everything a test needs it brings itself: a workflow `E2E …` with the four steps of the agents,
// a project `E2E …` with it, a runner `E2E …` (revoked in `finally`), and one bot per Playwright project
// (`e2e-runs-<variant>`, Erik responsible), found again by its handle and set back to off afterwards.

const label = (key: string, params: Record<string, string | number> = {}) => tr('en', key, params);
const prefix = () => `E2E ${variant()} ${runId()}`;
/** What the runner reports reaches the page live: the queue `live` of DDEV boots PHP for each job (`queue:listen`). */
const LIVE = { timeout: 20_000 };

/** The bot of this Playwright project that works as the agent: made once, found by its handle afterwards. */
async function runsBot(page: Page): Promise<{ id: string; name: string }> {
  const me = (await (await api(page, 'GET', '/api/v1/me')).json()) as { data: { id: string } };
  const handle = `e2e-runs-${variant()}`;
  const name = `E2E ${variant()} Runs`;
  let bot = (await allEntries(page, 'bots')).find((entry) => entry.handle === handle) as { id: string; disabled_at: string | null } | undefined;
  if (!bot) {
    const created = await api(page, 'POST', '/api/v1/bots', { name, handle, description: '', owner_id: me.data.id });
    expect(created.status(), await created.text()).toBe(201);
    bot = ((await created.json()) as { data: { id: string; disabled_at: null } }).data;
  }
  if (bot.disabled_at !== null) {
    const reactivated = await api(page, 'POST', `/api/v1/users/${bot.id}/reactivate`);
    expect(reactivated.status(), await reactivated.text()).toBeLessThan(300);
  }
  return { id: bot.id, name };
}

/** The agent of the bot: on with only this runner, or off again. */
async function setAgent(page: Page, botId: string, runnerIds: string[] | null): Promise<void> {
  const saved = await api(page, 'PUT', `/api/v1/bots/${botId}/agent`, { enabled: runnerIds !== null, runner_ids: runnerIds ?? [], cli: 'claude', model: 'sonnet', models: {} });
  expect(saved.status(), await saved.text()).toBe(200);
}

/**
 * What a test of the runs needs before its first key: a workflow `E2E …` with the four steps of the agents, a project
 * with it, the bot of this project as its member and agent with only the false runner in its pool, and an item of the
 * project. `cleanup` sets the agent back to off, revokes the runner and takes project and workflow away.
 */
async function agentWorld(page: Page, what: string) {
  await page.goto('/my-items');
  const name = `${prefix()} ${what}`;
  const workflow = await api(page, 'POST', '/api/v1/workflows', {
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
    agent_states: { working: 'b', review: 'c', correction: 'a', merged: 'd' },
  });
  expect(workflow.status(), await workflow.text()).toBe(201);
  const workflowId = ((await workflow.json()) as { data: { id: string } }).data.id;
  const project = await createE2eProject(page, `${prefix()} Agent ${what}`, { workflow: name });
  const bot = await runsBot(page);
  const runner = await createE2eFakeRunner(page, what);
  const member = await api(page, 'POST', `/api/v1/projects/${project.id}/members`, { user_id: bot.id, role: 'member' });
  expect(member.status(), await member.text()).toBe(201);
  await setAgent(page, bot.id, [runner.id]);
  const item = await createItem(page, { project_id: project.id, title: `${prefix()} Cookie banner` });
  // assigned to the agent: werkbuch queues a task
  const assigned = await api(page, 'PATCH', `/api/v1/work-items/${item.id}`, { assignee_id: bot.id });
  expect(assigned.status(), await assigned.text()).toBe(200);
  const cleanup = async () => {
    await setAgent(page, bot.id, null);
    await removeE2eRunner(page, runner.id);
    await removeE2eProject(page, project.identifier);
    // a project being deleted still holds its workflow until it is purged: the E2eSeeder takes it away then
    const removed = await api(page, 'DELETE', `/api/v1/workflows/${workflowId}`);
    expect([204, 404, 409], await removed.text()).toContain(removed.status());
  };
  return { bot, runner, item, cleanup };
}

const implement = () => label('settings.runners.run.type.task');

test('follows a run of an agent at an item with the keyboard: its log live, cancel it, start it again', async ({ page }) => {
  test.setTimeout(240_000);
  const { bot, runner, item, cleanup } = await agentWorld(page, 'runs');
  try {
    // the false runner takes the task and starts to log
    const first = await runner.claim(item.id);
    await runner.events(first, [
      { kind: 'system', text: 'Worktree ready' },
      { kind: 'tool', text: 'Read resources/js/consent/banner.ts' },
    ]);

    await page.goto(`/items/${item.key}`);
    const chip = page.getByRole('button', { name: new RegExp(label('items.agents.chip.running', { bot: bot.name, run: implement() })) });
    await expect(chip).toBeVisible();

    // the chip shows the run in the activity: its log is open while it runs
    await tabTo(page, chip, { max: 20 });
    await page.keyboard.press('Enter');
    const card = page.getByRole('article', { name: label('items.agents.run.label', { run: implement(), bot: bot.name }) });
    await expect(card).toBeFocused();
    const log = card.getByRole('log', { name: label('items.agents.log.label', { run: implement() }) });
    await expect(log).toContainText('Read resources/js/consent/banner.ts');

    // a line the runner sends comes in live, on the channel of the item
    await runner.events(first, [{ kind: 'result', text: '12 passed' }]);
    await expect(log).toContainText('12 passed', LIVE);

    // cancel after a question; the runner hears it at its next heartbeat and ends the run
    await tabTo(page, card.getByRole('button', { name: label('settings.runners.runs.cancel') }));
    await page.keyboard.press('Enter');
    const question = page.getByRole('alertdialog', { name: label('items.agents.cancel.title', { run: implement() }) });
    await tabTo(page, question.getByRole('button', { name: label('items.agents.cancel.confirm') }));
    await page.keyboard.press('Enter');
    await expect(page.getByText(label('items.agents.cancel.done', { key: item.key })).first()).toBeVisible();
    await expect(card).toContainText(label('settings.runners.run.status.canceling'));
    expect(await runner.heartbeat(first)).toBe(true);
    await runner.result(first, 'canceled');
    await expect(card).toContainText(label('settings.runners.run.status.canceled'), LIVE);

    // start it again: a new run is queued, the focus goes to its line once the button went away
    const again = card.getByRole('button', { name: label('items.agents.retry.button') });
    await tabTo(page, again);
    await page.keyboard.press('Enter');
    await expect(page.getByText(label('items.agents.retry.done', { key: item.key, run: implement() })).first()).toBeVisible();
    const cards = page.getByRole('article', { name: label('items.agents.run.label', { run: implement(), bot: bot.name }) });
    await expect(cards).toHaveCount(2, LIVE);
    await expect(cards.nth(1)).toBeFocused();

    // the runner takes the new run and finishes it
    const second = await runner.claim(item.id);
    await runner.result(second, 'succeeded', 'The banner uses the consent API v2.');
    await expect(cards.nth(1)).toContainText(label('settings.runners.run.status.succeeded'), LIVE);
    await expect(cards.nth(1)).toContainText('The banner uses the consent API v2.', LIVE);
  } finally {
    await cleanup();
  }
});

test('gives an item back to its agent with the keyboard after a run failed and a person took it', async ({ page }) => {
  test.setTimeout(240_000);
  const { bot, runner, item, cleanup } = await agentWorld(page, 'give back');
  try {
    // the run fails, a person takes the item: the strand of the agent pauses
    const run = await runner.claim(item.id);
    await runner.result(run, 'failed');
    const me = (await (await api(page, 'GET', '/api/v1/me')).json()) as { data: { id: string } };
    const taken = await api(page, 'PATCH', `/api/v1/work-items/${item.id}`, { assignee_id: me.data.id });
    expect(taken.status(), await taken.text()).toBe(200);

    await page.goto(`/items/${item.key}`);
    const card = page.getByRole('article', { name: label('items.agents.run.label', { run: implement(), bot: bot.name }) });
    await expect(card).toContainText(label('items.agents.run.not_with_bot', { key: item.key, bot: bot.name }));
    await tabTo(page, card.getByRole('button', { name: label('items.agents.give_back.button', { bot: bot.name }) }), { max: 80 });
    await page.keyboard.press('Enter');
    await expect(page.getByText(label('items.agents.give_back.done', { key: item.key, bot: bot.name })).first()).toBeVisible();
    // a correction on the strand is queued; its line takes the focus of the button that went
    const correction = page.getByRole('article', { name: label('items.agents.run.label', { run: label('settings.runners.run.type.correction'), bot: bot.name }) });
    await expect(correction).toBeFocused({ timeout: 30_000 });
  } finally {
    await cleanup();
  }
});

test('goes on with the strand of an agent with the keyboard once GitHub is back', async ({ page }) => {
  test.setTimeout(240_000);
  const { bot, runner, item, cleanup } = await agentWorld(page, 'resume');
  let app: string | null = null;
  try {
    // the task ran; then GitHub was disconnected (the strand paused) and is connected again with the repo of the project
    // (werkbuch holds the rows, `ResumeThread` asks GitHub nothing)
    const run = await runner.claim(item.id);
    await runner.result(run, 'succeeded', 'Done.');
    // the flow handles the result on its queue (a task in a project without a repo ends its strand); only then the
    // strand is set to what a disconnect leaves, so nothing of the flow writes over it
    await expect
      .poll(async () => {
        const answer = (await (await api(page, 'GET', `/api/v1/work-items/${item.id}?include=agent`)).json()) as { data: { agent: { thread: { status: string } | null } } };
        return answer.data.agent.thread?.status ?? 'ended';
      }, LIVE)
      .not.toBe('open');
    const made = JSON.parse(
      artisanEval(
        [
          `$erik = App\\Models\\User::query()->where('email', '${PEOPLE.e2e.email}')->firstOrFail();`,
          // the app of an account of this variant (A680: one per account), with its installation and repos
          `$app = App\\Models\\GitHubApp::factory()->account('e2e-runs-${variant()}-${runId()}')->create(['created_by' => $erik->id]);`,
          `$installation = App\\Models\\GitHubInstallation::factory()->create(['github_app_id' => $app->id, 'account_login' => 'e2e-runs-${variant()}-${runId()}']);`,
          `$repo = App\\Models\\GitHubRepository::factory()->create(['installation_id' => $installation->id, 'full_name' => 'e2e/${variant()}-${runId()}-runs']);`,
          `$item = App\\Models\\WorkItem::query()->findOrFail('${item.id}');`,
          "App\\Models\\ProjectRepository::query()->create(['project_id' => $item->project_id, 'repository_id' => $repo->id, 'base_branch' => 'main', 'protected' => false]);",
          "App\\Models\\AgentThread::query()->where('work_item_id', $item->id)->update(['status' => 'paused', 'pause_reason' => 'github', 'repository_github_id' => $repo->github_id]);",
          "echo json_encode(['app' => $app->id]), PHP_EOL;",
        ].join('\n'),
      ),
    ) as { app: string };
    app = made.app;

    await page.goto(`/items/${item.key}`);
    await expect(page.getByText(label('items.agents.paused.github_title', { bot: bot.name }))).toBeVisible();
    await tabTo(page, page.getByRole('button', { name: label('items.agents.resume.button') }), { max: 20 });
    await page.keyboard.press('Enter');
    await expect(page.getByText(label('items.agents.resume.done', { key: item.key, bot: bot.name })).first()).toBeVisible();
    // a correction in the same strand is queued; its line takes the focus of the button that went
    const correction = page.getByRole('article', { name: label('items.agents.run.label', { run: label('settings.runners.run.type.correction'), bot: bot.name }) });
    await expect(correction).toBeFocused({ timeout: 30_000 });
  } finally {
    await cleanup();
    // the app takes its installation, repo and the link of the project with it
    if (app !== null) artisanEval([`App\\Models\\GitHubApp::query()->whereKey('${app}')->delete();`, "echo 'ok', PHP_EOL;"].join('\n'));
  }
});
