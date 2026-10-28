/*
 * Personen (spec 4.2): who has an account, with which organisation role, and who was deactivated. Admins invite by
 * e-mail (the dialog ends in a link to copy, valid for seven days), change roles, and deactivate and reactivate
 * accounts. The last active admin among the people can neither be demoted nor deactivated: the server refuses with
 * 409 `last_admin` and the page says so in a message that stays until it is closed. Changing or deactivating one's own
 * account asks first, because it ends one's access to this page.
 */

import { Link2, UserPlus, UserRoundCheck, UserRoundX } from 'lucide-react';
import { useState } from 'react';
import { AlertDialog } from '@/components/ui/AlertDialog';
import { Avatar } from '@/components/ui/Avatar';
import { Banner } from '@/components/ui/Banner';
import { Button } from '@/components/ui/Button';
import { Checkbox } from '@/components/ui/Checkbox';
import { Dialog, DialogClose } from '@/components/ui/Dialog';
import { EmptyState } from '@/components/ui/EmptyState';
import { Input } from '@/components/ui/Input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/Popover';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { Select } from '@/components/ui/Select';
import { toast } from '@/components/ui/toast';
import { useProjects } from '@/hooks/projects';
import { useSession } from '@/store/session';
import { useCurrentUser, useDeactivateUser, useInvitations, useInviteUser, useReactivateUser, useUpdateUserRole, useUsers } from '@/hooks/users';
import { notifyError } from '@/lib/errors';
import type { Invitation, OrgRole, Project, ProjectRole, User } from '@/types';
import { CopyField } from './CopyField';
import { fieldMessage, hasReason, noticeOf } from './errors';
import { formatDate, useOrgZone } from './format';
import { FormDialog } from './FormDialog';
import { Badge, FieldGroup, Loaded, Panel, Row, Rows, RowsSkeleton, SectionHeader } from './parts';
import type { SectionProps } from './sections';
import { useDialogRound } from './useDialogRound';

const ROLE_OPTIONS: { value: OrgRole; label: string }[] = [
  { value: 'admin', label: 'Admin' },
  { value: 'member', label: 'Member' },
];

const PROJECT_ROLE_OPTIONS: { value: ProjectRole; label: string }[] = [
  { value: 'admin', label: 'Admin' },
  { value: 'member', label: 'Member' },
  { value: 'viewer', label: 'Viewer' },
];

const ROLE_NAME: Record<OrgRole, string> = { admin: 'Admin', member: 'Member' };
const PROJECT_ROLE_NAME: Record<ProjectRole, string> = { admin: 'Admin', member: 'Member', viewer: 'Viewer' };

/** The people who count for the "last admin" rule: active people with the role Admin. The default bot does not. */
const isActiveAdmin = (user: User) => user.type === 'person' && user.org_role === 'admin' && user.disabled_at === null;

/* ------------------------------------------------------------------------ invite */

function InviteDialog({ open, onOpenChange, projects }: { open: boolean; onOpenChange: (open: boolean) => void; projects: Project[] }) {
  const invite = useInviteUser();
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<OrgRole>('member');
  const [joined, setJoined] = useState<Record<string, ProjectRole>>({});
  const [attempted, setAttempted] = useState(false);
  const [sent, setSent] = useState<{ email: string; link: string } | null>(null);

  const emailError = attempted && email.trim() === '' ? 'Gib die E-Mail-Adresse der Person ein.' : fieldMessage(invite.error, 'email');

  function submit() {
    setAttempted(true);
    if (email.trim() === '') {
      document.getElementById('invite-email')?.focus();
      return;
    }
    invite.mutate(
      { email, org_role: role, projects: Object.entries(joined).map(([project_id, projectRole]) => ({ project_id, role: projectRole })) },
      { onSuccess: ({ link, invitation }) => setSent({ email: invitation.email, link }) },
    );
  }

  if (sent) {
    return (
      <Dialog
        open={open}
        onOpenChange={onOpenChange}
        title="Einladung ist angelegt"
        description={`Für ${sent.email}. Der Link ist sieben Tage gültig, eine neue Einladung an dieselbe Adresse ersetzt ihn.`}
        footer={<DialogClose render={<Button variant="primary">Fertig</Button>} />}
      >
        <CopyField label="Einladungslink" buttonLabel="Link kopieren" value={sent.link} hint="Die Einladung geht per E-Mail raus. Ohne Mailserver gibst du den Link selbst weiter." />
      </Dialog>
    );
  }

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Person einladen"
      description="Die Person bekommt einen Link, legt damit ihr Passwort fest und ist danach Teil der Organisation."
      submitLabel="Einladen"
      pending={invite.isPending}
      notice={noticeOf(invite.error, ['email'])}
      onSubmit={submit}
    >
      <Input
        id="invite-email"
        name="email"
        type="email"
        inputMode="email"
        label="E-Mail-Adresse"
        autoComplete="off"
        autoCapitalize="none"
        spellCheck={false}
        placeholder="name@firma.example …"
        value={email}
        error={emailError}
        onChange={(event) => setEmail(event.target.value)}
      />
      <FieldGroup legend="Rolle in der Organisation" hint={role === 'admin' ? 'Admins verwalten die Organisation und sehen alle Projekte, auch private.' : 'Member sehen die öffentlichen Projekte und treten ihnen mit einem Klick bei.'}>
        <SegmentedControl label="Rolle in der Organisation" value={role} onValueChange={setRole} options={ROLE_OPTIONS} />
      </FieldGroup>
      {projects.length > 0 && (
        <FieldGroup legend="Projekte" hint="Optional: Die Person ist nach dem Annehmen gleich Mitglied dieser Projekte.">
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
                    aria-label={`Rolle in ${project.identifier}`}
                    className="w-32"
                    value={joined[project.id]}
                    onValueChange={(next) => next && setJoined((current) => ({ ...current, [project.id]: next as ProjectRole }))}
                    options={PROJECT_ROLE_OPTIONS}
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
        <p className="text-sm text-muted">Gültig bis {formatDate(invitation.expires_at, zone)}</p>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge tone="quiet">{ROLE_NAME[invitation.org_role]}</Badge>
        {invitation.projects.map((entry) => {
          const project = projects.find((candidate) => candidate.id === entry.project_id);
          return (
            <Badge key={entry.project_id} tone="quiet">
              <span translate="no">{project?.identifier ?? '?'}</span> als {PROJECT_ROLE_NAME[entry.role]}
            </Badge>
          );
        })}
      </div>
      <Popover>
        <PopoverTrigger
          render={
            <Button variant="secondary" size="sm" icon={Link2}>
              Link anzeigen{' '}<span className="sr-only">für {invitation.email}</span>
            </Button>
          }
        />
        <PopoverContent title="Einladungslink" align="end" className="w-[min(28rem,calc(100vw-2rem))] p-3">
          <CopyField className="mt-2" label="Einladungslink" buttonLabel="Link kopieren" value={invitation.link} />
        </PopoverContent>
      </Popover>
    </Row>
  );
}

/* ----------------------------------------------------------------------- people */

type Refusal = { name: string; what: 'deactivate' | 'demote' };
type SelfAction = { what: 'deactivate' | 'demote'; user: User };

export default function People(_props: SectionProps) {
  const users = useUsers();
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

  const people = (users.data?.items ?? []).filter((user) => user.type === 'person').sort((a, b) => Number(a.disabled_at !== null) - Number(b.disabled_at !== null));
  const otherAdmin = (user: User) => (users.data?.items ?? []).some((other) => other.id !== user.id && isActiveAdmin(other));

  function refuse(error: unknown, user: User, what: Refusal['what']) {
    if (hasReason(error, 'last_admin')) setRefusal({ name: user.name, what });
    else notifyError(what === 'deactivate' ? `${user.name} nicht deaktiviert` : `Rolle von ${user.name} nicht geändert`, error);
  }

  function changeRole(user: User, role: OrgRole) {
    setRefusal(null);
    updateRole.mutate(
      { user_id: user.id, org_role: role },
      {
        onSuccess: () => toast({ title: `${user.name} ist jetzt ${ROLE_NAME[role]}`, tone: 'success' }),
        onError: (error) => refuse(error, user, 'demote'),
      },
    );
  }

  function runDeactivate(user: User) {
    setRefusal(null);
    deactivate.mutate(user.id, {
      onSuccess: () => {
        if (user.id === me?.id) {
          // the account that deactivated itself has no session any more, and the fake API would refuse every call it
          // makes: the demo carries on as the admin who made this possible, which the toast says
          const successor = (users.data?.items ?? []).find((other) => other.id !== user.id && isActiveAdmin(other));
          if (successor) useSession.getState().setUserId(successor.id);
          toast({
            title: 'Dein Konto ist deaktiviert',
            description: successor ? `Der Klickdummy meldet dich jetzt als ${successor.name} an, damit die Seite nicht leer bleibt.` : undefined,
            tone: 'success',
          });
        } else toast({ title: `${user.name} ist deaktiviert`, description: 'Tokens und Sitzungen sind widerrufen. Verlauf und Zuweisungen bleiben.', tone: 'success', action: { label: 'Reaktivieren', onClick: () => runReactivate(user) } });
      },
      onError: (error) => refuse(error, user, 'deactivate'),
    });
  }

  function runReactivate(user: User) {
    reactivate.mutate(user.id, {
      onSuccess: () => toast({ title: `${user.name} ist wieder aktiv`, tone: 'success' }),
      onError: (error) => notifyError(`${user.name} nicht reaktiviert`, error, () => runReactivate(user)),
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
        title="Personen"
        description="Wer Zugang hat und mit welcher Rolle. Konten werden deaktiviert, nicht gelöscht: Verlauf, Kommentare und Zuweisungen bleiben erhalten."
        actions={
          <Button variant="primary" icon={UserPlus} onClick={() => inviteDialog.show()}>
            Person einladen
          </Button>
        }
      />

      {refusal && (
        <Banner
          tone="danger"
          role="alert"
          title={`${refusal.name} ist der letzte aktive Admin`}
          action={
            <Button variant="ghost" size="sm" onClick={() => setRefusal(null)}>
              Schließen
            </Button>
          }
        >
          {refusal.what === 'deactivate' ? 'Das Konto bleibt aktiv. ' : 'Die Rolle bleibt Admin. '}
          Eine Organisation braucht mindestens einen aktiven Admin unter den Personen. Mache zuerst jemand anderen zum Admin.
        </Banner>
      )}

      <Loaded queries={[users, projects]} failure="Die Personen konnten nicht geladen werden" skeleton={<RowsSkeleton rows={5} label="Die Personen werden geladen …" />}>
        {() =>
          people.length === 0 ? (
            <EmptyState icon={UserPlus} title="Noch niemand außer dir" description="Lade Kolleginnen und Kollegen per E-Mail ein. Sie bekommen einen Link, der sieben Tage gilt." />
          ) : (
            <Panel>
              <Rows label="Personen">
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
                            {self && <Badge tone="quiet">Du</Badge>}
                          </p>
                          <p className="flex flex-wrap gap-x-3 text-sm text-muted" translate="no">
                            <span>@{person.handle}</span>
                            <span className="truncate">{person.email}</span>
                          </p>
                        </div>
                      </div>
                      <Select
                        aria-label={`Rolle von ${person.name}`}
                        className="w-32"
                        value={role}
                        disabled={busyRole === person.id}
                        onValueChange={(next) => {
                          if (!next || next === person.org_role) return;
                          if (next === 'member') ask('demote', person, () => changeRole(person, 'member'));
                          else changeRole(person, 'admin');
                        }}
                        options={ROLE_OPTIONS}
                      />
                      <div className="flex min-w-32 flex-col items-start gap-0.5">
                        {disabled ? (
                          <>
                            <Badge tone="danger" icon={UserRoundX}>
                              Deaktiviert
                            </Badge>
                            <span className="text-sm text-muted">seit {formatDate(person.disabled_at!, zone)}</span>
                          </>
                        ) : (
                          <Badge icon={UserRoundCheck}>Aktiv</Badge>
                        )}
                      </div>
                      {disabled ? (
                        <Button variant="secondary" pending={busyReactivate === person.id} onClick={() => runReactivate(person)}>
                          Reaktivieren{' '}<span className="sr-only">{person.name}</span>
                        </Button>
                      ) : (
                        <Button variant="ghost" pending={busyDeactivate === person.id} onClick={() => ask('deactivate', person, () => runDeactivate(person))}>
                          Deaktivieren{' '}<span className="sr-only">{person.name}</span>
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

      <Panel title="Offene Einladungen" description="Der Link ist sieben Tage gültig. Eine neue Einladung an dieselbe Adresse ersetzt die alte.">
        {invitations.isError ? (
          <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
            <p className="text-ui text-pretty text-danger">Die Einladungen konnten nicht geladen werden.</p>
            <Button variant="secondary" size="sm" pending={invitations.isFetching} onClick={() => void invitations.refetch()}>
              Erneut versuchen
            </Button>
          </div>
        ) : invitations.isPending ? (
          <p className="px-4 py-3 text-ui text-muted">Die Einladungen werden geladen …</p>
        ) : invitations.data.items.length === 0 ? (
          <p className="max-w-[65ch] px-4 py-3 text-ui text-pretty text-muted">Keine offenen Einladungen. Mit „Person einladen“ legst du eine an und bekommst den Link zum Weitergeben.</p>
        ) : (
          <Rows label="Offene Einladungen">
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
        title={asking?.what === 'deactivate' ? 'Dein eigenes Konto deaktivieren?' : 'Deine Admin-Rechte abgeben?'}
        description={
          asking?.what === 'deactivate'
            ? 'Du verlierst den Zugang sofort, deine Tokens und Sitzungen werden widerrufen. Ein anderer Admin kann dich wieder aktivieren.'
            : 'Du bist danach Member und siehst diese Einstellungen nicht mehr. Ein anderer Admin kann dich wieder zum Admin machen.'
        }
        confirmLabel={asking?.what === 'deactivate' ? 'Mich deaktivieren' : 'Zum Member machen'}
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
