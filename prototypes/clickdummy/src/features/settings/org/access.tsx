/*
 * Who may change the organisation's settings (spec 4.3). Admins change them; a member either reads the section
 * (workflows, types and the other catalogs, the general settings) or is told "Nur für Admins" with the reason from
 * `usePermissions()`. Nothing the person may not do is shown as a button.
 *
 * `usePermissions()` denies everything until its data has loaded, so a gate that read it directly would greet an
 * admin with "Nur für Admins" for a moment. `useOrgRight` waits for the same data first.
 */

import { Lock } from 'lucide-react';
import { Link } from 'react-router';
import { Banner } from '@/components/ui/Banner';
import { buttonClass } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { useMembers, useProjects } from '@/hooks/projects';
import { useCurrentUser, useUsers } from '@/hooks/users';
import type { Permission } from '@/lib/permissions';
import { usePermissions } from '@/lib/permissions';

export type OrgPermission = Extract<Permission, 'org.manage' | 'org.manage_catalog'>;

export type OrgRight =
  | { status: 'loading' }
  | { status: 'error'; retry: () => void; retrying: boolean }
  /** `reason` is null for somebody who may change the settings, otherwise the sentence that says who may. */
  | { status: 'ready'; reason: string | null };

/** The right to change one kind of setting, once the data behind the rights has loaded. */
export function useOrgRight(permission: OrgPermission): OrgRight {
  const { reason } = usePermissions();
  const me = useCurrentUser();
  const users = useUsers();
  const projects = useProjects({ include_archived: true });
  const members = useMembers();
  const queries = [users, projects, members];

  if (queries.some((query) => query.isError)) {
    return {
      status: 'error',
      retry: () => queries.filter((query) => query.isError).forEach((query) => void query.refetch()),
      retrying: queries.some((query) => query.isFetching),
    };
  }
  if (!me || queries.some((query) => query.isPending)) return { status: 'loading' };
  return { status: 'ready', reason: reason(permission) };
}

/** What a member sees instead of a section that is for admins only. */
export function NotForMembers({ reason, section }: { reason: string; section: string }) {
  return (
    <EmptyState
      icon={Lock}
      title="Nur für Admins"
      description={`${reason} Du siehst ${section} deshalb nicht.`}
      actions={
        <Link to="/settings/general" className={buttonClass({ variant: 'secondary' })}>
          Zu Allgemein
        </Link>
      }
    />
  );
}

/** The line above a section that members may read but not change. */
export function ReadOnlyNotice({ reason }: { reason: string }) {
  return (
    <Banner icon={Lock} title="Nur lesen" role="status">
      {reason}
    </Banner>
  );
}
