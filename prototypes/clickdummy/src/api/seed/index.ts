/*
 * The seed data of the demo: Feldwerk, an agency with six people, two bots and three projects. Everything is made
 * up (names, customers, hosts, mails). "Today" is Wednesday 2026-10-28, a little before 10:00.
 *
 * `createSeed` builds a fresh document each time, so the stored data can be changed without touching the seed.
 * The pieces live in this folder, one file per topic, so each stays readable:
 * people · config · items · activity · workspace · pages · inbox · files · helpers · agents (WEBU-18)
 */

import type { Db } from '../db';
import { attachments, comments, events, watchers } from './activity';
import { agentComments, agentConfigs, agentEvents, agentRuns, agentThreads, agentRules, applyAgentItems, github, projectAgents, pullRequests, runners, withAgentGuidance, withAgentLabels, withAgentMembers, withAgentUsers } from './agents';
import { labels, projectAutomations, properties, relationTypes, resolutions, types, workflows } from './config';
import { notifications, system, webhookDeliveries, webhooks } from './inbox';
import { buildItems, relations } from './items';
import { pages, pageVersions } from './pages';
import { organization, projectMembers, projects, tokens, users as baseUsers } from './people';
import { favorites, templateRuns, templates, views } from './workspace';

/** The document without its `schema_version`, which belongs to the storage layer (`db.ts`). */
export function createSeed(): Omit<Db, 'schema_version'> {
  // the agent demo (WEBU-18) lies on top of the base seed, which the app's demo seeders read
  const users = withAgentUsers(baseUsers);
  const items = buildItems();
  applyAgentItems(items);
  // bots and deactivated accounts do not watch items
  watchers(items, new Set(users.filter((user) => user.type === 'bot' || user.disabled_at !== null).map((user) => user.id)));

  const db: Omit<Db, 'schema_version'> = {
    organization,
    users,
    invitations: [],
    tokens,
    projects,
    project_aliases: [],
    project_members: withAgentMembers(projectMembers),
    counters: Object.fromEntries(projects.map((project) => [project.id, Math.max(...items.filter((item) => item.project_id === project.id).map((item) => item.number))])),
    workflows,
    types: withAgentGuidance(types),
    properties,
    labels: withAgentLabels(labels),
    relation_types: relationTypes,
    resolutions,
    items,
    relations,
    comments: [...comments, ...agentComments],
    attachments,
    events: [...events, ...agentEvents],
    unsubscribed: {},
    views,
    favorites,
    templates,
    template_runs: templateRuns,
    automations: projectAutomations,
    pages,
    page_versions: pageVersions,
    notifications,
    notification_preferences: [],
    webhooks,
    webhook_deliveries: webhookDeliveries,
    system,
    runners,
    runner_pairings: [],
    github,
    agent_rules: agentRules,
    agent_configs: agentConfigs,
    project_agents: projectAgents,
    agent_threads: agentThreads,
    agent_runs: agentRuns,
    pull_requests: pullRequests,
  };
  // the modules export plain data; a copy keeps stored changes away from them (and from the next `createSeed`)
  return structuredClone(db);
}
