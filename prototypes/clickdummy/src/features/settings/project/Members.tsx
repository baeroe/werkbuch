/*
 * Settings → Members (spec 4.2, 4.3): the people and bots of the project with their role there. Project admins add and
 * remove members and change roles; the lead stays a member. Removing runs after five seconds of undo. Org admins have
 * admin rights in every project, member or not, and carry a chip that says so.
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
import { useCurrentUser, useUsers } from '@/hooks/users';
import { notifyError } from '@/lib/errors';
import { runWithUndo } from '@/lib/undo';
import type { ProjectRole, User } from '@/types';
import { focusNeighbour } from './form';
import type { SectionProps } from './sectionProps';
import { RuledList, RuledRow, SettingsCard, SettingsError, SettingsSkeleton } from './SettingsParts';

const ROLES: { value: ProjectRole; label: string }[] = [
  { value: 'admin', label: 'Admin' },
  { value: 'member', label: 'Member' },
  { value: 'viewer', label: 'Viewer' },
];
const ROLE_LABEL: Record<ProjectRole, string> = { admin: 'Admin', member: 'Member', viewer: 'Viewer' };
const ROLE_RANK: Record<ProjectRole, number> = { admin: 0, member: 1, viewer: 2 };

const without = <T,>(set: ReadonlySet<T>, value: T): Set<T> => new Set([...set].filter((entry) => entry !== value));

export function Members({ project, canManage }: SectionProps) {
  const members = useMembers(project.id);
  const users = useUsers();
  const me = useCurrentUser();
  const add = useAddMember();
  const setRole = useUpdateMemberRole();
  const remove = useRemoveMember();

  // removed, and waiting for the end of the undo time: the row is gone from the screen already
  const [leaving, setLeaving] = useState<ReadonlySet<string>>(new Set());
  // a role just chosen, shown until the server has it
  const [chosen, setChosen] = useState<Record<string, ProjectRole>>({});
  const [demotion, setDemotion] = useState<{ user: User; role: ProjectRole } | null>(null);
  const [candidate, setCandidate] = useState<string | null>(null);
  const [newRole, setNewRole] = useState<ProjectRole>('member');
  const personFieldId = useId();

  const rows = useMemo(() => {
    const byId = new Map((users.data?.items ?? []).map((user) => [user.id, user]));
    return (members.data?.items ?? [])
      .flatMap((member) => {
        const user = byId.get(member.user_id);
        return user && !leaving.has(user.id) ? [{ user, role: member.role }] : [];
      })
      .sort((a, b) => ROLE_RANK[a.role] - ROLE_RANK[b.role] || a.user.name.localeCompare(b.user.name, 'de'));
  }, [members.data, users.data, leaving]);

  const candidates = useMemo(() => {
    const memberIds = new Set(members.data?.items.map((member) => member.user_id));
    return (users.data?.items ?? []).filter((user) => user.disabled_at === null && !memberIds.has(user.id));
  }, [members.data, users.data]);

  if (members.isPending || users.isPending) return <SettingsSkeleton rows={4} label="Mitglieder werden geladen …" />;
  if (members.isError || users.isError) {
    return (
      <SettingsError
        title="Die Mitglieder konnten nicht geladen werden"
        error={members.error ?? users.error}
        retrying={members.isFetching || users.isFetching}
        onRetry={() => {
          void members.refetch();
          void users.refetch();
        }}
      />
    );
  }

  async function applyRole(user: User, role: ProjectRole) {
    setChosen((current) => ({ ...current, [user.id]: role }));
    try {
      await setRole.mutateAsync({ project_id: project.id, user_id: user.id, role });
      toast({ title: `${user.name} ist jetzt ${ROLE_LABEL[role]} in ${project.identifier}`, tone: 'success' });
    } catch (error) {
      notifyError('Rolle nicht geändert', error, () => void applyRole(user, role));
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

  function removeWithUndo(user: User, row: Element | null) {
    focusNeighbour(row);
    setLeaving((current) => new Set(current).add(user.id));
    const show = () => setLeaving((current) => without(current, user.id));
    runWithUndo({
      label: `${user.name} aus ${project.identifier} entfernt`,
      run: async () => {
        try {
          await remove.mutateAsync({ project_id: project.id, user_id: user.id });
        } finally {
          show();
        }
      },
      undo: show,
    });
  }

  async function addMember(event: FormEvent) {
    event.preventDefault();
    const user = candidates.find((entry) => entry.id === candidate);
    if (!user) return;
    try {
      await add.mutateAsync({ project_id: project.id, user_id: user.id, role: newRole });
      // With nobody chosen the button is blocked again: the focus moves to the field, which is ready for the next person.
      document.getElementById(personFieldId)?.focus();
      setCandidate(null);
      toast({ title: `${user.name} ist jetzt ${ROLE_LABEL[newRole]} in ${project.identifier}`, tone: 'success' });
    } catch (error) {
      notifyError('Mitglied nicht hinzugefügt', error, () => void addMember(event));
    }
  }

  return (
    <>
      <SettingsCard flush={rows.length > 0} title="Mitglieder" description="Personen und Bots mit ihrer Rolle in diesem Projekt. Org-Admins haben in jedem Projekt Admin-Rechte, auch ohne Mitglied zu sein.">
        {canManage && (
          <form aria-label="Mitglied hinzufügen" noValidate onSubmit={(event) => void addMember(event)} className="grid items-end gap-3 md:grid-cols-[minmax(0,1fr)_9rem_auto]">
            <Combobox
              id={personFieldId}
              label="Person oder Bot"
              name="member"
              placeholder="Name suchen …"
              emptyText="Niemand mehr zum Hinzufügen"
              value={candidate}
              onValueChange={setCandidate}
              options={candidates.map((user) => ({ value: user.id, label: user.name, icon: <Avatar user={user} size="sm" decorative /> }))}
            />
            <Select label="Rolle" value={newRole} options={ROLES} onValueChange={(role) => role && setNewRole(role as ProjectRole)} />
            <Button variant="secondary" icon={UserPlus} type="submit" pending={add.isPending} disabledReason={candidate ? null : 'Wähle zuerst eine Person oder einen Bot.'}>
              Hinzufügen
            </Button>
          </form>
        )}
        {rows.length === 0 ? (
          <EmptyState icon={Users} title="Noch keine Mitglieder" description="Wer Mitglied ist, bekommt eine Rolle in diesem Projekt. Org-Admins brauchen keine." />
        ) : (
          <RuledList label={`Mitglieder von ${project.identifier}`}>
            {rows.map(({ user, role }) => {
              const lead = user.id === project.lead_id;
              const shown = chosen[user.id] ?? role;
              return (
                <RuledRow key={user.id} className="flex flex-wrap items-center gap-x-3 gap-y-2">
                  <Avatar user={user} decorative />
                  <div className="min-w-0 flex-1 basis-40">
                    <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-md font-medium text-ink">
                      <span className="min-w-0 truncate">{user.name}</span>
                      {lead && <Chip>Lead</Chip>}
                      {user.type === 'bot' ? <Chip>{user.is_default_bot ? 'Standard-Bot' : 'Bot'}</Chip> : user.org_role === 'admin' && <Chip>Org-Admin</Chip>}
                    </p>
                    <p className="truncate text-sm text-muted">{`@${user.handle}`}</p>
                  </div>
                  <Select
                    aria-label={`Rolle von ${user.name}`}
                    className="w-32"
                    disabled={!canManage}
                    value={shown}
                    options={ROLES}
                    onValueChange={(next) => next && chooseRole(user, role, next as ProjectRole)}
                  />
                  {canManage && (
                    <IconButton
                      icon={UserMinus}
                      label={`${user.name} entfernen`}
                      disabledReason={lead ? 'Die Lead-Person bleibt Mitglied. Setze zuerst unter Allgemein eine andere Person als Lead ein.' : null}
                      onClick={(event) => removeWithUndo(user, event.currentTarget.closest('li'))}
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
        title="Dir die Admin-Rechte nehmen?"
        description={`Danach kannst du die Einstellungen von ${project.identifier} nicht mehr ändern. Eine andere Admin-Person muss dir die Rolle zurückgeben.`}
        confirmLabel="Rolle ändern"
        onConfirm={() => {
          if (demotion) void applyRole(demotion.user, demotion.role);
          setDemotion(null);
        }}
      />
    </>
  );
}
