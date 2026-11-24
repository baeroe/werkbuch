/*
 * Bot → Agent (spec 10.4, `/settings/bots?agent=<bot>`): whether a bot works as an agent, on which runners, with which
 * CLI and default model. A view of the section "Bots", like the delivery log of a webhook; a port of the click dummy
 * (`prototypes/clickdummy/src/features/settings/org/BotAgent.tsx`) without its list of projects and its models per kind
 * of run (WEBU-32): those models go back to the server as they are, only what a change of CLI takes away drops out.
 * The pool may stay empty: the agent then works on every runner of the organization, also on ones that come later
 * (the click dummy did not know that case). The CLI says per runner of the pool whether it is there and logged in; a
 * CLI no runner reports still saves, its runs wait. A bot that cannot be an agent (the default bot, one without a
 * responsible person, a deactivated one) says why instead of showing the form.
 */

import { Link } from '@inertiajs/react';
import { ArrowLeft, Bot as BotIcon, CircleCheck, CircleMinus, Cpu, TriangleAlert } from 'lucide-react';
import { useId, useMemo, useRef, useState, type FormEvent } from 'react';
import { Avatar } from '@/components/ui/Avatar';
import { Banner } from '@/components/ui/Banner';
import { buttonClass } from '@/components/ui/Button';
import { Checkbox } from '@/components/ui/Checkbox';
import { cx } from '@/components/ui/cx';
import { EmptyState } from '@/components/ui/EmptyState';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { Select } from '@/components/ui/Select';
import { labelClass } from '@/components/ui/styles';
import { Switch } from '@/components/ui/Switch';
import { toast } from '@/components/ui/toast';
import { CLI_MODELS, CLI_NAMES, modelsFor, whyNotAgent, type NotAgentReason } from '@/domain/agents';
import { useAgentConfig, useSaveAgentConfig } from '@/hooks/agents';
import { useRunners } from '@/hooks/runners';
import { useAllUsers } from '@/hooks/users';
import { notifyError } from '@/lib/errors';
import { intlLocale, t, tn, type TranslationKey } from '@/lib/i18n';
import { paths } from '@/lib/links';
import { useDocumentTitle } from '@/lib/useDocumentTitle';
import type { AgentCli, AgentConfig, Runner, User } from '@/types';
import { fieldErrors, useDraft, useFieldErrors, useSaveShortcut } from '../../frame/form';
import { formatDateTime, useOrgZone } from '../../frame/format';
import { LeaveGuard } from '../../frame/LeaveGuard';
import { FieldGroup, FormActions, FormSkeleton, Loaded, SectionHeader, SettingsCard } from '../../frame/parts';

interface Form {
  enabled: boolean;
  /** Sorted, so the same pool in another order is no change. */
  runner_ids: string[];
  cli: AgentCli;
  model: string;
  /** The models per kind of run: not edited here (WEBU-32), sent back as they are. */
  models: AgentConfig['models'];
}

const formOf = (config: AgentConfig): Form => ({
  enabled: config.enabled,
  runner_ids: [...config.runner_ids].sort(),
  cli: config.cli,
  model: config.model,
  models: config.models,
});

const CLIS: { value: AgentCli; label: string }[] = [
  { value: 'claude', label: CLI_NAMES.claude },
  { value: 'codex', label: CLI_NAMES.codex },
];

const REASONS: Record<NotAgentReason, TranslationKey> = {
  default_bot: 'settings.bot_agent.cannot.default_bot',
  no_owner: 'settings.bot_agent.cannot.no_owner',
  disabled: 'settings.bot_agent.cannot.disabled',
};

/** The fields a 422 is shown at; everything else is a toast. */
const PLACED = ['enabled', 'runner_ids', 'cli', 'model'] as const;

export type CliState = 'ready' | 'not_logged_in' | 'not_installed';

/** Whether a runner reports a CLI installed and logged in (spec 8.8). */
export function cliState(runner: Pick<Runner, 'clis'>, cli: AgentCli): CliState {
  const entry = runner.clis.find((candidate) => candidate.cli === cli);
  if (!entry?.installed) return 'not_installed';
  return entry.logged_in ? 'ready' : 'not_logged_in';
}

/** "01m8…abcd": enough of an id to tell two revoked runners apart. */
export const shortId = (id: string) => (id.length > 9 ? `${id.slice(0, 4)}…${id.slice(-4)}` : id);

const quotedList = (texts: string[]) => new Intl.ListFormat(intlLocale(), { type: 'conjunction' }).format(texts.map((text) => t('settings.agents.quoted', { text })));

function BackLink({ variant = 'ghost' }: { variant?: 'ghost' | 'secondary' }) {
  return (
    <Link href={paths.settings('bots')} className={buttonClass({ variant, size: variant === 'ghost' ? 'sm' : 'md' }, variant === 'ghost' ? '-ml-2.5' : undefined)}>
      <ArrowLeft className="size-4 text-muted" aria-hidden="true" />
      {t('settings.bot_agent.back')}
    </Link>
  );
}

/** Online, or since when not, with its places. */
function runnerHint(runner: Runner, zone: string): string {
  const reach = runner.online
    ? t('settings.bot_agent.pool.online')
    : runner.last_seen_at
      ? t('settings.bot_agent.pool.offline_since', { time: formatDateTime(runner.last_seen_at, zone) })
      : t('settings.bot_agent.pool.offline');
  return `${reach}, ${tn('settings.bot_agent.pool.slots', runner.slots.total, { light: runner.slots.light })}`;
}

const STATE_TEXT: Record<CliState, TranslationKey> = {
  ready: 'settings.bot_agent.cli.state.ready',
  not_logged_in: 'settings.bot_agent.cli.state.not_logged_in',
  not_installed: 'settings.bot_agent.cli.state.not_installed',
};

/** Per runner the agent may work on: whether it has the CLI, installed and logged in. */
function CliOnRunners({ cli, pool }: { cli: AgentCli; pool: Runner[] }) {
  return (
    <ul role="list" aria-label={t('settings.bot_agent.cli.on_runners', { cli: CLI_NAMES[cli] })} className="flex flex-col gap-1">
      {pool.map((runner) => {
        const state = cliState(runner, cli);
        const Icon = state === 'ready' ? CircleCheck : CircleMinus;
        return (
          <li key={runner.id} className="flex items-center gap-2 text-ui">
            <Icon className={cx('size-4 shrink-0', state === 'ready' ? 'text-st-completed' : 'text-muted')} aria-hidden="true" />
            <span className="font-medium text-ink" translate="no">
              {runner.name}
            </span>
            <span className="text-muted">{t(STATE_TEXT[state])}</span>
          </li>
        );
      })}
    </ul>
  );
}

function AgentForm({ bot, config }: { bot: User; config: AgentConfig }) {
  const form = useRef<HTMLFormElement>(null);
  const enabledHint = useId();
  const save = useSaveAgentConfig();
  const runners = useRunners({ live: true });
  const zone = useOrgZone();
  const draft = useDraft(useMemo(() => formOf(config), [config]));
  // what a change of CLI did to the models, until the change is saved or discarded
  const [cliNote, setCliNote] = useState<string | null>(null);
  const problems = useFieldErrors(form);
  useSaveShortcut(form, true);
  const { value } = draft;
  const edit = (patch: Partial<Form>, ...paths: string[]) => {
    draft.set(patch);
    problems.clear(...paths);
  };

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (save.isPending) return;
    if (!draft.dirty) return draft.tellNothingToSave();
    try {
      await save.mutateAsync({ botId: bot.id, input: { enabled: value.enabled, runner_ids: value.runner_ids, cli: value.cli, model: value.model, models: value.models } });
      draft.reset();
      problems.clearAll();
      setCliNote(null);
      toast({
        title: t('settings.bot_agent.saved', { name: bot.name }),
        description: value.enabled ? undefined : t('settings.bot_agent.saved_off'),
        tone: 'success',
      });
    } catch (error) {
      // `runner_ids.2` (a runner revoked meanwhile) stands at the pool
      const fields = Object.entries(fieldErrors(error)).reduce<Record<string, string>>((found, [path, message]) => {
        const field = path.split('.')[0]!;
        if ((PLACED as readonly string[]).includes(field) && !found[field]) found[field] = message;
        return found;
      }, {});
      if (Object.keys(fields).length > 0) problems.show(fields);
      else notifyError(t('settings.bot_agent.not_saved'), error, () => form.current?.requestSubmit());
    }
  }

  const all = runners.data?.items ?? [];
  // runners of the pool that were revoked meanwhile: they stay in the pool until taken out, so they are shown to take out
  const gone = runners.data ? value.runner_ids.filter((id) => !all.some((runner) => runner.id === id)) : [];
  // an empty pool is every runner of the organization
  const pool = value.runner_ids.length === 0 ? all : all.filter((runner) => value.runner_ids.includes(runner.id));
  // a CLI no runner of the pool reports, installed and logged in (spec 8.8): saving still works
  const cliMissing = pool.length > 0 && !pool.some((runner) => cliState(runner, value.cli) === 'ready');
  const known = CLI_MODELS[value.cli];

  /** A change of CLI keeps the models it knows; the others fall back to its standard, and the note says which. */
  function chooseCli(cli: AgentCli) {
    if (cli === value.cli) return;
    const next = modelsFor(cli, value.model, value.models);
    edit({ cli, model: next.model, models: next.models }, 'cli', 'model');
    if (next.dropped.length === 0) return setCliNote(null);
    const lostTypes = Object.keys(next.models).length < Object.values(value.models).filter(Boolean).length;
    setCliNote(t(lostTypes ? 'settings.bot_agent.models_adjusted.text_types' : 'settings.bot_agent.models_adjusted.text', { models: quotedList(next.dropped), cli: CLI_NAMES[cli], model: next.model }));
  }

  function toggleRunner(id: string, on: boolean) {
    const next = on ? [...value.runner_ids, id] : value.runner_ids.filter((entry) => entry !== id);
    edit({ runner_ids: next.sort() }, 'runner_ids');
  }

  return (
    <form ref={form} noValidate onSubmit={(event) => void submit(event)} className="flex flex-col gap-4">
      <LeaveGuard dirty={draft.dirty} what={t('settings.bot_agent.leave_what', { name: bot.name })} />
      <SettingsCard title={t('settings.bot_agent.agent.title')} description={t('settings.bot_agent.agent.description')}>
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-md font-semibold text-ink">{t('settings.bot_agent.enabled')}</p>
            <p id={enabledHint} className="mt-0.5 max-w-[60ch] text-ui text-pretty text-muted">
              {t('settings.bot_agent.enabled_hint', { name: bot.name })}
            </p>
            {problems.errors.enabled && <p className="mt-1 text-sm font-medium text-danger">{problems.errors.enabled}</p>}
          </div>
          <Switch
            label={<span className="sr-only">{t('settings.bot_agent.enabled')}</span>}
            className="min-w-11 justify-center md:min-w-0"
            aria-describedby={enabledHint}
            aria-invalid={problems.errors.enabled ? true : undefined}
            checked={value.enabled}
            onCheckedChange={(enabled) => edit({ enabled }, 'enabled')}
          />
        </div>
      </SettingsCard>

      <SettingsCard title={t('settings.bot_agent.pool.title')} description={t('settings.bot_agent.pool.description')}>
        <Loaded queries={[runners]} failure={t('settings.bot_agent.pool.load_failed')} skeleton={<p className="text-ui text-muted">{t('settings.bot_agent.pool.loading')}</p>}>
          {() =>
            all.length === 0 && gone.length === 0 ? (
              <EmptyState
                icon={Cpu}
                title={t('settings.bot_agent.pool.empty.title')}
                description={t('settings.bot_agent.pool.empty.description')}
                actions={
                  <Link href={paths.settings('runners')} className={buttonClass({ variant: 'secondary' })}>
                    {t('settings.bot_agent.pool.empty.link')}
                  </Link>
                }
              />
            ) : (
              <FieldGroup
                legend={t('settings.bot_agent.pool.legend')}
                error={problems.errors.runner_ids}
                hint={value.runner_ids.length === 0 ? t('settings.bot_agent.pool.all') : tn('settings.bot_agent.pool.chosen', value.runner_ids.length)}
              >
                <ul className="flex flex-col">
                  {all.map((runner, index) => (
                    <li key={runner.id}>
                      <Checkbox
                        className="items-start py-1"
                        aria-label={runner.name}
                        aria-describedby={`runner-hint-${runner.id}`}
                        aria-invalid={index === 0 && problems.errors.runner_ids ? true : undefined}
                        checked={value.runner_ids.includes(runner.id)}
                        onCheckedChange={(on) => toggleRunner(runner.id, on)}
                        label={
                          <span className="min-w-0">
                            <span className="block font-medium" translate="no">
                              {runner.name}
                            </span>
                            <span id={`runner-hint-${runner.id}`} className="block text-sm text-muted">
                              {runnerHint(runner, zone)}
                            </span>
                          </span>
                        }
                      />
                    </li>
                  ))}
                  {gone.map((id) => (
                    <li key={id}>
                      <Checkbox
                        className="items-start py-1"
                        aria-label={t('settings.bot_agent.pool.gone', { id: shortId(id) })}
                        aria-describedby={`runner-hint-${id}`}
                        checked
                        onCheckedChange={(on) => toggleRunner(id, on)}
                        label={
                          <span className="min-w-0">
                            <span className="block font-medium">
                              {t('settings.bot_agent.pool.gone', { id: shortId(id) })}
                            </span>
                            <span id={`runner-hint-${id}`} className="block text-sm text-muted">
                              {t('settings.bot_agent.pool.gone_hint')}
                            </span>
                          </span>
                        }
                      />
                    </li>
                  ))}
                </ul>
              </FieldGroup>
            )
          }
        </Loaded>
      </SettingsCard>

      <SettingsCard title={t('settings.bot_agent.cli.title')} description={t('settings.bot_agent.cli.description')}>
        <div className="flex flex-col gap-1.5">
          <p className={labelClass}>{t('settings.bot_agent.cli.label')}</p>
          <div>
            <SegmentedControl label={t('settings.bot_agent.cli.label')} value={value.cli} onValueChange={chooseCli} options={CLIS} />
          </div>
          {/* one live region, always in the page: what the CLI means for the pool and the models is said when it changes */}
          <div aria-live="polite" className="flex flex-col gap-3">
            {problems.errors.cli && <p className="text-sm font-medium text-danger">{problems.errors.cli}</p>}
            {cliMissing ? (
              <p className="flex items-start gap-1.5 text-sm font-medium text-danger">
                <TriangleAlert className="mt-px size-3.5 shrink-0" aria-hidden="true" />
                {t(value.runner_ids.length === 0 ? 'settings.bot_agent.cli.missing_all' : 'settings.bot_agent.cli.missing', { cli: CLI_NAMES[value.cli] })}
              </p>
            ) : (
              <p className="max-w-[65ch] text-sm text-pretty text-muted">{t('settings.bot_agent.cli.hint')}</p>
            )}
            {cliNote && draft.dirty && (
              <Banner tone="info" title={t('settings.bot_agent.models_adjusted.title')}>
                {cliNote}
              </Banner>
            )}
          </div>
          {pool.length > 0 && <CliOnRunners cli={value.cli} pool={pool} />}
        </div>
        <Select
          label={t('settings.bot_agent.model')}
          hint={t('settings.bot_agent.model_hint')}
          error={problems.errors.model}
          className="max-w-sm"
          value={value.model === '' ? null : value.model}
          placeholder={t('settings.bot_agent.model_placeholder')}
          options={[
            ...known.map((model) => ({ value: model, label: model })),
            // a model saved before the list changed still shows what it is
            ...(value.model !== '' && !known.includes(value.model) ? [{ value: value.model, label: t('settings.bot_agent.model_unlisted', { model: value.model }) }] : []),
          ]}
          onValueChange={(model) => model && edit({ model }, 'model')}
        />
      </SettingsCard>

      <div className="flex flex-wrap items-center justify-end gap-2 rounded-card border border-line bg-surface px-4 py-3 shadow-elev-1 md:px-5">
        <FormActions
          dirty={draft.dirty}
          pending={save.isPending}
          quiet={draft.quiet}
          onReset={() => {
            draft.reset();
            problems.clearAll();
            setCliNote(null);
          }}
        />
      </div>
    </form>
  );
}

/** The configuration of a bot that can be an agent, then the form. */
function AgentLoader({ bot }: { bot: User }) {
  const config = useAgentConfig(bot.id);
  return (
    <Loaded queries={[config]} failure={t('settings.bot_agent.load_failed')} skeleton={<FormSkeleton label={t('settings.bot_agent.loading')} />}>
      {() => <AgentForm bot={bot} config={config.data!} />}
    </Loaded>
  );
}

export function BotAgent({ botId }: { botId: string }) {
  const bots = useAllUsers({ type: 'bot' });
  const bot = bots.data?.items.find((user) => user.id === botId);
  const title = bot ? t('settings.bot_agent.title', { name: bot.name }) : t('settings.bot_agent.title_unknown');
  useDocumentTitle(t('settings.org.document_title', { section: `${title} – ${t('settings.org.section.bots')}` }));

  return (
    <div className="flex flex-col gap-4">
      <SectionHeader
        back={<BackLink />}
        title={
          <span className="inline-flex items-center gap-2.5">
            {bot && <Avatar user={bot} decorative />}
            {title}
          </span>
        }
        description={t('settings.bot_agent.description')}
      />
      <Loaded queries={[bots]} failure={t('settings.bot_agent.load_failed')} skeleton={<FormSkeleton label={t('settings.bot_agent.loading')} />}>
        {() => {
          if (!bot) {
            return <EmptyState icon={BotIcon} title={t('settings.bot_agent.unknown.title')} description={t('settings.bot_agent.unknown.description')} actions={<BackLink variant="secondary" />} />;
          }
          const reasons = whyNotAgent(bot);
          if (reasons.length > 0) {
            return (
              <Banner tone="neutral" icon={BotIcon} title={t('settings.bot_agent.cannot.title', { name: bot.name })}>
                <ul className={cx('flex flex-col gap-1', reasons.length > 1 && 'list-disc pl-4')}>
                  {reasons.map((reason) => (
                    <li key={reason} className="max-w-[65ch]">
                      {t(REASONS[reason])}
                    </li>
                  ))}
                </ul>
                <p className="mt-1.5 max-w-[65ch] text-muted">{t('settings.bot_agent.cannot.note')}</p>
              </Banner>
            );
          }
          return <AgentLoader bot={bot} />;
        }}
      </Loaded>
    </div>
  );
}
