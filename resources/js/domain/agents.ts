/*
 * The rules of the agents the settings need (spec 7.4, 7.7, 10.4), as pure functions; ported from the click dummy
 * (`prototypes/clickdummy/src/domain/agents.ts`). The categories per step are those of `App\Domain\Workflow\AgentStep`,
 * the models per CLI those of `App\Domain\Agents\AgentCli`, the reasons a bot cannot be an agent those of
 * `SaveAgentConfig::refusal`. Texts stay with the screens: these give codes.
 */

import type { AgentCli, AgentStep, Label, Project, ProjectAgentBot, ProjectRole, RunType, State, StateCategory, User, Workflow } from '@/types';

export const AGENT_STEPS: readonly AgentStep[] = ['working', 'review', 'correction', 'merged'];

/** The categories a step accepts (spec 7.4). */
export const STEP_CATEGORIES: Record<AgentStep, readonly StateCategory[]> = {
  working: ['started'],
  review: ['started'],
  correction: ['unstarted', 'backlog'],
  merged: ['completed'],
};

export type AgentSteps = Record<AgentStep, string | null>;

export const NO_STEPS: AgentSteps = { working: null, review: null, correction: null, merged: null };

type StateLike = Pick<State, 'id' | 'name' | 'category'>;

/** Whether a status may hold a step. */
export const fitsStep = (step: AgentStep, category: StateCategory) => STEP_CATEGORIES[step].includes(category);

/** The steps without a status. */
export function missingSteps(steps: AgentSteps): AgentStep[] {
  return AGENT_STEPS.filter((step) => steps[step] === null);
}

/** All four steps name a status of the workflow that fits: only then do agents work in its projects. */
export function stepsComplete(states: readonly StateLike[], steps: AgentSteps): boolean {
  return AGENT_STEPS.every((step) => {
    const state = states.find((entry) => entry.id === steps[step]);
    return state !== undefined && fitsStep(step, state.category);
  });
}

/**
 * Per status that holds a step but no longer has a category the step accepts (a change of category in the editor): the
 * step. The server refuses it at the status (`field.states.agent_step`).
 */
export function boundStates(states: readonly StateLike[], steps: AgentSteps): Record<string, AgentStep> {
  const bound: Record<string, AgentStep> = {};
  for (const step of AGENT_STEPS) {
    const state = states.find((entry) => entry.id === steps[step]);
    if (state && !fitsStep(step, state.category) && !bound[state.id]) bound[state.id] = step;
  }
  return bound;
}

/**
 * A first guess per step for statuses in their order: the first of a fitting category, for "In Review" one named
 * review, else the second started one; for "Korrektur" an unstarted one before a backlog one.
 */
export function suggestSteps(states: readonly StateLike[]): AgentSteps {
  const fitting = (step: AgentStep) => states.filter((state) => fitsStep(step, state.category));
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

/** The models per CLI (spec 7.7): a fixed list, no free names. */
export const CLI_MODELS: Record<AgentCli, readonly string[]> = {
  claude: ['haiku', 'sonnet', 'opus', 'fable'],
  codex: ['gpt-5-codex', 'gpt-5-codex-mini'],
};

/** The model a bot starts with per CLI, and what a change of CLI falls back to. */
export const DEFAULT_MODELS: Record<AgentCli, string> = { claude: 'sonnet', codex: 'gpt-5-codex' };

export const CLI_NAMES: Record<AgentCli, string> = { claude: 'Claude Code', codex: 'Codex' };

/** What a change of CLI leaves of a bot's models: those the CLI knows; `dropped` the ones it does not. */
export function modelsFor(cli: AgentCli, model: string, models: Partial<Record<RunType, string>>): { model: string; models: Partial<Record<RunType, string>>; dropped: string[] } {
  const known = CLI_MODELS[cli];
  const dropped = [model, ...Object.values(models)].filter((entry): entry is string => typeof entry === 'string' && entry !== '' && !known.includes(entry));
  return {
    model: known.includes(model) ? model : DEFAULT_MODELS[cli],
    models: Object.fromEntries(Object.entries(models).filter(([, entry]) => typeof entry === 'string' && known.includes(entry))),
    dropped: [...new Set(dropped)],
  };
}

export type NotAgentReason = 'default_bot' | 'no_owner' | 'disabled';

/** Why a bot cannot be an agent (the default bot, no responsible person, deactivated); empty: it can. */
export function whyNotAgent(bot: Pick<User, 'is_default_bot' | 'owner_id' | 'disabled_at'>): NotAgentReason[] {
  const reasons: NotAgentReason[] = [];
  if (bot.is_default_bot) reasons.push('default_bot');
  else if (bot.owner_id === null) reasons.push('no_owner');
  if (bot.disabled_at !== null) reasons.push('disabled');
  return reasons;
}

/** The kinds of run in the order of the spec (`RunType::VALUES`). */
export const RUN_TYPES: readonly RunType[] = ['task', 'correction', 'conflict', 'review', 'comment'];

/** A model as a label or a project names it: the CLI and one of its models (`AgentModel`, stored as `cli:model`). */
export interface ModelRef {
  cli: AgentCli;
  model: string;
}

/** `claude:haiku` as a model of a CLI; null for anything the lists do not know. */
export function parseModel(value: string | null | undefined): ModelRef | null {
  const [cli, model, ...rest] = (value ?? '').split(':');
  if (rest.length > 0 || !(cli === 'claude' || cli === 'codex') || !CLI_MODELS[cli].includes(model ?? '')) return null;
  return { cli, model: model! };
}

export const modelValue = (ref: ModelRef): string => `${ref.cli}:${ref.model}`;

/** A label with a model for agents (spec 7.7). */
export const isModelLabel = (label: Pick<Label, 'agent_model'>): boolean => label.agent_model !== null && label.agent_model !== '';

/** The name a model label is suggested: "Haiku Agent" for `haiku`. */
export function modelLabelName(model: string): string {
  const trimmed = model.trim();
  return trimmed === '' ? '' : `${trimmed.charAt(0).toUpperCase()}${trimmed.slice(1)} Agent`;
}

/** What each agent of a project takes for a kind of run without a model of the project: its model for the kind, else its default. */
export function botModels(bots: readonly ProjectAgentBot[], type: RunType): { bot_id: string; model: string }[] {
  return bots.filter((bot) => bot.enabled).map((bot) => ({ bot_id: bot.bot_id, model: bot.models[type] || bot.model }));
}

export type AgentProjectReason = 'viewer' | 'archived' | 'steps';

/**
 * Why an agent does not work in a project it is a member of (`AgentFlow::refusal`): it only reads there, the project is
 * archived, or its workflow lacks a step of the agents. Null: it works there.
 */
export function agentProjectReason(role: ProjectRole, project: Pick<Project, 'archived_at'>, workflow: Pick<Workflow, 'states' | 'agent_states'> | undefined): AgentProjectReason | null {
  if (role === 'viewer') return 'viewer';
  if (project.archived_at !== null) return 'archived';
  if (!workflow || !stepsComplete(workflow.states, workflow.agent_states)) return 'steps';
  return null;
}
