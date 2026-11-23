/*
 * The agent configuration of bots (spec 10.4, org admins) and the agent settings of projects (spec 10.3, project
 * admins; everybody in the project reads them). A bot without a configuration answers a disabled default; a project
 * without settings answers defaults without any status: agents are off there until all four steps have one.
 */

import { DEFAULT_RULES, RUN_CONTRACTS } from '@/domain/agentRuleDefaults';
import { KNOWN_MODELS, RUN_TYPES, whyNotAgent, whyNotHere } from '@/domain/agents';
import type { AgentConfig, AgentRules, ProjectAgents, ProjectRole, RunType } from '@/types';
import { canSeeProject, requireOrgAdmin, requireRole, requireWritable } from './access';
import { FieldErrors, notFound, paginate, read, write, type Page } from './client';
import type { Db } from './db';


export const defaultAgentConfig = (bot_id: string): AgentConfig => ({
  bot_id,
  enabled: false,
  runner_ids: [],
  cli: 'claude',
  model: 'sonnet',
  models: {},
});

export const defaultProjectAgents = (project_id: string): ProjectAgents => ({
  project_id,
  repo: null,
  base_branch: 'main',
  merge_method: 'squash',
  setup_command: '',
  teardown_command: '',
  review_bot_id: null,
  max_corrections: 3,
  max_conflicts: 2,
  review_human_prs: true,
  comment_on_pr: true,
  models: {},
  info: '',
});

/** The configurations of all bots that have one. */
export function listAgentConfigs(): Promise<Page<AgentConfig>> {
  return read(({ db, me }) => {
    requireOrgAdmin(me, 'Agenten sehen nur Org-Admins.');
    return paginate(db.agent_configs);
  });
}

/** The bots that work as agents (the review agent of a project is one of them); every account may read the list. */
export function listAgentBotIds(): Promise<string[]> {
  return read(({ db }) => db.agent_configs.filter((config) => config.enabled).map((config) => config.bot_id));
}

/** The working rules of the organization per kind of run, with the standards and the contracts werkbuch gives (spec 7.3, 10.8). */
export interface AgentRulesView {
  rules: AgentRules;
  /** The standard werkbuch ships per kind of run: what a rule without a text of its own is. */
  defaults: Record<RunType, string>;
  /** The contract per kind of run, fixed in code and always first in the prompt. */
  contracts: Record<RunType, string>;
}

export function getAgentRules(): Promise<AgentRulesView> {
  return read(({ db }) => ({ rules: { ...db.agent_rules }, defaults: { ...DEFAULT_RULES }, contracts: { ...RUN_CONTRACTS } }));
}

/** Saves the working rules (org admins); a text equal to the standard is stored as none of its own. */
export function saveAgentRules(rules: AgentRules): Promise<AgentRulesView> {
  return write(({ db, me }) => {
    requireOrgAdmin(me, 'Die Arbeitsregeln der Agenten ändern nur Org-Admins.');
    // the catalog right of the organization (org/sections: org.manage_catalog); the fake API knows org admins only
    const errors = new FieldErrors();
    for (const type of RUN_TYPES) if (rules[type] !== null && rules[type]!.trim() === '') errors.add(`rules.${type}`, 'Leer geht nicht. Stelle den Standard wieder her, wenn es keinen eigenen Text braucht.');
    errors.throwIfAny();
    db.agent_rules = Object.fromEntries(RUN_TYPES.map((type) => [type, rules[type] === null || rules[type]!.trim() === DEFAULT_RULES[type].trim() ? null : rules[type]!.trim()])) as AgentRules;
    return { rules: { ...db.agent_rules }, defaults: { ...DEFAULT_RULES }, contracts: { ...RUN_CONTRACTS } };
  });
}

/** The models of the bots that work as agents; every account may read them (what "Wie beim Bot" means in a project). */
export function listAgentModels(): Promise<Pick<AgentConfig, 'bot_id' | 'cli' | 'model' | 'models'>[]> {
  return read(({ db }) => db.agent_configs.filter((config) => config.enabled).map(({ bot_id, cli, model, models }) => ({ bot_id, cli, model, models })));
}

export function getAgentConfig(bot_id: string): Promise<AgentConfig> {
  return read(({ db, me }) => {
    requireOrgAdmin(me, 'Agenten sehen nur Org-Admins.');
    if (db.users.find((user) => user.id === bot_id)?.type !== 'bot') throw notFound('Der Bot');
    return db.agent_configs.find((config) => config.bot_id === bot_id) ?? defaultAgentConfig(bot_id);
  });
}

const wholeIn = (value: number, min: number, max: number) => Number.isInteger(value) && value >= min && value <= max;

export function saveAgentConfig(input: AgentConfig): Promise<AgentConfig> {
  return write(({ db, me }) => {
    requireOrgAdmin(me, 'Agenten einrichten dürfen nur Org-Admins.');
    const bot = db.users.find((user) => user.id === input.bot_id);
    if (bot?.type !== 'bot') throw notFound('Der Bot');
    const errors = new FieldErrors();
    if (input.enabled) {
      const reasons = whyNotAgent(bot);
      if (reasons.length > 0) errors.add('enabled', reasons[0]);
      if (input.runner_ids.length === 0) errors.add('runner_ids', 'Wähle mindestens einen Runner, auf dem der Agent arbeitet.');
    }
    if (input.runner_ids.some((id) => !db.runners.some((runner) => runner.id === id))) errors.add('runner_ids', 'Mindestens einen dieser Runner gibt es nicht mehr.');
    // a model is one of the list of the CLI (spec 7.7), no free name
    const known = KNOWN_MODELS[input.cli];
    if (!known.includes(input.model)) errors.add('model', `Wähle ein Modell von ${input.cli === 'claude' ? 'Claude Code' : 'Codex'}: ${known.join(', ')}.`);
    for (const type of RUN_TYPES) {
      const model = input.models[type];
      if (model && !known.includes(model)) errors.add(`models.${type}`, `„${model}“ gibt es bei ${input.cli === 'claude' ? 'Claude Code' : 'Codex'} nicht.`);
    }
    errors.throwIfAny();
    const stored: AgentConfig = { ...input, model: input.model.trim(), models: trimModels(input.models) };
    const index = db.agent_configs.findIndex((config) => config.bot_id === input.bot_id);
    if (index >= 0) db.agent_configs[index] = stored;
    else db.agent_configs.push(stored);
    return stored;
  });
}

function trimModels(models: Partial<Record<RunType, string>>): Partial<Record<RunType, string>> {
  return Object.fromEntries(Object.entries(models).flatMap(([type, model]) => (model && model.trim() !== '' ? [[type, model.trim()]] : [])));
}

function projectOrThrow(db: Db, id: string) {
  const project = db.projects.find((entry) => entry.id === id);
  if (!project) throw notFound('Das Projekt');
  return project;
}

export function getProjectAgents(project_id: string): Promise<ProjectAgents> {
  return read(({ db, me }) => {
    requireRole(db, me, projectOrThrow(db, project_id), 'viewer');
    const stored = db.project_agents.find((settings) => settings.project_id === project_id);
    return stored ? { ...stored, configured: true } : { ...defaultProjectAgents(project_id), configured: false };
  });
}

/**
 * Saves the agent settings of a project. Checked: a repo the app is installed on that belongs to no other project
 * (1:1), the brakes, the review bot. The status per step is the workflow's (spec 7.4).
 */
export function saveProjectAgents(input: ProjectAgents): Promise<ProjectAgents> {
  return write(({ db, me }) => {
    const project = projectOrThrow(db, input.project_id);
    requireWritable(db, me, project, 'admin', 'Die Agenten eines Projekts richten nur Projekt-Admins ein.');
    const errors = new FieldErrors();
    if (input.repo !== null) {
      const repo = db.github.repos.find((entry) => entry.full_name === input.repo);
      if (!repo) errors.add('repo', 'Dieses Repo ist nicht freigegeben.');
      const owner = db.project_agents.find((settings) => settings.repo === input.repo && settings.project_id !== project.id);
      if (owner) errors.add('repo', `Das Repo gehört schon zum Projekt ${projectOrThrow(db, owner.project_id).identifier}. Ein Repo gehört höchstens einem Projekt.`);
    }
    if (input.base_branch.trim() === '') errors.add('base_branch', 'Gib den Basis-Branch an, etwa main.');
    for (const type of RUN_TYPES) {
      const ref = input.models[type];
      if (ref && !(KNOWN_MODELS[ref.cli] ?? []).includes(ref.model)) errors.add(`models.${type}`, `„${ref.model}“ ist kein Modell der Liste.`);
    }
    if (!wholeIn(input.max_corrections, 1, 10)) errors.add('max_corrections', 'Eine ganze Zahl von 1 bis 10.');
    if (!wholeIn(input.max_conflicts, 1, 10)) errors.add('max_conflicts', 'Eine ganze Zahl von 1 bis 10.');
    if (input.review_bot_id !== null) {
      // the review agent is a bot that works as an agent: it needs a runner pool and a CLI (spec 10.3)
      const reviewer = db.users.find((user) => user.id === input.review_bot_id);
      if (reviewer?.type !== 'bot') errors.add('review_bot_id', 'Das ist kein Bot.');
      else if (!db.agent_configs.find((config) => config.bot_id === reviewer.id)?.enabled) errors.add('review_bot_id', `${reviewer.name} arbeitet nicht als Agent. Schalte „Als Agent arbeiten“ in den Einstellungen des Bots ein.`);
    }
    errors.throwIfAny();
    const { configured: _configured, guard: _guard, ...fields } = input;
    const previous = db.project_agents.find((settings) => settings.project_id === project.id);
    const stored: ProjectAgents = {
      ...fields,
      // a detected unauthorized merge is werkbuch's to set and a project admin's to confirm, never a save's
      guard: previous?.guard ?? null,
      base_branch: input.base_branch.trim(),
      setup_command: input.setup_command.trim(),
      teardown_command: input.teardown_command.trim(),
      info: input.info.trim(),
      models: Object.fromEntries(Object.entries(input.models).filter(([, ref]) => ref && ref.model !== '')),
    };
    const index = db.project_agents.findIndex((settings) => settings.project_id === project.id);
    if (index >= 0) db.project_agents[index] = stored;
    else db.project_agents.push(stored);
    return { ...stored, configured: true };
  });
}

/** Which project owns which repo (a repo belongs to one project at most); a project the reader does not see has no name. */
export function listRepoOwners(): Promise<{ repo: string; project_id: string; identifier: string | null }[]> {
  return read(({ db, me }) =>
    db.project_agents.flatMap((settings) => {
      if (settings.repo === null) return [];
      const project = db.projects.find((entry) => entry.id === settings.project_id)!;
      return [{ repo: settings.repo, project_id: project.id, identifier: canSeeProject(db, me, project) ? project.identifier : null }];
    }),
  );
}

export interface AgentProject {
  project_id: string;
  identifier: string;
  name: string;
  role: ProjectRole;
  /** Why the bot would not work as an agent there even when switched on; null: it would. */
  reason: string | null;
}

/** The projects a bot is a member of, and whether it can work as an agent in each (spec 7.2, 7.4). */
export function listAgentProjects(bot_id: string): Promise<AgentProject[]> {
  return read(({ db, me }) => {
    requireOrgAdmin(me, 'Agenten sehen nur Org-Admins.');
    const bot = db.users.find((user) => user.id === bot_id);
    if (bot?.type !== 'bot') throw notFound('Der Bot');
    return db.project_members
      .filter((member) => member.user_id === bot_id)
      .flatMap((member) => {
        const project = db.projects.find((entry) => entry.id === member.project_id);
        if (!project || project.archived_at !== null) return [];
        const reason = whyNotHere(bot, { enabled: true }, {
          identifier: project.identifier,
          role: member.role,
          settings: db.project_agents.find((settings) => settings.project_id === project.id) ?? null,
          workflow: db.workflows.find((workflow) => workflow.id === project.workflow_id),
        });
        return [{ project_id: project.id, identifier: project.identifier, name: project.name, role: member.role, reason }];
      });
  });
}
