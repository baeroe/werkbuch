/*
 * The personal settings (spec 5.2) in the shared settings frame: Profile, Security, and API & MCP, one address each
 * (`/me/{section?}`, the profile without a section; Notifications come with Phase 8). Everybody changes their own;
 * nobody sees another person's. The account is the signed-in one from the shared props, so there is nothing to load
 * before the sections show; an unknown section says so and keeps the list.
 */

import { Link } from '@inertiajs/react';
import { CircleAlert } from 'lucide-react';
import { Avatar } from '@/components/ui/Avatar';
import { buttonClass } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { useCurrentUser } from '@/hooks/users';
import { t } from '@/lib/i18n';
import { paths } from '@/lib/links';
import { useDocumentTitle } from '@/lib/useDocumentTitle';
import { SectionNav, SettingsFrame } from '../frame/SettingsFrame';
import { ApiAndMcp } from './ApiAndMcp';
import { Profile } from './Profile';
import { Security } from './Security';

const SECTIONS = ['profile', 'security', 'api'] as const;
type Section = (typeof SECTIONS)[number];

const isSection = (slug: string): slug is Section => (SECTIONS as readonly string[]).includes(slug);

/** The name of a section in the language of the page. */
const sectionLabel = (section: Section): string => t(`settings.personal.section.${section}`);

function UnknownSection() {
  return (
    <EmptyState
      icon={CircleAlert}
      title={t('settings.personal.unknown.title')}
      description={t('settings.personal.unknown.description')}
      actions={
        <Link href={paths.me()} className={buttonClass({ variant: 'primary' })}>
          {t('settings.personal.unknown.to_profile')}
        </Link>
      }
    />
  );
}

export function PersonalSettings({ section }: { section: string }) {
  const me = useCurrentUser();
  const current = isSection(section) ? section : null;
  useDocumentTitle(current ? t('settings.personal.document_title', { section: sectionLabel(current) }) : t('settings.personal.title'));

  // the route is for signed-in people only: the account is always there
  if (!me) return null;

  const items = SECTIONS.map((slug) => ({ slug, label: sectionLabel(slug) }));
  return (
    <SettingsFrame
      title={t('settings.personal.title')}
      lead={
        <span className="inline-flex max-w-full items-center gap-2">
          <Avatar user={me} size="sm" decorative />
          <span className="min-w-0 truncate font-medium text-ink">{me.name}</span>
          {me.email && <span className="min-w-0 truncate">{me.email}</span>}
        </span>
      }
      nav={<SectionNav label={t('settings.personal.nav_label')} items={items} current={current} hrefFor={paths.me} />}
    >
      {current === 'profile' && <Profile key={me.id} user={me} />}
      {current === 'security' && <Security key={me.id} user={me} />}
      {current === 'api' && <ApiAndMcp key={me.id} user={me} />}
      {current === null && <UnknownSection />}
    </SettingsFrame>
  );
}
