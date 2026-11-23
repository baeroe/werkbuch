/*
 * The rules of the agents (spec `2026-11-23-runner-design.md`), as pure functions: they are ported to PHP later.
 * - `mappingErrors`: the status each step of the flow sets has to be of the right category; the steps belong to the
 *   workflow (7.4), `stepsAfterSave` says what becomes of them when statuses are removed.
 * - `pickModel`: the model of a run; a model label of the item, then the project per kind of run, then the bot (7.7).
 * - `afterFindings`: what CI red or review findings lead to: a correction, or the brake when the strand has had
 *   enough (7.2).
 * - `whyNoAgent`: why a bot cannot be an agent at all, or not in a project (7.2, 7.4, 10.4).
 */

import type { AgentConfig, AgentRun, AgentStep, AgentThread, Label, ProjectAgents, ProjectRole, RunType, State, StateCategory, User, Workflow } from '@/types';

/** The CLIs an agent can run with, by name. */
export const CLI_NAMES: Record<AgentConfig['cli'], string> = { claude: 'Claude Code', codex: 'Codex' };

export const RUN_TYPES: readonly RunType[] = ['task', 'correction', 'conflict', 'review', 'comment'];

export const RUN_TYPE_NAMES: Record<RunType, string> = {
  task: 'Umsetzen',
  correction: 'Korrektur',
  conflict: 'Konflikt lösen',
  review: 'Review',
  comment: 'Antwort',
};

/** What a kind of run is for, in one sentence (settings, tooltips). */
export const RUN_TYPE_HINTS: Record<RunType, string> = {
  task: 'Das Item umsetzen und einen PR öffnen. Startet, wenn ein Item dem Bot zugewiesen wird.',
  correction: 'Befunde aus CI oder Review abarbeiten und auf denselben PR pushen.',
  conflict: 'Die Basis in den Branch mergen und die Konflikte lösen.',
  review: 'Einen PR prüfen, sobald CI grün ist. Nur lesen; werkbuch gibt frei und mergt.',
  comment: 'Eine Frage beantworten, wenn jemand den Bot in einem Kommentar erwähnt. Nur lesen.',
};

/** Runs that still have to happen or happen now. */
const ACTIVE: readonly AgentRun['status'][] = ['queued', 'waiting', 'running', 'canceling'];
export const isActive = (run: Pick<AgentRun, 'status'>) => ACTIVE.includes(run.status);

/** `review` and `comment` only read: they come out of the runner's pot of light runs (spec 9). */
export const LIGHT_RUNS: readonly RunType[] = ['review', 'comment'];

/**
 * Minutes a run of each kind may take (spec 6.4): fixed, not a setting. Past it a run ends as "Zeitlimit erreicht" and
 * the item goes to "Korrektur".
 */
export const RUN_TIMEOUTS: Record<RunType, number> = { task: 60, correction: 60, conflict: 30, review: 20, comment: 10 };

/* ------------------------------------------------------------------- status steps */

export const AGENT_STEPS: readonly AgentStep[] = ['working', 'review', 'correction', 'merged'];

export const STEP_NAMES: Record<AgentStep, string> = {
  working: 'In Arbeit',
  review: 'In Review',
  correction: 'Korrektur',
  merged: 'Gemergt',
};

export const STEP_HINTS: Record<AgentStep, string> = {
  working: 'Sobald ein Auftrag startet.',
  review: 'Sobald der PR offen ist; bis zum Merge.',
  correction: 'Bei CI rot, Befunden im Review, einem gescheiterten Auftrag oder der Bremse.',
  merged: 'Nach dem Merge; ohne Repo nach Abschluss.',
};

/** The categories a step accepts (spec 7.4). */
export const STEP_CATEGORIES: Record<AgentStep, readonly StateCategory[]> = {
  working: ['started'],
  review: ['started'],
  correction: ['unstarted', 'backlog'],
  merged: ['completed'],
};

const CATEGORY_NAMES: Record<StateCategory, string> = {
  backlog: 'Backlog',
  unstarted: 'Unstarted',
  started: 'Started',
  completed: 'Completed',
  canceled: 'Canceled',
};

/** "Started", "Unstarted oder Backlog". */
export function categoriesText(categories: readonly StateCategory[]): string {
  return categories.map((category) => CATEGORY_NAMES[category]).join(' oder ');
}

/**
 * The error per step whose status does not fit: a category the step does not accept, or a status that is not in the
 * workflow (any more, after a change of workflow). A step without a status is no error here; `mappingComplete` says
 * whether all are set.
 */
export function mappingErrors(workflow: Workflow, states: Record<AgentStep, string | null>): Partial<Record<AgentStep, string>> {
  const errors: Partial<Record<AgentStep, string>> = {};
  for (const step of AGENT_STEPS) {
    const id = states[step];
    if (id === null) continue;
    const state = workflow.states.find((entry) => entry.id === id);
    if (!state) {
      errors[step] = `Diesen Status gibt es im Workflow „${workflow.name}“ nicht mehr. Wähle einen neuen.`;
      continue;
    }
    const allowed = STEP_CATEGORIES[step];
    if (!allowed.includes(state.category)) {
      errors[step] = `„${state.name}“ ist ${CATEGORY_NAMES[state.category]}. „${STEP_NAMES[step]}“ braucht einen Status der Kategorie ${categoriesText(allowed)}.`;
    }
  }
  return errors;
}

/** All four steps have a status that fits: only then do agents work in the project. */
export function mappingComplete(workflow: Workflow, states: Record<AgentStep, string | null>): boolean {
  return AGENT_STEPS.every((step) => states[step] !== null) && Object.keys(mappingErrors(workflow, states)).length === 0;
}

/** The steps of a workflow that have no status yet. */
export function missingSteps(workflow: Pick<Workflow, 'agent_states'>): AgentStep[] {
  return AGENT_STEPS.filter((step) => workflow.agent_states[step] === null);
}

/**
 * The steps after a workflow is saved with statuses removed (spec 7.4): a step whose status stays keeps it; a step
 * whose status goes follows the status mapping of the save when its target fits the step's category, otherwise it is
 * empty, and agents are off in the projects of the workflow until somebody chooses one.
 */
export function stepsAfterSave(states: Record<AgentStep, string | null>, kept: readonly Pick<State, 'id' | 'category'>[], mapping: Record<string, string> = {}): Record<AgentStep, string | null> {
  const next = {} as Record<AgentStep, string | null>;
  for (const step of AGENT_STEPS) {
    const old = states[step];
    if (old === null || kept.some((state) => state.id === old)) {
      next[step] = old;
      continue;
    }
    const target = kept.find((state) => state.id === mapping[old]);
    next[step] = target && STEP_CATEGORIES[step].includes(target.category) ? target.id : null;
  }
  return next;
}

/**
 * Per status that holds a step but no longer has a category the step accepts: the error the status shows (a change
 * of category in the workflow editor).
 */
export function boundStateErrors(states: readonly Pick<State, 'id' | 'name' | 'category'>[], steps: Record<AgentStep, string | null>): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const step of AGENT_STEPS) {
    const state = states.find((entry) => entry.id === steps[step]);
    if (!state || STEP_CATEGORIES[step].includes(state.category) || errors[state.id]) continue;
    errors[state.id] = `„${state.name.trim() || 'Dieser Status'}“ ist der Agenten-Schritt „${STEP_NAMES[step]}“ und braucht die Kategorie ${categoriesText(STEP_CATEGORIES[step])}. Wähle für den Schritt unten zuerst einen anderen Status.`;
  }
  return errors;
}

/** A first guess per step for a workflow: the first status of a fitting category, "In Review" by name if there is one. */
export function suggestMapping(workflow: Workflow): Record<AgentStep, string | null> {
  const fitting = (step: AgentStep): State[] => workflow.states.filter((state) => STEP_CATEGORIES[step].includes(state.category)).sort((a, b) => a.position - b.position);
  const started = fitting('working');
  const review = started.find((state) => /review/i.test(state.name)) ?? started[1] ?? started[0];
  const correction = fitting('correction').find((state) => state.category === 'unstarted') ?? fitting('correction')[0];
  return {
    working: started[0]?.id ?? null,
    review: review?.id ?? null,
    correction: correction?.id ?? null,
    merged: fitting('merged')[0]?.id ?? null,
  };
}

/* ------------------------------------------------------------------------- models */

export interface ModelChoice {
  model: string;
  source: 'label' | 'project' | 'bot';
  /** With source `label`: the model label that won. */
  label_id: string | null;
}

export interface ModelInput {
  type: RunType;
  /** The label catalog of the organization, in its order: the labels with `agent_model` are the model labels. */
  catalog: readonly Pick<Label, 'id' | 'agent_model'>[];
  /** The labels of the item. */
  labelIds: readonly string[];
  /** A child of an epic without a model label takes the epic's (spec 7.7). */
  epicLabelIds?: readonly string[];
  project: Pick<ProjectAgents, 'models'> | null;
  /** With `cli`, a model of a label or the project that this CLI does not know is passed over (spec 7.7). */
  agent: Pick<AgentConfig, 'model' | 'models'> & { cli?: AgentConfig['cli'] };
}

const filled = (model: string | null | undefined): model is string => model !== undefined && model !== null && model.trim() !== '';

/** Whether a label of the catalog sets the model of an agent (recognized by its field, never by its name). */
export const isModelLabel = (label: Pick<Label, 'agent_model'>) => filled(label.agent_model);

/**
 * The model of a run (spec 7.7): the model label of the item (with several, the first in the order of the catalog),
 * for a child of an epic without one the epic's; then the project's model for the kind of run, then the bot's for the
 * kind of run, then the bot's default. A model the bot's CLI does not have (a Claude model for a Codex agent) is passed
 * over.
 */
export function pickModel({ type, catalog, labelIds, epicLabelIds = [], project, agent }: ModelInput): ModelChoice {
  const fits = (model: string) => !agent.cli || KNOWN_MODELS[agent.cli].includes(model.trim());
  for (const labels of [labelIds, epicLabelIds]) {
    const label = catalog.find((entry) => labels.includes(entry.id) && isModelLabel(entry) && fits(entry.agent_model!));
    if (label) return { model: label.agent_model!.trim(), source: 'label', label_id: label.id };
  }
  const fromProject = project?.models[type];
  if (filled(fromProject) && fits(fromProject)) return { model: fromProject.trim(), source: 'project', label_id: null };
  const fromBot = agent.models[type];
  return { model: filled(fromBot) ? fromBot.trim() : agent.model.trim(), source: 'bot', label_id: null };
}

/** The models per CLI (spec 7.7): a fixed list, no free names. */
export const KNOWN_MODELS: Record<AgentConfig['cli'], readonly string[]> = {
  claude: ['haiku', 'sonnet', 'opus', 'fable'],
  codex: ['gpt-5-codex', 'gpt-5-codex-mini'],
};

/** The model a bot starts with per CLI, and what a change of CLI falls back to. */
export const DEFAULT_MODELS: Record<AgentConfig['cli'], string> = { claude: 'sonnet', codex: 'gpt-5-codex' };

/** The same models for the same CLI, keeping those it knows: what a change of CLI leaves of a bot's models. */
export function modelsFor(cli: AgentConfig['cli'], model: string, models: Partial<Record<RunType, string>>): { model: string; models: Partial<Record<RunType, string>>; dropped: string[] } {
  const known = KNOWN_MODELS[cli];
  const dropped = [model, ...Object.values(models)].filter((entry): entry is string => Boolean(entry) && !known.includes(entry!));
  return {
    model: known.includes(model) ? model : DEFAULT_MODELS[cli],
    models: Object.fromEntries(Object.entries(models).filter(([, entry]) => entry && known.includes(entry))),
    dropped: [...new Set(dropped)],
  };
}

/* -------------------------------------------------------------------------- brakes */

export type AfterFindings = { next: 'correction' | 'conflict'; used: number; max: number } | { next: 'paused'; kind: 'correction' | 'conflict'; max: number };

/**
 * What a red CI or review findings (`correction`), or a conflict with the base (`conflict`), lead to: another run of
 * that kind, or the brake when the strand has used them up (spec 7.2: 3 corrections, 2 conflicts, each counted apart).
 */
export function afterFindings(thread: Pick<AgentThread, 'corrections' | 'conflicts'>, limits: Pick<ProjectAgents, 'max_corrections' | 'max_conflicts'>, kind: 'correction' | 'conflict'): AfterFindings {
  const used = kind === 'correction' ? thread.corrections : thread.conflicts;
  const max = kind === 'correction' ? limits.max_corrections : limits.max_conflicts;
  return used < max ? { next: kind, used: used + 1, max } : { next: 'paused', kind, max };
}

/* --------------------------------------------------------------------- eligibility */

/** Why a bot cannot be an agent anywhere: the default bot, no responsible person, deactivated. Empty: it can. */
export function whyNotAgent(bot: Pick<User, 'type' | 'is_default_bot' | 'owner_id' | 'disabled_at'>): string[] {
  if (bot.type !== 'bot') return ['Nur Bots können Agenten sein.'];
  const reasons: string[] = [];
  if (bot.is_default_bot) reasons.push('Der Standard-Bot handelt für Automatisierungen und Vorlagen. Er hat keine verantwortliche Person, die die Arbeit eines Agenten zurückbekäme.');
  else if (bot.owner_id === null) reasons.push('Der Bot hat keine verantwortliche Person. Sie bekommt das Ticket zurück, wenn die Bremse greift.');
  if (bot.disabled_at !== null) reasons.push('Der Bot ist deaktiviert.');
  return reasons;
}

export interface ProjectContext {
  identifier: string;
  /** The bot's role in the project; null: not a member. */
  role: ProjectRole | null;
  settings: ProjectAgents | null;
  workflow: Workflow | undefined;
}

/**
 * Why a bot does not work as an agent in a project, or null when it does: its agent configuration is off, it is not a
 * member who may edit items, the project has no settings, or its workflow no status per step (spec 7.2, 7.4).
 */
export function whyNotHere(bot: Pick<User, 'name' | 'type' | 'is_default_bot' | 'owner_id' | 'disabled_at'>, agent: Pick<AgentConfig, 'enabled'> | null, project: ProjectContext): string | null {
  const general = whyNotAgent(bot);
  if (general.length > 0) return general[0];
  if (!agent?.enabled) return `${bot.name} ist kein Agent: In den Einstellungen des Bots ist „Als Agent arbeiten“ aus.`;
  if (project.role === null || project.role === 'viewer') return `${bot.name} ist in ${project.identifier} ${project.role === 'viewer' ? 'nur Viewer' : 'kein Mitglied'} und darf Items nicht bearbeiten.`;
  if (!project.settings || !project.workflow) return `In ${project.identifier} sind die Agenten noch nicht eingerichtet.`;
  if (!mappingComplete(project.workflow, project.workflow.agent_states)) {
    return `In ${project.identifier} sind die Agenten aus: Der Workflow „${project.workflow.name}“ hat noch ${missingSteps(project.workflow).length === AGENT_STEPS.length ? 'keine' : 'nicht alle'} Agenten-Schritte.`;
  }
  return null;
}
