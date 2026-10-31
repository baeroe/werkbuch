/*
 * The settings of the organisation (spec 5.2) in the shared settings frame: the list of sections on the left, the chosen
 * section on the right (below lg the list is a row above it). `/settings` shows General; an unknown section says so and
 * keeps the list. Admins change everything; a member reads the general settings and the catalogs and is told "Admins
 * only" in the sections that are not theirs.
 */

import { Link } from '@inertiajs/react';
import { CircleAlert } from 'lucide-react';
import type { ComponentType } from 'react';
import { buttonClass } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { useCurrentUser } from '@/hooks/users';
import { t } from '@/lib/i18n';
import { paths } from '@/lib/links';
import { useDocumentTitle } from '@/lib/useDocumentTitle';
import { NotForMembers, useOrgRight } from '../frame/access';
import { FormSkeleton, SectionHeader } from '../frame/parts';
import { SectionNav, SettingsFrame } from '../frame/SettingsFrame';
import Bots from './Bots';
import Labels from './catalogs/Labels';
import RelationTypes from './catalogs/RelationTypes';
import Resolutions from './catalogs/Resolutions';
import General from './General';
import People from './People';
import Properties from './properties/Properties';
import { findSection, GROUP_NAMES, SECTIONS, sectionLabel, type SectionDef, type SectionProps, type SectionSlug } from './sections';
import Types from './types/Types';
import Workflows from './workflows/Workflows';

const COMPONENTS: Record<SectionSlug, ComponentType<SectionProps>> = {
  general: General,
  people: People,
  bots: Bots,
  workflows: Workflows,
  types: Types,
  properties: Properties,
  labels: Labels,
  'relation-types': RelationTypes,
  resolutions: Resolutions,
};

/** The chosen section, once the rights are known: its screen, a notice for members, or the reason it could not load. */
function SectionBody({ section }: { section: SectionDef }) {
  const right = useOrgRight(section.permission);
  const label = sectionLabel(section);

  if (right.status === 'error') {
    return <ErrorState title={t('settings.org.rights_failed.title')} description={t('settings.org.rights_failed.description')} retrying={right.retrying} onRetry={right.retry} />;
  }
  if (right.status === 'loading') {
    return (
      <div className="flex flex-col gap-4">
        <SectionHeader title={label} />
        <FormSkeleton label={t('settings.org.section_loading', { section: label })} />
      </div>
    );
  }
  if (right.reason !== null && section.members === 'blocked') {
    return (
      <div className="flex flex-col gap-4">
        <SectionHeader title={label} />
        <NotForMembers reason={right.reason} section={t('settings.org.quoted', { section: label })} />
      </div>
    );
  }
  const Section = COMPONENTS[section.slug];
  return <Section readOnlyReason={right.reason} />;
}

function UnknownSection({ slug }: { slug: string }) {
  return (
    <EmptyState
      icon={CircleAlert}
      title={t('settings.org.unknown.title')}
      description={t('settings.org.unknown.description', { slug })}
      actions={
        <Link href={paths.settings('general')} className={buttonClass({ variant: 'primary' })}>
          {t('settings.org.unknown.to_general')}
        </Link>
      }
    />
  );
}

export function OrgSettings({ section: slug }: { section: string }) {
  const me = useCurrentUser();
  const current = findSection(slug);
  useDocumentTitle(current ? t('settings.org.document_title', { section: sectionLabel(current) }) : t('settings.org.title'));

  const items = SECTIONS.map((section) => ({
    slug: section.slug,
    label: sectionLabel(section),
    icon: section.icon,
    group: t(GROUP_NAMES[section.group]),
    locked: me?.org_role === 'member' && section.members === 'blocked',
  }));

  return (
    <SettingsFrame title={t('settings.org.title')} nav={<SectionNav label={t('settings.org.nav_label')} items={items} current={current?.slug ?? null} hrefFor={paths.settings} />}>
      {current ? <SectionBody key={current.slug} section={current} /> : <UnknownSection slug={slug} />}
    </SettingsFrame>
  );
}
