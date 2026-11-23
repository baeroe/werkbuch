/*
 * Project → Agenten (WEBU-18, spec 10.3): how agents work in this project. One form, saved as a whole from the bar at
 * the bottom (⌘↵), in six sheets:
 * - Repository: the repo (1:1, only repos with both GitHub apps), base branch, merge method, the review agent (a bot
 *   that works as an agent; the others stand greyed with the reason), reviews of PRs by people, the comment on the PR.
 * - Worktree: the setup and teardown commands the runner runs around a worktree, and further MCP servers (spec 8.4).
 * - Status je Schritt: the status each step of the flow sets; the category is checked at once and by the server.
 *   Without all four, agents are off in the project: an assignment to a bot stays a plain one.
 * - Bremsen: corrections and conflicts per strand before the item goes back to the bot's responsible person.
 * - Modelle: per kind of run. A model label of the item (a label of the organization with a model for agents) goes
 *   first; those are set in Organisation → Labels (spec 7.7).
 * - Arbeitsregeln: a Markdown text per kind of run, with the standard werkbuch ships and "Standard wiederherstellen".
 * Everybody in the project reads; project admins change it.
 */

import { CircleAlert, GitBranch, RotateCcw } from 'lucide-react';
import { useMemo, useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { Avatar } from '@/components/ui/Avatar';
import { Banner } from '@/components/ui/Banner';
import { Button } from '@/components/ui/Button';
import { ToneDot } from '@/components/ui/Chip';
import { Checkbox } from '@/components/ui/Checkbox';
import { cx } from '@/components/ui/cx';
import { Input } from '@/components/ui/Input';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { Select } from '@/components/ui/Select';
import { StatusIcon } from '@/components/ui/StatusIcon';
import { labelClass } from '@/components/ui/styles';
import { Switch } from '@/components/ui/Switch';
import { Tab, Tabs, TabsList, TabsPanel } from '@/components/ui/Tabs';
import { Textarea } from '@/components/ui/Textarea';
import { toast } from '@/components/ui/toast';
import { DEFAULT_RULES } from '@/domain/agentRuleDefaults';
import { AGENT_STEPS, categoriesText, isModelLabel, mappingComplete, mappingErrors, RUN_TYPE_HINTS, RUN_TYPE_NAMES, RUN_TYPES, STEP_CATEGORIES, STEP_HINTS, STEP_NAMES } from '@/domain/agents';
import { ModelField } from '@/features/agents/ModelField';
import { SaveBar } from '@/features/agents/SaveBar';
import { useAgentBotIds, useGithub, useMcpServers, useProjectAgents, useRepoOwners, useSaveProjectAgents } from '@/hooks/agents';
import { useLabels } from '@/hooks/catalog';
import { useMembers } from '@/hooks/projects';
import { useUsers } from '@/hooks/users';
import { useWorkflows } from '@/hooks/workflows';
import { notifyError } from '@/lib/errors';
import { usePermissions } from '@/lib/permissions';
import type { AgentStep, Label, McpServer, MergeMethod, ProjectAgents, RunType, User, Workflow } from '@/types';
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
  mcp_server_ids: string[];
  review_bot_id: string;
  states: Record<AgentStep, string | null>;
  max_corrections: string;
  max_conflicts: string;
  review_human_prs: boolean;
  comment_on_pr: boolean;
  models: Record<RunType, string>;
  rules: Record<RunType, string | null>;
}

const formOf = (settings: ProjectAgents): Form => ({
  repo: settings.repo ?? NO_REPO,
  base_branch: settings.base_branch,
  merge_method: settings.merge_method,
  setup_command: settings.setup_command,
  teardown_command: settings.teardown_command,
  mcp_server_ids: settings.mcp_server_ids,
  review_bot_id: settings.review_bot_id ?? NO_BOT,
  states: settings.states,
  max_corrections: String(settings.max_corrections),
  max_conflicts: String(settings.max_conflicts),
  review_human_prs: settings.review_human_prs,
  comment_on_pr: settings.comment_on_pr,
  models: Object.fromEntries(RUN_TYPES.map((type) => [type, settings.models[type] ?? ''])) as Record<RunType, string>,
  rules: settings.rules,
});

const toSettings = (project_id: string, form: Form): ProjectAgents => ({
  project_id,
  repo: form.repo === NO_REPO ? null : form.repo,
  base_branch: form.base_branch,
  merge_method: form.merge_method,
  setup_command: form.setup_command,
  teardown_command: form.teardown_command,
  mcp_server_ids: form.mcp_server_ids,
  review_bot_id: form.review_bot_id === NO_BOT ? null : form.review_bot_id,
  states: form.states,
  max_corrections: Number(form.max_corrections),
  max_conflicts: Number(form.max_conflicts),
  review_human_prs: form.review_human_prs,
  comment_on_pr: form.comment_on_pr,
  models: form.models,
  rules: form.rules,
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

function StepRow({ step, workflow, value, error, disabled, onChange }: { step: AgentStep; workflow: Workflow; value: string | null; error?: string; disabled: boolean; onChange: (id: string) => void }) {
  const options = [...workflow.states]
    .sort((a, b) => a.position - b.position)
    .map((state) => ({
      value: state.id,
      label: STEP_CATEGORIES[step].includes(state.category) ? state.name : `${state.name} (passt nicht)`,
      icon: <StatusIcon icon={state.icon} category={state.category} label={state.name} aria-hidden="true" />,
    }));
  return (
    <div className="grid items-start gap-x-4 gap-y-1.5 md:grid-cols-[12rem_minmax(0,1fr)]">
      <div className="min-w-0 md:pt-1.5">
        <p className="text-ui font-semibold text-ink">{STEP_NAMES[step]}</p>
        <p className="text-sm text-pretty text-muted">{`${STEP_HINTS[step]} Kategorie ${categoriesText(STEP_CATEGORIES[step])}.`}</p>
      </div>
      <Select aria-label={`Status für „${STEP_NAMES[step]}“`} placeholder="Status wählen …" value={value} disabled={disabled} error={error} options={options} onValueChange={(next) => next && onChange(next)} />
    </div>
  );
}

/* -------------------------------------------------------------------------- the rules */

type Rules = Record<RunType, string | null>;

/** `onChange` takes a change of the rules as they are when it applies: the undo of a toast comes later. */
function RulesEditor({ value, onChange, readOnly }: { value: Rules; onChange: (change: (rules: Rules) => Rules) => void; readOnly: boolean }) {
  const [tab, setTab] = useState<RunType>('task');
  return (
    <Tabs value={tab} onValueChange={(next) => setTab(next as RunType)}>
      <TabsList aria-label="Arbeitsregeln je Auftragstyp" className="-mx-4 px-4 md:mx-0 md:px-0">
        {RUN_TYPES.map((type) => (
          <Tab key={type} value={type}>
            {RUN_TYPE_NAMES[type]}
            {value[type] !== null && (
              <span className="size-1.5 rounded-full bg-accent" aria-label="eigener Text" role="img" />
            )}
          </Tab>
        ))}
      </TabsList>
      {RUN_TYPES.map((type) => {
        const own = value[type];
        const text = own ?? DEFAULT_RULES[type];
        return (
          <TabsPanel key={type} value={type} className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="max-w-[60ch] text-sm text-pretty text-muted">{RUN_TYPE_HINTS[type]}</p>
              <span className="inline-flex h-6 items-center rounded-chip border border-line bg-sunken px-1.5 text-sm font-medium text-muted">{own === null ? 'Standard von werkbuch' : 'Eigener Text'}</span>
            </div>
            <Textarea
              label={`Arbeitsregeln für „${RUN_TYPE_NAMES[type]}“`}
              rows={11}
              value={text}
              readOnly={readOnly}
              className={readOnly ? READ_ONLY : undefined}
              spellCheck
              hint="Markdown. Wird nach dem festen Vertrag und der Anweisung des Bots in jeden Auftrag dieses Typs gesetzt."
              onChange={(event) => {
                const next = event.target.value === DEFAULT_RULES[type] ? null : event.target.value;
                onChange((rules) => ({ ...rules, [type]: next }));
              }}
            />
            {!readOnly && own !== null && (
              <div>
                <Button
                  variant="secondary"
                  size="sm"
                  icon={RotateCcw}
                  onClick={() => {
                    onChange((rules) => ({ ...rules, [type]: null }));
                    // the undo puts back this one text, into the rules as they are by then
                    toast({ title: `Standard für „${RUN_TYPE_NAMES[type]}“ wiederhergestellt`, description: 'Gilt nach dem Speichern.', action: { label: 'Rückgängig', onClick: () => onChange((rules) => ({ ...rules, [type]: own })) } });
                  }}
                >
                  Standard wiederherstellen
                </Button>
              </div>
            )}
          </TabsPanel>
        );
      })}
    </Tabs>
  );
}

/* ------------------------------------------------------------------------- MCP servers */

/** The servers of the organization's catalog the agents of the project get, as ticks; werkbuch's own is always there. */
function McpChoice({ servers, chosen, readOnly, error, canManage, onChange }: { servers: readonly McpServer[]; chosen: string[]; readOnly: boolean; error?: string; canManage: boolean; onChange: (ids: string[]) => void }) {
  const link = canManage ? (
    <Link to="/settings/mcp" className="font-medium text-accent-text underline-offset-2 hover:underline">
      Katalog bearbeiten
    </Link>
  ) : null;
  return (
    <fieldset className="flex flex-col gap-2 border-t border-line pt-4">
      <legend className={cx(labelClass, 'float-left mb-2 w-full')}>MCP-Server</legend>
      <p className="max-w-[65ch] text-sm text-pretty text-muted">
        Jeder Agent bekommt werkbuch mit dem Token seines Auftrags. Dazu kommen die Server, die du hier anhakst, aus dem Katalog der Organisation; die Server der Maschine sieht ein Agent nie. {link}
      </p>
      {servers.length === 0 ? (
        <p className="text-ui text-muted">Der Katalog ist noch leer.</p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {servers.map((server) => (
            <li key={server.id}>
              <Checkbox
                checked={chosen.includes(server.id)}
                disabled={readOnly}
                onCheckedChange={(on) => onChange(on ? [...chosen, server.id] : chosen.filter((id) => id !== server.id))}
                label={
                  <span className="min-w-0">
                    <span className="font-medium" translate="no">
                      {server.name}
                    </span>{' '}
                    <span className="text-sm text-muted" translate="no">
                      {[server.command, ...server.args].join(' ')}
                    </span>
                    {server.missing_on.length > 0 && (
                      <span className="block text-sm text-danger">{`Fehlt auf ${server.missing_on.map((runner) => runner.name).join(', ')}: Aufträge dort scheitern sofort.`}</span>
                    )}
                  </span>
                }
              />
            </li>
          ))}
        </ul>
      )}
      {error && <p className="text-sm text-danger">{error}</p>}
    </fieldset>
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
  const mcp = useMcpServers();
  const queries = [settings, github, owners, workflows, labels, users, members, agentBots, mcp];

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
  return <AgentsForm project={project} canManage={canManage} settings={settings.data!} workflow={workflow} bots={bots} agentBotIds={new Set(agentBots.data!)} mcpServers={mcp.data!.items} />;
}

type FormProps = SectionProps & { settings: ProjectAgents; workflow: Workflow; bots: User[]; agentBotIds: Set<string>; mcpServers: McpServer[] };

function AgentsForm({ project, canManage, settings, workflow, bots, agentBotIds, mcpServers }: FormProps) {
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

  const live = mappingErrors(workflow, value.states);
  const stepError = (step: AgentStep) => live[step] ?? problems.errors[`states.${step}`];
  const complete = mappingComplete(workflow, value.states);
  const anySet = AGENT_STEPS.some((step) => value.states[step] !== null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (readOnly || save.isPending) return;
    if (!draft.dirty) return draft.tellNothingToSave();
    try {
      const saved = await save.mutateAsync(toSettings(project.id, value));
      draft.reset();
      problems.clearAll();
      toast({
        title: 'Agenten gespeichert',
        description: mappingComplete(workflow, saved.states) ? undefined : 'Ohne Status für alle vier Schritte bleiben die Agenten in diesem Projekt aus.',
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
      {!complete && (
        <Banner tone="info" role="status" title={`Agenten sind in ${project.identifier} aus`}>
          <span className="block max-w-[65ch]">
            {anySet
              ? 'Eine Status-Zuordnung passt noch nicht. Bis alle vier Schritte einen passenden Status haben, bleibt eine Zuweisung an einen Bot eine normale Zuweisung.'
              : 'Wähle unten für jeden Schritt einen Status. Bis dahin bleibt eine Zuweisung an einen Bot eine normale Zuweisung, und das Item sagt warum.'}
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
        title="Worktree und Werkzeuge"
        description="Was der Runner für dieses Projekt um einen Worktree tut und welche MCP-Server aus dem Katalog die Agenten bekommen. Gilt auf jedem Runner; auf der Maschine stellt man nichts ein."
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
        <McpChoice
          servers={mcpServers}
          chosen={value.mcp_server_ids}
          readOnly={readOnly}
          canManage={can('org.manage')}
          error={Object.entries(problems.errors).find(([path]) => path.startsWith('mcp_server_ids'))?.[1]}
          onChange={(mcp_server_ids) => edit({ mcp_server_ids }, ...value.mcp_server_ids.map((_, index) => `mcp_server_ids.${index}`))}
        />
      </SettingsCard>

      <SettingsCard
        title="Status je Schritt"
        description={`Diesen Status setzt werkbuch in jedem Schritt, mit der Übergangsprüfung des Workflows „${workflow.name}“. Ist ein Übergang nicht erlaubt, bleibt der Status, und ein Kommentar sagt es.`}
      >
        <div className="flex flex-col gap-4">
          {AGENT_STEPS.map((step) => (
            <StepRow
              key={step}
              step={step}
              workflow={workflow}
              value={value.states[step]}
              error={stepError(step)}
              disabled={readOnly}
              onChange={(id) => edit({ states: { ...value.states, [step]: id } }, `states.${step}`)}
            />
          ))}
        </div>
        {!workflow.states.some((state) => /review/i.test(state.name)) && (
          <p className="max-w-[65ch] text-sm text-pretty text-muted">
            {`„${workflow.name}“ hat keinen Status „In Review“. „Pending“ geht auch; schöner ist ein eigener Status der Kategorie Started im Workflow.`}{' '}
            {can('org.manage_catalog') && (
              <Link to={`/settings/workflows?workflow=${workflow.id}`} className="font-medium text-accent-text underline-offset-2 hover:underline">
                Workflow bearbeiten
              </Link>
            )}
          </p>
        )}
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
          <p className="text-sm text-muted">Leer heißt: wie in den Einstellungen des Bots.</p>
          <div className="grid gap-x-4 gap-y-3 md:grid-cols-2">
            {RUN_TYPES.map((type) => (
              <ModelField
                key={type}
                label={RUN_TYPE_NAMES[type]}
                cli="claude"
                suggestions={false}
                readOnly={readOnly}
                placeholder="wie beim Bot"
                value={value.models[type]}
                onChange={(model) => edit({ models: { ...value.models, [type]: model } })}
              />
            ))}
          </div>
        </div>
      </SettingsCard>

      <SettingsCard title="Arbeitsregeln" description="Wie Agenten in diesem Projekt arbeiten, je Auftragstyp. Was nie erlaubt ist (Status setzen, mergen, Force-Push) und das Ausgabeformat stehen fest im Code und gehen vor; die Regeln für den Code stehen im Repo (CLAUDE.md, AGENTS.md).">
        <RulesEditor value={value.rules} readOnly={readOnly} onChange={(change) => draft.update((current) => ({ rules: change(current.rules) }))} />
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
