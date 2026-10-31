/*
 * Who may change the organisation's settings (spec 4.3). Admins change them; a member either reads the section
 * (workflows, types and the other catalogs, the general settings) or is told "Admins only" with the reason from
 * `usePermissions()`. Nothing the person may not do is shown as a button.
 *
 * `usePermissions()` denies everything until its data has loaded, so a gate that read it directly would greet an admin
 * with "Admins only" for a moment. `useOrgRight` waits for the same data first.
 */

import { Link } from '@inertiajs/react';
import { Lock } from 'lucide-react';
import { Banner } from '@/components/ui/Banner';
import { buttonClass } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { useProjects } from '@/hooks/projects';
import { useCurrentUser } from '@/hooks/users';
import { t } from '@/lib/i18n';
import { paths } from '@/lib/links';
import type { Permission } from '@/lib/permissions';
import { usePermissions } from '@/lib/permissions';

export type OrgPermission = Extract<Permission, 'org.manage' | 'org.manage_catalog'>;

export type OrgRight =
  | { status: 'loading' }
  | { status: 'error'; retry: () => void; retrying: boolean }
  /** `reason` is null for somebody who may change the settings, otherwise the sentence that says who may. */
  | { status: 'ready'; reason: string | null };

/** The right to change one kind of setting, once the data behind the rights (the projects with the own role) has loaded. */
export function useOrgRight(permission: OrgPermission): OrgRight {
  const { reason, loading } = usePermissions();
  // the same query `usePermissions` reads: no second request, but its failure and its retry
  const projects = useProjects({ include_archived: true }, { enabled: useCurrentUser() !== undefined });

  if (projects.isError) return { status: 'error', retry: () => void projects.refetch(), retrying: projects.isFetching };
  if (loading) return { status: 'loading' };
  return { status: 'ready', reason: reason(permission) };
}

/** What a member sees instead of a section that is for admins only. */
export function NotForMembers({ reason, section }: { reason: string; section: string }) {
  return (
    <EmptyState
      icon={Lock}
      title={t('settings.access.title')}
      description={t('settings.access.description', { reason, section })}
      actions={
        <Link href={paths.settings('general')} className={buttonClass({ variant: 'secondary' })}>
          {t('settings.access.to_general')}
        </Link>
      }
    />
  );
}

/** The line above a section that members may read but not change. */
export function ReadOnlyNotice({ reason }: { reason: string }) {
  return (
    <Banner icon={Lock} title={t('settings.access.read_only')} role="status">
      {reason}
    </Banner>
  );
}
