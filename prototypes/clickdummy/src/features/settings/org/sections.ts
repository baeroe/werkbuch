/*
 * The sections of the organisation settings (spec 5.2). The slugs are the contract with the router and the other
 * screens: `/settings/:section`, the palette opens a person under `people` and a bot under `bots`.
 */

import type { LucideIcon } from 'lucide-react';
import { BadgeCheck, Bot, Building2, Link2, Server, Shapes, SlidersHorizontal, Tags, Users, Webhook, Workflow } from 'lucide-react';
import type { OrgPermission } from './access';

export type SectionSlug =
  | 'general'
  | 'people'
  | 'bots'
  | 'workflows'
  | 'types'
  | 'properties'
  | 'labels'
  | 'relation-types'
  | 'resolutions'
  | 'webhooks'
  | 'system';

export type SectionGroup = 'organization' | 'catalogs' | 'operations';

export interface SectionDef {
  slug: SectionSlug;
  label: string;
  icon: LucideIcon;
  group: SectionGroup;
  /** The right that changes things in this section. */
  permission: OrgPermission;
  /** What a member gets: the section to read, or the notice that it is for admins. */
  members: 'read' | 'blocked';
  /** More words that find the section in the command palette. */
  keywords: string[];
}

export const GROUP_NAMES: Record<SectionGroup, string> = {
  organization: 'Organisation',
  catalogs: 'Kataloge',
  operations: 'Betrieb',
};

export const SECTIONS: readonly SectionDef[] = [
  { slug: 'general', label: 'Allgemein', icon: Building2, group: 'organization', permission: 'org.manage', members: 'read', keywords: ['name', 'logo', 'sprache', 'zeitzone', 'wochenbeginn', 'organisation'] },
  { slug: 'people', label: 'Personen', icon: Users, group: 'organization', permission: 'org.manage', members: 'blocked', keywords: ['einladen', 'rollen', 'konten', 'deaktivieren', 'admin'] },
  { slug: 'bots', label: 'Bots', icon: Bot, group: 'organization', permission: 'org.manage', members: 'blocked', keywords: ['agent', 'token', 'automation', 'api'] },
  { slug: 'workflows', label: 'Workflows', icon: Workflow, group: 'catalogs', permission: 'org.manage_catalog', members: 'read', keywords: ['status', 'übergänge', 'matrix', 'startstatus'] },
  { slug: 'types', label: 'Typen', icon: Shapes, group: 'catalogs', permission: 'org.manage_catalog', members: 'read', keywords: ['work item', 'epic', 'task', 'bug', 'icon'] },
  { slug: 'properties', label: 'Properties', icon: SlidersHorizontal, group: 'catalogs', permission: 'org.manage_catalog', members: 'read', keywords: ['felder', 'eigenschaften', 'dropdown', 'schlüssel'] },
  { slug: 'labels', label: 'Labels', icon: Tags, group: 'catalogs', permission: 'org.manage_catalog', members: 'read', keywords: ['schlagwörter', 'tags', 'farben'] },
  { slug: 'relation-types', label: 'Relationstypen', icon: Link2, group: 'catalogs', permission: 'org.manage_catalog', members: 'read', keywords: ['relationen', 'blockiert', 'duplikat', 'verwandt'] },
  { slug: 'resolutions', label: 'Resolutions', icon: BadgeCheck, group: 'catalogs', permission: 'org.manage_catalog', members: 'read', keywords: ['abschluss', 'done', 'duplicate', 'standard'] },
  { slug: 'webhooks', label: 'Webhooks', icon: Webhook, group: 'operations', permission: 'org.manage', members: 'blocked', keywords: ['ereignisse', 'zustellungen', 'geheimnis', 'ping'] },
  { slug: 'system', label: 'System', icon: Server, group: 'operations', permission: 'org.manage', members: 'blocked', keywords: ['version', 'queue', 'jobs', 'meilisearch', 'testmail'] },
];

export const findSection = (slug: string | undefined): SectionDef | undefined => SECTIONS.find((section) => section.slug === slug);

/** What every section component receives. */
export interface SectionProps {
  /** Why the signed-in person may only read this section, or null when they may change it. */
  readOnlyReason: string | null;
}
