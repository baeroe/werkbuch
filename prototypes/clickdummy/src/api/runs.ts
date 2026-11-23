/*
 * Runs of agents at an item (WEBU-18, spec 6 and 7). The fake API plays the runner as well: a queued run starts four
 * seconds after it was queued on a free runner of the agent's pool, its log streams in line by line (a line shows once
 * the clock has passed its offset), and a cancel takes three seconds until the runner has stopped the CLI. These steps
 * happen when somebody reads (`advance`), so the screens see them by polling.
 *
 * What werkbuch does around a run follows the spec: assigning an item to an agent queues a `task` (or a `correction`
 * when the item has a strand already, and the brake starts over); assigning it to somebody else cancels what runs and
 * pauses the strand. Statuses are set by the agent bot with the reason „Agent: …“.
 */

import { afterFindings, CLI_NAMES, isActive, LIGHT_RUNS, pickModel, RUN_TYPE_NAMES, whyNotHere } from '@/domain/agents';
import { now as clockNow } from '@/lib/clock';
import { textDoc } from '@/lib/richtext';
import type { AgentCli, AgentRun, AgentThread, ItemAgentState, RunnerSlots, RunType, User, WorkItemRecord } from '@/types';
import { canSeeProject, requireWritable } from './access';
import { conflict, makeCtx, newId, notFound, read, write, type Ctx } from './client';
import { saveDb, type Db } from './db';
import { moveItem, patchItem } from './itemRules';
import { LOG_TEMPLATES, TASK_LOGS, type StoredRun, type StoredRunner } from './seed/agents';
import { findProject } from './lookup';
import { notifyPeople, recordEvent } from './events';
import { requireItem } from './workItems';

/** A queued run starts this long after it was queued, when a runner is free. */
export const START_DELAY_MS = 4_000;
/** How long a runner takes to stop the CLI after a cancel. */
export const CANCEL_DELAY_MS = 3_000;
/** After this long offline, another runner of the pool may take over a strand (spec 9). */
export const TAKEOVER_MS = 30 * 60_000;

const CODE_RUNS: readonly RunType[] = ['task', 'correction', 'conflict'];

export { isActive };

/** An online runner calls in every few seconds; its last contact is close to the clock. */
export function lastSeen(runner: StoredRunner, at: Date): string {
  return runner.online ? new Date(at.getTime() - 3_000).toISOString() : runner.last_seen_at;
}

const elapsed = (from: string, at: Date) => (at.getTime() - Date.parse(from)) / 1000;

function slug(title: string): string {
  return title
    .toLowerCase()
    .replaceAll('ä', 'ae')
    .replaceAll('ö', 'oe')
    .replaceAll('ü', 'ue')
    .replaceAll('ß', 'ss')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .split('-')
    .slice(0, 4)
    .join('-');
}

/* ------------------------------------------------------------------------- the runner */

function agentBot(db: Db, botId: string): User | undefined {
  return db.users.find((user) => user.id === botId);
}

/** The repo a run works in: the project's, or the project itself when it has none (a folder per strand). */
export function repoOf(db: Db, itemId: string): string {
  const item = db.items.find((entry) => entry.id === itemId);
  if (!item) return '';
  return db.project_agents.find((settings) => settings.project_id === item.project_id)?.repo ?? `project:${item.project_id}`;
}

/** Whether a runner can start runs with this CLI: installed and logged in (spec 8.8). */
export const hasCli = (runner: Pick<StoredRunner, 'clis'>, cli: AgentCli) => runner.clis.some((entry) => entry.cli === cli && entry.installed && entry.logged_in);

/** Whether any runner of a bot's pool, online or not, has its CLI; without one its runs wait with the reason. */
function poolHasCli(db: Db, botId: string): boolean {
  const config = db.agent_configs.find((entry) => entry.bot_id === botId);
  return Boolean(config && config.runner_ids.some((id) => db.runners.some((runner) => runner.id === id && hasCli(runner, config.cli))));
}

const busy = (run: StoredRun) => run.status === 'running' || run.status === 'canceling';

/**
 * What runs on a runner in each pot (spec 9): code runs in all, code runs of the busiest repo, light runs (`review`,
 * `comment`) in a pot of their own.
 */
export function slotsUsed(db: Db, runnerId: string): RunnerSlots {
  const runs = db.agent_runs.filter((run) => run.runner_id === runnerId && busy(run));
  const code = runs.filter((run) => !LIGHT_RUNS.includes(run.type));
  const perRepo = new Map<string, number>();
  for (const run of code) perRepo.set(repoOf(db, run.item_id), (perRepo.get(repoOf(db, run.item_id)) ?? 0) + 1);
  return { total: code.length, per_repo: Math.max(0, ...perRepo.values()), light: runs.length - code.length };
}

/**
 * A runner of the pool that is online and has a free slot for the run (spec 9): a light run in the pot of light runs,
 * a code run in all and in its repo. Every runner takes runs of every project (spec 8.4).
 */
function freeRunner(db: Db, run: StoredRun): StoredRunner | undefined {
  const config = db.agent_configs.find((entry) => entry.bot_id === run.bot_id);
  if (!config) return undefined;
  const thread = db.agent_threads.find((entry) => entry.id === run.thread_id);
  // a correction or comment at a strand goes to the strand's runner (spec 9)
  const pool = thread?.runner_id && run.type !== 'review' ? config.runner_ids.filter((id) => id === thread.runner_id) : config.runner_ids;
  const repo = repoOf(db, run.item_id);
  return pool
    .map((id) => db.runners.find((runner) => runner.id === id))
    .find((runner): runner is StoredRunner => {
      if (!runner?.online || !hasCli(runner, config.cli)) return false;
      const running = db.agent_runs.filter((other) => other.runner_id === runner.id && busy(other));
      if (LIGHT_RUNS.includes(run.type)) return running.filter((other) => LIGHT_RUNS.includes(other.type)).length < runner.slots.light;
      const code = running.filter((other) => !LIGHT_RUNS.includes(other.type));
      return code.length < runner.slots.total && code.filter((other) => repoOf(db, other.item_id) === repo).length < runner.slots.per_repo;
    });
}

/** A word of the title to search for, and a name for the test the story writes. */
function wordsOf(title: string): { word: string; test: string } {
  const word = title.split(/[^\p{L}\p{N}.]+/u).find((part) => part.length > 3) ?? title;
  const test = `${slug(word).replace(/(^|-)(\w)/g, (_match, _dash, letter: string) => letter.toUpperCase())}Test`;
  return { word, test };
}

/** The log a run writes: the story of its kind, or of its item when it has one, filled in for the item. */
function fillLog(run: StoredRun, item: WorkItemRecord, branch: string, cli: string) {
  const { word, test } = wordsOf(item.title);
  const template = run.type === 'task' ? (TASK_LOGS[item.key] ?? LOG_TEMPLATES.task) : LOG_TEMPLATES[run.type];
  return template.map((line) => ({
    ...line,
    text: line.text.replaceAll('{key}', item.key).replaceAll('{branch}', branch).replaceAll('{model}', run.model).replaceAll('{title}', item.title).replaceAll('{word}', word).replaceAll('{test}', test).replaceAll('Claude Code', cli),
  }));
}

/**
 * Plays the runners up to now: queued runs start, cancels finish. Returns whether anything changed. Sets the status
 * of an item when a code run starts (the agent bot, with the transition check; a forbidden move is left out).
 */
export function advance(db: Db, at: Date = clockNow()): boolean {
  let changed = false;
  for (const run of db.agent_runs) {
    // a run that waits for a CLI (no runner of its own) starts as soon as a runner of the pool has it (spec 8.8)
    const waitsForCli = run.status === 'waiting' && !run.runner_id;
    if ((run.status === 'queued' && at.getTime() - Date.parse(run.created_at) >= START_DELAY_MS) || waitsForCli) {
      if (!poolHasCli(db, run.bot_id)) {
        if (run.status === 'queued') {
          run.status = 'waiting';
          run.runner_id = null;
          changed = true;
        }
        continue;
      }
      const item = db.items.find((entry) => entry.id === run.item_id);
      const runner = item && freeRunner(db, run);
      if (!item || !runner) continue;
      const started = waitsForCli ? at : new Date(Date.parse(run.created_at) + START_DELAY_MS);
      const thread = db.agent_threads.find((entry) => entry.id === run.thread_id);
      run.runner_id = runner.id;
      if (thread && thread.runner_id === '') thread.runner_id = runner.id;
      run.started_at = started.toISOString();
      run.status = 'running';
      run.log = fillLog(run, item, thread?.branch ?? `agent/${item.key}`, CLI_NAMES[db.agent_configs.find((entry) => entry.bot_id === run.bot_id)?.cli ?? 'claude']);
      changed = true;
      const settings = db.project_agents.find((entry) => entry.project_id === item.project_id);
      const bot = agentBot(db, run.bot_id);
      const working = settings && db.workflows.find((workflow) => workflow.id === db.projects.find((project) => project.id === item.project_id)?.workflow_id)?.agent_states.working;
      if (bot && working && CODE_RUNS.includes(run.type) && item.state_id !== working) {
        try {
          moveItem(makeCtx(db, bot, started), bot, item, working, null, { reason: `Agent: Auftrag „${RUN_TYPE_NAMES[run.type]}“ gestartet` });
        } catch {
          // the workflow does not allow it: the status stays (spec 7.2)
        }
      }
    }
    if (run.status === 'canceling' && run.cancel_requested_at && at.getTime() - Date.parse(run.cancel_requested_at) >= CANCEL_DELAY_MS) {
      run.status = 'canceled';
      run.finished_at = new Date(Date.parse(run.cancel_requested_at) + CANCEL_DELAY_MS).toISOString();
      const who = run.canceled_by ? (db.users.find((user) => user.id === run.canceled_by)?.name ?? 'jemandem') : 'werkbuch';
      if (run.started_at) run.log.push({ offset: elapsed(run.started_at, new Date(run.finished_at)), kind: 'system', text: `Abgebrochen von ${who}. Der Runner hat Claude Code beendet (SIGTERM).` });
      changed = true;
    }
  }
  return changed;
}

/** Plays the runners and keeps what changed; reading the runs of an item is where the demo moves on. */
function advanceAndStore(db: Db): void {
  if (!advance(db)) return;
  try {
    saveDb();
  } catch {
    // storage full or blocked: the demo moves on in memory
  }
}

/* ------------------------------------------------------------------------- the views */

/** A run as the reader gets it: the log up to now and the runner's name. */
export function runView(db: Db, run: StoredRun, at: Date = clockNow()): AgentRun {
  const { cancel_requested_at: _cancel, ...rest } = run;
  const runner = db.runners.find((entry) => entry.id === run.runner_id);
  const shown = run.started_at === null ? [] : run.finished_at !== null ? run.log : run.log.filter((line) => Date.parse(run.started_at!) + line.offset * 1000 <= at.getTime());
  const config = db.agent_configs.find((entry) => entry.bot_id === run.bot_id);
  const waiting_reason = run.status === 'waiting' && !run.runner_id && config && !poolHasCli(db, run.bot_id) ? `Kein Runner im Pool hat ${CLI_NAMES[config.cli]} installiert und angemeldet.` : null;
  return { ...rest, waiting_reason, log: shown, runner_name: runner?.name ?? null, runner_online: runner?.online ?? false, runner_last_seen_at: runner ? lastSeen(runner, at) : null };
}

/** Why the assignee of an item does not work as an agent there; null when it does, or the assignee is a person. */
export function whyAssigneeIsNoAgent(db: Db, item: WorkItemRecord): string | null {
  const bot = db.users.find((user) => user.id === item.assignee_id);
  if (bot?.type !== 'bot') return null;
  const project = db.projects.find((entry) => entry.id === item.project_id)!;
  // an unauthorized merge pauses the agents of the whole project until a project admin confirms (spec 7.1)
  if (db.project_agents.find((entry) => entry.project_id === project.id)?.guard) {
    return `In ${project.identifier} ist ein eigenmächtiger Merge erkannt: Die Agenten pausieren, bis ein Projekt-Admin ihn unter Projekteinstellungen → Agenten bestätigt.`;
  }
  return whyNotHere(bot, db.agent_configs.find((entry) => entry.bot_id === bot.id) ?? null, {
    identifier: project.identifier,
    // a bot works where it is a member, never as a reader of a public project
    role: db.project_members.find((member) => member.project_id === project.id && member.user_id === bot.id)?.role ?? null,
    settings: db.project_agents.find((entry) => entry.project_id === project.id) ?? null,
    workflow: db.workflows.find((workflow) => workflow.id === project.workflow_id),
  });
}

/** Everything about agents at an item: strand, runs (oldest first), PRs, and why the assigned bot does no work here. */
export function getItemAgents(itemRef: string): Promise<ItemAgentState> {
  return read(({ db, me }) => {
    advanceAndStore(db);
    const { item } = requireItem(db, me, itemRef);
    const threads = db.agent_threads.filter((thread) => thread.item_id === item.id);
    const thread = threads.find((entry) => entry.status === 'open' || entry.status === 'paused') ?? threads.at(-1) ?? null;
    return {
      thread,
      runs: db.agent_runs.filter((run) => run.item_id === item.id).sort((a, b) => (a.created_at < b.created_at ? -1 : 1)).map((run) => runView(db, run)),
      pull_requests: db.pull_requests.filter((pr) => pr.item_id === item.id).sort((a, b) => b.number - a.number),
      not_an_agent: whyAssigneeIsNoAgent(db, item),
    };
  });
}

/* ---------------------------------------------------------------------- what werkbuch does */

function queueRun(ctx: Ctx, bot: User, item: WorkItemRecord, thread: AgentThread | null, type: RunType, attempt = 1): StoredRun {
  const { db, stamp } = ctx;
  const settings = db.project_agents.find((entry) => entry.project_id === item.project_id) ?? null;
  const config = db.agent_configs.find((entry) => entry.bot_id === bot.id)!;
  const parent = item.parent_id ? db.items.find((entry) => entry.id === item.parent_id) : undefined;
  const model = pickModel({ type, catalog: db.labels, labelIds: item.label_ids, epicLabelIds: parent?.label_ids ?? [], project: settings, agent: config });
  const offline = thread ? db.runners.find((runner) => runner.id === thread.runner_id && !runner.online) : undefined;
  const run: StoredRun = {
    id: newId('run'),
    type,
    status: offline ? 'waiting' : 'queued',
    bot_id: bot.id,
    runner_id: thread?.runner_id ?? null,
    item_id: item.id,
    thread_id: thread?.id ?? null,
    model: model.model,
    model_source: model.source,
    model_label_id: model.label_id,
    attempt,
    created_at: stamp,
    started_at: null,
    finished_at: null,
    result: null,
    error: null,
    usage: null,
    log: [],
    canceled_by: null,
    cancel_requested_at: null,
  };
  db.agent_runs.push(run);
  return run;
}

function cancelActive(ctx: Ctx, item: WorkItemRecord, by: string | null): void {
  cancelRuns(ctx, (run) => run.item_id === item.id, by);
}

/** Cancels what is active on a strand (GitHub disconnected). */
export function cancelThread(ctx: Ctx, threadId: string, by: string | null): void {
  cancelRuns(ctx, (run) => run.thread_id === threadId, by);
}

function cancelRuns(ctx: Ctx, which: (run: StoredRun) => boolean, by: string | null): void {
  for (const run of ctx.db.agent_runs) {
    if (!which(run) || !isActive(run) || run.status === 'canceling') continue;
    if (run.status === 'running') {
      run.status = 'canceling';
      run.cancel_requested_at = ctx.stamp;
      run.canceled_by = by;
    } else {
      run.status = 'canceled';
      run.finished_at = ctx.stamp;
      run.canceled_by = by;
    }
  }
}

/**
 * The assignee of an item changed (from `patchItem`). To an agent that works in the project: a `task` on a new strand,
 * or a `correction` on the strand the item has, and its brake starts over. Away from the agent to somebody else: what
 * runs is canceled and the strand pauses; the PR stays (spec 7.2, „Mensch greift ein“).
 */
export function onAssigneeChanged(ctx: Ctx, actor: User, item: WorkItemRecord, previous: string | null): void {
  const { db } = ctx;
  const thread = db.agent_threads.find((entry) => entry.item_id === item.id && (entry.status === 'open' || entry.status === 'paused')) ?? null;
  const left = db.users.find((user) => user.id === previous);
  if (left?.type === 'bot' && thread && thread.bot_id === left.id && actor.id !== left.id) {
    cancelActive(ctx, item, actor.id);
    thread.status = 'paused';
    delete thread.pause_reason;
  }
  const bot = db.users.find((user) => user.id === item.assignee_id);
  if (bot?.type !== 'bot') return;
  if (whyAssigneeIsNoAgent(db, item) !== null) {
    // an unauthorized merge holds the project: the assignment is remembered and started when it is confirmed
    const guard = db.project_agents.find((settings) => settings.project_id === item.project_id)?.guard;
    if (guard && !guard.held_item_ids.includes(item.id)) guard.held_item_ids.push(item.id);
    return;
  }
  if (thread && thread.bot_id === bot.id) {
    thread.status = 'open';
    delete thread.pause_reason;
    thread.corrections = 1;
    thread.conflicts = 0;
    queueRun(ctx, bot, item, thread, 'correction');
    return;
  }
  // the strand gets its runner when its first run starts
  const created: AgentThread = { id: newId('th'), item_id: item.id, bot_id: bot.id, runner_id: '', branch: `agent/${item.key}-${slug(item.title)}`, status: 'open', corrections: 0, conflicts: 0, pr_number: null };
  db.agent_threads.push(created);
  queueRun(ctx, bot, item, created, 'task');
}

function findRun(db: Db, id: string): StoredRun {
  const run = db.agent_runs.find((entry) => entry.id === id);
  if (!run) throw notFound('Der Auftrag');
  return run;
}

/** Cancels a run (whoever may change the item): a running one stops within seconds, a waiting one at once. */
export function cancelRun(id: string): Promise<AgentRun> {
  return write((ctx) => {
    advance(ctx.db, ctx.now);
    const run = findRun(ctx.db, id);
    const { project } = requireItem(ctx.db, ctx.me, run.item_id);
    requireWritable(ctx.db, ctx.me, project, 'member', 'Aufträge abbrechen darf, wer das Item bearbeiten darf.');
    if (!isActive(run)) throw conflict('run_finished', 'Der Auftrag ist schon beendet.');
    if (run.status !== 'canceling') {
      if (run.status === 'running') {
        run.status = 'canceling';
        run.cancel_requested_at = ctx.stamp;
      } else {
        run.status = 'canceled';
        run.finished_at = ctx.stamp;
      }
      run.canceled_by = ctx.me.id;
    }
    return runView(ctx.db, run, ctx.now);
  });
}

/**
 * Starts a run again that failed, ran out of time, got lost or was canceled: the same kind on the same strand, as the
 * next attempt. The brake is not reset (spec 7.2). Only while the item is still with the bot and its strand is not
 * paused: a strand goes on after a person took over only by assigning the item to the bot again (spec 7.2).
 */
export function retryRun(id: string): Promise<AgentRun> {
  return write((ctx) => {
    advance(ctx.db, ctx.now);
    const run = findRun(ctx.db, id);
    const { item, project } = requireItem(ctx.db, ctx.me, run.item_id);
    requireWritable(ctx.db, ctx.me, project, 'member', 'Aufträge erneut starten darf, wer das Item bearbeiten darf.');
    if (isActive(run) || run.status === 'succeeded') throw conflict('run_not_failed', 'Nur gescheiterte oder abgebrochene Aufträge lassen sich erneut starten.');
    if (ctx.db.agent_runs.some((other) => other.item_id === item.id && isActive(other))) throw conflict('run_active', `An ${item.key} läuft schon ein Auftrag.`);
    const bot = agentBot(ctx.db, run.bot_id)!;
    const thread = ctx.db.agent_threads.find((entry) => entry.id === run.thread_id) ?? null;
    if (item.assignee_id !== bot.id || thread?.status === 'paused') {
      throw conflict('not_assigned', `${item.key} ist nicht mehr bei ${bot.name}. Weise es wieder ${bot.name} zu, dann macht ${bot.name} mit einer Korrektur weiter.`);
    }
    if (thread) thread.status = 'open';
    const attempts = ctx.db.agent_runs.filter((other) => other.thread_id === run.thread_id && other.type === run.type).length;
    return runView(ctx.db, queueRun(ctx, bot, item, thread, run.type, attempts + 1), ctx.now);
  });
}

/**
 * Goes on with a strand that paused when GitHub was disconnected while the item stayed with the bot: a correction on
 * the strand, and the brake counts on (spec 7.2): when the strand has used up its corrections, it stays paused and the
 * item goes to the bot's responsible person, as after any brake. Only once the project has a repo again.
 */
export function resumeThread(itemRef: string): Promise<{ run: AgentRun | null; braked: boolean }> {
  return write((ctx) => {
    advance(ctx.db, ctx.now);
    const { item, project } = requireItem(ctx.db, ctx.me, itemRef);
    requireWritable(ctx.db, ctx.me, project, 'member', 'Weitermachen lassen darf, wer das Item bearbeiten darf.');
    const thread = ctx.db.agent_threads.find((entry) => entry.item_id === item.id && entry.status === 'paused' && entry.pause_reason === 'github');
    if (!thread || item.assignee_id !== thread.bot_id) throw conflict('nothing_to_resume', `${item.key} hat keinen Strang, der wegen GitHub pausiert.`);
    if (!ctx.db.project_agents.find((settings) => settings.project_id === item.project_id)?.repo) {
      throw conflict('no_repo', `${project.identifier} hat noch kein Repo. Verbinde GitHub und wähle unter Agenten ein Repo, dann geht es weiter.`);
    }
    const why = whyAssigneeIsNoAgent(ctx.db, item);
    if (why) throw conflict('not_an_agent', why);
    const settings = ctx.db.project_agents.find((entry) => entry.project_id === item.project_id)!;
    const bot = agentBot(ctx.db, thread.bot_id)!;
    const decision = afterFindings(thread, settings, 'correction');
    delete thread.pause_reason;
    if (decision.next === 'paused') {
      // the brake: the strand stays paused, the item goes to the responsible person (assigned by the bot itself, so
      // nothing is canceled twice)
      const owner = ctx.db.users.find((user) => user.id === bot.owner_id);
      if (owner) patchItem(ctx, bot, item, { assignee_id: owner.id }, { reason: `Agent: Bremse nach ${decision.max} Korrekturen` });
      return { run: null, braked: true };
    }
    thread.status = 'open';
    thread.corrections = decision.used;
    return { run: runView(ctx.db, queueRun(ctx, bot, item, thread, 'correction'), ctx.now), braked: false };
  });
}

/** Whether the reader may see the item of a run; runs are listed per item only. */
export function runVisible(db: Db, me: User, run: StoredRun): boolean {
  const item = db.items.find((entry) => entry.id === run.item_id);
  const project = item && db.projects.find((entry) => entry.id === item.project_id);
  return Boolean(project && canSeeProject(db, me, project));
}

/* ---------------------------------------------------------------- unauthorized merge */

/** The strands of a project, by the items they belong to. */
function threadsOf(db: Db, projectId: string): AgentThread[] {
  const items = new Set(db.items.filter((item) => item.project_id === projectId).map((item) => item.id));
  return db.agent_threads.filter((thread) => items.has(thread.item_id));
}

/**
 * Only in the click dummy: plays what the webhook would tell werkbuch, a push of the app to the base branch that no
 * merge of werkbuch explains (spec 7.1). Every open strand of the project pauses and what runs is canceled; the push
 * is told to have come from the running code run of the project, if there is one.
 */
export function simulateUnauthorizedMerge(projectId: string): Promise<{ paused: number }> {
  return write((ctx) => {
    const { db, me, stamp } = ctx;
    const project = findProject(db, projectId);
    if (!project) throw notFound('Das Projekt');
    requireWritable(db, me, project, 'admin', 'Nur Projekt-Admins.');
    const settings = db.project_agents.find((entry) => entry.project_id === project.id);
    if (!settings?.repo) throw conflict('no_repo', `${project.identifier} hat kein Repo: ohne Basis-Branch gibt es keinen Merge.`);
    const threads = threadsOf(db, project.id);
    const pusher = db.agent_runs.find((run) => run.status === 'running' && CODE_RUNS.includes(run.type) && threads.some((thread) => thread.id === run.thread_id));
    const item = pusher ? db.items.find((entry) => entry.id === pusher.item_id) : undefined;
    settings.guard = { detected_at: stamp, branch: settings.base_branch, sha: 'a41c9e7', item_id: item?.id ?? null, item_key: item?.key ?? null, bot_id: pusher?.bot_id ?? null, held_item_ids: [] };
    // werkbuch says so at the item the push came from and tells the org admins (spec 11.3)
    if (item && pusher) {
      const system = db.users.find((user) => user.is_default_bot)!;
      const text = `werkbuch hat auf ${settings.base_branch} einen Push der App erkannt (a41c9e7), den kein Merge von werkbuch erklärt, aus dem Auftrag ${RUN_TYPE_NAMES[pusher.type]} dieses Items. Alle Stränge von ${project.identifier} pausieren, bis ein Projekt-Admin den Merge in den Projekteinstellungen unter Agenten bestätigt.`;
      const comment = { id: newId('c'), work_item_id: item.id, author_id: system.id, body: textDoc(text), created_at: stamp, edited_at: null, reactions: [], run_id: pusher.id };
      db.comments.push(comment);
      const event = recordEvent(ctx, { type: 'comment.created', actor_id: system.id, subject: { type: 'work_item', id: item.id }, project_id: project.id, changes: { comment_id: { old: null, new: comment.id } } });
      const admins = db.users.filter((user) => user.type === 'person' && user.org_role === 'admin').map((user) => user.id);
      notifyPeople(ctx, { event: 'comment', actor_id: system.id, event_id: event.id, item, recipients: admins, data: { excerpt: text, comment_id: comment.id } });
    }
    let paused = 0;
    for (const thread of threads) {
      if (thread.status !== 'open') continue;
      thread.status = 'paused';
      thread.pause_reason = 'guard';
      cancelThread(ctx, thread.id, null);
      paused += 1;
    }
    return { paused };
  });
}

/**
 * A project admin confirms the unauthorized merge was looked at (spec 7.1). The guard goes; then every item of the
 * project that is with an agent and has no run gets what an assignment would have started meanwhile: a strand the
 * guard paused goes on with a correction (the brake counts on: used up, the item goes to the responsible person); a
 * strand of the same bot paused by a person going back and forth goes on as after an assignment; an item without its
 * bot's strand starts one with a task. Strands GitHub paused wait for "Weitermachen"; other paused strands stay.
 */
export function confirmMergeGuard(projectId: string): Promise<{ resumed: number }> {
  return write((ctx) => {
    const { db, me } = ctx;
    const project = findProject(db, projectId);
    if (!project) throw notFound('Das Projekt');
    requireWritable(db, me, project, 'admin', 'Einen eigenmächtigen Merge bestätigen nur Admins des Projekts.');
    const settings = db.project_agents.find((entry) => entry.project_id === project.id);
    if (!settings?.guard) throw conflict('nothing_to_confirm', 'Es gibt keinen eigenmächtigen Merge zu bestätigen.');
    // only what the guard held back: strands it paused and items assigned to an agent meanwhile; a merged or closed
    // item that stays with its bot (spec 7.2) gets nothing
    const held = new Set([...settings.guard.held_item_ids, ...threadsOf(db, project.id).filter((thread) => thread.pause_reason === 'guard').map((thread) => thread.item_id)]);
    settings.guard = null;
    // without a repo (chosen away meanwhile) the paused strands wait as after a disconnect of GitHub; what was assigned
    // meanwhile starts as without the guard, in a folder
    if (!settings.repo) {
      const paused = new Set<string>();
      for (const thread of threadsOf(db, project.id)) {
        if (thread.pause_reason !== 'guard') continue;
        thread.pause_reason = 'github';
        paused.add(thread.item_id);
      }
      let started = 0;
      for (const item of db.items.filter((entry) => held.has(entry.id) && !paused.has(entry.id))) {
        const bot = agentBot(db, item.assignee_id ?? '');
        if (bot?.type !== 'bot' || whyAssigneeIsNoAgent(db, item) !== null) continue;
        if (db.agent_runs.some((run) => run.item_id === item.id && isActive(run) && run.status !== 'canceling')) continue;
        onAssigneeChanged(ctx, me, item, null);
        started += 1;
      }
      return { resumed: started };
    }
    let resumed = 0;
    for (const item of db.items.filter((entry) => held.has(entry.id))) {
      const guarded = db.agent_threads.find((entry) => entry.item_id === item.id && entry.status === 'paused' && entry.pause_reason === 'guard');
      if (guarded) delete guarded.pause_reason;
      const bot = agentBot(db, item.assignee_id ?? '');
      if (bot?.type !== 'bot' || whyAssigneeIsNoAgent(db, item) !== null) continue;
      // a run the guard canceled may still be stopping: it does not hold the strand back
      if (db.agent_runs.some((run) => run.item_id === item.id && isActive(run) && run.status !== 'canceling')) continue;
      const thread = db.agent_threads.find((entry) => entry.item_id === item.id && (entry.status === 'open' || entry.status === 'paused')) ?? null;
      if (thread?.pause_reason === 'github') continue;
      if (thread && thread.bot_id === bot.id && thread === guarded) {
        const decision = afterFindings(thread, settings, 'correction');
        if (decision.next === 'paused') {
          const owner = db.users.find((user) => user.id === bot.owner_id);
          if (owner) patchItem(ctx, bot, item, { assignee_id: owner.id }, { reason: `Agent: Bremse nach ${decision.max} Korrekturen` });
          continue;
        }
        thread.status = 'open';
        thread.corrections = decision.used;
        queueRun(ctx, bot, item, thread, 'correction');
      } else {
        // what onAssigneeChanged would have done while the guard held the project
        onAssigneeChanged(ctx, me, item, null);
      }
      resumed += 1;
    }
    return { resumed };
  });
}
