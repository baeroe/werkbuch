/*
 * Webhooks (spec 6.3): where werkbuch sends events, signed with a secret that is shown once. The list marks a webhook
 * the system shut down after 24 hours without a success and lets an admin turn it on again; the log of deliveries is a
 * view of this section (`?deliveries=<id>`). A form takes name, address, scope, the events as a tree and an optional
 * bot; the address is checked against private networks by the server and the refusal stands next to the field.
 */

import { Pencil, Plus, RefreshCw, ScrollText, Send, Trash2, Webhook as WebhookIcon } from 'lucide-react';
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { AlertDialog } from '@/components/ui/AlertDialog';
import { Button, buttonClass } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';
import { EmptyState } from '@/components/ui/EmptyState';
import { Input } from '@/components/ui/Input';
import { ProjectBadge } from '@/components/ui/ProjectBadge';
import { Select } from '@/components/ui/Select';
import { Switch } from '@/components/ui/Switch';
import { toast } from '@/components/ui/toast';
import { useProjects } from '@/hooks/projects';
import { useUsers } from '@/hooks/users';
import { useDeleteWebhook, usePingWebhook, useSaveWebhook, useWebhooks } from '@/hooks/webhooks';
import { useSettle } from '@/hooks/mutation';
import { notifyError } from '@/lib/errors';
import type { Project, User, Webhook } from '@/types';
import { eventLabel } from './catalog';
import { fieldMessage, noticeOf } from './errors';
import { EventTree } from './EventTree';
import { formatDateTime, useOrgZone } from './format';
import { FormDialog } from './FormDialog';
import { Loaded, RowsSkeleton, SectionHeader } from './parts';
import { SecretDialog, type Secret } from './SecretDialog';
import type { SectionProps } from './sections';
import { useDialogRound } from './useDialogRound';
import { useRemoval } from './useRemoval';
import { WebhookDeliveries } from './WebhookDeliveries';
import { DisabledNotice, StateBadge, toastDelivery } from './webhookParts';

/* ------------------------------------------------------------------------- form */

const ORG_SCOPE = 'organization';
const ANY_BOT = 'any';

type WebhookDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The webhook to change; null creates one. */
  webhook: Webhook | null;
  projects: Project[];
  bots: User[];
  onSecret: (secret: Secret) => void;
};

function WebhookDialog({ open, onOpenChange, webhook, projects, bots, onSecret }: WebhookDialogProps) {
  const settle = useSettle();
  const save = useSaveWebhook();
  const [name, setName] = useState(webhook?.name ?? '');
  const [url, setUrl] = useState(webhook?.url ?? '');
  const [scope, setScope] = useState(webhook?.project_id ?? ORG_SCOPE);
  const [events, setEvents] = useState<string[]>(webhook?.events ?? []);
  const [bot, setBot] = useState(webhook?.bot_id ?? ANY_BOT);
  const [active, setActive] = useState(webhook?.active ?? true);
  const [attempted, setAttempted] = useState(false);
  const [renewing, setRenewing] = useState(false);

  const nameError = attempted && name.trim() === '' ? 'Gib dem Webhook einen Namen.' : fieldMessage(save.error, 'name');
  const urlError = attempted && url.trim() === '' ? 'Gib die Adresse ein, an die werkbuch sendet.' : fieldMessage(save.error, 'url');
  const eventsError = attempted && events.length === 0 ? 'Wähle mindestens ein Ereignis.' : fieldMessage(save.error, 'events');

  function reveal(created: Webhook, secret: string) {
    onOpenChange(false);
    // the secret dialog has it now; the call's answer lets go of it (and leaves the cache, gcTime 0)
    save.reset();
    onSecret({
      title: webhook ? 'Neues Geheimnis ist erzeugt' : 'Webhook ist angelegt',
      description: `„${created.name}“. Der Empfänger prüft damit die Signatur jeder Zustellung.`,
      heading: 'Kopiere das Geheimnis jetzt',
      once: 'Du siehst es nur dieses eine Mal. Später kannst du nur ein neues erzeugen, das dann das alte ablöst.',
      label: 'Geheimnis',
      value: secret,
      copyLabel: 'Geheimnis kopieren',
    });
  }

  function submit() {
    setAttempted(true);
    if (name.trim() === '' || url.trim() === '' || events.length === 0) {
      document.getElementById(name.trim() === '' ? 'webhook-name' : 'webhook-url')?.focus();
      return;
    }
    settle(save.mutateAsync({ webhook: { id: webhook?.id, name, url, project_id: scope === ORG_SCOPE ? null : scope, events, bot_id: bot === ANY_BOT ? null : bot, active } }), {
      onSuccess: ({ webhook: saved, secret }) => {
        if (secret) reveal(saved, secret);
        else {
          onOpenChange(false);
          toast({ title: `Webhook „${saved.name}“ gespeichert`, tone: 'success' });
        }
      },
    });
  }

  function renew() {
    if (!webhook) return;
    setRenewing(false);
    settle(save.mutateAsync({ webhook: { id: webhook.id, name: webhook.name, url: webhook.url, project_id: webhook.project_id, events: webhook.events, bot_id: webhook.bot_id, active: webhook.active }, options: { renew_secret: true } }), {
      onSuccess: ({ webhook: saved, secret }) => secret && reveal(saved, secret),
      onError: (error) => notifyError('Geheimnis nicht erneuert', error, renew),
    });
  }

  return (
    <>
      <FormDialog
        open={open}
        onOpenChange={onOpenChange}
        size="lg"
        title={webhook ? `Webhook „${webhook.name}“ bearbeiten` : 'Webhook anlegen'}
        description="werkbuch schickt die gewählten Ereignisse als JSON an die Adresse, signiert mit einem Geheimnis."
        submitLabel={webhook ? 'Speichern' : 'Anlegen'}
        pending={save.isPending && !renewing}
        notice={noticeOf(save.error, ['name', 'url', 'events'])}
        onSubmit={submit}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Input id="webhook-name" name="name" label="Name" autoComplete="off" value={name} error={nameError} onChange={(event) => setName(event.target.value)} />
          <Input
            id="webhook-url"
            name="url"
            label="URL"
            hint="Adressen in privaten Netzen, etwa localhost oder 192.168.x.x, sind gesperrt."
            inputMode="url"
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            placeholder="https://beispiel.example/hook …"
            value={url}
            error={urlError}
            onChange={(event) => setUrl(event.target.value)}
          />
          <Select
            label="Geltungsbereich"
            hint="Gilt für die ganze Organisation oder nur für ein Projekt."
            value={scope}
            onValueChange={(next) => next && setScope(next)}
            options={[
              { value: ORG_SCOPE, label: 'Gesamte Organisation' },
              ...projects.map((project) => ({ value: project.id, label: `${project.identifier} ${project.name}`, icon: <ProjectBadge project={project} /> })),
            ]}
          />
          <Select
            label="Nur für einen Bot"
            hint="Optional: nur Ereignisse, die diesen Bot betreffen."
            value={bot}
            onValueChange={(next) => next && setBot(next)}
            options={[{ value: ANY_BOT, label: 'Alle' }, ...bots.map((entry) => ({ value: entry.id, label: entry.name }))]}
          />
        </div>
        <EventTree value={events} onChange={setEvents} error={eventsError} />
        <Switch label="Aktiv" checked={active} onCheckedChange={setActive} />
        {webhook && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-ctl border border-line bg-sunken px-3 py-2.5">
            <p className="max-w-[46ch] text-sm text-pretty text-muted">Das Geheimnis siehst du nur beim Anlegen. Hast du es verloren, erzeuge ein neues und trage es beim Empfänger ein.</p>
            <Button variant="secondary" icon={RefreshCw} onClick={() => setRenewing(true)}>
              Neues Geheimnis erzeugen
            </Button>
          </div>
        )}
      </FormDialog>
      <AlertDialog
        open={renewing}
        onOpenChange={setRenewing}
        title="Neues Geheimnis erzeugen?"
        description="Das alte Geheimnis gilt sofort nicht mehr. Der Empfänger lehnt Zustellungen ab, bis du ihm das neue gegeben hast."
        confirmLabel="Neues Geheimnis erzeugen"
        pending={save.isPending}
        onConfirm={renew}
      />
    </>
  );
}

/* ------------------------------------------------------------------------- list */

function scopeOf(webhook: Webhook, projects: Project[]) {
  if (webhook.project_id === null) return 'Gesamte Organisation';
  const project = projects.find((entry) => entry.id === webhook.project_id);
  return project ? `${project.identifier} ${project.name}` : 'Ein Projekt';
}

const SHOWN_EVENTS = 3;

function WebhookCard({ webhook, projects, bots, onEdit, onDelete }: { webhook: Webhook; projects: Project[]; bots: User[]; onEdit: () => void; onDelete: () => void }) {
  const settle = useSettle();
  const ping = usePingWebhook();
  const zone = useOrgZone();
  const bot = bots.find((entry) => entry.id === webhook.bot_id);
  const shown = webhook.events.slice(0, SHOWN_EVENTS);
  const titleId = `webhook-${webhook.id}`;

  function runPing() {
    settle(ping.mutateAsync(webhook.id), {
      onSuccess: (delivery) => toastDelivery('Test-Ping', webhook, delivery),
      onError: (error) => notifyError('Test-Ping nicht gesendet', error, runPing),
    });
  }

  return (
    <article aria-labelledby={titleId} className="flex flex-col gap-3 rounded-card border border-line bg-surface p-4 shadow-elev-1">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0 flex-1 basis-64">
          <div className="flex flex-wrap items-center gap-2">
            <h3 id={titleId} className="font-display text-lg font-bold tracking-title break-words text-ink">
              {webhook.name}
            </h3>
            <StateBadge webhook={webhook} />
          </div>
          <p className="mt-0.5 text-ui break-all text-muted" translate="no">
            {webhook.url}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link to={{ search: `?deliveries=${webhook.id}` }} className={buttonClass({ variant: 'secondary' })}>
            <ScrollText className="size-4 text-muted" aria-hidden="true" />
            Zustellungen{' '}
            <span className="sr-only">von {webhook.name}</span>
          </Link>
          <Button variant="secondary" icon={Send} pending={ping.isPending} onClick={runPing}>
            Test-Ping{' '}
            <span className="sr-only">an {webhook.name}</span>
          </Button>
          <Button variant="ghost" icon={Pencil} onClick={onEdit}>
            Bearbeiten{' '}
            <span className="sr-only">{webhook.name}</span>
          </Button>
          <Button variant="ghost" icon={Trash2} onClick={onDelete}>
            Löschen{' '}
            <span className="sr-only">{webhook.name}</span>
          </Button>
        </div>
      </div>

      <DisabledNotice webhook={webhook} />

      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-ui">
        <dt className="text-muted">Geltungsbereich</dt>
        <dd className="text-ink">{scopeOf(webhook, projects)}</dd>
        <dt className="text-muted">Ereignisse</dt>
        <dd className="min-w-0">
          <ul className="flex flex-wrap gap-1.5">
            {shown.map((event) => (
              <li key={event}>
                <Chip>{eventLabel(event)}</Chip>
              </li>
            ))}
            {webhook.events.length > SHOWN_EVENTS && (
              <li>
                <Chip>+{webhook.events.length - SHOWN_EVENTS} weitere</Chip>
              </li>
            )}
          </ul>
        </dd>
        {bot && (
          <>
            <dt className="text-muted">Nur für Bot</dt>
            <dd className="text-ink">{bot.name}</dd>
          </>
        )}
        <dt className="text-muted">Angelegt</dt>
        <dd className="text-ink">{formatDateTime(webhook.created_at, zone)}</dd>
      </dl>
    </article>
  );
}

function WebhookList() {
  const webhooks = useWebhooks();
  const projects = useProjects({ include_archived: true });
  const users = useUsers();
  const remove = useDeleteWebhook();
  const { hidden, remove: removeWithUndo } = useRemoval();
  const dialog = useDialogRound<Webhook>();
  const [secret, setSecret] = useState<Secret | null>(null);
  const bots = (users.data?.items ?? []).filter((user) => user.type === 'bot' && user.disabled_at === null);

  return (
    <div className="flex flex-col gap-4">
      <SectionHeader
        title="Webhooks"
        description={'Schicken Ereignisse aus werkbuch an andere Systeme, etwa an einen Agenten, der auf „Bot zugewiesen“ wartet. Jede Zustellung ist signiert und wird 30\u00a0Tage protokolliert.'}
        actions={
          <Button variant="primary" icon={Plus} onClick={() => dialog.show()}>
            Webhook anlegen
          </Button>
        }
      />
      <Loaded queries={[webhooks, projects, users]} failure="Die Webhooks konnten nicht geladen werden" skeleton={<RowsSkeleton rows={3} label="Die Webhooks werden geladen …" />}>
        {() => {
          const shown = (webhooks.data?.items ?? []).filter((webhook) => !hidden.has(webhook.id));
          if (shown.length === 0) {
            return (
              <EmptyState
                icon={WebhookIcon}
                title="Noch kein Webhook"
                description="Ein Webhook meldet Ereignisse wie „Status geändert“ oder „Bot zugewiesen“ an eine Adresse, damit andere Systeme darauf reagieren."
                actions={
                  <Button variant="primary" icon={Plus} onClick={() => dialog.show()}>
                    Webhook anlegen
                  </Button>
                }
              />
            );
          }
          return (
            <ul className="flex flex-col gap-3">
              {shown.map((webhook) => (
                <li key={webhook.id}>
                  <WebhookCard
                    webhook={webhook}
                    projects={projects.data?.items ?? []}
                    bots={users.data?.items ?? []}
                    onEdit={() => dialog.show(webhook)}
                    onDelete={() =>
                      removeWithUndo({
                        id: webhook.id,
                        label: `Webhook „${webhook.name}“ gelöscht`,
                        failureTitle: `Webhook „${webhook.name}“ nicht gelöscht`,
                        run: () => remove.mutateAsync(webhook.id),
                      })
                    }
                  />
                </li>
              ))}
            </ul>
          );
        }}
      </Loaded>
      <WebhookDialog key={dialog.round} open={dialog.open} onOpenChange={dialog.setOpen} webhook={dialog.target} projects={projects.data?.items ?? []} bots={bots} onSecret={setSecret} />
      <SecretDialog secret={secret} onClose={() => setSecret(null)} />
    </div>
  );
}

export default function Webhooks(_props: SectionProps) {
  const [params, setParams] = useSearchParams();
  const log = params.get('deliveries');
  if (log) return <WebhookDeliveries webhookId={log} onClose={() => setParams({})} closeTo={{ search: '' }} />;
  return <WebhookList />;
}

