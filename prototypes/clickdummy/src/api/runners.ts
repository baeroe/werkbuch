/*
 * Runners (WEBU-18, spec 6.2 and 10.1), managed by org admins. Pairing: a one-time code, valid for ten minutes and
 * redeemed once, inside the command that installs the runner. The demo cannot run the script, so two tools stand in
 * for the machine: `simulatePairing` (the runner redeems the code) and `expirePairing` (ten minutes pass).
 */

import { DEMO_ORIGIN } from '@/lib/links';
import type { Runner, RunnerPairing, RunnerSlots } from '@/types';
import { requireOrgAdmin } from './access';
import { conflict, FieldErrors, newId, notFound, paginate, read, write, type Page } from './client';
import type { Db } from './db';
import { advance, isActive, lastSeen, slotsUsed } from './runs';
import { RUNNER_VERSION, type StoredPairing, type StoredRunner } from './seed/agents';

export const PAIRING_MS = 10 * 60_000;

/** The slots of a new runner (spec 9). */
export const DEFAULT_SLOTS: RunnerSlots = { total: 2, per_repo: 1, light: 2 };
/** The most slots a pot takes; more is rarely what a machine can carry. */
export const MAX_SLOTS = 16;

/** The install command of a code. The demo has no instance of its own, so it names the made-up one. */
export const installCommand = (code: string) => `curl -fsSL ${DEMO_ORIGIN}/runner/install.sh | sh -s -- --code ${code}`;

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function newCode(): string {
  const part = () => Array.from({ length: 4 }, () => ALPHABET[Math.floor(Math.random() * ALPHABET.length)]).join('');
  return `${part()}-${part()}`;
}

function runnerView(db: Db, runner: StoredRunner, at: Date): Runner {
  const active_runs = db.agent_runs
    .filter((run) => run.runner_id === runner.id && isActive(run))
    .map((run) => {
      const item = db.items.find((entry) => entry.id === run.item_id)!;
      return { id: run.id, type: run.type, status: run.status, item_id: item.id, item_key: item.key, item_title: item.title, started_at: run.started_at };
    });
  const seen = lastSeen(runner, at);
  const missing_mcp = db.mcp_servers.filter((server) => runner.missing_mcp.includes(server.id)).map((server) => ({ id: server.id, name: server.name }));
  return { ...runner, last_seen_at: seen, slots_used: slotsUsed(db, runner.id), load: { ...runner.load, measured_at: seen }, missing_mcp, active_runs };
}

const pairingView = (pairing: StoredPairing): RunnerPairing => ({ code: pairing.code, command: installCommand(pairing.code), expires_at: pairing.expires_at, runner_id: pairing.runner_id });

/** The runners of the organisation: online ones first, then by name. */
export function listRunners(): Promise<Page<Runner>> {
  return read(({ db, me, now }) => {
    requireOrgAdmin(me, 'Runner sehen nur Org-Admins.');
    advance(db, now);
    const sorted = [...db.runners].sort((a, b) => Number(b.online) - Number(a.online) || a.name.localeCompare(b.name, 'de'));
    return paginate(sorted.map((runner) => runnerView(db, runner, now)));
  });
}

/** A new code; codes that were not redeemed yet stop working. */
export function createPairing(): Promise<RunnerPairing> {
  return write(({ db, me, now }) => {
    requireOrgAdmin(me, 'Runner verbinden dürfen nur Org-Admins.');
    db.runner_pairings = db.runner_pairings.filter((pairing) => pairing.runner_id !== null);
    const pairing: StoredPairing = { code: newCode(), expires_at: new Date(now.getTime() + PAIRING_MS).toISOString(), runner_id: null, created_by: me.id };
    db.runner_pairings.push(pairing);
    return pairingView(pairing);
  });
}

export function getPairing(code: string): Promise<RunnerPairing> {
  return read(({ db, me }) => {
    requireOrgAdmin(me, 'Runner verbinden dürfen nur Org-Admins.');
    const pairing = db.runner_pairings.find((entry) => entry.code === code);
    if (!pairing) throw notFound('Der Code');
    return pairingView(pairing);
  });
}

/** Demo: the runner on the machine redeems the code (what `werkbuch-runner login` does). */
export function simulatePairing(code: string, name = 'mac-mini-buero'): Promise<Runner> {
  return write(({ db, me, now, stamp }) => {
    requireOrgAdmin(me);
    const pairing = db.runner_pairings.find((entry) => entry.code === code);
    if (!pairing) throw notFound('Der Code');
    if (pairing.runner_id !== null) throw conflict('code_used', 'Der Code ist schon eingelöst.');
    if (Date.parse(pairing.expires_at) <= now.getTime()) throw conflict('code_expired', 'Der Code ist abgelaufen. Erzeuge einen neuen.');
    const taken = new Set(db.runners.map((runner) => runner.name));
    let unique = name;
    for (let n = 2; taken.has(unique); n += 1) unique = `${name}-${n}`;
    const runner: StoredRunner = {
      id: newId('rn'),
      name: unique,
      os: 'darwin',
      arch: 'arm64',
      version: RUNNER_VERSION,
      online: true,
      last_seen_at: stamp,
      slots: { ...DEFAULT_SLOTS },
      load: { cpu: 3, gpu: 1, ram_used: 7.4, ram_total: 24, disk_free: 311, disk_total: 460 },
      missing_mcp: [],
      update_error: null,
      created_at: stamp,
    };
    db.runners.push(runner);
    pairing.runner_id = runner.id;
    return runnerView(db, runner, now);
  });
}

/** Demo: ten minutes pass for a code. */
export function expirePairing(code: string): Promise<RunnerPairing> {
  return write(({ db, me, now }) => {
    requireOrgAdmin(me);
    const pairing = db.runner_pairings.find((entry) => entry.code === code);
    if (!pairing) throw notFound('Der Code');
    pairing.expires_at = new Date(now.getTime() - 1000).toISOString();
    return pairingView(pairing);
  });
}

export function renameRunner(id: string, name: string): Promise<Runner> {
  return write(({ db, me, now }) => {
    requireOrgAdmin(me, 'Runner verwalten nur Org-Admins.');
    const runner = db.runners.find((entry) => entry.id === id);
    if (!runner) throw notFound('Der Runner');
    const errors = new FieldErrors();
    const trimmed = name.trim();
    if (trimmed === '') errors.add('name', 'Gib dem Runner einen Namen.');
    else if (trimmed.length > 64) errors.add('name', 'Höchstens 64 Zeichen.');
    else if (db.runners.some((entry) => entry.id !== id && entry.name.toLowerCase() === trimmed.toLowerCase())) errors.add('name', `Ein anderer Runner heißt schon „${trimmed}“.`);
    errors.throwIfAny();
    runner.name = trimmed;
    return runnerView(db, runner, now);
  });
}

/**
 * Sets the slots of a runner (spec 8.4): code runs in all and per repo (at most as many as in all), light runs. The
 * runner gets them with its next contact; what runs keeps running, a lower number only holds back new runs.
 */
export function saveRunnerSlots(id: string, slots: RunnerSlots): Promise<Runner> {
  return write(({ db, me, now }) => {
    requireOrgAdmin(me, 'Runner verwalten nur Org-Admins.');
    const runner = db.runners.find((entry) => entry.id === id);
    if (!runner) throw notFound('Der Runner');
    const errors = new FieldErrors();
    const whole = (value: number) => Number.isInteger(value) && value >= 1 && value <= MAX_SLOTS;
    if (!whole(slots.total)) errors.add('total', `Eine ganze Zahl von 1 bis ${MAX_SLOTS}.`);
    if (!whole(slots.per_repo)) errors.add('per_repo', `Eine ganze Zahl von 1 bis ${MAX_SLOTS}.`);
    else if (whole(slots.total) && slots.per_repo > slots.total) errors.add('per_repo', 'Höchstens so viele wie gesamt.');
    if (!whole(slots.light)) errors.add('light', `Eine ganze Zahl von 1 bis ${MAX_SLOTS}.`);
    errors.throwIfAny();
    runner.slots = { total: slots.total, per_repo: slots.per_repo, light: slots.light };
    advance(db, now);
    return runnerView(db, runner, now);
  });
}

/**
 * Revokes a runner: its token stops working, what runs on it is canceled, waiting runs go back to the queue for the
 * rest of the pool (spec 6.2). Answers how many runs were canceled.
 */
export function revokeRunner(id: string): Promise<{ canceled: number }> {
  return write(({ db, me, stamp }) => {
    requireOrgAdmin(me, 'Runner verwalten nur Org-Admins.');
    if (!db.runners.some((entry) => entry.id === id)) throw notFound('Der Runner');
    let canceled = 0;
    for (const run of db.agent_runs) {
      if (run.runner_id !== id || !isActive(run)) continue;
      if (run.status === 'running' || run.status === 'canceling') {
        run.status = 'canceled';
        run.finished_at = stamp;
        run.canceled_by = me.id;
        run.error = 'Der Runner wurde widerrufen.';
        canceled += 1;
      } else {
        run.status = 'queued';
        run.runner_id = null;
      }
    }
    for (const thread of db.agent_threads) if (thread.runner_id === id) thread.runner_id = '';
    db.runners = db.runners.filter((entry) => entry.id !== id);
    for (const config of db.agent_configs) config.runner_ids = config.runner_ids.filter((entry) => entry !== id);
    return { canceled };
  });
}
