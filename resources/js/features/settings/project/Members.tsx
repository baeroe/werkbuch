/*
 * Settings → Members (spec 4.2, 4.3): the people and bots of the project with their role there. Project admins add and
 * remove members and change roles; the lead stays a member (its role may change, the lead has no rights of its own).
 * Removing runs after five seconds of undo. Org admins have admin rights in every project, member or not, and carry a
 * chip that says so.
 */

import { UserMinus, UserPlus, Users } from 'lucide-react';
import { useId, useMemo, useState, type FormEvent } from 'react';
import { AlertDialog } from '@/components/ui/AlertDialog';
import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';
import { Combobox } from '@/components/ui/Combobox';
import { EmptyState } from '@/components/ui/EmptyState';
import { IconButton } from '@/components/ui/IconButton';
import { Select } from '@/components/ui/Select';
import { toast } from '@/components/ui/toast';
import { useAddMember, useMembers, useRemoveMember, useUpdateMemberRole } from '@/hooks/projects';
import { useAllUsers, useCurrentUser } from '@/hooks/users';
import { notifyError } from '@/lib/errors';
import { intlLocale, t } from '@/lib/i18n';
import type { ProjectMember, ProjectRole, User } from '@/types';
import { Loaded, RuledList, RuledRow, SettingsCard, SettingsSkeleton } from '../frame/parts';
import { useRemoval } from '../frame/useRemoval';
import type { ProjectSectionProps } from './sectionProps';

const ROLE_VALUES: ProjectRole[] = ['admin', 'member', 'viewer'];
const ROLE_RANK: Record<ProjectRole, number> = { admin: 0, member: 1, viewer: 2 };

const roleLabel = (role: ProjectRole): string => t(`roles.project.${role}`);
const roleOptions = () => ROLE_VALUES.map((role) => ({ value: role, label: roleLabel(role) }));

function MemberList({ project, canManage, members, users }: ProjectSectionProps & { members: ProjectMember[]; users: User[] }) {
  const me = useCurrentUser();
  const add = useAddMember();
  const setRole = useUpdateMemberRole();
  const remove = useRemoveMember();
  const { hidden, remove: removeWithUndo } = useRemoval();

  // a role just chosen, shown until the server has it
  const [chosen, setChosen] = useState<Record<string, ProjectRole>>({});
  const [demotion, setDemotion] = useState<{ user: User; role: ProjectRole } | null>(null);
  const [candidate, setCandidate] = useState<string | null>(null);
  const [newRole, setNewRole] = useState<ProjectRole>('member');
  const personFieldId = useId();

  const rows = useMemo(() => {
    const byId = new Map(users.map((user) => [user.id, user]));
    const collator = new Intl.Collator(intlLocale());
    return members
      .flatMap((member) => {
        const user = byId.get(member.user_id);
        return user && !hidden.has(user.id) ? [{ user, role: member.role }] : [];
      })
      .sort((a, b) => ROLE_RANK[a.role] - ROLE_RANK[b.role] || collator.compare(a.user.name, b.user.name));
  }, [members, users, hidden]);

  const candidates = useMemo(() => {
    const memberIds = new Set(members.map((member) => member.user_id));
    return users.filter((user) => user.disabled_at === null && !memberIds.has(user.id));
  }, [members, users]);

  async function applyRole(user: User, role: ProjectRole) {
    setChosen((current) => ({ ...current, [user.id]: role }));
    try {
      await setRole.mutateAsync({ project_id: project.id, user_id: user.id, role });
      toast({ title: t('settings.project.members.role_set', { name: user.name, role: roleLabel(role), identifier: project.identifier }), tone: 'success' });
    } catch (error) {
      notifyError(t('settings.project.members.role_failed'), error, () => void applyRole(user, role));
    } finally {
      setChosen(({ [user.id]: _done, ...rest }) => rest);
    }
  }

  function chooseRole(user: User, current: ProjectRole, role: ProjectRole) {
    if (role === current) return;
    // an admin who is not an org admin loses this screen with the role: ask first
    if (user.id === me?.id && current === 'admin' && me.org_role !== 'admin') setDemotion({ user, role });
    else void applyRole(user, role);
  }

  async function addMember(event?: FormEvent) {
    event?.preventDefault();
    const user = candidates.find((entry) => entry.id === candidate);
    if (!user) return;
    try {
      await add.mutateAsync({ project_id: project.id, user_id: user.id, role: newRole });
      // With nobody chosen the button is blocked again: the focus moves to the field, which is ready for the next person.
      document.getElementById(personFieldId)?.focus();
      setCandidate(null);
      toast({ title: t('settings.project.members.role_set', { name: user.name, role: roleLabel(newRole), identifier: project.identifier }), tone: 'success' });
    } catch (error) {
      notifyError(t('settings.project.members.add_failed'), error, () => void addMember());
    }
  }

  return (
    <>
      <SettingsCard flush={rows.length > 0} title={t('settings.project.members.title')} description={t('settings.project.members.description')}>
        {canManage && (
          <form
            aria-label={t('settings.project.members.add_label')}
            noValidate
            onSubmit={(event) => void addMember(event)}
            className="grid items-end gap-3 md:grid-cols-[minmax(0,1fr)_9rem_auto]"
          >
            <Combobox
              id={personFieldId}
              label={t('settings.project.members.person')}
              name="member"
              placeholder={t('settings.project.members.search')}
              emptyText={t('settings.project.members.nobody_left')}
              value={candidate}
              onValueChange={setCandidate}
              options={candidates.map((user) => ({ value: user.id, label: user.name, icon: <Avatar user={user} size="sm" decorative /> }))}
            />
            <Select label={t('settings.project.members.role')} value={newRole} options={roleOptions()} onValueChange={(role) => role && setNewRole(role as ProjectRole)} />
            <Button variant="secondary" icon={UserPlus} type="submit" pending={add.isPending} disabledReason={candidate ? null : t('settings.project.members.choose_first')}>
              {t('settings.project.members.add')}
            </Button>
          </form>
        )}
        {rows.length === 0 ? (
          <EmptyState icon={Users} title={t('settings.project.members.empty_title')} description={t('settings.project.members.empty_description')} />
        ) : (
          <RuledList label={t('settings.project.members.list_of', { identifier: project.identifier })}>
            {rows.map(({ user, role }) => {
              const lead = user.id === project.lead_id;
              return (
                <RuledRow key={user.id} className="flex flex-wrap items-center gap-x-3 gap-y-2">
                  <Avatar user={user} decorative />
                  <div className="min-w-0 flex-1 basis-40">
                    <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-md font-medium text-ink">
                      <span className="min-w-0 truncate">{user.name}</span>
                      {lead && <Chip>{t('settings.project.members.lead')}</Chip>}
                      {user.type === 'bot' ? (
                        <Chip>{user.is_default_bot ? t('settings.project.members.default_bot') : t('settings.project.members.bot')}</Chip>
                      ) : (
                        user.org_role === 'admin' && <Chip>{t('settings.project.members.org_admin')}</Chip>
                      )}
                    </p>
                    <p className="truncate text-sm text-muted">{`@${user.handle}`}</p>
                  </div>
                  <Select
                    aria-label={t('settings.project.members.role_of', { name: user.name })}
                    className="w-32"
                    disabled={!canManage}
                    value={chosen[user.id] ?? role}
                    options={roleOptions()}
                    onValueChange={(next) => next && chooseRole(user, role, next as ProjectRole)}
                  />
                  {canManage && (
                    <IconButton
                      icon={UserMinus}
                      label={t('settings.project.members.remove', { name: user.name })}
                      disabledReason={lead ? t('settings.project.members.lead_stays') : null}
                      onClick={() =>
                        removeWithUndo({
                          id: user.id,
                          label: t('settings.project.members.removed', { name: user.name, identifier: project.identifier }),
                          run: () => remove.mutateAsync({ project_id: project.id, user_id: user.id }),
                        })
                      }
                    />
                  )}
                </RuledRow>
              );
            })}
          </RuledList>
        )}
      </SettingsCard>
      <AlertDialog
        open={demotion !== null}
        onOpenChange={(open) => !open && setDemotion(null)}
        title={t('settings.project.members.demote_title')}
        description={t('settings.project.members.demote_description', { identifier: project.identifier })}
        confirmLabel={t('settings.project.members.demote_confirm')}
        onConfirm={() => {
          if (demotion) void applyRole(demotion.user, demotion.role);
          setDemotion(null);
        }}
      />
    </>
  );
}

export function Members({ project, canManage }: ProjectSectionProps) {
  const members = useMembers(project.id);
  const users = useAllUsers();
  return (
    <Loaded
      queries={[members, users]}
      failure={t('settings.project.members.load_failed')}
      skeleton={<SettingsSkeleton rows={4} label={t('settings.project.members.loading')} />}
    >
      {() => <MemberList project={project} canManage={canManage} members={members.data!.items} users={users.data!.items} />}
    </Loaded>
  );
}
