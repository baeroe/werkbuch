/*
 * The fake database: one JSON document in localStorage under `werkbuch:db`, held in memory while the page runs.
 *
 * - `getDb()` is the working copy; every API function reads and changes it.
 * - `saveDb()` writes it back after a successful change. `rollbackDb()` throws away what a failed change did to the
 *   working copy by going back to what was written last, so an error never leaves half a change behind.
 * - `loadDb()` reads the stored document. Broken JSON, a missing collection or an old `schema_version` is not an
 *   error: the seed data are loaded (and written back) instead of a blank page (Review Focus 1).
 * - `resetDb()` starts over with the seed ("Demo zurücksetzen").
 *
 * Bump `SCHEMA_VERSION` whenever the shape of the stored data or the seed changes in a way old documents cannot
 * serve; `migrateDb` is the place for a real migration step should keeping the data ever matter.
 */

import type {
  Attachment,
  Automation,
  Comment,
  Favorite,
  Invitation,
  ItemEvent,
  Label,
  Notification,
  NotificationPreference,
  Organization,
  Page,
  PageVersion,
  Project,
  ProjectMember,
  Property,
  Relation,
  RelationType,
  Resolution,
  SystemStatus,
  Template,
  TemplateRun,
  Token,
  User,
  View,
  Webhook,
  WebhookDelivery,
  Workflow,
  WorkItem,
  WorkItemType,
} from '@/types';
import { createSeed } from './seed';

export const DB_KEY = 'werkbuch:db';
/** 2: relation events name the other item by id (`{ label, item_id }`), not by key. */
export const SCHEMA_VERSION = 2;

/** An earlier identifier of a project: keys like `OLD-12` keep resolving after a rename. */
export interface ProjectAlias {
  identifier: string;
  project_id: string;
}

/** A webhook as stored: with the secret, which the API gives out only when creating or renewing it. */
export interface StoredWebhook extends Webhook {
  secret: string;
}

export interface Db {
  schema_version: number;
  organization: Organization;
  users: User[];
  invitations: Invitation[];
  tokens: Token[];
  projects: Project[];
  project_aliases: ProjectAlias[];
  project_members: ProjectMember[];
  /** The last item number handed out per project id; numbers are never reused. */
  counters: Record<string, number>;
  workflows: Workflow[];
  types: WorkItemType[];
  properties: Property[];
  labels: Label[];
  relation_types: RelationType[];
  resolutions: Resolution[];
  items: WorkItem[];
  relations: Relation[];
  comments: Comment[];
  attachments: Attachment[];
  events: ItemEvent[];
  /** Item id → people who switched watching off by hand; only a new mention or assignment subscribes them again. */
  unsubscribed: Record<string, string[]>;
  views: View[];
  favorites: Favorite[];
  templates: Template[];
  template_runs: TemplateRun[];
  automations: Automation[];
  pages: Page[];
  page_versions: PageVersion[];
  notifications: Notification[];
  /** Only what a person changed; defaults fill the rest (spec 4.14). */
  notification_preferences: NotificationPreference[];
  webhooks: StoredWebhook[];
  webhook_deliveries: WebhookDelivery[];
  system: SystemStatus;
}

/** The collections a stored document must have to be usable. */
const ARRAY_KEYS = [
  'users',
  'invitations',
  'tokens',
  'projects',
  'project_aliases',
  'project_members',
  'workflows',
  'types',
  'properties',
  'labels',
  'relation_types',
  'resolutions',
  'items',
  'relations',
  'comments',
  'attachments',
  'events',
  'views',
  'favorites',
  'templates',
  'template_runs',
  'automations',
  'pages',
  'page_versions',
  'notifications',
  'notification_preferences',
  'webhooks',
  'webhook_deliveries',
] as const;
const OBJECT_KEYS = ['organization', 'counters', 'unsubscribed', 'system'] as const;

let cache: Db | null = null;
/** What is in storage (or would be, when storage is blocked): the state a rollback returns to. */
let lastJson: string | null = null;

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Turns what was stored into a usable document, or null when it cannot be used: not an object, another schema
 * version (older or newer) or a missing collection. Nothing older than the current version is migrated yet.
 */
export function migrateDb(raw: unknown): Db | null {
  if (!isObject(raw) || raw.schema_version !== SCHEMA_VERSION) return null;
  if (!ARRAY_KEYS.every((key) => Array.isArray(raw[key]))) return null;
  if (!OBJECT_KEYS.every((key) => isObject(raw[key]))) return null;
  return raw as unknown as Db;
}

function readStorage(): string | null {
  try {
    return localStorage.getItem(DB_KEY);
  } catch {
    return null; // storage blocked: the demo lives in memory
  }
}

/** Reads the stored document into the working copy; falls back to the seed (and writes it back). */
export function loadDb(): Db {
  const raw = readStorage();
  let loaded: Db | null = null;
  if (raw !== null) {
    try {
      loaded = migrateDb(JSON.parse(raw));
    } catch {
      loaded = null; // broken JSON
    }
  }

  if (loaded) {
    cache = loaded;
    lastJson = raw;
    return cache;
  }
  return resetDb();
}

/** The working copy; loaded on first use. */
export function getDb(): Db {
  return cache ?? loadDb();
}

const isQuotaError = (error: unknown): boolean =>
  error instanceof DOMException && (error.name === 'QuotaExceededError' || error.name === 'NS_ERROR_DOM_QUOTA_REACHED');

/**
 * Writes the working copy to localStorage. Throws the quota error when the document got too big (attachments are
 * data URLs); any other storage problem (blocked storage) is ignored, the demo then lives in memory.
 */
export function saveDb(): void {
  if (!cache) return;
  const json = JSON.stringify(cache);
  try {
    localStorage.setItem(DB_KEY, json);
  } catch (error) {
    if (isQuotaError(error)) throw error;
  }
  lastJson = json;
}

/** Drops unsaved changes of the working copy: back to what was written last. */
export function rollbackDb(): void {
  cache = lastJson === null ? null : (JSON.parse(lastJson) as Db);
}

/** Starts over with the seed data and writes them to storage. */
export function resetDb(): Db {
  cache = { schema_version: SCHEMA_VERSION, ...createSeed() };
  try {
    saveDb();
  } catch {
    lastJson = JSON.stringify(cache); // too big to store (cannot happen with the seed); keep it in memory
  }
  return cache;
}

// Another tab wrote the document: the working copy is stale, read it again on next use.
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (event) => {
    if (event.key === DB_KEY || event.key === null) {
      cache = null;
      lastJson = null;
    }
  });
}
