/*
 * Bots (spec 4.2): accounts without a login that work through tokens, such as an agent that takes items assigned to
 * it. Each bot card holds its tokens: name, abilities, expiry and last use. The plain text of a new token appears once,
 * in the token dialog (the same as under "Personal"). The default bot ("Automation") is the one automations act as: it
 * has a badge, can be renamed but neither deactivated nor deleted, and since it is an admin its tokens are too, which
 * the page says every time they come up. Admins manage the tokens of all bots; people manage their own under "Personal".
 * Every other bot is a "Bot", whoever is responsible for it (spec, changes of 2026-10-29). Each card says in a line
 * whether the bot works as an agent and links to that view (`?agent=<id>`, `BotAgent`, WEBU-27).
 */

import { Link } from '@inertiajs/react';
import type { UseQueryResult } from '@tanstack/react-query';
import { Bot as BotIcon, BotMessageSquare, Pencil, Plus, Trash2, UserRoundCheck, UserRoundX } from 'lucide-react';
import { useState } from 'react';
import { Avatar } from '@/components/ui/Avatar';
import { Button, buttonClass } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { FormDialog } from '@/components/ui/FormDialog';
import { IconButton } from '@/components/ui/IconButton';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Textarea } from '@/components/ui/Textarea';
import { toast } from '@/components/ui/toast';
import { CLI_NAMES, whyNotAgent } from '@/domain/agents';
import { useAgentConfigs } from '@/hooks/agents';
import { useSettle } from '@/hooks/mutation';
import { useRunners } from '@/hooks/runners';
import { useRevokeToken, useTokens } from '@/hooks/tokens';
import { useAllUsers, useCreateBot, useCurrentUser, useDeactivateUser, useReactivateUser, useUpdateUser } from '@/hooks/users';
import { notifyError } from '@/lib/errors';
import { intlLocale, t } from '@/lib/i18n';
import { paths, useSearchParam } from '@/lib/links';
import type { AgentConfig, Token, User } from '@/types';
import { fieldMessage, noticeOf } from '../frame/form';
import { formatDate, relativeTime, useOrgZone } from '../frame/format';
import { Badge, Loaded, Row, Rows, RowsSkeleton, SectionHeader } from '../frame/parts';
import { useDialogRound } from '../frame/useDialogRound';
import { useRemoval } from '../frame/useRemoval';
import { AdminWarning } from '../tokens/AdminWarning';
import { TokenDialog } from '../tokens/TokenDialog';
import { BotAgent } from './bots/BotAgent';
import type { SectionProps } from './sections';

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
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+/, '')
    .slice(0, 32)
    .replace(/-+$/, '');
}

/* ------------------------------------------------------------------- bot dialog */

/**
 * The people who can be responsible: the active ones, and the chosen one and the one the bot had even when deactivated
 * meanwhile, so the dialog never loses the value and a switch away can be taken back (like `zoneOptions`).
 */
function ownerOptions(people: User[], kept: (string | null)[]) {
  return people
    .filter((person) => person.disabled_at === null || kept.includes(person.id))
    .map((person) => ({ value: person.id, label: person.name, icon: <Avatar user={person} size="sm" decorative /> }));
}

type BotDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The bot to change; null creates a new one. */
  bot: User | null;
  /** Every person, deactivated ones included. */
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

  const nameError = attempted && name.trim() === '' ? t('settings.bots.dialog.name_required') : fieldMessage(mutation.error, 'name');
  const handleError = attempted && handle.trim() === '' ? t('settings.bots.dialog.handle_required') : fieldMessage(mutation.error, 'handle');

  function submit() {
    setAttempted(true);
    if (name.trim() === '' || handle.trim() === '') {
      document.getElementById(name.trim() === '' ? 'bot-name' : 'bot-handle')?.focus();
      return;
    }
    const done = () => {
      toast({ title: bot ? t('settings.bots.dialog.saved', { name: name.trim() }) : t('settings.bots.dialog.created', { name: name.trim() }), tone: 'success' });
      onOpenChange(false);
    };
    if (bot) settle(update.mutateAsync({ user_id: bot.id, patch: { name, handle, description, owner_id: bot.is_default_bot ? null : owner } }), { onSuccess: done });
    else settle(create.mutateAsync({ name, handle, description, owner_id: owner ?? undefined }), { onSuccess: done });
  }

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={bot ? t('settings.bots.dialog.edit_title', { name: bot.name }) : t('settings.bots.create')}
      description={bot?.is_default_bot ? t('settings.bots.dialog.default_description') : t('settings.bots.dialog.new_description')}
      submitLabel={bot ? t('settings.frame.save') : t('settings.bots.dialog.submit_create')}
      pending={mutation.isPending}
      notice={noticeOf(mutation.error, ['name', 'handle', 'description', 'owner_id'])}
      onSubmit={submit}
    >
      <Input
        id="bot-name"
        label={t('settings.bots.dialog.name')}
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
        label={t('settings.bots.dialog.handle')}
        name="handle"
        hint={t('settings.bots.dialog.handle_hint')}
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
      <Textarea
        label={t('settings.bots.dialog.description')}
        name="description"
        autoComplete="off"
        hint={t('settings.bots.dialog.description_hint')}
        error={fieldMessage(mutation.error, 'description')}
        rows={2}
        value={description}
        onChange={(event) => setDescription(event.target.value)}
      />
      {!bot?.is_default_bot && (
        <Select
          label={t('settings.bots.dialog.owner')}
          hint={t('settings.bots.dialog.owner_hint')}
          error={fieldMessage(mutation.error, 'owner_id')}
          value={owner}
          placeholder={t('settings.bots.dialog.owner_placeholder')}
          onValueChange={setOwner}
          options={ownerOptions(people, [owner, bot?.owner_id ?? null])}
        />
      )}
    </FormDialog>
  );
}

/* ----------------------------------------------------------------------- tokens */

function expiryOf(token: Token, zone: string) {
  if (token.expires_at === null) return <span className="text-muted">{t('settings.tokens.never_expires')}</span>;
  if (new Date(token.expires_at).getTime() <= Date.now()) {
    return (
      <span className="inline-flex flex-wrap items-center gap-1.5">
        <Badge tone="danger">{t('settings.tokens.expired')}</Badge>
        <span className="text-muted">{t('settings.tokens.expired_on', { date: formatDate(token.expires_at, zone) })}</span>
      </span>
    );
  }
  return <span className="text-muted">{t('settings.tokens.expires_on', { date: formatDate(token.expires_at, zone) })}</span>;
}

function BotTokens({ bot }: { bot: User }) {
  const tokens = useTokens(bot.id);
  const revoke = useRevokeToken();
  const zone = useOrgZone();
  const { hidden, remove } = useRemoval();
  const [creating, setCreating] = useState(false);
  const shown = (tokens.data?.items ?? []).filter((token) => !hidden.has(token.id));

  return (
    <div className="border-t border-line">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 pt-3">
        <h4 className="font-display text-md font-bold tracking-title text-ink">{t('settings.tokens.title')}</h4>
        {!bot.disabled_at && (
          <Button variant="secondary" size="sm" icon={Plus} onClick={() => setCreating(true)}>
            {t('settings.tokens.create')} <span className="sr-only">{bot.name}</span>
          </Button>
        )}
      </div>
      {bot.is_default_bot && (
        <div className="px-4 pt-3">
          <AdminWarning title={t('settings.tokens.admin_warning.list')} />
        </div>
      )}
      <div className="pt-1 pb-1">
        <Loaded queries={[tokens]} failure={t('settings.tokens.load_failed')} skeleton={<p className="px-4 py-3 text-ui text-muted">{t('settings.tokens.loading')}</p>}>
          {() =>
            shown.length === 0 ? (
              <p className="max-w-[65ch] px-4 py-3 text-ui text-pretty text-muted">{bot.disabled_at ? t('settings.tokens.bot_empty_disabled') : t('settings.tokens.bot_empty')}</p>
            ) : (
              <Rows label={t('settings.tokens.list_of', { name: bot.name })}>
                {shown.map((token) => (
                  <Row key={token.id}>
                    <div className="min-w-0 flex-1 basis-44">
                      <p className="truncate font-medium text-ink">{token.name}</p>
                      <p className="text-sm text-muted">{t('settings.tokens.created_on', { date: formatDate(token.created_at, zone) })}</p>
                    </div>
                    <ul aria-label={t('settings.tokens.abilities')} className="flex flex-wrap gap-1.5">
                      {token.abilities.map((ability) => (
                        <li key={ability}>
                          <Badge tone="quiet">{t(`settings.tokens.ability.${ability}`)}</Badge>
                        </li>
                      ))}
                    </ul>
                    <div className="min-w-44 text-sm">
                      <p>{expiryOf(token, zone)}</p>
                      <p className="text-muted">{token.last_used_at ? t('settings.tokens.last_used', { time: relativeTime(token.last_used_at) }) : t('settings.tokens.never_used')}</p>
                    </div>
                    <IconButton
                      icon={Trash2}
                      label={t('settings.tokens.revoke', { name: token.name })}
                      onClick={() =>
                        remove({
                          id: token.id,
                          label: t('settings.tokens.revoked', { name: token.name, owner: bot.name }),
                          failureTitle: t('settings.tokens.not_revoked', { name: token.name }),
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
      {creating && <TokenDialog owner={bot} onClose={() => setCreating(false)} />}
    </div>
  );
}

/* -------------------------------------------------------------------------- bots */

/** The agent of a bot in a line, for its card: off, or on with CLI, model and pool (empty: every runner). */
export function agentSummary(config: AgentConfig, runnerNames: Map<string, string>): string {
  if (!config.enabled) return t('settings.bots.agent.off');
  const runners =
    config.runner_ids.length === 0
      ? t('settings.bots.agent.all_runners')
      : new Intl.ListFormat(intlLocale(), { type: 'conjunction' }).format(config.runner_ids.map((id) => runnerNames.get(id) ?? t('settings.bots.agent.unknown_runner')));
  return t('settings.bots.agent.on', { cli: CLI_NAMES[config.cli], model: config.model, runners });
}

type BotCardProps = {
  bot: User;
  owner: User | undefined;
  onEdit: () => void;
  /** The agent configuration of the bot; undefined for a bot that cannot be an agent. */
  agent: UseQueryResult<AgentConfig> | undefined;
  runnerNames: Map<string, string>;
};

/** What the card says about the agent: why not, the summary, or that it loads or failed. */
function agentLine(bot: User, agent: BotCardProps['agent'], runnerNames: Map<string, string>) {
  if (whyNotAgent(bot).length > 0 || !agent) return <span className="text-muted">{t('settings.bots.agent.cannot')}</span>;
  if (agent.data) return agentSummary(agent.data, runnerNames);
  return <span className="text-muted">{agent.isError ? t('settings.bots.agent.failed') : t('settings.bots.agent.loading')}</span>;
}

function BotCard({ bot, owner, onEdit, agent, runnerNames }: BotCardProps) {
  const settle = useSettle();
  const deactivate = useDeactivateUser();
  const reactivate = useReactivateUser();
  const disabled = bot.disabled_at !== null;
  const titleId = `bot-${bot.id}`;

  function runReactivate() {
    settle(reactivate.mutateAsync(bot.id), {
      onSuccess: () => toast({ title: t('settings.bots.reactivated', { name: bot.name }), description: t('settings.bots.reactivated_description'), tone: 'success' }),
      onError: (error) => notifyError(t('settings.bots.not_reactivated', { name: bot.name }), error, runReactivate),
    });
  }

  function runDeactivate() {
    settle(deactivate.mutateAsync(bot.id), {
      onSuccess: () =>
        toast({
          title: t('settings.bots.deactivated', { name: bot.name }),
          description: t('settings.bots.deactivated_description'),
          tone: 'success',
          action: { label: t('settings.bots.reactivate'), onClick: runReactivate },
        }),
      onError: (error) => notifyError(t('settings.bots.not_deactivated', { name: bot.name }), error, runDeactivate),
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
              {bot.is_default_bot ? <Badge tone="accent">{t('settings.bots.default_badge')}</Badge> : <Badge tone="quiet">{t('settings.bots.bot_badge')}</Badge>}
              {disabled && (
                <Badge tone="danger" icon={UserRoundX}>
                  {t('settings.bots.disabled')}
                </Badge>
              )}
            </div>
            <p className="text-sm text-muted" translate="no">
              @{bot.handle}
            </p>
            {bot.description && <p className="mt-1.5 max-w-[65ch] text-ui text-pretty text-ink">{bot.description}</p>}
            <dl className="mt-2 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 text-ui">
              <dt className="text-muted">{t('settings.bots.responsible')}</dt>
              <dd className="text-ink">{bot.is_default_bot ? t('settings.bots.responsible_org') : (owner?.name ?? t('settings.bots.responsible_none'))}</dd>
              <dt className="text-muted">{t('settings.bots.role')}</dt>
              <dd className="text-ink">{t(`roles.org.${bot.org_role}`)}</dd>
              <dt className="text-muted">{t('settings.bots.agent.label')}</dt>
              <dd className="text-ink">{agentLine(bot, agent, runnerNames)}</dd>
            </dl>
            {bot.is_default_bot && <p className="mt-2 text-sm text-pretty text-muted">{t('settings.bots.default_note')}</p>}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link href={paths.botAgent(bot.id)} className={buttonClass({ variant: 'secondary' })}>
            <BotMessageSquare className="size-4 text-muted" aria-hidden="true" />
            {/* one inline run, so the space before the hidden words stays in the name of the link */}
            <span>
              {agent?.data?.enabled ? t('settings.bots.agent.edit') : t('settings.bots.agent.set_up')} <span className="sr-only">{t('settings.bots.agent.for', { name: bot.name })}</span>
            </span>
          </Link>
          <Button variant="secondary" icon={Pencil} onClick={onEdit}>
            {t('settings.bots.edit')} <span className="sr-only">{bot.name}</span>
          </Button>
          {!bot.is_default_bot &&
            (disabled ? (
              <Button variant="secondary" icon={UserRoundCheck} pending={reactivate.isPending} onClick={runReactivate}>
                {t('settings.bots.reactivate')} <span className="sr-only">{bot.name}</span>
              </Button>
            ) : (
              <Button variant="ghost" icon={UserRoundX} pending={deactivate.isPending} onClick={runDeactivate}>
                {t('settings.bots.deactivate')} <span className="sr-only">{bot.name}</span>
              </Button>
            ))}
        </div>
      </div>
      <BotTokens bot={bot} />
    </article>
  );
}

export default function Bots(props: SectionProps) {
  const agent = useSearchParam('agent');
  return agent ? <BotAgent key={agent} botId={agent} /> : <BotList {...props} />;
}

function BotList(_props: SectionProps) {
  const botList = useAllUsers({ type: 'bot' });
  const personList = useAllUsers({ type: 'person' });
  const me = useCurrentUser();
  const dialog = useDialogRound<User>();
  const people = personList.data?.items ?? [];
  // the default bot first, deactivated bots last
  const bots = [...(botList.data?.items ?? [])].sort((a, b) => Number(b.is_default_bot) - Number(a.is_default_bot) || Number(a.disabled_at !== null) - Number(b.disabled_at !== null));
  // the agent configurations only of bots that can be one; the runner names for their pools
  const agentBots = bots.filter((bot) => whyNotAgent(bot).length === 0).map((bot) => bot.id);
  const agents = useAgentConfigs(agentBots);
  const runners = useRunners({ enabled: agentBots.length > 0 });
  const runnerNames = new Map((runners.data?.items ?? []).map((runner) => [runner.id, runner.name]));

  return (
    <div className="flex flex-col gap-4">
      <SectionHeader
        title={t('settings.org.section.bots')}
        description={t('settings.bots.description')}
        actions={
          <Button variant="primary" icon={Plus} onClick={() => dialog.show()}>
            {t('settings.bots.create')}
          </Button>
        }
      />
      <Loaded queries={[botList, personList]} failure={t('settings.bots.load_failed')} skeleton={<RowsSkeleton rows={2} label={t('settings.bots.loading')} />}>
        {() =>
          bots.length === 0 ? (
            <EmptyState
              icon={BotIcon}
              title={t('settings.bots.empty.title')}
              description={t('settings.bots.empty.description')}
              actions={
                <Button variant="primary" icon={Plus} onClick={() => dialog.show()}>
                  {t('settings.bots.create')}
                </Button>
              }
            />
          ) : (
            <ul className="flex flex-col gap-3">
              {bots.map((bot) => (
                <li key={bot.id}>
                  <BotCard
                    bot={bot}
                    owner={people.find((user) => user.id === bot.owner_id)}
                    onEdit={() => dialog.show(bot)}
                    agent={agents[agentBots.indexOf(bot.id)]}
                    runnerNames={runnerNames}
                  />
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
