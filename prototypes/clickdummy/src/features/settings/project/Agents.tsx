/*
 * Project → Agenten (WEBU-18, spec 10.3): how agents work in this project. One form, saved as a whole from the bar at
 * the bottom (⌘↵), in six sheets:
 * - Repository: the repo (1:1, only repos with both GitHub apps), base branch, merge method, the review agent (a bot
 *   that works as an agent; the others stand greyed with the reason), reviews of PRs by people, the comment on the PR.
 * - Worktree: the setup and teardown commands the runner runs around a worktree (spec 8.4). MCP servers, skills and
 *   plugins are equipment of the machine, not set here (spec 8.7).
 * - Status je Schritt: read only. The steps belong to the workflow (spec 7.4) and are set in the workflow editor; a
 *   link leads there. Without all four, agents are off in the project: an assignment to a bot stays a plain one.
 * - Bremsen: corrections and conflicts per strand before the item goes back to the bot's responsible person.
 * - Modelle: per kind of run. A model label of the item (a label of the organization with a model for agents) goes
 *   first; those are set in Organisation → Labels (spec 7.7).
 * - Projektinformationen und Regeln: one Markdown text for every kind of run; the working rules per kind are the
 *   organization's (Organisation → Agenten, spec 7.3).
 * Everybody in the project reads; project admins change it.
 */

import { CircleAlert, GitBranch } from 'lucide-react';
import { useMemo, useRef, type FormEvent } from 'react';
import { Link } from 'react-router';
import { Avatar } from '@/components/ui/Avatar';
import { Banner } from '@/components/ui/Banner';
import { ToneDot } from '@/components/ui/Chip';
import { Input } from '@/components/ui/Input';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { Select } from '@/components/ui/Select';
import { StatusIcon } from '@/components/ui/StatusIcon';
import { labelClass } from '@/components/ui/styles';
import { Switch } from '@/components/ui/Switch';
import { Textarea } from '@/components/ui/Textarea';
import { toast } from '@/components/ui/toast';
import { AGENT_STEPS, categoriesText, isModelLabel, mappingComplete, missingSteps, RUN_TYPE_NAMES, RUN_TYPES, STEP_CATEGORIES, STEP_HINTS, STEP_NAMES } from '@/domain/agents';
import { ModelChoice } from '@/features/agents/ModelField';
import { SaveBar } from '@/features/agents/SaveBar';
import { useAgentBotIds, useAgentModels, useGithub, useProjectAgents, useRepoOwners, useSaveProjectAgents } from '@/hooks/agents';
import { useLabels } from '@/hooks/catalog';
import { useMembers } from '@/hooks/projects';
import { useUsers } from '@/hooks/users';
import { useWorkflows } from '@/hooks/workflows';
import { notifyError } from '@/lib/errors';
import { usePermissions } from '@/lib/permissions';
import type { AgentStep, Label, MergeMethod, ModelRef, ProjectAgents, RunType, User, Workflow } from '@/types';
import { fieldErrors, useDraft, useFieldErrors, useSaveShortcut } from './form';
import type { SectionProps } from './sectionProps';
import { SettingsCard, SettingsError, SettingsSkeleton, UnsavedGuard } from './SettingsParts';

const NO_REPO = '__none';
const NO_BOT = '__none';
const READ_ONLY = 'bg-sunken! shadow-none!';

interface Form {
  repo: string;
  base_branch: string;
  merge_method: MergeMethod;
  setup_command: string;
  teardown_command: string;
  review_bot_id: string;
  max_corrections: string;
  max_conflicts: string;
  review_human_prs: boolean;
  comment_on_pr: boolean;
  models: Record<RunType, ModelRef | null>;
  info: string;
}

const formOf = (settings: ProjectAgents): Form => ({
  repo: settings.repo ?? NO_REPO,
  base_branch: settings.base_branch,
  merge_method: settings.merge_method,
  setup_command: settings.setup_command,
  teardown_command: settings.teardown_command,
  review_bot_id: settings.review_bot_id ?? NO_BOT,
  max_corrections: String(settings.max_corrections),
  max_conflicts: String(settings.max_conflicts),
  review_human_prs: settings.review_human_prs,
  comment_on_pr: settings.comment_on_pr,
  models: Object.fromEntries(RUN_TYPES.map((type) => [type, settings.models[type] ?? null])) as Record<RunType, ModelRef | null>,
  info: settings.info,
});

const toSettings = (project_id: string, form: Form): ProjectAgents => ({
  project_id,
  repo: form.repo === NO_REPO ? null : form.repo,
  base_branch: form.base_branch,
  merge_method: form.merge_method,
  setup_command: form.setup_command,
  teardown_command: form.teardown_command,
  review_bot_id: form.review_bot_id === NO_BOT ? null : form.review_bot_id,
  max_corrections: Number(form.max_corrections),
  max_conflicts: Number(form.max_conflicts),
  review_human_prs: form.review_human_prs,
  comment_on_pr: form.comment_on_pr,
  models: Object.fromEntries(Object.entries(form.models).filter(([, ref]) => ref !== null)) as Partial<Record<RunType, ModelRef>>,
  info: form.info,
});

const MERGE_METHODS = [
  { value: 'squash' as const, label: 'Squash' },
  { value: 'merge' as const, label: 'Merge-Commit' },
  { value: 'rebase' as const, label: 'Rebase' },
];

const MERGE_HINTS: Record<MergeMethod, string> = {
  squash: 'Ein Commit je PR auf dem Basis-Branch. Der Merge-Commit eines gelösten Konflikts stört dabei nicht.',
  merge: 'Alle Commits des PRs bleiben, dazu ein Merge-Commit.',
  rebase: 'Die Commits des PRs werden einzeln auf den Basis-Branch gesetzt.',
};

/* ----------------------------------------------------------------------- status steps */

/** A step and the status the workflow gives it, to read: the steps are set in the workflow editor. */
function StepRow({ step, workflow }: { step: AgentStep; workflow: Workflow }) {
  const state = workflow.states.find((entry) => entry.id === workflow.agent_states[step]);
  return (
    <div className="grid items-start gap-x-4 gap-y-1 md:grid-cols-[12rem_minmax(0,1fr)]">
      <dt className="min-w-0">
        <span className="block text-ui font-semibold text-ink">{STEP_NAMES[step]}</span>
        <span className="block text-sm text-pretty text-muted">{`${STEP_HINTS[step]} Kategorie ${categoriesText(STEP_CATEGORIES[step])}.`}</span>
      </dt>
      <dd className="flex items-center gap-2 text-ui text-ink md:pt-0.5">
        {state ? (
          <>
            <StatusIcon icon={state.icon} category={state.category} label={state.name} aria-hidden="true" />
            {state.name}
          </>
        ) : (
          <span className="text-muted">Kein Status</span>
        )}
      </dd>
    </div>
  );
}

/* ------------------------------------------------------------------------ model labels */

/** The model labels of the organization, which go before the project's models; they are set in Organisation → Labels. */
function ModelLabels({ labels, canManage }: { labels: readonly Label[]; canManage: boolean }) {
  const link = canManage ? (
    <Link to="/settings/labels" className="font-medium text-accent-text underline-offset-2 hover:underline">
      Labels bearbeiten
    </Link>
  ) : null;
  return (
    <div className="flex flex-col gap-2">
      <p className={labelClass}>Modell-Labels der Organisation</p>
      {labels.length === 0 ? (
        <p className="max-w-[65ch] text-sm text-pretty text-muted">Noch kein Label mit einem Modell für Agenten. Ein solches Label legen Org-Admins unter Labels an. {link}</p>
      ) : (
        <>
          <p className="max-w-[65ch] text-sm text-pretty text-muted">
            Trägt ein Item eins davon, nimmt der Agent dessen Modell; bei mehreren das erste in dieser Reihenfolge. Ein Kind eines Epics ohne Modell-Label nimmt das des Epics. {link}
          </p>
          <ul aria-label="Modell-Labels" className="flex flex-wrap gap-2">
            {labels.map((label) => (
              <li key={label.id} className="inline-flex h-7 items-center gap-1.5 rounded-chip border border-line bg-surface px-2 text-sm">
                <ToneDot tone={label.color} className="size-2.5" />
                <span className="font-medium text-ink">{label.name}</span>
                <span className="text-muted" translate="no">
                  {label.agent_model}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------------- the screen */

export function Agents({ project, canManage }: SectionProps) {
  const settings = useProjectAgents(project.id);
  const github = useGithub();
  const owners = useRepoOwners();
  const workflows = useWorkflows();
  const labels = useLabels();
  const users = useUsers();
  const members = useMembers(project.id);
  const agentBots = useAgentBotIds();
  const agentModels = useAgentModels();
  const queries = [settings, github, owners, workflows, labels, users, members, agentBots, agentModels];

  if (queries.some((query) => query.isPending)) return <SettingsSkeleton rows={6} label="Agenten werden geladen …" />;
  const failed = queries.find((query) => query.isError);
  const workflow = workflows.data?.items.find((entry) => entry.id === project.workflow_id);
  if (failed || !workflow) {
    return (
      <SettingsError
        title="Die Agenten konnten nicht geladen werden"
        error={failed?.error}
        retrying={queries.some((query) => query.isFetching)}
        onRetry={() => queries.filter((query) => query.isError).forEach((query) => void query.refetch())}
      />
    );
  }
  const memberIds = new Set(members.data!.items.map((member) => member.user_id));
  const bots = users.data!.items.filter((user) => user.type === 'bot' && !user.is_default_bot && user.disabled_at === null && memberIds.has(user.id));
  // what an empty model per kind of run means here: the model of each agent of the project for that kind
  const agents = agentModels.data!.filter((config) => bots.some((bot) => bot.id === config.bot_id));
  const botModelText = (type: RunType) => {
    const named = agents.map((config) => ({ name: bots.find((bot) => bot.id === config.bot_id)!.name, model: config.models[type] || config.model }));
    const models = [...new Set(named.map((entry) => entry.model))];
    if (models.length === 0) return 'Wie beim Bot';
    if (models.length === 1) return `Wie beim Bot (${models[0]})`;
    return `Wie beim Bot (${named.map((entry) => `${entry.name}: ${entry.model}`).join(', ')})`;
  };
  return <AgentsForm project={project} canManage={canManage} settings={settings.data!} workflow={workflow} bots={bots} agentBotIds={new Set(agentBots.data!)} botModelText={botModelText} />;
}

type FormProps = SectionProps & { settings: ProjectAgents; workflow: Workflow; bots: User[]; agentBotIds: Set<string>; botModelText: (type: RunType) => string };

function AgentsForm({ project, canManage, settings, workflow, bots, agentBotIds, botModelText }: FormProps) {
  const form = useRef<HTMLFormElement>(null);
  const save = useSaveProjectAgents();
  const github = useGithub().data!;
  const owners = useRepoOwners().data!;
  const modelLabels = useLabels().data!.items.filter(isModelLabel);
  const { can } = usePermissions();
  const draft = useDraft(useMemo(() => formOf(settings), [settings]));
  const problems = useFieldErrors(form);
  useSaveShortcut(form, canManage);
  const { value } = draft;
  const readOnly = !canManage;
  const edit = (patch: Partial<Form>, ...paths: string[]) => {
    draft.set(patch);
    problems.clear(...paths);
  };

  const complete = mappingComplete(workflow, workflow.agent_states);
  const missing = missingSteps(workflow);
  const catalog = can('org.manage_catalog');
  const workflowLink = `/settings/workflows?workflow=${workflow.id}`;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (readOnly || save.isPending) return;
    // a project that never saved its settings may save the values as they stand: that sets agents up
    if (!draft.dirty && settings.configured !== false) return draft.tellNothingToSave();
    try {
      await save.mutateAsync(toSettings(project.id, value));
      draft.reset();
      problems.clearAll();
      toast({
        title: 'Agenten gespeichert',
        description: complete ? undefined : `Die Agenten bleiben aus, bis der Workflow „${workflow.name}“ alle Agenten-Schritte hat.`,
        tone: 'success',
      });
    } catch (error) {
      const fields = fieldErrors(error);
      if (Object.keys(fields).length > 0) problems.show(fields);
      else notifyError('Agenten nicht gespeichert', error, () => form.current?.requestSubmit());
    }
  }

  const connected = github.agent_app !== null && github.review_app !== null;
  const repoOptions = [
    { value: NO_REPO, label: 'Kein Repo: Aufträge enden mit einer Zusammenfassung' },
    ...github.repos.map((repo) => {
      const owner = owners.find((entry) => entry.repo === repo.full_name && entry.project_id !== project.id);
      const both = repo.agent_app && repo.review_app;
      return {
        value: repo.full_name,
        label: owner ? `${repo.full_name} (gehört zu ${owner.identifier ?? 'einem anderen Projekt'})` : both ? repo.full_name : `${repo.full_name} (Review-App fehlt)`,
        icon: <GitBranch className="size-4 text-muted" aria-hidden="true" />,
        disabled: Boolean(owner) || !both,
      };
    }),
  ];

  return (
    <form ref={form} noValidate onSubmit={(event) => void submit(event)} className="flex flex-col gap-6">
      {canManage && <UnsavedGuard dirty={draft.dirty} saving={save.isPending} />}
      {settings.configured === false && (
        <Banner tone="info" title={`Agenten in ${project.identifier} noch nicht eingerichtet`}>
          <span className="block max-w-[65ch]">
            {canManage
              ? 'Prüfe die Werte unten (Repo oder ohne Repo, Bremsen, Review-Agent) und speichere einmal. Bis dahin bleibt eine Zuweisung an einen Bot eine normale Zuweisung.'
              : 'Ein Admin des Projekts legt die Werte unten fest und speichert sie. Bis dahin bleibt eine Zuweisung an einen Bot eine normale Zuweisung.'}
          </span>
        </Banner>
      )}
      {!complete && (
        <Banner tone="info" title={`Agenten aus: der Workflow „${workflow.name}“ hat noch ${missing.length === AGENT_STEPS.length ? 'keine' : 'nicht alle'} Agenten-Schritte`}>
          <span className="block max-w-[65ch]">
            {'Bis dahin bleibt eine Zuweisung an einen Bot eine normale Zuweisung, und das Item sagt warum. '}
            {catalog ? (
              <Link to={workflowLink} className="font-medium text-accent-text underline-offset-2 hover:underline">
                Schritte im Workflow einrichten
              </Link>
            ) : (
              'Die Schritte gehören zum Workflow; ein Org-Admin richtet sie dort ein.'
            )}
          </span>
        </Banner>
      )}

      <SettingsCard title="Repository" description="Ein Repo je Projekt, damit der Agent das ganze Projekt kennt. Ohne Repo arbeiten Agenten in einem Ordner und antworten mit einer Zusammenfassung.">
        {!connected && (
          <Banner tone="neutral" icon={CircleAlert} title="GitHub ist nicht verbunden">
            {can('org.manage') ? (
              <>
                Verbinde zuerst die beiden GitHub-Apps unter{' '}
                <Link to="/settings/github" className="font-medium text-accent-text underline-offset-2 hover:underline">
                  Einstellungen → GitHub
                </Link>
                .
              </>
            ) : (
              'Eine Org-Admin verbindet GitHub in den Einstellungen der Organisation.'
            )}
          </Banner>
        )}
        <div className="grid items-start gap-4 md:grid-cols-[minmax(0,1fr)_12rem]">
          <Select label="Repo" value={value.repo} disabled={readOnly} error={problems.errors.repo} options={repoOptions} onValueChange={(repo) => repo && edit({ repo }, 'repo')} />
          <Input
            label="Basis-Branch"
            name="base_branch"
            autoComplete="off"
            spellCheck={false}
            translate="no"
            value={value.base_branch}
            readOnly={readOnly}
            className={readOnly ? READ_ONLY : undefined}
            error={problems.errors.base_branch}
            onChange={(event) => edit({ base_branch: event.target.value }, 'base_branch')}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <p className={labelClass}>Merge-Methode</p>
          <div>
            <SegmentedControl label="Merge-Methode" value={value.merge_method} onValueChange={(merge_method) => edit({ merge_method })} options={MERGE_METHODS.map((option) => ({ ...option, disabled: readOnly }))} />
          </div>
          <p className="text-sm text-pretty text-muted">{MERGE_HINTS[value.merge_method]} werkbuch mergt, wenn CI und die Freigabe des Reviews auf demselben Commit grün sind; der Agent mergt nie.</p>
        </div>
        <Select
          label="Review-Agent"
          hint="Prüft jeden PR des Repos, sobald CI grün ist: die der Agenten und, wenn unten an, die von Personen. Startet immer mit frischer Session."
          value={value.review_bot_id}
          disabled={readOnly}
          error={problems.errors.review_bot_id}
          options={[
            { value: NO_BOT, label: 'Kein Review: werkbuch mergt nicht' },
            // only a bot that works as an agent can review; the others stand greyed with the reason
            ...bots.map((bot) => {
              const agent = agentBotIds.has(bot.id);
              return { value: bot.id, label: agent ? bot.name : `${bot.name} (arbeitet nicht als Agent)`, icon: <Avatar user={bot} size="sm" decorative />, disabled: !agent && bot.id !== settings.review_bot_id };
            }),
          ]}
          onValueChange={(review_bot_id) => review_bot_id && edit({ review_bot_id }, 'review_bot_id')}
        />
        <div className="flex flex-col gap-3">
          <SwitchRow
            title="PRs von Personen reviewen"
            text="Wie die der Agenten, sobald CI grün ist; Entwürfe nicht. Bei Befunden schreibt der Agent einen Kommentar statt „Request changes“, gemergt wird nicht."
            checked={value.review_human_prs}
            disabled={readOnly}
            onChange={(review_human_prs) => edit({ review_human_prs })}
          />
          <SwitchRow
            title="Kommentar am PR"
            text="Bei einer neuen Verknüpfung schreibt die Agenten-App einen Kommentar mit Links auf die Items (einer je PR, wird aktualisiert)."
            checked={value.comment_on_pr}
            disabled={readOnly}
            onChange={(comment_on_pr) => edit({ comment_on_pr })}
          />
        </div>
      </SettingsCard>

      <SettingsCard
        title="Worktree"
        description="Was der Runner für dieses Projekt um einen Worktree tut, auf jedem Runner. MCP-Server, Skills und Plugins richtet man auf der Maschine ein; werkbuch gibt jedem Agenten nur seinen eigenen Server mit dem Token des Auftrags dazu."
      >
        <div className="grid items-start gap-4 md:grid-cols-2">
          <Textarea
            label="Setup-Befehl"
            name="setup_command"
            rows={2}
            spellCheck={false}
            translate="no"
            autoCapitalize="none"
            placeholder="keiner"
            value={value.setup_command}
            readOnly={readOnly}
            className={readOnly ? READ_ONLY : undefined}
            hint="Läuft im neuen Worktree, bevor der Agent startet. $WORKTREE ist sein Name, etwa für ein eigenes DDEV-Projekt."
            error={problems.errors.setup_command}
            onChange={(event) => edit({ setup_command: event.target.value }, 'setup_command')}
          />
          <Textarea
            label="Teardown-Befehl"
            name="teardown_command"
            rows={2}
            spellCheck={false}
            translate="no"
            autoCapitalize="none"
            placeholder="keiner"
            value={value.teardown_command}
            readOnly={readOnly}
            className={readOnly ? READ_ONLY : undefined}
            hint="Läuft, bevor der Runner den Worktree entfernt (nach dem Merge oder wenn der Strang endet)."
            error={problems.errors.teardown_command}
            onChange={(event) => edit({ teardown_command: event.target.value }, 'teardown_command')}
          />
        </div>
      </SettingsCard>

      <SettingsCard
        title="Status je Schritt"
        description={`Diesen Status setzt werkbuch in jedem Schritt, mit der Übergangsprüfung. Die Schritte gehören zum Workflow „${workflow.name}“ und gelten für jedes Projekt damit.`}
      >
        <dl className="flex flex-col gap-4">
          {AGENT_STEPS.map((step) => (
            <StepRow key={step} step={step} workflow={workflow} />
          ))}
        </dl>
        <p className="max-w-[65ch] text-sm text-pretty text-muted">
          {catalog ? (
            <Link to={workflowLink} className="font-medium text-accent-text underline-offset-2 hover:underline">
              Im Workflow „{workflow.name}“ bearbeiten
            </Link>
          ) : (
            `Ändern lassen sie sich im Workflow „${workflow.name}“; das tun Org-Admins.`
          )}
        </p>
      </SettingsCard>

      <SettingsCard title="Bremsen" description="Damit kein Strang ohne Ende Tokens verbrennt: Danach pausiert er, PR und Branch bleiben, und das Item geht mit dem letzten Befund an die verantwortliche Person des Bots.">
        <div className="grid items-start gap-4 sm:grid-cols-2">
          <Input
            label="Korrekturen je Strang"
            inputMode="numeric"
            value={value.max_corrections}
            readOnly={readOnly}
            className={readOnly ? READ_ONLY : undefined}
            hint="Nach CI rot oder Befunden im Review. Standard 3."
            error={problems.errors.max_corrections}
            onChange={(event) => edit({ max_corrections: event.target.value }, 'max_corrections')}
          />
          <Input
            label="Konflikte je Strang"
            inputMode="numeric"
            value={value.max_conflicts}
            readOnly={readOnly}
            className={readOnly ? READ_ONLY : undefined}
            hint="Konflikte mit der Basis, eigens gezählt. Standard 2."
            error={problems.errors.max_conflicts}
            onChange={(event) => edit({ max_conflicts: event.target.value }, 'max_conflicts')}
          />
        </div>
      </SettingsCard>

      <SettingsCard title="Modelle" description="Nicht jeder Auftrag braucht das stärkste Modell. Es gewinnt das erste, das passt: ein Modell-Label des Items, dann der Auftragstyp hier, dann die Einstellungen des Bots.">
        <ModelLabels labels={modelLabels} canManage={can('org.manage_catalog')} />
        <div className="flex flex-col gap-2 border-t border-line pt-4">
          <p className={labelClass}>Modell je Auftragstyp</p>
          <div className="grid gap-x-4 gap-y-3 md:grid-cols-2">
            {RUN_TYPES.map((type) => (
              <ModelChoice
                key={type}
                label={RUN_TYPE_NAMES[type]}
                readOnly={readOnly}
                inherit={botModelText(type)}
                value={value.models[type]}
                error={problems.errors[`models.${type}`]}
                onChange={(model) => edit({ models: { ...value.models, [type]: model } }, `models.${type}`)}
              />
            ))}
          </div>
        </div>
      </SettingsCard>

      <SettingsCard
        title="Projektinformationen und Regeln für Agenten"
        description="Was Agenten über dieses Projekt wissen sollen, für jeden Auftragstyp. Im Prompt steht es nach den Arbeitsregeln der Organisation und dem Vorgehen des Item-Typs, vor CLAUDE.md im Repo."
      >
        <Textarea
          label="Projektinformationen und Regeln"
          name="info"
          rows={8}
          spellCheck
          placeholder="keine"
          value={value.info}
          readOnly={readOnly}
          className={readOnly ? READ_ONLY : undefined}
          hint="Markdown. Für Regeln des Codes ist CLAUDE.md bzw. AGENTS.md im Repo da."
          error={problems.errors.info}
          onChange={(event) => edit({ info: event.target.value }, 'info')}
        />
        <p className="max-w-[65ch] text-sm text-pretty text-muted">
          {'Die Arbeitsregeln je Auftragstyp gelten für die ganze Organisation. '}
          <Link to="/settings/agents" className="font-medium text-accent-text underline-offset-2 hover:underline">
            Arbeitsregeln ansehen
          </Link>
        </p>
      </SettingsCard>

      {canManage && (
        <SaveBar
          dirty={draft.dirty}
          pending={save.isPending}
          quiet={draft.quiet}
          onReset={() => {
            draft.reset();
            problems.clearAll();
          }}
        />
      )}
    </form>
  );
}

function SwitchRow({ title, text, checked, disabled, onChange }: { title: string; text: string; checked: boolean; disabled: boolean; onChange: (on: boolean) => void }) {
  const id = `switch-${title.replace(/\W+/g, '-')}`;
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        <p className="text-ui font-semibold text-ink">{title}</p>
        <p id={id} className="mt-0.5 max-w-[60ch] text-sm text-pretty text-muted">
          {text}
        </p>
      </div>
      <Switch label={<span className="sr-only">{title}</span>} className="min-w-11 justify-center md:min-w-0" aria-describedby={id} checked={checked} disabled={disabled} onCheckedChange={onChange} />
    </div>
  );
}
