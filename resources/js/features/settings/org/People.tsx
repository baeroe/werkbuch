/*
 * People (spec 4.2): who has an account, with which organisation role, and who was deactivated. Admins invite by
 * e-mail (the dialog ends in a link to copy, valid for seven days), change roles, and deactivate and reactivate
 * accounts. The last active admin among the people can neither be demoted nor deactivated: the server refuses with
 * 409 `last_admin` and the page says so in a message that stays until it is closed. Changing or deactivating one's own
 * account asks first, because it ends one's access to this page; after deactivating oneself the page reloads and the
 * server signs the person out.
 */

import { router } from '@inertiajs/react';
import { Link2, UserPlus, UserRoundCheck, UserRoundX } from 'lucide-react';
import { useState } from 'react';
import { AlertDialog } from '@/components/ui/AlertDialog';
import { Avatar } from '@/components/ui/Avatar';
import { Banner } from '@/components/ui/Banner';
import { Button } from '@/components/ui/Button';
import { Checkbox } from '@/components/ui/Checkbox';
import { CopyField } from '@/components/ui/CopyField';
import { Dialog, DialogClose } from '@/components/ui/Dialog';
import { EmptyState } from '@/components/ui/EmptyState';
import { FormDialog } from '@/components/ui/FormDialog';
import { Input } from '@/components/ui/Input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/Popover';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { Select } from '@/components/ui/Select';
import { toast } from '@/components/ui/toast';
import { useSettle } from '@/hooks/mutation';
import { useProjects } from '@/hooks/projects';
import { useAllUsers, useCurrentUser, useDeactivateUser, useInvitations, useInviteUser, useReactivateUser, useUpdateUserRole } from '@/hooks/users';
import { notifyError } from '@/lib/errors';
import { t } from '@/lib/i18n';
import type { Invitation, OrgRole, Project, ProjectRole, User } from '@/types';
import { fieldMessage, hasReason, noticeOf } from '../frame/form';
import { formatDate, useOrgZone } from '../frame/format';
import { Badge, FieldGroup, Loaded, Panel, Row, Rows, RowsSkeleton, SectionHeader } from '../frame/parts';
import { useDialogRound } from '../frame/useDialogRound';
import type { SectionProps } from './sections';

const ORG_ROLES: OrgRole[] = ['admin', 'member'];
const PROJECT_ROLES: ProjectRole[] = ['admin', 'member', 'viewer'];

const orgRoleName = (role: OrgRole) => t(`roles.org.${role}`);
const projectRoleName = (role: ProjectRole) => t(`roles.project.${role}`);
const orgRoleOptions = () => ORG_ROLES.map((role) => ({ value: role, label: orgRoleName(role) }));

/** The people who count for the "last admin" rule: active people with the role Admin. The default bot does not. */
const isActiveAdmin = (user: User) => user.type === 'person' && user.org_role === 'admin' && user.disabled_at === null;

/* ------------------------------------------------------------------------ invite */

function InviteDialog({ open, onOpenChange, projects }: { open: boolean; onOpenChange: (open: boolean) => void; projects: Project[] }) {
  const settle = useSettle();
  const invite = useInviteUser();
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<OrgRole>('member');
  const [joined, setJoined] = useState<Record<string, ProjectRole>>({});
  const [attempted, setAttempted] = useState(false);
  const [sent, setSent] = useState<{ email: string; link: string } | null>(null);

  const emailError = attempted && email.trim() === '' ? t('settings.people.invite_dialog.email_required') : fieldMessage(invite.error, 'email');

  function submit() {
    setAttempted(true);
    if (email.trim() === '') {
      document.getElementById('invite-email')?.focus();
      return;
    }
    const memberships = Object.entries(joined).map(([project_id, projectRole]) => ({ project_id, role: projectRole }));
    settle(invite.mutateAsync({ email, org_role: role, projects: memberships }), {
      onSuccess: ({ link, invitation }) => setSent({ email: invitation.email, link }),
    });
  }

  if (sent) {
    return (
      <Dialog
        open={open}
        onOpenChange={onOpenChange}
        title={t('settings.people.invite_dialog.sent_title')}
        description={t('settings.people.invite_dialog.sent_description', { email: sent.email })}
        footer={<DialogClose render={<Button variant="primary">{t('settings.people.invite_dialog.done')}</Button>} />}
      >
        <CopyField
          label={t('settings.people.link_label')}
          name="invitation_link"
          buttonLabel={t('settings.people.copy_link')}
          value={sent.link}
          hint={t('settings.people.invite_dialog.sent_hint')}
        />
      </Dialog>
    );
  }

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('settings.people.invite')}
      description={t('settings.people.invite_dialog.description')}
      submitLabel={t('settings.people.invite_dialog.submit')}
      pending={invite.isPending}
      notice={noticeOf(invite.error, ['email'])}
      onSubmit={submit}
    >
      <Input
        id="invite-email"
        name="email"
        type="email"
        inputMode="email"
        label={t('settings.people.invite_dialog.email')}
        autoComplete="off"
        autoCapitalize="none"
        spellCheck={false}
        placeholder={t('settings.people.invite_dialog.email_placeholder')}
        value={email}
        error={emailError}
        onChange={(event) => setEmail(event.target.value)}
      />
      <FieldGroup
        legend={t('settings.people.invite_dialog.role')}
        hint={role === 'admin' ? t('settings.people.invite_dialog.role_admin_hint') : t('settings.people.invite_dialog.role_member_hint')}
      >
        <SegmentedControl label={t('settings.people.invite_dialog.role')} value={role} onValueChange={setRole} options={orgRoleOptions()} />
      </FieldGroup>
      {projects.length > 0 && (
        <FieldGroup legend={t('settings.people.invite_dialog.projects')} hint={t('settings.people.invite_dialog.projects_hint')}>
          <ul className="flex flex-col gap-1">
            {projects.map((project) => (
              <li key={project.id} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                <Checkbox
                  className="min-w-0 flex-1 basis-40"
                  label={
                    <span className="min-w-0 truncate">
                      <span translate="no" className="font-medium">
                        {project.identifier}
                      </span>{' '}
                      {project.name}
                    </span>
                  }
                  checked={project.id in joined}
                  onCheckedChange={(checked) =>
                    setJoined((current) => {
                      const next = { ...current };
                      if (checked) next[project.id] = 'member';
                      else delete next[project.id];
                      return next;
                    })
                  }
                />
                {project.id in joined && (
                  <Select
                    aria-label={t('settings.people.invite_dialog.project_role', { project: project.identifier })}
                    className="w-32"
                    value={joined[project.id]}
                    onValueChange={(next) => next && setJoined((current) => ({ ...current, [project.id]: next as ProjectRole }))}
                    options={PROJECT_ROLES.map((projectRole) => ({ value: projectRole, label: projectRoleName(projectRole) }))}
                  />
                )}
              </li>
            ))}
          </ul>
        </FieldGroup>
      )}
    </FormDialog>
  );
}

/* ------------------------------------------------------------------ invitations */

function InvitationRow({ invitation, projects, zone }: { invitation: Invitation; projects: Project[]; zone: string }) {
  return (
    <Row>
      <div className="min-w-0 flex-1 basis-56">
        <p className="truncate font-medium text-ink" translate="no">
          {invitation.email}
        </p>
        <p className="text-sm text-muted">{t('settings.people.invitations.valid_until', { date: formatDate(invitation.expires_at, zone) })}</p>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge tone="quiet">{orgRoleName(invitation.org_role)}</Badge>
        {invitation.projects.map((entry) => {
          const project = projects.find((candidate) => candidate.id === entry.project_id);
          return (
            <Badge key={entry.project_id} tone="quiet">
              <span translate="no">{project?.identifier ?? '?'}</span> {t('settings.people.invitations.as_role', { role: projectRoleName(entry.role) })}
            </Badge>
          );
        })}
        {/* the inviter lost the admin role or an account with the address exists: the link leads nowhere any more */}
        {invitation.state === 'closed' && <Badge tone="danger">{t('settings.people.invitations.closed')}</Badge>}
      </div>
      {/* a read-only access gets no link (whoever holds it can make an account) */}
      {invitation.link !== null && invitation.state === 'open' && (
        <Popover>
          <PopoverTrigger
            render={
              <Button variant="secondary" size="sm" icon={Link2}>
                {t('settings.people.show_link')} <span className="sr-only">{t('settings.people.show_link_for', { email: invitation.email })}</span>
              </Button>
            }
          />
          <PopoverContent title={t('settings.people.link_label')} align="end" className="w-[min(28rem,calc(100vw-2rem))] p-3">
            <CopyField className="mt-2" label={t('settings.people.link_label')} name="invitation_link" buttonLabel={t('settings.people.copy_link')} value={invitation.link} />
          </PopoverContent>
        </Popover>
      )}
    </Row>
  );
}

/* ----------------------------------------------------------------------- people */

type Refusal = { name: string; what: 'deactivate' | 'demote' };
type SelfAction = { what: 'deactivate' | 'demote'; user: User };

export default function People(_props: SectionProps) {
  const settle = useSettle();
  const users = useAllUsers({ type: 'person' });
  const invitations = useInvitations();
  const projects = useProjects();
  const me = useCurrentUser();
  const zone = useOrgZone();
  const updateRole = useUpdateUserRole();
  const deactivate = useDeactivateUser();
  const reactivate = useReactivateUser();
  const inviteDialog = useDialogRound();
  const [refusal, setRefusal] = useState<Refusal | null>(null);
  const [asking, setAsking] = useState<SelfAction | null>(null);

  const people = [...(users.data?.items ?? [])].sort((a, b) => Number(a.disabled_at !== null) - Number(b.disabled_at !== null));
  const otherAdmin = (user: User) => (users.data?.items ?? []).some((other) => other.id !== user.id && isActiveAdmin(other));

  function refuse(error: unknown, user: User, what: Refusal['what']) {
    if (hasReason(error, 'last_admin')) setRefusal({ name: user.name, what });
    else notifyError(what === 'deactivate' ? t('settings.people.not_deactivated', { name: user.name }) : t('settings.people.role_not_changed', { name: user.name }), error);
  }

  function changeRole(user: User, role: OrgRole) {
    setRefusal(null);
    settle(updateRole.mutateAsync({ user_id: user.id, org_role: role }), {
      onSuccess: () => toast({ title: t('settings.people.role_changed', { name: user.name, role: orgRoleName(role) }), tone: 'success' }),
      onError: (error) => refuse(error, user, 'demote'),
    });
  }

  function runDeactivate(user: User) {
    setRefusal(null);
    settle(deactivate.mutateAsync(user.id), {
      onSuccess: () => {
        if (user.id === me?.id) {
          // the session has ended with the account: the reload brings the server's answer, the sign-in
          toast({ title: t('settings.people.own_deactivated'), tone: 'success' });
          router.reload();
        } else {
          toast({
            title: t('settings.people.deactivated', { name: user.name }),
            description: t('settings.people.deactivated_description'),
            tone: 'success',
            action: { label: t('settings.people.reactivate'), onClick: () => runReactivate(user) },
          });
        }
      },
      onError: (error) => refuse(error, user, 'deactivate'),
    });
  }

  function runReactivate(user: User) {
    settle(reactivate.mutateAsync(user.id), {
      onSuccess: () => toast({ title: t('settings.people.reactivated', { name: user.name }), tone: 'success' }),
      onError: (error) => notifyError(t('settings.people.not_reactivated', { name: user.name }), error, () => runReactivate(user)),
    });
  }

  /** One's own account is asked about when the change would succeed; when it would be refused the server says why. */
  function ask(what: SelfAction['what'], user: User, go: () => void) {
    if (user.id === me?.id && otherAdmin(user)) setAsking({ what, user });
    else go();
  }

  // which row a running call belongs to, so only its own controls show the pending state
  const busyRole = updateRole.isPending ? updateRole.variables?.user_id : undefined;
  const busyDeactivate = deactivate.isPending ? deactivate.variables : undefined;
  const busyReactivate = reactivate.isPending ? reactivate.variables : undefined;

  return (
    <div className="flex flex-col gap-4">
      <SectionHeader
        title={t('settings.org.section.people')}
        description={t('settings.people.description')}
        actions={
          <Button variant="primary" icon={UserPlus} onClick={() => inviteDialog.show()}>
            {t('settings.people.invite')}
          </Button>
        }
      />

      {refusal && (
        <Banner
          tone="danger"
          role="alert"
          title={t('settings.people.last_admin.title', { name: refusal.name })}
          action={
            <Button variant="ghost" size="sm" onClick={() => setRefusal(null)}>
              {t('common.close')}
            </Button>
          }
        >
          {refusal.what === 'deactivate' ? t('settings.people.last_admin.deactivate') : t('settings.people.last_admin.demote')} {t('settings.people.last_admin.text')}
        </Banner>
      )}

      <Loaded queries={[users, projects]} failure={t('settings.people.load_failed')} skeleton={<RowsSkeleton rows={5} label={t('settings.people.loading')} />}>
        {() =>
          people.length === 0 ? (
            <EmptyState icon={UserPlus} title={t('settings.people.empty.title')} description={t('settings.people.empty.description')} />
          ) : (
            <Panel>
              <Rows label={t('settings.org.section.people')}>
                {people.map((person) => {
                  const self = person.id === me?.id;
                  const disabled = person.disabled_at !== null;
                  // the chosen role shows while the call runs, not the old one that is about to change
                  const role = busyRole === person.id && updateRole.variables ? updateRole.variables.org_role : person.org_role;
                  return (
                    <Row key={person.id}>
                      <div className="flex min-w-0 flex-1 basis-60 items-center gap-3">
                        <Avatar user={person} decorative />
                        <div className="min-w-0">
                          <p className="flex flex-wrap items-center gap-x-2">
                            <span className="truncate font-medium text-ink">{person.name}</span>
                            {self && <Badge tone="quiet">{t('settings.people.you')}</Badge>}
                          </p>
                          <p className="flex flex-wrap gap-x-3 text-sm text-muted" translate="no">
                            <span>@{person.handle}</span>
                            <span className="truncate">{person.email}</span>
                          </p>
                        </div>
                      </div>
                      <Select
                        aria-label={t('settings.people.role_of', { name: person.name })}
                        className="w-32"
                        value={role}
                        // read-only, not disabled, while the call runs: a disabled field would drop the keyboard focus
                        readOnly={busyRole === person.id}
                        onValueChange={(next) => {
                          if (!next || next === person.org_role) return;
                          if (next === 'member') ask('demote', person, () => changeRole(person, 'member'));
                          else changeRole(person, 'admin');
                        }}
                        options={orgRoleOptions()}
                      />
                      <div className="flex min-w-32 flex-col items-start gap-0.5">
                        {disabled ? (
                          <>
                            <Badge tone="danger" icon={UserRoundX}>
                              {t('settings.people.disabled')}
                            </Badge>
                            <span className="text-sm text-muted">{t('settings.people.disabled_since', { date: formatDate(person.disabled_at!, zone) })}</span>
                          </>
                        ) : (
                          <Badge icon={UserRoundCheck}>{t('settings.people.active')}</Badge>
                        )}
                      </div>
                      {disabled ? (
                        <Button variant="secondary" pending={busyReactivate === person.id} onClick={() => runReactivate(person)}>
                          {t('settings.people.reactivate')} <span className="sr-only">{person.name}</span>
                        </Button>
                      ) : (
                        <Button variant="ghost" pending={busyDeactivate === person.id} onClick={() => ask('deactivate', person, () => runDeactivate(person))}>
                          {t('settings.people.deactivate')} <span className="sr-only">{person.name}</span>
                        </Button>
                      )}
                    </Row>
                  );
                })}
              </Rows>
            </Panel>
          )
        }
      </Loaded>

      <Panel title={t('settings.people.invitations.title')} description={t('settings.people.invitations.description')}>
        {invitations.isError ? (
          <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
            <p className="text-ui text-pretty text-danger">{t('settings.people.invitations.load_failed')}</p>
            <Button variant="secondary" size="sm" pending={invitations.isFetching} onClick={() => void invitations.refetch()}>
              {t('common.retry')}
            </Button>
          </div>
        ) : invitations.isPending ? (
          <p className="px-4 py-3 text-ui text-muted">{t('settings.people.invitations.loading')}</p>
        ) : invitations.data.items.length === 0 ? (
          <p className="max-w-[65ch] px-4 py-3 text-ui text-pretty text-muted">{t('settings.people.invitations.empty')}</p>
        ) : (
          <Rows label={t('settings.people.invitations.title')}>
            {invitations.data.items.map((invitation) => (
              <InvitationRow key={invitation.id} invitation={invitation} projects={projects.data?.items ?? []} zone={zone} />
            ))}
          </Rows>
        )}
      </Panel>

      <InviteDialog key={inviteDialog.round} open={inviteDialog.open} onOpenChange={inviteDialog.setOpen} projects={projects.data?.items ?? []} />

      <AlertDialog
        open={asking !== null}
        onOpenChange={(open) => !open && setAsking(null)}
        title={asking?.what === 'deactivate' ? t('settings.people.self.deactivate_title') : t('settings.people.self.demote_title')}
        description={asking?.what === 'deactivate' ? t('settings.people.self.deactivate_description') : t('settings.people.self.demote_description')}
        confirmLabel={asking?.what === 'deactivate' ? t('settings.people.self.deactivate_confirm') : t('settings.people.self.demote_confirm')}
        pending={deactivate.isPending || updateRole.isPending}
        onConfirm={() => {
          const action = asking;
          setAsking(null);
          if (!action) return;
          if (action.what === 'deactivate') runDeactivate(action.user);
          else changeRole(action.user, 'member');
        }}
      />
    </div>
  );
}
