/*
 * Project → Agenten (spec 10.3, 11.3; a port of the click dummy's `Agents.tsx`, WEBU-27 and WEBU-32): how agents work in
 * this project. One form, saved as a whole from the bar at the bottom (⌘↵), in six sheets:
 * - Repository: the repo (1:1) and its base branch, the merge method, the review agent (a bot of the project; one that
 *   does not work as an agent or may not edit items stands greyed with the reason), reviews of PRs of persons, the
 *   comment at the PR. The repo goes through `PUT …/repository`, the rest through `PUT …/agents`: only what changed.
 * - Worktree: the setup and teardown commands the runner runs around a worktree (spec 8.4).
 * - Status je Schritt: read only. The steps belong to the workflow (spec 7.4) and are set in the workflow editor.
 * - Bremsen: corrections and conflicts per strand before the item goes back to the bot's responsible person.
 * - Modelle: per kind of run, `cli:model`; the model labels of the organization go first (Organisation → Labels).
 * - Projektinformationen und Regeln: one Markdown text for every kind of run.
 * Above them the guard against an unauthorized merge: werkbuch detected a push of the app to the base branch that no
 * merge of werkbuch explains, every strand of the project pauses until a project admin confirms. Without all four
 * steps, agents are off in the project and say so. Everybody in the project reads; project admins change and confirm.
 */

import { Link } from '@inertiajs/react';
import { CircleAlert, GitBranch, ShieldAlert } from 'lucide-react';
import { Fragment, useId, useMemo, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { useQueries } from '@tanstack/react-query';
import { ApiError } from '@/api/client';
import { Avatar } from '@/components/ui/Avatar';
import { Banner } from '@/components/ui/Banner';
import { Button } from '@/components/ui/Button';
import { cx } from '@/components/ui/cx';
import { ToneDot } from '@/components/ui/Chip';
import { Input } from '@/components/ui/Input';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { Select } from '@/components/ui/Select';
import { StatusIcon } from '@/components/ui/StatusIcon';
import { labelClass } from '@/components/ui/styles';
import { Switch } from '@/components/ui/Switch';
import { Textarea } from '@/components/ui/Textarea';
import { toast } from '@/components/ui/toast';
import { useUserMap } from '@/components/fields/itemData';
import { AGENT_STEPS, botModels, isModelLabel, missingSteps, parseModel, RUN_TYPES, STEP_CATEGORIES, stepsComplete } from '@/domain/agents';
import { useProjectAgents, useSaveProjectAgents } from '@/hooks/agents';
import { useLabels } from '@/hooks/catalog';
import { useConfirmMergeGuard, useGitHub, useProjectRepository, useSetProjectRepository } from '@/hooks/github';
import { useSettle } from '@/hooks/mutation';
import { itemRefQuery } from '@/hooks/richText';
import { useWorkflows } from '@/hooks/workflows';
import { notifyError } from '@/lib/errors';
import { focusWhenLost } from '@/lib/focusOrigin';
import { intlLocale, t, tx, type TranslationKey } from '@/lib/i18n';
import { paths } from '@/lib/links';
import { usePermissions } from '@/lib/permissions';
import type { AgentStep, GitHubStatus, Label, ListedItem, MergeGuard, MergeMethod, Project, ProjectAgents, ProjectRepository, RunType, StateCategory, Workflow } from '@/types';
import { ModelChoice } from '../agents/ModelField';
import { runName } from '../agents/runTypes';
import { SaveBar } from '../agents/SaveBar';
import { fieldErrors, noticeOf, useDraft, useFieldErrors, useSaveShortcut } from '../frame/form';
import { formatDateTime, useOrgZone } from '../frame/format';
import { LeaveGuard } from '../frame/LeaveGuard';
import { Loaded, Measure, readOnlyField, ReadOnlyValue, SettingsCard, SettingsSkeleton } from '../frame/parts';
import type { ProjectSectionProps } from './sectionProps';

const NO_REPO = '__none';

const linkClass = 'font-medium text-accent-text underline-offset-2 hover:underline';

const STEP_NAMES: Record<AgentStep, TranslationKey> = {
  working: 'catalog.agent_step.working',
  review: 'catalog.agent_step.review',
  correction: 'catalog.agent_step.correction',
  merged: 'catalog.agent_step.merged',
};

const STEP_HINTS: Record<AgentStep, TranslationKey> = {
  working: 'settings.project.agents.step_hint.working',
  review: 'settings.project.agents.step_hint.review',
  correction: 'settings.project.agents.step_hint.correction',
  merged: 'settings.project.agents.step_hint.merged',
};

/** The categories a step accepts in words, "Unstarted oder Backlog". */
const categoriesText = (categories: readonly StateCategory[]): string =>
  new Intl.ListFormat(intlLocale(), { type: 'disjunction' }).format(categories.map((category) => t(`catalog.category.${category}`)));

const NO_BOT = '__none';

interface Fields {
  repository_id: string;
  base_branch: string;
  merge_method: MergeMethod;
  review_bot_id: string;
  review_person_prs: boolean;
  comment_on_pr: boolean;
  setup_command: string;
  teardown_command: string;
  max_corrections: string;
  max_conflicts: string;
  models: Record<RunType, string | null>;
  instructions: string;
}

/** The fields that go through `PUT …/repository`; all others through `PUT …/agents`. */
const REPO_FIELDS: (keyof Fields)[] = ['repository_id', 'base_branch'];

const fieldsOf = (link: ProjectRepository | null, settings: ProjectAgents): Fields => ({
  repository_id: link?.repository.id ?? NO_REPO,
  base_branch: link?.base_branch ?? '',
  merge_method: settings.merge_method,
  review_bot_id: settings.review_bot_id ?? NO_BOT,
  review_person_prs: settings.review_person_prs,
  comment_on_pr: settings.comment_on_pr,
  setup_command: settings.setup_command ?? '',
  teardown_command: settings.teardown_command ?? '',
  max_corrections: String(settings.max_corrections),
  max_conflicts: String(settings.max_conflicts),
  models: Object.fromEntries(RUN_TYPES.map((type) => [type, settings.models[type] ?? null])) as Record<RunType, string | null>,
  instructions: settings.instructions ?? '',
});

const textOrNull = (text: string) => (text.trim() === '' ? null : text);

/** A brake as the server takes it: a whole number of 1 to `BRAKE_MAX`; null for anything else. */
export const BRAKE_MAX = 10;
export function parseBrake(text: string): number | null {
  if (!/^\s*\d{1,2}\s*$/.test(text)) return null;
  const value = Number(text);
  return value >= 1 && value <= BRAKE_MAX ? value : null;
}

const MERGE_METHODS: MergeMethod[] = ['squash', 'merge', 'rebase'];

/* ------------------------------------------------------------------- unauthorized merge */

/** The items of the runs that pushed, as links with their key, in a list of the language ("WEB-47 und WEB-48"). */
function RunItems({ items }: { items: ListedItem[] }) {
  const parts = new Intl.ListFormat(intlLocale(), { type: 'conjunction' }).formatToParts(items.map((item) => item.key));
  let at = 0;
  return (
    <>
      {parts.map((part, index) => {
        if (part.type === 'literal') return <Fragment key={index}>{part.value}</Fragment>;
        const item = items[at++]!;
        return (
          <Link key={item.id} href={paths.item(item.key)} className={linkClass}>
            {item.key}
          </Link>
        );
      })}
    </>
  );
}

/**
 * werkbuch detected a push of the app to the base branch that no merge of werkbuch explains (spec 11.3): every strand
 * of the project pauses until a project admin confirms; the strands then go on with a correction. The items of the
 * runs that pushed are named once the reader sees them (an item the reader does not see stays out).
 */
function MergeGuardBanner({ project, guard, canManage, unprotected, pending, onConfirm }: { project: Project; guard: MergeGuard; canManage: boolean; unprotected: boolean; pending: boolean; onConfirm: () => void }) {
  const zone = useOrgZone();
  const ids = [...new Set(guard.runs.flatMap((run) => (run.item_id ? [run.item_id] : [])))];
  const refs = useQueries({ queries: ids.map((id) => itemRefQuery(id)) });
  const items = refs.flatMap((ref) => (ref.data ? [ref.data] : []));
  const branch = guard.branch ?? '';
  const sha = (guard.sha ?? '').slice(0, 7);
  const parts = { time: guard.detected_at ? formatDateTime(guard.detected_at, zone) : '', branch, sha, items: <RunItems items={items} /> };
  const what = guard.detected_at ? (items.length > 0 ? 'pushed_at_runs' : 'pushed_at') : items.length > 0 ? 'pushed_runs' : 'pushed';

  // an alert is announced as it first shows: it waits for the items of its runs (a hidden one settles too), so it is
  // announced once with its whole sentence, not again when the links come
  if (refs.some((ref) => ref.isPending)) return null;

  return (
    <Banner
      tone="danger"
      role="alert"
      aria-labelledby="merge-guard-title"
      icon={ShieldAlert}
      title={<span id="merge-guard-title">{t('settings.project.agents.guard.title', { identifier: project.identifier })}</span>}
      action={
        canManage ? (
          <Button variant="secondary" size="sm" pending={pending} onClick={onConfirm} aria-describedby="merge-guard-title" data-confirm-guard="">
            {t('settings.project.agents.guard.confirm')}
          </Button>
        ) : undefined
      }
    >
      <Measure>
        {tx(`settings.project.agents.guard.${what}`, parts)}{' '}
        {canManage ? t('settings.project.agents.guard.admin') : t('settings.project.agents.guard.reader')}
        {canManage && unprotected && ` ${t('settings.project.agents.guard.unprotected', { branch })}`}
      </Measure>
    </Banner>
  );
}

/* ----------------------------------------------------------------------- status steps */

/** A step and the status the workflow gives it, to read: the steps are set in the workflow editor. */
function StepRow({ step, workflow }: { step: AgentStep; workflow: Workflow }) {
  const state = workflow.states.find((entry) => entry.id === workflow.agent_states[step]);
  return (
    <div className="grid items-start gap-x-4 gap-y-1 md:grid-cols-[12rem_minmax(0,1fr)]">
      <dt className="min-w-0">
        <span className="block text-ui font-semibold text-ink">{t(STEP_NAMES[step])}</span>
        <span className="block text-sm text-pretty text-muted">{t('settings.project.agents.step_line', { hint: t(STEP_HINTS[step]), categories: categoriesText(STEP_CATEGORIES[step]) })}</span>
      </dt>
      <dd className="flex items-center gap-2 text-ui text-ink md:pt-0.5">
        {state ? (
          <>
            <StatusIcon icon={state.icon} category={state.category} label={state.name} aria-hidden="true" />
            {state.name}
          </>
        ) : (
          <span className="text-muted">{t('settings.project.agents.no_state')}</span>
        )}
      </dd>
    </div>
  );
}

/* ------------------------------------------------------------------------ model labels */

/** The model labels of the organization, which go before the project's models; they are set in Organisation → Labels. */
function ModelLabels({ labels, canManage }: { labels: readonly Label[]; canManage: boolean }) {
  const link = canManage ? (
    <Link href={paths.settings('labels')} className={linkClass}>
      {t('settings.project.agents.model_labels.edit')}
    </Link>
  ) : null;
  return (
    <div className="flex flex-col gap-2">
      <p className={labelClass}>{t('settings.project.agents.model_labels.title')}</p>
      {labels.length === 0 ? (
        <Measure>
          <span className="text-sm text-muted">{t('settings.project.agents.model_labels.none')}</span> {link}
        </Measure>
      ) : (
        <>
          <Measure>
            <span className="text-sm text-muted">{t('settings.project.agents.model_labels.text')}</span> {link}
          </Measure>
          <ul aria-label={t('settings.project.agents.model_labels.list')} className="flex flex-wrap gap-2">
            {labels.map((label) => (
              <li key={label.id} className="inline-flex h-7 items-center gap-1.5 rounded-chip border border-line bg-surface px-2 text-sm">
                <ToneDot tone={label.color} className="size-2.5" />
                <span className="font-medium text-ink">{label.name}</span>
                <span className="text-muted" translate="no">
                  {parseModel(label.agent_model)?.model ?? label.agent_model}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

/** A setting that is on or off, with its sentence; read only, the switch is disabled like the automations. */
/**
 * A setting that is on or off, with its sentence; read only, the switch is disabled like the automations. `reason` locks
 * it for something else on the page, said below the sentence (a disabled switch takes no focus, so the reason is text).
 */
function SwitchRow({ title, text, checked, readOnly, reason = null, onChange }: { title: string; text: string; checked: boolean; readOnly: boolean; reason?: string | null; onChange: (on: boolean) => void }) {
  const id = useId();
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        <p className="text-ui font-semibold text-ink">{title}</p>
        <p id={id} className="mt-0.5 max-w-[60ch] text-sm text-pretty text-muted">
          {text}
          {reason && <span className="mt-1 block font-medium text-ink">{reason}</span>}
        </p>
      </div>
      <Switch label={<span className="sr-only">{title}</span>} className="min-w-11 justify-center md:min-w-0" aria-describedby={id} checked={checked} disabled={readOnly || reason !== null} onCheckedChange={onChange} />
    </div>
  );
}

/* ------------------------------------------------------------------------- the screen */

type FormProps = ProjectSectionProps & { link: ProjectRepository | null; settings: ProjectAgents; github: GitHubStatus; workflow: Workflow; labels: Label[] };

function AgentsForm({ project, canManage, readOnlyReason, link, settings, github, workflow, labels }: FormProps) {
  const form = useRef<HTMLFormElement>(null);
  const saveRepo = useSetProjectRepository();
  const saveSettings = useSaveProjectAgents();
  const [saving, setSaving] = useState(false);
  const settle = useSettle();
  const confirm = useConfirmMergeGuard();
  const users = useUserMap();
  const { can } = usePermissions();
  const draft = useDraft(useMemo(() => fieldsOf(link, settings), [link, settings]));
  const problems = useFieldErrors(form);
  const [notice, setNotice] = useState<string | null>(null);
  useSaveShortcut(form, canManage);
  const { value } = draft;

  const complete = stepsComplete(workflow.states, workflow.agent_states);
  const none = missingSteps(workflow.agent_states).length === AGENT_STEPS.length;
  const catalog = can('org.manage_catalog');
  const connected = github.app !== null;
  const nameOf = (id: string) => users.get(id)?.name ?? t('items.someone');

  // here and not in the banner: the banner goes before the answer of the call comes back (the repo is read anew
  // first), and what the call says must still reach the person
  function confirmGuard() {
    settle(confirm.mutateAsync(project.id), {
      onSuccess: () => {
        toast({ title: t('settings.project.agents.guard.confirmed'), description: t('settings.project.agents.guard.confirmed_text'), tone: 'success' });
        // the banner went with the confirm: the focus moves to the heading of the first sheet under it
        focusWhenLost(() => document.querySelector<HTMLElement>('[data-agents-form] [data-card-heading]'), 2000);
      },
      onError: (error) => notifyError(t('settings.project.agents.guard.not_confirmed'), error, confirmGuard),
    });
  }

  function edit(patch: Partial<Fields>, ...paths: string[]) {
    draft.set(patch);
    problems.clear(...(paths.length > 0 ? paths : Object.keys(patch)));
    setNotice(null);
  }

  /** A refusal of one of the two calls: at its fields, the rest as a notice; anything but a 4xx as a toast. */
  function refused(error: unknown, placed: readonly string[]) {
    const fields = fieldErrors(error);
    if (Object.keys(fields).length > 0) problems.show(fields);
    if (error instanceof ApiError && error.status < 500) setNotice(noticeOf(error, placed));
    else notifyError(t('settings.project.agents.not_saved'), error, () => form.current?.requestSubmit());
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!canManage || saving) return;
    if (!draft.dirty) return draft.tellNothingToSave();
    const brakes = { max_corrections: parseBrake(value.max_corrections), max_conflicts: parseBrake(value.max_conflicts) };
    const wrong = (Object.keys(brakes) as (keyof typeof brakes)[]).filter((key) => brakes[key] === null);
    if (wrong.length > 0) return problems.show(Object.fromEntries(wrong.map((key) => [key, t('field.brake.invalid', { max: BRAKE_MAX })])));
    const repoChanged = draft.changed.some((field) => REPO_FIELDS.includes(field));
    const settingsChanged = draft.changed.some((field) => !REPO_FIELDS.includes(field));
    setSaving(true);
    let saved: Pick<Fields, 'repository_id' | 'base_branch'> | null = null;
    try {
      if (repoChanged) {
        const repository = value.repository_id === NO_REPO ? null : value.repository_id;
        try {
          const answer = await saveRepo.mutateAsync({ project: project.id, repository_id: repository, base_branch: repository === null || value.base_branch.trim() === '' ? null : value.base_branch.trim() });
          saved = { repository_id: answer?.repository.id ?? NO_REPO, base_branch: answer?.base_branch ?? '' };
        } catch (error) {
          return refused(error, REPO_FIELDS as string[]);
        }
      }
      if (settingsChanged) {
        try {
          await saveSettings.mutateAsync({
            projectId: project.id,
            input: {
              review_bot_id: value.review_bot_id === NO_BOT ? null : value.review_bot_id,
              instructions: textOrNull(value.instructions),
              models: Object.fromEntries(RUN_TYPES.flatMap((type) => (value.models[type] ? [[type, value.models[type]]] : []))),
              max_corrections: brakes.max_corrections!,
              max_conflicts: brakes.max_conflicts!,
              review_person_prs: value.review_person_prs,
              comment_on_pr: value.comment_on_pr,
              merge_method: value.merge_method,
              setup_command: textOrNull(value.setup_command),
              teardown_command: textOrNull(value.teardown_command),
            },
          });
        } catch (error) {
          // what the repo call saved stays saved: its fields take the answer (equal to the repo read anew, so no
          // change any more), the others wait for the next try
          if (saved) draft.set(saved);
          return refused(error, [...SETTINGS_PLACED, ...RUN_TYPES.map((type) => `models.${type}`)]);
        }
      }
      draft.reset();
      problems.clearAll();
      setNotice(null);
      toast({
        title: t('settings.project.agents.saved'),
        description: complete ? undefined : t('settings.project.agents.saved_off', { workflow: workflow.name }),
        tone: 'success',
      });
    } finally {
      setSaving(false);
    }
  }

  // the repos the app reaches; the one of the project stays even when GitHub took it away, so the choice shows it
  const repos = github.repositories.filter((repo) => !repo.removed_at || repo.id === link?.repository.id);
  const repoOptions = [
    { value: NO_REPO, label: t('settings.project.agents.no_repo') },
    ...repos.map((repo) => {
      const other = repo.taken && repo.project?.id !== project.id;
      return {
        value: repo.id,
        label: other ? t('settings.project.agents.repo_taken', { repo: repo.full_name, project: repo.project?.identifier ?? t('settings.project.agents.another_project') }) : repo.full_name,
        icon: <GitBranch className="size-4 text-muted" aria-hidden="true" />,
        disabled: other,
      };
    }),
  ];
  const chosen = repos.find((repo) => repo.id === value.repository_id);
  const workflowLink = paths.workflow(workflow.id);

  // only a bot that works as an agent and may edit items reviews; the others stand greyed with the reason
  const reviewOptions = [
    { value: NO_BOT, label: t('settings.project.agents.review_bot.none') },
    ...settings.bots.map((bot) => {
      const user = users.get(bot.bot_id);
      const why = user?.disabled_at
        ? 'settings.project.agents.review_bot.disabled'
        : !bot.reviews
          ? 'settings.project.agents.review_bot.cannot'
          : !bot.enabled
            ? 'settings.project.agents.review_bot.off'
            : null;
      return {
        value: bot.bot_id,
        label: why ? t(why, { name: nameOf(bot.bot_id) }) : nameOf(bot.bot_id),
        icon: user ? <Avatar user={user} size="sm" decorative /> : undefined,
        disabled: why !== null && bot.bot_id !== settings.review_bot_id,
      };
    }),
  ];

  /** What no model of the project means for a kind: the model of each agent of the project for that kind. */
  function inheritText(type: RunType): string {
    const named = botModels(settings.bots, type);
    const models = [...new Set(named.map((entry) => entry.model))];
    if (models.length === 0) return t('settings.project.agents.models.as_bot');
    if (models.length === 1) return t('settings.project.agents.models.as_bot_one', { model: models[0]! });
    return t('settings.project.agents.models.as_bot_one', { model: named.map((entry) => `${nameOf(entry.bot_id)}: ${entry.model}`).join(', ') });
  }

  const area = (name: 'setup_command' | 'teardown_command' | 'instructions') => ({
    name,
    value: value[name],
    readOnly: !canManage,
    className: cx(!canManage && readOnlyField),
    error: problems.errors[name],
    onChange: (event: ChangeEvent<HTMLTextAreaElement>) => edit({ [name]: event.target.value }),
  });

  return (
    <form ref={form} noValidate onSubmit={(event) => void submit(event)} data-agents-form="" className="flex flex-col gap-6">
      {canManage && <LeaveGuard dirty={draft.dirty} what={t('settings.project.agents.leave_what')} />}
      {link?.guard && <MergeGuardBanner project={project} guard={link.guard} canManage={canManage} unprotected={link.protected === false} pending={confirm.isPending} onConfirm={confirmGuard} />}
      {!complete && (
        <Banner tone="info" title={t(none ? 'settings.project.agents.off.none' : 'settings.project.agents.off.some', { workflow: workflow.name })}>
          <Measure>
            {`${t('settings.project.agents.off.text')} `}
            {catalog ? (
              <Link href={workflowLink} className={linkClass}>
                {t('settings.project.agents.off.link')}
              </Link>
            ) : (
              t('settings.project.agents.off.reader')
            )}
          </Measure>
        </Banner>
      )}
      {notice && (
        <Banner tone="danger" role="alert" title={t('settings.project.agents.not_saved')}>
          <Measure>{notice}</Measure>
        </Banner>
      )}

      <SettingsCard focusableHeading title={t('settings.project.agents.repository.title')} description={t('settings.project.agents.repository.description')}>
        {!connected && (
          <Banner tone="neutral" icon={CircleAlert} title={t('settings.project.agents.github_off.title')}>
            {can('org.manage')
              ? tx('settings.project.agents.github_off.admin', {
                  link: (
                    <Link href={paths.settings('github')} className={linkClass}>
                      {t('settings.project.agents.github_off.link')}
                    </Link>
                  ),
                })
              : t('settings.project.agents.github_off.reader')}
          </Banner>
        )}
        <div className="grid items-start gap-4 md:grid-cols-[minmax(0,1fr)_12rem]">
          {readOnlyReason !== null ? (
            <ReadOnlyValue label={t('settings.project.agents.repo')} value={repoOptions.find((option) => option.value === value.repository_id)?.label ?? link?.repository.full_name ?? ''} reason={readOnlyReason} />
          ) : (
            <Select
              label={t('settings.project.agents.repo')}
              value={value.repository_id}
              error={problems.errors.repository_id}
              options={repoOptions}
              onValueChange={(repository) => repository && edit({ repository_id: repository, base_branch: repository === link?.repository.id ? link.base_branch : '' })}
            />
          )}
          <Input
            label={t('settings.project.agents.base_branch')}
            name="base_branch"
            autoComplete="off"
            spellCheck={false}
            translate="no"
            value={value.base_branch}
            placeholder={chosen?.default_branch}
            readOnly={!canManage || value.repository_id === NO_REPO}
            className={cx((!canManage || value.repository_id === NO_REPO) && readOnlyField)}
            hint={value.repository_id === NO_REPO ? t('settings.project.agents.base_branch_none') : t('settings.project.agents.base_branch_hint')}
            error={problems.errors.base_branch}
            onChange={(event) => edit({ base_branch: event.target.value })}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          {readOnlyReason !== null ? (
            <ReadOnlyValue label={t('settings.project.agents.merge_method.label')} value={t(`settings.project.agents.merge_method.${value.merge_method}`)} reason={readOnlyReason} />
          ) : (
            <>
              <p className={labelClass}>{t('settings.project.agents.merge_method.label')}</p>
              <div>
                <SegmentedControl
                  label={t('settings.project.agents.merge_method.label')}
                  value={value.merge_method}
                  onValueChange={(merge_method) => edit({ merge_method })}
                  options={MERGE_METHODS.map((method) => ({ value: method, label: t(`settings.project.agents.merge_method.${method}`) }))}
                />
              </div>
              {problems.errors.merge_method && <p className="text-sm font-medium text-danger">{problems.errors.merge_method}</p>}
            </>
          )}
          <Measure>
            <span className="text-sm text-muted">{`${t(`settings.project.agents.merge_method.hint.${value.merge_method}`)} ${t('settings.project.agents.merge_method.how')}`}</span>
          </Measure>
        </div>
        {readOnlyReason !== null ? (
          <ReadOnlyValue
            label={t('settings.project.agents.review_bot.label')}
            value={reviewOptions.find((option) => option.value === value.review_bot_id)?.label ?? nameOf(value.review_bot_id)}
            reason={readOnlyReason}
            hint={t('settings.project.agents.review_bot.hint')}
          />
        ) : (
          <Select
            label={t('settings.project.agents.review_bot.label')}
            hint={t('settings.project.agents.review_bot.hint')}
            value={value.review_bot_id}
            error={problems.errors.review_bot_id}
            options={reviewOptions}
            onValueChange={(review_bot_id) => review_bot_id && edit({ review_bot_id })}
          />
        )}
        <div className="flex flex-col gap-3">
          <SwitchRow
            title={t('settings.project.agents.review_person_prs.title')}
            text={t('settings.project.agents.review_person_prs.text')}
            checked={value.review_person_prs}
            readOnly={!canManage}
            // without a review agent of the project the bot of the strand reviews, and PRs of persons get no review
            reason={value.review_bot_id === NO_BOT ? t('settings.project.agents.review_person_prs.no_reviewer') : null}
            onChange={(review_person_prs) => edit({ review_person_prs })}
          />
          <SwitchRow
            title={t('settings.project.agents.comment_on_pr.title')}
            text={t('settings.project.agents.comment_on_pr.text')}
            checked={value.comment_on_pr}
            readOnly={!canManage}
            onChange={(comment_on_pr) => edit({ comment_on_pr })}
          />
        </div>
      </SettingsCard>

      <SettingsCard title={t('settings.project.agents.worktree.title')} description={t('settings.project.agents.worktree.description')}>
        <div className="grid items-start gap-4 md:grid-cols-2">
          <Textarea
            label={t('settings.project.agents.worktree.setup')}
            rows={2}
            spellCheck={false}
            translate="no"
            autoCapitalize="none"
            placeholder={t('settings.project.agents.worktree.none')}
            hint={t('settings.project.agents.worktree.setup_hint')}
            {...area('setup_command')}
          />
          <Textarea
            label={t('settings.project.agents.worktree.teardown')}
            rows={2}
            spellCheck={false}
            translate="no"
            autoCapitalize="none"
            placeholder={t('settings.project.agents.worktree.none')}
            hint={t('settings.project.agents.worktree.teardown_hint')}
            {...area('teardown_command')}
          />
        </div>
      </SettingsCard>

      <SettingsCard title={t('settings.project.agents.steps.title')} description={t('settings.project.agents.steps.description', { workflow: workflow.name })}>
        <dl className="flex flex-col gap-4">
          {AGENT_STEPS.map((step) => (
            <StepRow key={step} step={step} workflow={workflow} />
          ))}
        </dl>
        <p className="max-w-[65ch] text-sm text-pretty text-muted">
          {catalog ? (
            <Link href={workflowLink} className={linkClass}>
              {t('settings.project.agents.steps.edit', { workflow: workflow.name })}
            </Link>
          ) : (
            t('settings.project.agents.steps.reader', { workflow: workflow.name })
          )}
        </p>
      </SettingsCard>

      <SettingsCard title={t('settings.project.agents.brakes.title')} description={t('settings.project.agents.brakes.description')}>
        <div className="grid items-start gap-4 sm:grid-cols-2">
          {(['max_corrections', 'max_conflicts'] as const).map((brake) => (
            <Input
              key={brake}
              label={t(`settings.project.agents.brakes.${brake}`)}
              name={brake}
              inputMode="numeric"
              autoComplete="off"
              value={value[brake]}
              readOnly={!canManage}
              className={cx(!canManage && readOnlyField)}
              hint={t(`settings.project.agents.brakes.${brake}_hint`)}
              error={problems.errors[brake]}
              onChange={(event) => edit({ [brake]: event.target.value })}
            />
          ))}
        </div>
      </SettingsCard>

      <SettingsCard title={t('settings.project.agents.models.title')} description={t('settings.project.agents.models.description')}>
        <ModelLabels labels={labels.filter(isModelLabel)} canManage={catalog} />
        <div className="flex flex-col gap-2 border-t border-line pt-4">
          <p className={labelClass}>{t('settings.project.agents.models.per_type')}</p>
          <div className="grid gap-x-4 gap-y-3 md:grid-cols-2">
            {RUN_TYPES.map((type) => (
              <ModelChoice
                key={type}
                label={runName(type)}
                readOnlyReason={readOnlyReason}
                inherit={inheritText(type)}
                value={value.models[type]}
                error={problems.errors[`models.${type}`]}
                onChange={(model) => edit({ models: { ...value.models, [type]: model } }, `models.${type}`, 'models')}
              />
            ))}
          </div>
          {problems.errors.models && <p className="text-sm font-medium text-danger">{problems.errors.models}</p>}
        </div>
      </SettingsCard>

      <SettingsCard title={t('settings.project.agents.instructions.title')} description={t('settings.project.agents.instructions.description')}>
        <Textarea label={t('settings.project.agents.instructions.label')} rows={8} spellCheck placeholder={t('settings.project.agents.instructions.none')} hint={t('settings.project.agents.instructions.hint')} {...area('instructions')} />
        <Measure>
          <span className="text-sm text-muted">{`${t('settings.project.agents.instructions.rules')} `}</span>
          <Link href={paths.settings('agents')} className={linkClass}>
            {t('settings.project.agents.instructions.rules_link')}
          </Link>
        </Measure>
      </SettingsCard>

      {canManage && (
        <SaveBar
          dirty={draft.dirty}
          pending={saving}
          quiet={draft.quiet}
          onReset={() => {
            draft.reset();
            problems.clearAll();
            setNotice(null);
          }}
        />
      )}
    </form>
  );
}

/** The fields of `PUT …/agents` a 422 is shown at. */
const SETTINGS_PLACED = ['review_bot_id', 'instructions', 'models', 'max_corrections', 'max_conflicts', 'merge_method', 'setup_command', 'teardown_command'];

export function Agents({ project, canManage, readOnlyReason }: ProjectSectionProps) {
  const link = useProjectRepository(project.id);
  const settings = useProjectAgents(project.id);
  const github = useGitHub();
  const workflows = useWorkflows();
  const labels = useLabels();
  return (
    <Loaded queries={[link, settings, github, workflows, labels]} keepData failure={t('settings.project.agents.load_failed')} skeleton={<SettingsSkeleton rows={6} label={t('settings.project.agents.loading')} />}>
      {() => {
        const workflow = workflows.data!.items.find((entry) => entry.id === project.workflow_id);
        /* istanbul ignore next -- a project always has a workflow of the catalog (NOT NULL, restrictOnDelete) */
        if (!workflow) return null;
        return (
          <AgentsForm
            project={project}
            canManage={canManage}
            readOnlyReason={readOnlyReason}
            link={link.data ?? null}
            settings={settings.data!}
            github={github.data!}
            workflow={workflow}
            labels={labels.data!.items}
          />
        );
      }}
    </Loaded>
  );
}
