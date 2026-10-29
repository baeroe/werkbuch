/*
 * The seed data of the demo: Feldwerk, an agency with six people, two bots and three projects. Everything is made
 * up (names, customers, hosts, mails). "Today" is Wednesday 2026-10-28, a little before 10:00.
 *
 * `createSeed` builds a fresh document each time, so the stored data can be changed without touching the seed.
 * The pieces live in this folder, one file per topic, so each stays readable:
 * people · config · items · activity · workspace · pages · inbox · files · helpers
 */

import type { Db } from '../db';
import { attachments, comments, events, watchers } from './activity';
import { labels, projectAutomations, properties, relationTypes, resolutions, types, workflows } from './config';
import { notifications, system, webhookDeliveries, webhooks } from './inbox';
import { buildItems, relations } from './items';
import { pages, pageVersions } from './pages';
import { organization, projectMembers, projects, tokens, users } from './people';
import { favorites, templateRuns, templates, views } from './workspace';

/** The document without its `schema_version`, which belongs to the storage layer (`db.ts`). */
export function createSeed(): Omit<Db, 'schema_version'> {
  const items = buildItems();
  // bots and deactivated accounts do not watch items
  watchers(items, new Set(users.filter((user) => user.type === 'bot' || user.disabled_at !== null).map((user) => user.id)));

  const db: Omit<Db, 'schema_version'> = {
    organization,
    users,
    invitations: [],
    tokens,
    projects,
    project_aliases: [],
    project_members: projectMembers,
    counters: Object.fromEntries(projects.map((project) => [project.id, Math.max(...items.filter((item) => item.project_id === project.id).map((item) => item.number))])),
    workflows,
    types,
    properties,
    labels,
    relation_types: relationTypes,
    resolutions,
    items,
    relations,
    comments,
    attachments,
    events,
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
  };
  // the modules export plain data; a copy keeps stored changes away from them (and from the next `createSeed`)
  return structuredClone(db);
}
