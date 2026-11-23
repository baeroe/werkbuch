/*
 * The rules of the agents (spec `2026-11-23-runner-design.md`), as pure functions: they are ported to PHP later.
 * - `mappingErrors`: the status each step of the flow sets has to be of the right category (7.4).
 * - `pickModel`: the model of a run; a model label of the item, then the project per kind of run, then the bot (7.7).
 * - `afterFindings`: what CI red or review findings lead to: a correction, or the brake when the strand has had
 *   enough (7.2).
 * - `whyNoAgent`: why a bot cannot be an agent at all, or not in a project (7.2, 7.4, 10.4).
 */

import type { AgentConfig, AgentRun, AgentStep, AgentThread, Label, ProjectAgents, ProjectRole, RunType, State, StateCategory, User, Workflow } from '@/types';

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

/**
 * The status of each step after a change of workflow (spec 7.4, like Auto-Close, A345): a step keeps the state the
 * mapping of the change gives its old one when that fits the step's category; otherwise it has none, and agents stay
 * off in the project until somebody chooses one.
 */
export function followMapping(states: Record<AgentStep, string | null>, mapping: Record<string, string>, to: Workflow): Record<AgentStep, string | null> {
  const next = {} as Record<AgentStep, string | null>;
  for (const step of AGENT_STEPS) {
    const old = states[step];
    const target = old === null ? undefined : to.states.find((state) => state.id === mapping[old]);
    next[step] = target && STEP_CATEGORIES[step].includes(target.category) ? target.id : null;
  }
  return next;
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
  agent: Pick<AgentConfig, 'model' | 'models'>;
}

const filled = (model: string | null | undefined): model is string => model !== undefined && model !== null && model.trim() !== '';

/** Whether a label of the catalog sets the model of an agent (recognized by its field, never by its name). */
export const isModelLabel = (label: Pick<Label, 'agent_model'>) => filled(label.agent_model);

/**
 * The model of a run (spec 7.7): the model label of the item (with several, the first in the order of the catalog),
 * for a child of an epic without one the epic's; then the project's model for the kind of run, then the bot's for the
 * kind of run, then the bot's default.
 */
export function pickModel({ type, catalog, labelIds, epicLabelIds = [], project, agent }: ModelInput): ModelChoice {
  for (const labels of [labelIds, epicLabelIds]) {
    const label = catalog.find((entry) => labels.includes(entry.id) && isModelLabel(entry));
    if (label) return { model: label.agent_model!.trim(), source: 'label', label_id: label.id };
  }
  const fromProject = project?.models[type];
  if (filled(fromProject)) return { model: fromProject.trim(), source: 'project', label_id: null };
  const fromBot = agent.models[type];
  return { model: filled(fromBot) ? fromBot.trim() : agent.model.trim(), source: 'bot', label_id: null };
}

/** Models the UI suggests per CLI; the field takes any text (spec 7.7). */
export const KNOWN_MODELS: Record<AgentConfig['cli'], readonly string[]> = {
  claude: ['haiku', 'sonnet', 'opus', 'fable'],
  codex: ['gpt-5-codex', 'gpt-5-codex-mini'],
};

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
 * member who may edit items, or the project has no status mapping yet (spec 7.2, 7.4).
 */
export function whyNotHere(bot: Pick<User, 'name' | 'type' | 'is_default_bot' | 'owner_id' | 'disabled_at'>, agent: Pick<AgentConfig, 'enabled'> | null, project: ProjectContext): string | null {
  const general = whyNotAgent(bot);
  if (general.length > 0) return general[0];
  if (!agent?.enabled) return `${bot.name} ist kein Agent: In den Einstellungen des Bots ist „Als Agent arbeiten“ aus.`;
  if (project.role === null || project.role === 'viewer') return `${bot.name} ist in ${project.identifier} ${project.role === 'viewer' ? 'nur Viewer' : 'kein Mitglied'} und darf Items nicht bearbeiten.`;
  if (!project.settings || !project.workflow || !mappingComplete(project.workflow, project.settings.states)) {
    return `In ${project.identifier} sind die Agenten noch nicht eingerichtet: Die Projekteinstellungen „Agenten“ brauchen einen Status für jeden Schritt.`;
  }
  return null;
}
