/*
 * The sections of the organisation settings (spec 5.2). The slugs are the contract with the route and the other
 * screens: `/settings/{section}`. Phase 2 brings General, People and Bots (group "Organisation"), Phase 3 the catalogs
 * (labels, relation types and resolutions here; workflows, types and properties take their place before them with
 * their tasks); operations (webhooks, system) come with their phases. Members read the catalogs, admins change them.
 */

import type { LucideIcon } from 'lucide-react';
import { BadgeCheck, Bot, Building2, Link2, Tags, Users } from 'lucide-react';
import { t, type TranslationKey } from '@/lib/i18n';
import type { OrgPermission } from '../frame/access';

export type SectionSlug = 'general' | 'people' | 'bots' | 'labels' | 'relation-types' | 'resolutions';

export type SectionGroup = 'organization' | 'catalogs';

export interface SectionDef {
  slug: SectionSlug;
  /** The name of the section; a fixed key, because a slug like `relation-types` is no valid key (P21). */
  labelKey: TranslationKey;
  icon: LucideIcon;
  group: SectionGroup;
  /** The right that changes things in this section. */
  permission: OrgPermission;
  /** What a member gets: the section to read, or the notice that it is for admins. */
  members: 'read' | 'blocked';
}

export const GROUP_NAMES: Record<SectionGroup, TranslationKey> = {
  organization: 'settings.org.group.organization',
  catalogs: 'settings.org.group.catalogs',
};

export const SECTIONS: readonly SectionDef[] = [
  { slug: 'general', labelKey: 'settings.org.section.general', icon: Building2, group: 'organization', permission: 'org.manage', members: 'read' },
  { slug: 'people', labelKey: 'settings.org.section.people', icon: Users, group: 'organization', permission: 'org.manage', members: 'blocked' },
  { slug: 'bots', labelKey: 'settings.org.section.bots', icon: Bot, group: 'organization', permission: 'org.manage', members: 'blocked' },
  { slug: 'labels', labelKey: 'settings.org.section.labels', icon: Tags, group: 'catalogs', permission: 'org.manage_catalog', members: 'read' },
  { slug: 'relation-types', labelKey: 'settings.org.section.relation_types', icon: Link2, group: 'catalogs', permission: 'org.manage_catalog', members: 'read' },
  { slug: 'resolutions', labelKey: 'settings.org.section.resolutions', icon: BadgeCheck, group: 'catalogs', permission: 'org.manage_catalog', members: 'read' },
];

/** The name of a section in the language of the page (only known after `initI18n`, so it is looked up each time). */
export const sectionLabel = (section: SectionDef): string => t(section.labelKey);

export const findSection = (slug: string): SectionDef | undefined => SECTIONS.find((section) => section.slug === slug);

/** What every section component receives. */
export interface SectionProps {
  /** Why the signed-in person may only read this section, or null when they may change it. */
  readOnlyReason: string | null;
}
