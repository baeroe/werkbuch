/*
 * The sections of the organisation settings (spec 5.2). The slugs are the contract with the route and the other
 * screens: `/settings/{section}`. Phase 2 brings General, People and Bots (group "Organisation"); the catalogs
 * (workflows, types, properties, labels, relation types, resolutions) and operations (webhooks, system) come with their
 * phases.
 */

import type { LucideIcon } from 'lucide-react';
import { Bot, Building2, Users } from 'lucide-react';
import { t, type TranslationKey } from '@/lib/i18n';
import type { OrgPermission } from '../frame/access';

export type SectionSlug = 'general' | 'people' | 'bots';

export type SectionGroup = 'organization';

export interface SectionDef {
  slug: SectionSlug;
  icon: LucideIcon;
  group: SectionGroup;
  /** The right that changes things in this section. */
  permission: OrgPermission;
  /** What a member gets: the section to read, or the notice that it is for admins. */
  members: 'read' | 'blocked';
}

export const GROUP_NAMES: Record<SectionGroup, TranslationKey> = {
  organization: 'settings.org.group.organization',
};

export const SECTIONS: readonly SectionDef[] = [
  { slug: 'general', icon: Building2, group: 'organization', permission: 'org.manage', members: 'read' },
  { slug: 'people', icon: Users, group: 'organization', permission: 'org.manage', members: 'blocked' },
  { slug: 'bots', icon: Bot, group: 'organization', permission: 'org.manage', members: 'blocked' },
];

/** The name of a section in the language of the page (only known after `initI18n`, so it is looked up each time). */
export const sectionLabel = (section: SectionDef): string => t(`settings.org.section.${section.slug}`);

export const findSection = (slug: string): SectionDef | undefined => SECTIONS.find((section) => section.slug === slug);

/** What every section component receives. */
export interface SectionProps {
  /** Why the signed-in person may only read this section, or null when they may change it. */
  readOnlyReason: string | null;
}
