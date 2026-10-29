/*
 * The personal settings (spec 5.2): Profile, Security, Notifications and API & MCP, one address each (`/me/:section?`,
 * Profile without a section). Everybody changes their own; nobody sees another person's.
 */

import { useParams } from 'react-router';
import { NotFound } from '@/app/PageStates';
import { Avatar } from '@/components/ui/Avatar';
import { Skeleton } from '@/components/ui/Skeleton';
import { useCurrentUser, useUsers } from '@/hooks/users';
import { useDocumentTitle } from '@/lib/useDocumentTitle';
import { ApiAndMcp } from './ApiAndMcp';
import { Notifications } from './Notifications';
import { Profile } from './Profile';
import { Security } from './Security';
import { SectionNav, SettingsError, SettingsFrame, SettingsSkeleton, useSectionCommands, type SectionItem } from '../project/SettingsParts';

const SECTIONS = [
  { slug: 'profile', label: 'Profil' },
  { slug: 'security', label: 'Sicherheit' },
  { slug: 'notifications', label: 'Benachrichtigungen' },
  { slug: 'api', label: 'API & MCP' },
] as const satisfies readonly SectionItem[];

const hrefFor = (slug: string) => `/me/${slug}`;

export default function PersonalSettings() {
  const { section } = useParams();
  const current = section ?? 'profile';
  const users = useUsers();
  const me = useCurrentUser();
  const label = SECTIONS.find((item) => item.slug === current)?.label;

  useSectionCommands('settings.me', 'Persönliche Einstellungen', SECTIONS, hrefFor);
  useDocumentTitle(label ? `${label} – Persönliche Einstellungen` : 'Persönliche Einstellungen');

  if (users.isError) {
    return (
      <SettingsFrame title="Persönliche Einstellungen" nav={null}>
        <SettingsError title="Dein Konto konnte nicht geladen werden" error={users.error} retrying={users.isFetching} onRetry={() => void users.refetch()} />
      </SettingsFrame>
    );
  }

  if (!me) {
    if (users.isSuccess) return <NotFound title="Dein Konto gibt es nicht mehr" description="Melde dich neu an oder wechsle über das Profilmenü zu einer anderen Person." />;
    return (
      <SettingsFrame title="Persönliche Einstellungen" nav={<Skeleton className="h-9 w-full max-w-md" />}>
        <SettingsSkeleton rows={4} label="Persönliche Einstellungen werden geladen …" />
      </SettingsFrame>
    );
  }

  if (!label) {
    return <NotFound title="Diesen Bereich gibt es nicht" description="Die persönlichen Einstellungen haben die Bereiche Profil, Sicherheit, Benachrichtigungen sowie API & MCP." />;
  }

  return (
    <SettingsFrame
      title="Persönliche Einstellungen"
      lead={
        <span className="inline-flex max-w-full items-center gap-2">
          <Avatar user={me} size="sm" decorative />
          <span className="min-w-0 truncate font-medium text-ink">{me.name}</span>
          {me.email && <span className="min-w-0 truncate">{me.email}</span>}
        </span>
      }
      nav={<SectionNav label="Bereiche der persönlichen Einstellungen" items={SECTIONS} current={current} hrefFor={hrefFor} />}
    >
      {current === 'profile' && <Profile user={me} />}
      {current === 'security' && <Security user={me} />}
      {current === 'notifications' && <Notifications user={me} />}
      {current === 'api' && <ApiAndMcp user={me} />}
    </SettingsFrame>
  );
}
