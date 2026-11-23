/*
 * The fake API of the runner and the agents (WEBU-18): what an assignment starts, how the demo runner moves a run on,
 * cancel and retry, the brake given back, a bot without an agent, the checks of the project settings and pairing.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { now } from '@/lib/clock';
import { asUser, failure, resetApi } from '@/test/api';
import { getProjectAgents, listAgentProjects, saveAgentConfig, getAgentConfig, saveProjectAgents } from './agents';
import { getDb, saveDb } from './db';
import { connectGithubApp, disconnectGithub } from './github';
import { createPairing, expirePairing, listRunners, revokeRunner, saveRunnerSlots, simulatePairing } from './runners';
import { advance, CANCEL_DELAY_MS, cancelRun, getItemAgents, resumeThread, retryRun, START_DELAY_MS } from './runs';
import { listActivity, updateWorkItem } from './workItems';
import { assignWorkflow, listWorkflows, saveWorkflow } from './workflows';

beforeEach(resetApi);

const later = (ms: number) => new Date(now().getTime() + ms);
/** The demo runner moves on by `ms` and the result is stored, as a read of the item would store it. */
function tick(ms: number): boolean {
  const changed = advance(getDb(), later(ms));
  saveDb();
  return changed;
}

describe('assigning an item to an agent', () => {
  it('queues a task on a new strand, which starts on a free runner and sets "In Arbeit"', async () => {
    await updateWorkItem('wi_web_50', { assignee_id: 'u_kira' });
    let state = await getItemAgents('WEB-50');
    expect(state.runs).toHaveLength(1);
    expect(state.runs[0]).toMatchObject({ type: 'task', status: 'queued', model: 'sonnet', model_source: 'bot' });
    expect(state.thread).toMatchObject({ branch: 'agent/WEB-50-fehlerseite-404-gestalten', status: 'open' });

    // mac-studio works on WEB-51 in the same repo, and takes one run per repo: the task waits
    tick(START_DELAY_MS + 100);
    expect((await getItemAgents('WEB-50')).runs[0].status).toBe('queued');
    await saveRunnerSlots('rn_studio', { total: 2, per_repo: 2, light: 2 });
    expect(tick(START_DELAY_MS + 100)).toBe(true);
    state = await getItemAgents('WEB-50');
    expect(state.runs[0]).toMatchObject({ status: 'running', runner_name: 'mac-studio', runner_online: true });
    expect(getDb().items.find((item) => item.key === 'WEB-50')?.state_id).toBe('std_progress');
    const moved = (await listActivity('WEB-50')).items.find((entry) => entry.kind === 'event' && entry.event.type === 'work_item.state_changed');
    expect(moved?.kind === 'event' && moved.event).toMatchObject({ actor_id: 'u_kira', reason: 'Agent: Auftrag „Umsetzen“ gestartet' });
  });

  it('takes the model of a model label the item carries („Fable Agent“), an ordinary label does nothing', async () => {
    await updateWorkItem('wi_web_50', { assignee_id: 'u_kira', label_ids: ['lb_seo', 'lb_agent_fable'] });
    expect((await getItemAgents('WEB-50')).runs[0]).toMatchObject({ model: 'fable', model_source: 'label', model_label_id: 'lb_agent_fable' });
  });

  it('cancels a running run in two steps and lets it start again as the next attempt', async () => {
    await saveRunnerSlots('rn_studio', { total: 2, per_repo: 2, light: 2 });
    await updateWorkItem('wi_web_50', { assignee_id: 'u_kira' });
    tick(START_DELAY_MS + 100);
    const [run] = (await getItemAgents('WEB-50')).runs;

    expect((await cancelRun(run.id)).status).toBe('canceling');
    tick(START_DELAY_MS + CANCEL_DELAY_MS + 200);
    const canceled = (await getItemAgents('WEB-50')).runs[0];
    expect(canceled).toMatchObject({ status: 'canceled', canceled_by: 'u_mara' });
    expect(canceled.log.at(-1)?.text).toContain('Abgebrochen von Mara Lindqvist');
    expect((await failure(cancelRun(run.id))).reason).toBe('run_finished');

    const again = await retryRun(run.id);
    expect(again).toMatchObject({ type: 'task', status: 'queued', attempt: 2 });
    // one run at a time per item
    expect((await failure(retryRun(run.id))).reason).toBe('run_active');
  });

  it('starts nothing again on a strand a person took over: the way back is assigning the item to the bot (spec 7.2)', async () => {
    // WEB-53 ran out of time; Jonas takes it over, the strand pauses
    await updateWorkItem('wi_web_53', { assignee_id: 'u_jonas' });
    expect((await getItemAgents('WEB-53')).thread?.status).toBe('paused');
    const refused = await failure(retryRun('run_web53_task'));
    expect(refused).toMatchObject({ status: 409, reason: 'not_assigned' });
    expect(refused.message).toContain('Weise es wieder Kira zu');
    // given back, a correction starts on the same strand
    await updateWorkItem('wi_web_53', { assignee_id: 'u_kira' });
    expect((await getItemAgents('WEB-53')).runs.at(-1)).toMatchObject({ type: 'correction', status: 'queued' });
  });

  it('pauses open strands with the reason when GitHub is disconnected', async () => {
    await disconnectGithub();
    const state = await getItemAgents('WEB-51');
    expect(state.thread).toMatchObject({ status: 'paused', pause_reason: 'github' });
    expect(state.runs[0].status).toBe('canceling');
    expect((await getProjectAgents('p_web')).repo).toBeNull();
  });

  it('lets only who may edit the item cancel', async () => {
    asUser('u_theo'); // a viewer in WEB
    expect((await failure(cancelRun('run_web51_task'))).status).toBe(403);
  });

  it('pauses the strand when somebody gives the item to a person, and the agent stops', async () => {
    await updateWorkItem('wi_web_51', { assignee_id: 'u_jonas' });
    const state = await getItemAgents('WEB-51');
    expect(state.thread?.status).toBe('paused');
    expect(state.runs[0].status).toBe('canceling');
  });

  it('starts a correction with the brake reset when the item goes back to the agent after the brake', async () => {
    let state = await getItemAgents('WEB-49');
    expect(state.thread).toMatchObject({ status: 'paused', corrections: 3 });
    await updateWorkItem('wi_web_49', { assignee_id: 'u_kira' });
    state = await getItemAgents('WEB-49');
    expect(state.thread).toMatchObject({ status: 'open', corrections: 1 });
    expect(state.runs.at(-1)).toMatchObject({ type: 'correction', status: 'queued' });
  });

  // a simplification of the demo: past the 30 minutes another runner of the pool would take the strand over (spec 9);
  // the demo keeps the run waiting, and the item says what would have happened
  it('keeps a run waiting for the offline runner of its strand (the demo plays no takeover)', async () => {
    tick(60 * 60_000);
    expect((await getItemAgents('WEB-44')).runs.at(-1)).toMatchObject({ type: 'correction', status: 'waiting', runner_name: 'mac-mini-alt', runner_online: false });
  });

  it('says why an assigned bot does no work: OPS has no agent settings', async () => {
    const state = await getItemAgents('OPS-15');
    expect(state.runs).toEqual([]);
    expect(state.not_an_agent).toContain('In OPS sind die Agenten noch nicht eingerichtet');
    await updateWorkItem('wi_ops_14', { assignee_id: 'u_kira' });
    expect((await getItemAgents('OPS-14')).runs).toEqual([]);
  });

  it('starts nothing for an agent that is switched off', async () => {
    await saveAgentConfig({ ...(await getAgentConfig('u_kira')), enabled: false });
    await updateWorkItem('wi_web_50', { assignee_id: 'u_kira' });
    const state = await getItemAgents('WEB-50');
    expect(state.runs).toEqual([]);
    expect(state.not_an_agent).toContain('„Als Agent arbeiten“ aus');
  });
});

describe('the agent settings', () => {
  it('give a repo to one project only, and only one with both apps', async () => {
    const ops = await getProjectAgents('p_ops');
    expect((await failure(saveProjectAgents({ ...ops, repo: 'feldwerk/website' }))).errors?.repo?.[0]).toContain('gehört schon zum Projekt WEB');
    expect((await failure(saveProjectAgents({ ...ops, repo: 'feldwerk/design-tokens' }))).errors?.repo?.[0]).toContain('nicht beide GitHub-Apps');
    expect((await saveProjectAgents({ ...ops, repo: 'feldwerk/infrastruktur' })).repo).toBe('feldwerk/infrastruktur');
  });

  it('are changed by project admins only; members read them', async () => {
    asUser('u_jonas'); // a member in WEB
    const settings = await getProjectAgents('p_web');
    expect(settings.repo).toBe('feldwerk/website');
    expect((await failure(saveProjectAgents(settings))).status).toBe(403);
  });

  it('never make the default bot an agent', async () => {
    expect((await failure(saveAgentConfig({ ...(await getAgentConfig('u_automation')), enabled: true, runner_ids: ['rn_studio'] }))).errors?.enabled?.[0]).toContain('Standard-Bot');
  });

  it('say per project where the agent works', async () => {
    const projects = await listAgentProjects('u_kira');
    expect(projects.map((project) => [project.identifier, project.reason === null])).toEqual([
      ['WEB', true],
      ['OPS', false],
    ]);
  });
});

describe('the slots of a runner (spec 9)', () => {
  it('keep a light run apart from code runs: a review starts while the code slot of the repo is taken', async () => {
    // a review of WEB-44 (its strand's runner is offline, a review may go to any runner of the pool)
    const db = getDb();
    const before = db.agent_runs.length;
    db.agent_runs.push({ ...db.agent_runs.find((run) => run.id === 'run_web44_review')!, id: 'run_review_now', status: 'queued', runner_id: null, created_at: now().toISOString(), started_at: null, finished_at: null, result: null, log: [], usage: null });
    saveDb();
    tick(START_DELAY_MS + 100);
    expect(getDb().agent_runs.find((run) => run.id === 'run_review_now')).toMatchObject({ status: 'running', runner_id: 'rn_studio' });
    expect(getDb().agent_runs.length).toBe(before + 1);
    expect((await listRunners()).items.find((runner) => runner.id === 'rn_studio')?.slots_used).toEqual({ total: 1, per_repo: 1, light: 1 });
  });

  it('are whole numbers, per repo at most as many as in all', async () => {
    const refused = await failure(saveRunnerSlots('rn_studio', { total: 2, per_repo: 3, light: 0 }));
    expect(Object.keys(refused.errors ?? {}).sort()).toEqual(['light', 'per_repo']);
  });
});

describe('runners', () => {
  it('pair with a code that is valid once and for ten minutes', async () => {
    const pairing = await createPairing();
    expect(pairing.command).toBe(`curl -fsSL https://werkbuch.example.com/runner/install.sh | sh -s -- --code ${pairing.code}`);
    expect(Date.parse(pairing.expires_at) - now().getTime()).toBeGreaterThan(9 * 60_000);

    const runner = await simulatePairing(pairing.code);
    expect(runner).toMatchObject({ name: 'mac-mini-buero', online: true, slots: { total: 2, per_repo: 1, light: 2 } });
    expect((await failure(simulatePairing(pairing.code))).reason).toBe('code_used');

    const expired = await createPairing();
    await expirePairing(expired.code);
    expect((await failure(simulatePairing(expired.code))).reason).toBe('code_expired');
  });

  it('are listed for org admins only, with what runs on them', async () => {
    const runners = (await listRunners()).items;
    expect(runners.find((runner) => runner.name === 'mac-studio')?.active_runs.map((run) => run.item_key)).toEqual(['WEB-51']);
    asUser('u_jonas');
    expect((await failure(listRunners())).status).toBe(403);
  });

  it('cancel what runs on them when revoked and leave the pools', async () => {
    expect(await revokeRunner('rn_studio')).toEqual({ canceled: 1 });
    expect((await getItemAgents('WEB-51')).runs[0]).toMatchObject({ status: 'canceled', error: 'Der Runner wurde widerrufen.' });
    expect((await getAgentConfig('u_kira')).runner_ids).toEqual(['rn_mini']);
  });
});

describe('going on after GitHub was disconnected', () => {
  async function reconnect() {
    await connectGithubApp('agent');
    await connectGithubApp('review');
    await saveProjectAgents({ ...(await getProjectAgents('p_web')), repo: 'feldwerk/website' });
  }

  it('waits for a repo, then queues a correction on the same strand', async () => {
    await disconnectGithub();
    expect((await failure(resumeThread('WEB-51'))).reason).toBe('no_repo');
    await reconnect();
    const { run, braked } = await resumeThread('WEB-51');
    expect(braked).toBe(false);
    expect(run).toMatchObject({ type: 'correction', status: 'queued', thread_id: 'th_web51' });
    expect((await getItemAgents('WEB-51')).thread).toMatchObject({ status: 'open', corrections: 1 });
    expect((await failure(resumeThread('WEB-51'))).reason).toBe('nothing_to_resume');
  });

  it('lets the brake hold: with the corrections used up the strand stays paused and the item goes to the person', async () => {
    getDb().agent_threads.find((thread) => thread.id === 'th_web51')!.corrections = 3;
    saveDb();
    await disconnectGithub();
    await reconnect();
    expect(await resumeThread('WEB-51')).toEqual({ run: null, braked: true });
    const state = await getItemAgents('WEB-51');
    expect(state.thread).toMatchObject({ status: 'paused', corrections: 3 });
    expect(state.thread?.pause_reason).toBeUndefined();
    expect(getDb().items.find((item) => item.key === 'WEB-51')?.assignee_id).toBe('u_mara');
  });

  it('leaves strands of projects without a repo alone', async () => {
    getDb().project_agents.find((settings) => settings.project_id === 'p_web')!.repo = null;
    saveDb();
    await disconnectGithub();
    expect((await getItemAgents('WEB-51')).thread).toMatchObject({ status: 'open' });
  });
});

describe('the equipment of a runner', () => {
  it('is what its harness reports, read only, with a warning for a second way into werkbuch', async () => {
    const runners = (await listRunners()).items;
    expect(runners.find((runner) => runner.name === 'mac-studio')?.equipment).toMatchObject({ mcp_servers: ['playwright', 'context7'], werkbuch_access: [] });
    expect(runners.find((runner) => runner.name === 'mac-mini-alt')?.equipment).toEqual({ mcp_servers: [], skills: [], plugins: [], werkbuch_access: [] });
    expect(runners.find((runner) => runner.name === 'build-01')?.equipment.werkbuch_access).toEqual(['werkbuch-mara']);
  });

  it('lets WEB-54 fail on a setup command, before the CLI', async () => {
    const [run] = (await getItemAgents('WEB-54')).runs;
    expect(run).toMatchObject({ status: 'failed', runner_name: 'mac-mini-alt' });
    expect(run.error).toContain('Setup-Befehl');
  });
});

describe('the agents\' steps of a workflow (spec 7.4)', () => {
  const standardInput = async () => {
    const workflow = (await listWorkflows()).items.find((entry) => entry.id === 'wf_standard')!;
    return { ...workflow, states: workflow.states.map(({ id, name, icon, category, position }) => ({ id, name, icon, category, position })) };
  };

  it('come with the workflow: WEB has them, APP (Agentur-Freigabe) not, so Kira is no agent there', async () => {
    const workflows = (await listWorkflows()).items;
    expect(workflows.find((entry) => entry.id === 'wf_standard')?.agent_states).toEqual({ working: 'std_progress', review: 'std_pending', correction: 'std_todo', merged: 'std_done' });
    expect(workflows.find((entry) => entry.id === 'wf_agency')?.agent_states.working).toBeNull();
  });

  it('refuse a category change of a status that holds a step, with the error at the status', async () => {
    const input = await standardInput();
    const index = input.states.findIndex((state) => state.id === 'std_pending');
    input.states[index] = { ...input.states[index], category: 'completed' };
    const refused = await failure(saveWorkflow(input));
    expect(refused.status).toBe(422);
    expect(Object.keys(refused.errors ?? {})).toEqual([`states.${index}.category`]);
  });

  it('follow the status mapping when a status that holds a step is removed, where the target fits', async () => {
    const input = await standardInput();
    input.states = input.states.filter((state) => state.id !== 'std_pending');
    const saved = await saveWorkflow(input, { state_mapping: { std_pending: 'std_progress' } });
    expect(saved.agent_states.review).toBe('std_progress');
    const again = await standardInput();
    again.states = again.states.filter((state) => state.id !== 'std_todo');
    const emptied = await saveWorkflow(again, { state_mapping: { std_todo: 'std_done' } });
    expect(emptied.agent_states.correction).toBeNull();
  });

  it('switch with the workflow: a project that changes to one without steps has its agents off', async () => {
    const counts = new Map<string, number>();
    for (const item of getDb().items.filter((entry) => entry.project_id === 'p_web')) counts.set(item.state_id, (counts.get(item.state_id) ?? 0) + 1);
    const mapping = Object.fromEntries([...counts.keys()].map((id) => [id, 'app_todo']));
    await assignWorkflow('p_web', 'wf_agency', mapping);
    await updateWorkItem('wi_web_50', { assignee_id: 'u_kira' });
    expect((await getItemAgents('WEB-50')).not_an_agent).toContain('Der Workflow „Agentur-Freigabe“ hat noch keine Agenten-Schritte');
  });
});

describe('the CLI of an agent on the runners (spec 8.8)', () => {
  it('lets Otto\'s run wait with the reason while no runner of his pool has Codex logged in, and starts it once one has', async () => {
    let [run] = (await getItemAgents('WEB-55')).runs;
    expect(run).toMatchObject({ status: 'waiting', runner_id: null, waiting_reason: 'Kein Runner im Pool hat Codex installiert und angemeldet.' });
    // build-01 has Codex installed, but not logged in: that is not enough
    tick(60_000);
    expect((await getItemAgents('WEB-55')).runs[0].status).toBe('waiting');

    const db = getDb();
    db.runners.find((runner) => runner.id === 'rn_build')!.clis.find((entry) => entry.cli === 'codex')!.logged_in = true;
    saveDb();
    tick(1000);
    [run] = (await getItemAgents('WEB-55')).runs;
    expect(run).toMatchObject({ status: 'running', runner_name: 'build-01', waiting_reason: null });
    // the stored log names the CLI of the agent
    expect(getDb().agent_runs.find((entry) => entry.id === run.id)!.log.some((line) => line.text.includes('Codex gestartet'))).toBe(true);
  });

  it('sends a run only to a runner with the CLI: a new task of Otto waits after the start delay', async () => {
    await updateWorkItem('wi_web_50', { assignee_id: 'u_otto' });
    expect((await getItemAgents('WEB-50')).runs[0].status).toBe('queued');
    tick(START_DELAY_MS + 1000);
    expect((await getItemAgents('WEB-50')).runs[0]).toMatchObject({ status: 'waiting', runner_id: null });
  });

  it('reports the CLIs of each runner', async () => {
    const build = (await listRunners()).items.find((runner) => runner.name === 'build-01')!;
    expect(build.clis).toEqual([
      { cli: 'claude', installed: true, version: '2.4.1', logged_in: true },
      { cli: 'codex', installed: true, version: '0.40.0', logged_in: false },
    ]);
  });
});

describe('agents have no limits of their own (spec 6.4, 9)', () => {
  it('saves a configuration without slots or time limits, and a model only from the list of the CLI', async () => {
    const kira = await getAgentConfig('u_kira');
    expect(kira).not.toHaveProperty('slots');
    expect(kira).not.toHaveProperty('timeouts');
    const refused = await failure(saveAgentConfig({ ...kira, model: 'claude-free-name' }));
    expect(Object.keys(refused.errors ?? {})).toEqual(['model']);
    const codex = await failure(saveAgentConfig({ ...kira, cli: 'codex' }));
    expect(Object.keys(codex.errors ?? {}).sort()).toEqual(['model', 'models.review']);
  });
});
