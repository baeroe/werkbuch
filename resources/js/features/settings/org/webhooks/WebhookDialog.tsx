/*
 * Creating and changing a webhook (spec 6.3): name, address, scope (the organisation or one project), optionally only one
 * bot, the events as a tree, and whether it is on. A missing field is said before anything is sent; a refusal of the
 * server stands at its field (a private address next to the URL), one without a field on top, and a server that did not
 * answer is a toast with "Erneut versuchen". A new webhook answers its secret, which the list shows once.
 *
 * "Neues Geheimnis erzeugen" is an action of its own beside the form: it asks first, calls only `rotate-secret` and
 * shows the new secret above the form, which stays open with everything typed into it (13c). Both dialogs are nested
 * in this one, so a click into them does not count as a click outside the form.
 */

import { RefreshCw } from 'lucide-react';
import { useEffect, useRef, useState, type RefObject } from 'react';
import { AlertDialog } from '@/components/ui/AlertDialog';
import { Button } from '@/components/ui/Button';
import { FormDialog } from '@/components/ui/FormDialog';
import { Input } from '@/components/ui/Input';
import { ProjectBadge } from '@/components/ui/ProjectBadge';
import { Select } from '@/components/ui/Select';
import { Switch } from '@/components/ui/Switch';
import { toast } from '@/components/ui/toast';
import { useSettle } from '@/hooks/mutation';
import { useRotateWebhookSecret, useSaveWebhook } from '@/hooks/webhooks';
import { isTransient, notifyError } from '@/lib/errors';
import { t } from '@/lib/i18n';
import type { Project, User, Webhook } from '@/types';
import { fieldMessage, noticeOf } from '../../frame/form';
import { EventTree } from './EventTree';
import { SecretDialog, type Secret } from './SecretDialog';

const ORG_SCOPE = 'organization';
const ANY_BOT = 'any';
/** The fields of the form; a refusal of any other path shows as a notice on top. */
// `active` is a switch with no place for a message: a refusal of it shows as the notice on top
const PLACED = ['name', 'url', 'project_id', 'events', 'bot_id'];

type WebhookDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The webhook to change; null creates one. */
  webhook: Webhook | null;
  projects: Project[];
  /** Every bot, deactivated ones included: the form offers the active ones and keeps the one the webhook has. */
  bots: User[];
  /** A new webhook and its secret, to be shown once. */
  onCreated: (secret: Secret) => void;
  /** Where the focus goes when the form or the new secret closes. */
  finalFocus?: RefObject<HTMLElement | null>;
};

export function WebhookDialog({ open, onOpenChange, webhook, projects, bots, onCreated, finalFocus }: WebhookDialogProps) {
  const settle = useSettle();
  const save = useSaveWebhook();
  const rotate = useRotateWebhookSecret();
  const [name, setName] = useState(webhook?.name ?? '');
  const [url, setUrl] = useState(webhook?.url ?? '');
  const [scope, setScope] = useState(webhook?.project_id ?? ORG_SCOPE);
  const [events, setEvents] = useState<string[]>(webhook?.events ?? []);
  const [bot, setBot] = useState(webhook?.bot_id ?? ANY_BOT);
  const [active, setActive] = useState(webhook?.active ?? true);
  const [attempted, setAttempted] = useState(false);
  const [asking, setAsking] = useState(false);
  const [secret, setSecret] = useState<Secret | null>(null);
  const renewButton = useRef<HTMLButtonElement>(null);
  // "Try again" of a toast sends the form as it is by then, not as it was when the toast came up
  const latest = useRef<() => void>(() => {});

  // a refusal that is no answer of the server (5xx, none at all) is a toast to try again, not a notice in the form
  const refusal = save.error && !isTransient(save.error) ? save.error : null;
  const nameError = attempted && name.trim() === '' ? t('settings.webhooks.dialog.name_required') : fieldMessage(refusal, 'name');
  const urlError = attempted && url.trim() === '' ? t('settings.webhooks.dialog.url_required') : fieldMessage(refusal, 'url');
  const eventsError = attempted && events.length === 0 ? t('settings.webhooks.dialog.events_required') : fieldMessage(refusal, 'events');
  const offered = bots.filter((entry) => entry.disabled_at === null || entry.id === webhook?.bot_id);

  function submit() {
    // ⌘↵ over the question or the new secret belongs to them, not to the form below
    if (asking || secret) return;
    setAttempted(true);
    if (name.trim() === '' || url.trim() === '' || events.length === 0) {
      const target = name.trim() === '' ? 'webhook-name' : url.trim() === '' ? 'webhook-url' : null;
      (target ? document.getElementById(target) : document.querySelector<HTMLElement>('[data-event-tree] [role="checkbox"]'))?.focus();
      return;
    }
    const input = { name, url, project_id: scope === ORG_SCOPE ? null : scope, events, bot_id: bot === ANY_BOT ? null : bot, active };
    settle(save.mutateAsync(webhook ? { id: webhook.id, ...input } : input), {
      onSuccess: ({ webhook: saved, secret: created }) => {
        // the list holds the secret now; the call's answer lets go of it (and leaves the cache, gcTime 0)
        save.reset();
        onOpenChange(false);
        if (created) onCreated({ kind: 'created', name: saved.name, value: created });
        else toast({ title: t('settings.webhooks.dialog.saved', { name: saved.name }), tone: 'success' });
      },
      onError: (error) => {
        if (isTransient(error)) notifyError(t('settings.webhooks.dialog.not_saved'), error, () => latest.current());
      },
    });
  }

  useEffect(() => {
    latest.current = submit;
  });

  function renew(target: Webhook) {
    settle(rotate.mutateAsync(target.id), {
      onSuccess: ({ webhook: renewed, secret: value }) => {
        rotate.reset();
        setAsking(false);
        if (value) setSecret({ kind: 'rotated', name: renewed.name, value });
      },
      onError: (error) => {
        setAsking(false);
        notifyError(t('settings.webhooks.rotate.failed'), error, () => renew(target));
      },
    });
  }

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      size="lg"
      title={webhook ? t('settings.webhooks.dialog.edit_title', { name: webhook.name }) : t('settings.webhooks.dialog.new_title')}
      description={t('settings.webhooks.dialog.description')}
      submitLabel={webhook ? t('settings.frame.save') : t('settings.webhooks.dialog.submit_create')}
      pending={save.isPending}
      notice={noticeOf(refusal, PLACED)}
      finalFocus={finalFocus}
      onSubmit={submit}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Input id="webhook-name" name="name" label={t('settings.webhooks.dialog.name')} autoComplete="off" value={name} error={nameError} onChange={(event) => setName(event.target.value)} />
        <Input
          id="webhook-url"
          name="url"
          label={t('settings.webhooks.dialog.url')}
          hint={t('settings.webhooks.dialog.url_hint')}
          inputMode="url"
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          translate="no"
          placeholder={t('settings.webhooks.dialog.url_placeholder')}
          value={url}
          error={urlError}
          onChange={(event) => setUrl(event.target.value)}
        />
        <Select
          label={t('settings.webhooks.scope')}
          // a project webhook without a bot reads like an org admin (K10): it names keys in other projects
          hint={scope !== ORG_SCOPE && bot === ANY_BOT ? t('settings.webhooks.scope_hint') : t('settings.webhooks.dialog.scope_hint')}
          error={fieldMessage(refusal, 'project_id')}
          value={scope}
          onValueChange={(next) => next && setScope(next)}
          options={[
            { value: ORG_SCOPE, label: t('settings.webhooks.scope_org') },
            ...projects.map((project) => ({ value: project.id, label: `${project.identifier} ${project.name}`, icon: <ProjectBadge project={project} /> })),
          ]}
        />
        <Select
          label={t('settings.webhooks.dialog.bot')}
          hint={t('settings.webhooks.dialog.bot_hint')}
          error={fieldMessage(refusal, 'bot_id')}
          value={bot}
          onValueChange={(next) => next && setBot(next)}
          options={[{ value: ANY_BOT, label: t('settings.webhooks.dialog.bot_any') }, ...offered.map((entry) => ({ value: entry.id, label: entry.name }))]}
        />
      </div>
      <EventTree value={events} onChange={setEvents} error={eventsError} />
      <Switch label={t('settings.webhooks.dialog.active')} checked={active} onCheckedChange={setActive} />
      {webhook && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-ctl border border-line bg-sunken px-3 py-2.5">
          <p className="max-w-[46ch] text-sm text-pretty text-muted">{t('settings.webhooks.dialog.secret_note')}</p>
          <Button ref={renewButton} variant="secondary" icon={RefreshCw} pending={rotate.isPending} onClick={() => setAsking(true)}>
            {t('settings.webhooks.rotate.button')}
          </Button>
        </div>
      )}
      <AlertDialog
        open={asking}
        onOpenChange={(next) => !rotate.isPending && setAsking(next)}
        title={t('settings.webhooks.rotate.title')}
        description={t('settings.webhooks.rotate.description')}
        confirmLabel={t('settings.webhooks.rotate.button')}
        pending={rotate.isPending}
        onConfirm={() => webhook && renew(webhook)}
      />
      <SecretDialog secret={secret} onClose={() => setSecret(null)} finalFocus={renewButton} />
    </FormDialog>
  );
}
