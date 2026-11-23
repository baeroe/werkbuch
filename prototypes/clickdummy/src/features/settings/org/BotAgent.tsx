/*
 * Bot → Agent (WEBU-18, spec 10.4): whether a bot works as an agent, on which runners, with which CLI and models.
 * Slots stand at the runners, time limits are fixed, working rules are the organization's (Organisation → Agenten). A view of the section „Bots“
 * (`/settings/bots?agent=<bot>`), like the delivery log of a webhook. A bot that cannot be an agent (the default bot,
 * one without a responsible person) says why instead of showing the form. The projects list says where the agent
 * works and, where not, why: not a member who may edit items, or the project has not set up agents yet.
 */

import { ArrowLeft, Bot as BotIcon, CircleCheck, CircleMinus, Cpu, TriangleAlert } from 'lucide-react';
import { useMemo, useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { Avatar } from '@/components/ui/Avatar';
import { Banner } from '@/components/ui/Banner';
import { Checkbox } from '@/components/ui/Checkbox';
import { cx } from '@/components/ui/cx';
import { EmptyState } from '@/components/ui/EmptyState';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { labelClass } from '@/components/ui/styles';
import { Switch } from '@/components/ui/Switch';
import { toast } from '@/components/ui/toast';
import { CLI_NAMES, DEFAULT_MODELS, modelsFor, RUN_TYPE_NAMES, RUN_TYPES, whyNotAgent } from '@/domain/agents';
import { ModelField } from '@/features/agents/ModelField';
import { clockTime } from '@/features/agents/runParts';
import { SaveBar } from '@/features/agents/SaveBar';
import { fieldErrors, useDraft, useFieldErrors, useSaveShortcut } from '@/features/settings/project/form';
import { SettingsCard, UnsavedGuard } from '@/features/settings/project/SettingsParts';
import { useAgentConfig, useAgentProjects, useRunners, useSaveAgentConfig } from '@/hooks/agents';
import { useUsers } from '@/hooks/users';
import { notifyError } from '@/lib/errors';
import type { AgentCli, AgentConfig, RunType, User } from '@/types';
import { useOrgZone } from './format';
import { FieldGroup, FormSkeleton, Loaded, SectionHeader } from './parts';

interface Form {
  enabled: boolean;
  runner_ids: string[];
  cli: AgentCli;
  model: string;
  models: Record<RunType, string>;
}

const formOf = (config: AgentConfig): Form => ({
  enabled: config.enabled,
  runner_ids: config.runner_ids,
  cli: config.cli,
  model: config.model,
  models: Object.fromEntries(RUN_TYPES.map((type) => [type, config.models[type] ?? ''])) as Record<RunType, string>,
});

const toConfig = (bot_id: string, form: Form): AgentConfig => ({
  bot_id,
  enabled: form.enabled,
  runner_ids: form.runner_ids,
  cli: form.cli,
  model: form.model,
  models: form.models,
});

const CLIS = [
  { value: 'claude' as const, label: 'Claude Code' },
  { value: 'codex' as const, label: 'Codex' },
];

function Back() {
  return (
    <Link to={{ search: '' }} className="inline-flex h-11 items-center gap-1.5 rounded-ctl text-ui font-medium text-accent-text hover:underline md:h-7">
      <ArrowLeft className="size-4" aria-hidden="true" />
      Alle Bots
    </Link>
  );
}

function Projects({ bot }: { bot: User }) {
  const projects = useAgentProjects(bot.id);
  return (
    <SettingsCard title="Projekte" description="Ein Agent arbeitet, wo er Mitglied ist und Items bearbeiten darf, und wo das Projekt die Agenten eingerichtet hat.">
      <Loaded queries={[projects]} failure="Die Projekte konnten nicht geladen werden" skeleton={<p className="text-ui text-muted">Wird geladen …</p>}>
        {() =>
          projects.data!.length === 0 ? (
            <p className="text-ui text-muted">{`${bot.name} ist in keinem Projekt Mitglied. Füge den Bot in den Projekteinstellungen unter „Mitglieder“ hinzu.`}</p>
          ) : (
            <ul className="flex flex-col gap-2" aria-label={`Projekte von ${bot.name}`}>
              {projects.data!.map((project) => (
                <li key={project.project_id} className="flex items-start gap-2.5">
                  {project.reason === null ? <CircleCheck className="mt-0.5 size-4 shrink-0 text-st-completed" aria-hidden="true" /> : <CircleMinus className="mt-0.5 size-4 shrink-0 text-muted" aria-hidden="true" />}
                  <div className="min-w-0 text-ui">
                    <p className="text-ink">
                      <span className="font-semibold tabular-nums" translate="no">
                        {project.identifier}
                      </span>{' '}
                      {project.name}
                      <span className="sr-only">{project.reason === null ? ': arbeitet hier' : ': arbeitet hier nicht'}</span>
                    </p>
                    <p className="text-sm text-pretty text-muted">
                      {project.reason ?? 'Arbeitet hier: Zuweisen startet einen Auftrag.'}
                      {project.reason?.includes('nicht eingerichtet') && (
                        <>
                          {' '}
                          <Link to={`/projects/${project.identifier}/settings/agents`} className="font-medium text-accent-text underline-offset-2 hover:underline">
                            Agenten von {project.identifier} einrichten
                          </Link>
                        </>
                      )}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )
        }
      </Loaded>
    </SettingsCard>
  );
}

function AgentForm({ bot, config }: { bot: User; config: AgentConfig }) {
  const form = useRef<HTMLFormElement>(null);
  const save = useSaveAgentConfig();
  const runners = useRunners();
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
      await save.mutateAsync(toConfig(bot.id, value));
      draft.reset();
      problems.clearAll();
      toast({ title: `${bot.name}: Agent gespeichert`, description: value.enabled ? undefined : 'Der Agent ist aus. Zuweisungen bleiben normale Zuweisungen.', tone: 'success' });
    } catch (error) {
      const fields = fieldErrors(error);
      if (Object.keys(fields).length > 0) problems.show(fields);
      else notifyError('Agent nicht gespeichert', error, () => form.current?.requestSubmit());
    }
  }

  const defaultModel = value.model.trim() || DEFAULT_MODELS[value.cli];
  // a CLI no runner of the chosen pool reports, installed and logged in (spec 8.8): saving still works
  const pool = (runners.data?.items ?? []).filter((runner) => value.runner_ids.includes(runner.id));
  const cliMissing = pool.length > 0 && !pool.some((runner) => runner.clis.some((entry) => entry.cli === value.cli && entry.installed && entry.logged_in));

  /** A change of CLI keeps the models it knows; the others fall back to its standard, and the hint says which. */
  function chooseCli(cli: AgentCli) {
    if (cli === value.cli) return;
    const next = modelsFor(cli, value.model, value.models);
    edit({ cli, model: next.model, models: Object.fromEntries(RUN_TYPES.map((type) => [type, next.models[type] ?? ''])) as Record<RunType, string> }, 'model');
    setCliNote(
      next.dropped.length === 0
        ? null
        : `${next.dropped.map((model) => `„${model}“`).join(', ')} gibt es bei ${cli === 'claude' ? 'Claude Code' : 'Codex'} nicht. Standard-Modell ist jetzt ${next.model}${Object.keys(next.models).length < Object.values(value.models).filter(Boolean).length ? ', die Modelle je Auftragstyp sind wieder „Wie Standard“' : ''}.`,
    );
  }

  return (
    <form ref={form} noValidate onSubmit={(event) => void submit(event)} className="flex flex-col gap-4">
      <UnsavedGuard dirty={draft.dirty} saving={save.isPending} />
      <SettingsCard title="Agent" description="Ein Agent bekommt bei jeder Zuweisung einen Auftrag: Er setzt das Item um, öffnet einen PR, reviewt PRs und beantwortet Fragen in Kommentaren. Status setzt und mergen tut nur werkbuch.">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-md font-semibold text-ink">Als Agent arbeiten</p>
            <p id="agent-enabled-hint" className="mt-0.5 max-w-[60ch] text-ui text-pretty text-muted">
              Aus: {bot.name} bleibt ein Bot, der nur über Tokens arbeitet. Laufende Aufträge laufen zu Ende.
            </p>
            {problems.errors.enabled && <p className="mt-1 text-sm font-medium text-danger">{problems.errors.enabled}</p>}
          </div>
          <Switch
            label={<span className="sr-only">Als Agent arbeiten</span>}
            className="min-w-11 justify-center md:min-w-0"
            aria-describedby="agent-enabled-hint"
            checked={value.enabled}
            onCheckedChange={(enabled) => edit({ enabled }, 'enabled')}
          />
        </div>
      </SettingsCard>

      <Projects bot={bot} />

      <SettingsCard title="Runner-Pool" description="Auf diesen Runnern arbeitet der Agent. Einen Auftrag nimmt der erste freie Runner; Korrekturen gehen an den Runner ihres Strangs.">
        <Loaded queries={[runners]} failure="Die Runner konnten nicht geladen werden" skeleton={<p className="text-ui text-muted">Wird geladen …</p>}>
          {() =>
            runners.data!.items.length === 0 ? (
              <EmptyState icon={Cpu} title="Noch kein Runner" description="Verbinde zuerst einen Runner unter Betrieb → Runner." />
            ) : (
              <FieldGroup legend="Runner" error={problems.errors.runner_ids}>
                <ul className="flex flex-col">
                  {runners.data!.items.map((runner) => (
                    <li key={runner.id}>
                      <Checkbox
                        className="items-start py-1"
                        aria-label={runner.name}
                        aria-describedby={`runner-hint-${runner.id}`}
                        checked={value.runner_ids.includes(runner.id)}
                        onCheckedChange={(on) => edit({ runner_ids: on ? [...value.runner_ids, runner.id] : value.runner_ids.filter((id) => id !== runner.id) }, 'runner_ids')}
                        label={
                          <span className="min-w-0">
                            <span className="block font-medium" translate="no">
                              {runner.name}
                            </span>
                            <span id={`runner-hint-${runner.id}`} className="block text-sm text-muted">
                              {`${runner.online ? 'Online' : `Offline seit ${clockTime(runner.last_seen_at, zone)}`}, ${runner.slots.total} ${runner.slots.total === 1 ? 'Platz' : 'Plätze'}, ${runner.slots.light} für Reviews und Antworten`}
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

      <SettingsCard title="CLI und Modelle" description="Die Modelle stehen je CLI fest. Wer gewinnt: das Modell-Label des Items, dann das Projekt je Auftragstyp, dann der Bot je Auftragstyp, dann sein Standard.">
        <div className="flex flex-col gap-1.5">
          <p className={labelClass}>CLI</p>
          <div>
            <SegmentedControl label="CLI" value={value.cli} onValueChange={chooseCli} options={CLIS} describedBy="cli-hint" />
          </div>
          {/* one live region, always in the page: what the CLI means for the pool and the models is announced when it changes */}
          <div aria-live="polite" className="flex flex-col gap-3">
            {cliMissing ? (
              <p id="cli-hint" className="flex items-start gap-1.5 text-sm font-medium text-danger">
                <TriangleAlert className="mt-px size-3.5 shrink-0" aria-hidden="true" />
                {`${CLI_NAMES[value.cli]}: auf keinem Runner im Pool verfügbar (installiert und angemeldet). Speichern geht; Aufträge warten, bis ein Runner es meldet.`}
              </p>
            ) : (
              <p id="cli-hint" className="text-sm text-muted">
                Der Runner startet es headless und reicht das Modell durch. Es muss auf den Runnern installiert und angemeldet sein; „Doctor“ in der TUI prüft das.
              </p>
            )}
            {cliNote && draft.dirty && (
              <Banner tone="info" title="Modelle angepasst">
                {cliNote}
              </Banner>
            )}
          </div>
        </div>
        <ModelField label="Standard-Modell" cli={value.cli} value={value.model} error={problems.errors.model} onChange={(model) => edit({ model }, 'model')} />
        <FieldGroup legend="Modell je Auftragstyp" hint="„Wie Standard“ nimmt das Standard-Modell.">
          <div className="grid gap-x-4 gap-y-3 md:grid-cols-2">
            {RUN_TYPES.map((type) => (
              <ModelField
                key={type}
                label={RUN_TYPE_NAMES[type]}
                cli={value.cli}
                inherit={`Wie Standard (${defaultModel})`}
                value={value.models[type]}
                error={problems.errors[`models.${type}`]}
                onChange={(model) => edit({ models: { ...value.models, [type]: model } }, `models.${type}`)}
              />
            ))}
          </div>
        </FieldGroup>
      </SettingsCard>

      <SaveBar
        dirty={draft.dirty}
        pending={save.isPending}
        quiet={draft.quiet}
        onReset={() => {
          draft.reset();
          problems.clearAll();
        }}
      />
    </form>
  );
}

export function BotAgent({ botId }: { botId: string }) {
  const users = useUsers();
  const config = useAgentConfig(botId);
  const bot = users.data?.items.find((user) => user.id === botId);
  const reasons = bot ? whyNotAgent(bot) : [];

  return (
    <div className="flex flex-col gap-4">
      <SectionHeader
        back={<Back />}
        title={
          <span className="inline-flex items-center gap-2.5">
            {bot && <Avatar user={bot} decorative />}
            {bot ? `${bot.name} als Agent` : 'Agent'}
          </span>
        }
        description="Wer einem Agenten ein Item zuweist, startet einen Auftrag auf einem Runner. Die Arbeit sieht in werkbuch aus wie die einer Person: gleiche History, gleiche Benachrichtigungen."
      />
      <Loaded queries={[users, config]} failure="Der Agent konnte nicht geladen werden" skeleton={<FormSkeleton label="Der Agent wird geladen …" />}>
        {() => {
          if (!bot) return <EmptyState icon={BotIcon} title="Diesen Bot gibt es nicht" description="Vielleicht wurde er gelöscht. Die Liste zeigt alle Bots." actions={<Back />} />;
          if (reasons.length > 0) {
            return (
              <Banner tone="neutral" icon={BotIcon} title={`${bot.name} kann kein Agent sein`}>
                <ul className={cx('flex flex-col gap-1', reasons.length > 1 && 'list-disc pl-4')}>
                  {reasons.map((reason) => (
                    <li key={reason} className="max-w-[65ch]">
                      {reason}
                    </li>
                  ))}
                </ul>
                <p className="mt-1.5 max-w-[65ch] text-muted">Ein Agent braucht eine verantwortliche Person: Sie bekommt das Ticket zurück, wenn die Bremse greift. Lege für Agenten einen eigenen Bot an.</p>
              </Banner>
            );
          }
          return <AgentForm bot={bot} config={config.data!} />;
        }}
      </Loaded>
    </div>
  );
}

/** The agent of a bot in a line, for its card in the list. */
export function agentSummary(config: AgentConfig | undefined, runnerNames: Map<string, string>): string {
  if (!config?.enabled) return 'Aus';
  const runners = config.runner_ids.map((id) => runnerNames.get(id) ?? 'ein Runner');
  return `An: ${config.cli === 'claude' ? 'Claude Code' : 'Codex'} mit ${config.model}, auf ${runners.join(' und ')}`;
}

