/*
 * Bots (spec 4.2): accounts without a login that work through tokens, such as an agent that takes items assigned to
 * it. Each bot card holds its tokens: name, abilities, expiry and last use. The plain text of a new token appears once,
 * in a dialog of its own. The default bot ("Automation") is the one automations act as: it has a badge, can be renamed
 * but neither deactivated nor deleted, and since it is an admin its tokens are too, which the page says every time
 * they come up. Admins manage the tokens of all bots; people manage their own under "Persönlich".
 */

import { Bot as BotIcon, Pencil, Plus, ShieldAlert, Trash2, UserRoundCheck, UserRoundX } from 'lucide-react';
import { useState } from 'react';
import { Avatar } from '@/components/ui/Avatar';
import { Banner } from '@/components/ui/Banner';
import { Button } from '@/components/ui/Button';
import { Checkbox } from '@/components/ui/Checkbox';
import { EmptyState } from '@/components/ui/EmptyState';
import { IconButton } from '@/components/ui/IconButton';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Textarea } from '@/components/ui/Textarea';
import { toast } from '@/components/ui/toast';
import { createZone } from '@/domain/tz';
import { DatePopover } from '@/components/fields/DateField';
import { botWord, formatDay } from '@/components/fields/format';
import { useToday } from '@/components/fields/itemData';
import { useCreateToken, useRevokeToken, useTokens } from '@/hooks/tokens';
import { useCreateBot, useCurrentUser, useDeactivateUser, useReactivateUser, useUpdateUser, useUsers } from '@/hooks/users';
import { useSettle } from '@/hooks/mutation';
import { now } from '@/lib/clock';
import { notifyError } from '@/lib/errors';
import type { Token, TokenAbility, User } from '@/types';
import { ABILITIES, ABILITY_NAMES } from './catalog';
import { fieldMessage, noticeOf } from './errors';
import { formatDate, relativeTime, useOrgZone } from './format';
import { FormDialog } from './FormDialog';
import { Badge, FieldGroup, Loaded, Row, Rows, RowsSkeleton, SectionHeader } from './parts';
import { SecretDialog, type Secret } from './SecretDialog';
import type { SectionProps } from './sections';
import { useDialogRound } from './useDialogRound';
import { useRemoval } from './useRemoval';

/** What every token of the default bot is: an admin's. */
const ADMIN_WARNING = 'Der Standard-Bot ist Admin, damit Automatisierungen in jedem Projekt handeln dürfen. Ein Token handelt immer mit den Rechten seines Kontos.';

/** "Rita Prüfer" becomes "rita-pruefer": the handle a name suggests (a–z, 0–9 and hyphens, at most 32). */
export function handleFrom(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replaceAll('ä', 'ae')
    .replaceAll('ö', 'oe')
    .replaceAll('ü', 'ue')
    .replaceAll('ß', 'ss')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+/, '')
    .slice(0, 32)
    .replace(/-+$/, '');
}

/* ------------------------------------------------------------------- bot dialog */

type BotDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The bot to change; null creates a new one. */
  bot: User | null;
  people: User[];
  meId: string | undefined;
};

function BotDialog({ open, onOpenChange, bot, people, meId }: BotDialogProps) {
  const settle = useSettle();
  const create = useCreateBot();
  const update = useUpdateUser();
  const mutation = bot ? update : create;
  const [name, setName] = useState(bot?.name ?? '');
  const [handle, setHandle] = useState(bot?.handle ?? '');
  // the handle follows the name until somebody writes one themselves
  const [handleTouched, setHandleTouched] = useState(bot !== null);
  const [description, setDescription] = useState(bot?.description ?? '');
  const [owner, setOwner] = useState<string | null>(bot ? bot.owner_id : (meId ?? null));
  const [attempted, setAttempted] = useState(false);

  const nameError = attempted && name.trim() === '' ? 'Gib dem Bot einen Namen.' : fieldMessage(mutation.error, 'name');
  const handleError = attempted && handle.trim() === '' ? 'Gib dem Bot ein Kürzel.' : fieldMessage(mutation.error, 'handle');

  function submit() {
    setAttempted(true);
    if (name.trim() === '' || handle.trim() === '') {
      document.getElementById(name.trim() === '' ? 'bot-name' : 'bot-handle')?.focus();
      return;
    }
    const done = () => {
      toast({ title: bot ? `${name.trim()} gespeichert` : `Bot ${name.trim()} ist angelegt`, tone: 'success' });
      onOpenChange(false);
    };
    if (bot) settle(update.mutateAsync({ user_id: bot.id, patch: { name, handle, description, owner_id: bot.is_default_bot ? null : owner } }), { onSuccess: done });
    else settle(create.mutateAsync({ name, handle, description, owner_id: owner ?? undefined }), { onSuccess: done });
  }

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={bot ? `Bot „${bot.name}“ bearbeiten` : 'Bot anlegen'}
      description={bot?.is_default_bot ? 'Den Standard-Bot kannst du umbenennen. Seine Rolle bleibt Admin.' : 'Ein Bot hat kein Login. Er arbeitet über Tokens, kann Projektmitglied sein und Items zugewiesen bekommen.'}
      submitLabel={bot ? 'Speichern' : 'Anlegen'}
      pending={mutation.isPending}
      notice={noticeOf(mutation.error, ['name', 'handle'])}
      onSubmit={submit}
    >
      <Input
        id="bot-name"
        label="Name"
        name="name"
        autoComplete="off"
        value={name}
        error={nameError}
        onChange={(event) => {
          setName(event.target.value);
          if (!handleTouched) setHandle(handleFrom(event.target.value));
        }}
      />
      <Input
        id="bot-handle"
        label="Kürzel"
        name="handle"
        hint="3 bis 32 Zeichen: a–z, 0–9 und Bindestrich. Damit erwähnst du den Bot, etwa @kira."
        autoComplete="off"
        autoCapitalize="none"
        spellCheck={false}
        value={handle}
        error={handleError}
        onChange={(event) => {
          setHandle(event.target.value);
          setHandleTouched(true);
        }}
      />
      <Textarea label="Beschreibung" name="description" autoComplete="off" hint="Wofür der Bot da ist, damit andere ihn einordnen können." rows={2} value={description} onChange={(event) => setDescription(event.target.value)} />
      {!bot?.is_default_bot && (
        <Select
          label="Verantwortliche Person"
          hint="Sie ist Ansprechperson, wenn der Bot etwas Unerwartetes tut."
          error={fieldMessage(mutation.error, 'owner_id')}
          value={owner}
          placeholder="Person wählen …"
          onValueChange={setOwner}
          options={people.map((person) => ({ value: person.id, label: person.name, icon: <Avatar user={person} size="sm" decorative /> }))}
        />
      )}
    </FormDialog>
  );
}

/* ------------------------------------------------------------------ token dialog */

type TokenDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  bot: User;
  onCreated: (secret: Secret) => void;
};

function TokenDialog({ open, onOpenChange, bot, onCreated }: TokenDialogProps) {
  const settle = useSettle();
  const create = useCreateToken();
  const zone = useOrgZone();
  const { today } = useToday();
  const [name, setName] = useState('');
  const [abilities, setAbilities] = useState<TokenAbility[]>(['read']);
  const [expiresOn, setExpiresOn] = useState<string | null>(null);
  const [attempted, setAttempted] = useState(false);

  const nameError = attempted && name.trim() === '' ? 'Gib dem Token einen Namen, damit du ihn später erkennst.' : fieldMessage(create.error, 'name');
  const abilityError = attempted && abilities.length === 0 ? 'Wähle mindestens eine Fähigkeit.' : fieldMessage(create.error, 'abilities');

  function submit() {
    setAttempted(true);
    if (name.trim() === '') {
      document.getElementById('token-name')?.focus();
      return;
    }
    if (abilities.length === 0) return;
    // the token runs until the end of the chosen day in the organisation's time zone
    const expires_at = expiresOn ? createZone(zone).toUtc(expiresOn, '23:59').toISOString() : null;
    settle(create.mutateAsync({ user_id: bot.id, name, abilities, expires_at }), {
      onSuccess: ({ token, plain_text }) => {
        onOpenChange(false);
        // the secret dialog has it now; the call's answer lets go of it (and leaves the cache, gcTime 0)
        create.reset();
        onCreated({
          title: 'Token ist angelegt',
          description: `„${token.name}“ für ${bot.name}.`,
          heading: 'Kopiere den Token jetzt',
          once: 'Du siehst ihn nur dieses eine Mal. Später kannst du ihn nicht mehr abrufen, nur einen neuen anlegen.',
          label: 'Token',
          value: plain_text,
          name: 'bot_token',
          copyLabel: 'Token kopieren',
          warning: bot.is_default_bot ? <AdminWarning title="Dieser Token hat Admin-Rechte" /> : undefined,
        });
      },
    });
  }

  function toggle(ability: TokenAbility, on: boolean) {
    setAbilities((current) => (on ? [...current.filter((entry) => entry !== ability), ability] : current.filter((entry) => entry !== ability)));
  }

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={`Token für ${bot.name} anlegen`}
      description="Mit dem Token arbeitet ein Skript oder ein Agent im Namen des Bots, über REST und MCP."
      submitLabel="Token anlegen"
      pending={create.isPending}
      notice={noticeOf(create.error, ['name', 'abilities', 'expires_at'])}
      onSubmit={submit}
    >
      {bot.is_default_bot && <AdminWarning title="Dieser Token bekommt Admin-Rechte" />}
      <Input id="token-name" name="token_name" label="Name des Tokens" hint="Wofür er gebraucht wird, etwa „Deploy-Skript“." autoComplete="off" value={name} error={nameError} onChange={(event) => setName(event.target.value)} />
      <FieldGroup legend="Fähigkeiten" error={abilityError}>
        <ul className="flex flex-col">
          {ABILITIES.map((ability) => (
            <li key={ability.value}>
              <Checkbox
                // the name is the short word, the sentence below it describes it (a name read out in full would be long)
                aria-label={ability.label}
                aria-describedby={`ability-${ability.value}-hint`}
                label={
                  <span className="min-w-0">
                    <span className="block font-medium">{ability.label}</span>
                    <span id={`ability-${ability.value}-hint`} className="block max-w-[65ch] text-sm text-pretty text-muted">
                      {ability.hint}
                    </span>
                  </span>
                }
                className="items-start py-1"
                checked={abilities.includes(ability.value)}
                onCheckedChange={(checked) => toggle(ability.value, checked)}
              />
            </li>
          ))}
        </ul>
      </FieldGroup>
      <FieldGroup legend="Ablaufdatum" hint="Optional. Danach funktioniert der Token nicht mehr.">
        <DatePopover
          look="form"
          label="Ablaufdatum"
          value={expiresOn}
          display={<span className={expiresOn ? 'text-ink' : 'text-muted'}>{expiresOn ? formatDay(expiresOn) : 'Kein Ablaufdatum'}</span>}
          displayText={expiresOn ? formatDay(expiresOn) : 'kein Ablaufdatum'}
          onChoose={(next) => {
            if (next && next <= today) return 'Das Ablaufdatum muss in der Zukunft liegen.';
            setExpiresOn(next);
          }}
        />
      </FieldGroup>
    </FormDialog>
  );
}

/** The warning for tokens of the default bot (spec 4.2). */
function AdminWarning({ title }: { title: string }) {
  return (
    <Banner tone="danger" icon={ShieldAlert} title={title} role="note">
      {ADMIN_WARNING}
    </Banner>
  );
}

/* ----------------------------------------------------------------------- tokens */

function expiryOf(token: Token, zone: string) {
  if (token.expires_at === null) return <span className="text-muted">Läuft nicht ab</span>;
  if (new Date(token.expires_at) <= now()) {
    return (
      <span className="inline-flex flex-wrap items-center gap-1.5">
        <Badge tone="danger">Abgelaufen</Badge>
        <span className="text-muted">am {formatDate(token.expires_at, zone)}</span>
      </span>
    );
  }
  return <span className="text-muted">Läuft am {formatDate(token.expires_at, zone)} ab</span>;
}

function BotTokens({ bot }: { bot: User }) {
  const tokens = useTokens(bot.id);
  const revoke = useRevokeToken();
  const zone = useOrgZone();
  const dialog = useDialogRound();
  const { hidden, remove } = useRemoval();
  const [secret, setSecret] = useState<Secret | null>(null);
  const shown = (tokens.data?.items ?? []).filter((token) => !hidden.has(token.id));

  return (
    <div className="border-t border-line">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 pt-3">
        <h4 className="font-display text-md font-bold tracking-title text-ink">Tokens</h4>
        {!bot.disabled_at && (
          <Button variant="secondary" size="sm" icon={Plus} onClick={() => dialog.show()}>
            Token anlegen
          </Button>
        )}
      </div>
      {bot.is_default_bot && (
        <div className="px-4 pt-3">
          <AdminWarning title="Tokens des Standard-Bots haben Admin-Rechte" />
        </div>
      )}
      <div className="pt-1 pb-1">
        <Loaded queries={[tokens]} failure="Die Tokens konnten nicht geladen werden" skeleton={<p className="px-4 py-3 text-ui text-muted">Die Tokens werden geladen …</p>}>
          {() =>
            shown.length === 0 ? (
              <p className="max-w-[65ch] px-4 py-3 text-ui text-pretty text-muted">
                {bot.disabled_at ? 'Ein deaktivierter Bot hat keine Tokens. Beim Deaktivieren wurden sie widerrufen.' : 'Noch kein Token. Ohne Token kann niemand im Namen dieses Bots arbeiten.'}
              </p>
            ) : (
              <Rows label={`Tokens von ${bot.name}`}>
                {shown.map((token) => (
                  <Row key={token.id}>
                    <div className="min-w-0 flex-1 basis-44">
                      <p className="truncate font-medium text-ink">{token.name}</p>
                      <p className="text-sm text-muted">Angelegt am {formatDate(token.created_at, zone)}</p>
                    </div>
                    <ul aria-label="Fähigkeiten" className="flex flex-wrap gap-1.5">
                      {token.abilities.map((ability) => (
                        <li key={ability}>
                          <Badge tone="quiet">{ABILITY_NAMES[ability]}</Badge>
                        </li>
                      ))}
                    </ul>
                    <div className="min-w-44 text-sm">
                      <p>{expiryOf(token, zone)}</p>
                      <p className="text-muted">{token.last_used_at ? `Zuletzt benutzt ${relativeTime(token.last_used_at)}` : 'Noch nie benutzt'}</p>
                    </div>
                    <IconButton
                      icon={Trash2}
                      label={`Token „${token.name}“ widerrufen`}
                      onClick={() =>
                        remove({
                          id: token.id,
                          label: `Token „${token.name}“ von ${bot.name} widerrufen`,
                          failureTitle: `Token „${token.name}“ nicht widerrufen`,
                          run: () => revoke.mutateAsync(token.id),
                        })
                      }
                    />
                  </Row>
                ))}
              </Rows>
            )
          }
        </Loaded>
      </div>
      <TokenDialog key={dialog.round} open={dialog.open} onOpenChange={dialog.setOpen} bot={bot} onCreated={setSecret} />
      <SecretDialog secret={secret} onClose={() => setSecret(null)} />
    </div>
  );
}

/* -------------------------------------------------------------------------- bots */

type BotCardProps = {
  bot: User;
  owner: User | undefined;
  onEdit: () => void;
};

function BotCard({ bot, owner, onEdit }: BotCardProps) {
  const settle = useSettle();
  const deactivate = useDeactivateUser();
  const reactivate = useReactivateUser();
  const disabled = bot.disabled_at !== null;
  const titleId = `bot-${bot.id}`;

  function runReactivate() {
    settle(reactivate.mutateAsync(bot.id), {
      onSuccess: () => toast({ title: `${bot.name} ist wieder aktiv`, description: 'Seine Tokens sind widerrufen. Lege neue an.', tone: 'success' }),
      onError: (error) => notifyError(`${bot.name} nicht reaktiviert`, error, runReactivate),
    });
  }

  function runDeactivate() {
    settle(deactivate.mutateAsync(bot.id), {
      onSuccess: () =>
        toast({ title: `${bot.name} ist deaktiviert`, description: 'Seine Tokens sind widerrufen. Verlauf und Zuweisungen bleiben.', tone: 'success', action: { label: 'Reaktivieren', onClick: runReactivate } }),
      onError: (error) => notifyError(`${bot.name} nicht deaktiviert`, error, runDeactivate),
    });
  }

  return (
    <article aria-labelledby={titleId} className="rounded-card border border-line bg-surface shadow-elev-1">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3 p-4">
        <div className="flex min-w-0 flex-1 basis-64 items-start gap-3">
          <Avatar user={bot} decorative />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3 id={titleId} className="font-display text-lg font-bold tracking-title break-words text-ink">
                {bot.name}
              </h3>
              {bot.is_default_bot ? <Badge tone="accent">Standard-Bot</Badge> : <Badge tone="quiet">{botWord(bot) ?? 'Bot'}</Badge>}
              {disabled && (
                <Badge tone="danger" icon={UserRoundX}>
                  Deaktiviert
                </Badge>
              )}
            </div>
            <p className="text-sm text-muted" translate="no">
              @{bot.handle}
            </p>
            {bot.description && <p className="mt-1.5 max-w-[65ch] text-ui text-pretty text-ink">{bot.description}</p>}
            <dl className="mt-2 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 text-ui">
              <dt className="text-muted">Verantwortlich</dt>
              <dd className="text-ink">{bot.is_default_bot ? 'Die Organisation' : (owner?.name ?? 'Niemand')}</dd>
              <dt className="text-muted">Rolle</dt>
              <dd className="text-ink">{bot.org_role === 'admin' ? 'Admin' : 'Member'}</dd>
            </dl>
            {bot.is_default_bot && <p className="mt-2 text-sm text-pretty text-muted">Er lässt sich weder deaktivieren noch löschen, nur umbenennen.</p>}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="secondary" icon={Pencil} onClick={onEdit}>
            Bearbeiten{' '}
            <span className="sr-only">{bot.name}</span>
          </Button>
          {!bot.is_default_bot &&
            (disabled ? (
              <Button variant="secondary" icon={UserRoundCheck} pending={reactivate.isPending} onClick={runReactivate}>
                Reaktivieren{' '}
                <span className="sr-only">{bot.name}</span>
              </Button>
            ) : (
              <Button variant="ghost" icon={UserRoundX} pending={deactivate.isPending} onClick={runDeactivate}>
                Deaktivieren{' '}
                <span className="sr-only">{bot.name}</span>
              </Button>
            ))}
        </div>
      </div>
      <BotTokens bot={bot} />
    </article>
  );
}

export default function Bots(_props: SectionProps) {
  const users = useUsers();
  const me = useCurrentUser();
  const dialog = useDialogRound<User>();
  const all = users.data?.items ?? [];
  const people = all.filter((user) => user.type === 'person' && user.disabled_at === null);
  // the default bot first, deactivated bots last
  const bots = all.filter((user) => user.type === 'bot').sort((a, b) => Number(b.is_default_bot) - Number(a.is_default_bot) || Number(a.disabled_at !== null) - Number(b.disabled_at !== null));

  return (
    <div className="flex flex-col gap-4">
      <SectionHeader
        title="Bots"
        description="Konten ohne Login für Agenten und Skripte. Sie arbeiten über Tokens, können Projektmitglied sein, Items zugewiesen bekommen und erwähnt werden."
        actions={
          <Button variant="primary" icon={Plus} onClick={() => dialog.show()}>
            Bot anlegen
          </Button>
        }
      />
      <Loaded queries={[users]} failure="Die Bots konnten nicht geladen werden" skeleton={<RowsSkeleton rows={2} label="Die Bots werden geladen …" />}>
        {() =>
          bots.length === 0 ? (
            <EmptyState
              icon={BotIcon}
              title="Noch kein Bot"
              description="Ein Bot arbeitet für dich, etwa als Agent, der Items bekommt und sie per MCP bearbeitet."
              actions={
                <Button variant="primary" icon={Plus} onClick={() => dialog.show()}>
                  Bot anlegen
                </Button>
              }
            />
          ) : (
            <ul className="flex flex-col gap-3">
              {bots.map((bot) => (
                <li key={bot.id}>
                  <BotCard bot={bot} owner={all.find((user) => user.id === bot.owner_id)} onEdit={() => dialog.show(bot)} />
                </li>
              ))}
            </ul>
          )
        }
      </Loaded>
      <BotDialog key={dialog.round} open={dialog.open} onOpenChange={dialog.setOpen} bot={dialog.target} people={people} meId={me?.id} />
    </div>
  );
}
