/*
 * The fake API of the runner and the agents (WEBU-18): what an assignment starts, how the demo runner moves a run on,
 * cancel and retry, the brake given back, a bot without an agent, the checks of the project settings and pairing.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { now } from '@/lib/clock';
import { asUser, failure, resetApi } from '@/test/api';
import { getProjectAgents, listAgentProjects, saveAgentConfig, getAgentConfig, saveProjectAgents } from './agents';
import { getDb, saveDb } from './db';
import { createPairing, expirePairing, listRunners, revokeRunner, simulatePairing } from './runners';
import { advance, CANCEL_DELAY_MS, cancelRun, getItemAgents, retryRun, START_DELAY_MS } from './runs';
import { listActivity, updateWorkItem } from './workItems';

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

    expect(tick(START_DELAY_MS + 100)).toBe(true);
    state = await getItemAgents('WEB-50');
    expect(state.runs[0]).toMatchObject({ status: 'running', runner_name: 'mac-studio', runner_online: true });
    expect(getDb().items.find((item) => item.key === 'WEB-50')?.state_id).toBe('std_progress');
    const moved = (await listActivity('WEB-50')).items.find((entry) => entry.kind === 'event' && entry.event.type === 'work_item.state_changed');
    expect(moved?.kind === 'event' && moved.event).toMatchObject({ actor_id: 'u_kira', reason: 'Agent: Auftrag „Umsetzen“ gestartet' });
  });

  it('takes the model of a label the item carries (SEO → haiku in WEB)', async () => {
    await updateWorkItem('wi_web_50', { assignee_id: 'u_kira', label_ids: ['lb_seo'] });
    expect((await getItemAgents('WEB-50')).runs[0]).toMatchObject({ model: 'haiku', model_source: 'label', model_label_id: 'lb_seo' });
  });

  it('cancels a running run in two steps and lets it start again as the next attempt', async () => {
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

  it('keeps a run waiting for the offline runner of its strand', async () => {
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
  it('check the category of each step and refuse half a mapping', async () => {
    const settings = await getProjectAgents('p_web');
    const refused = await failure(saveProjectAgents({ ...settings, states: { ...settings.states, working: 'std_todo', merged: 'std_cancelled' } }));
    expect(refused.status).toBe(422);
    expect(Object.keys(refused.errors ?? {}).sort()).toEqual(['states.merged', 'states.working']);

    const ops = await getProjectAgents('p_ops');
    expect(ops.states).toEqual({ working: null, review: null, correction: null, merged: null });
    const half = await failure(saveProjectAgents({ ...ops, states: { ...ops.states, working: 'std_progress' } }));
    expect(Object.keys(half.errors ?? {}).sort()).toEqual(['states.correction', 'states.merged', 'states.review']);
  });

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

describe('runners', () => {
  it('pair with a code that is valid once and for ten minutes', async () => {
    const pairing = await createPairing();
    expect(pairing.command).toBe(`curl -fsSL https://werkbuch.example.com/runner/install.sh | sh -s -- --code ${pairing.code}`);
    expect(Date.parse(pairing.expires_at) - now().getTime()).toBeGreaterThan(9 * 60_000);

    const runner = await simulatePairing(pairing.code);
    expect(runner).toMatchObject({ name: 'mac-mini-buero', online: true, projects: [] });
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
