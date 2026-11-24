/*
 * Project → Agenten (spec 10.3, 11.3; part of the clickdummy's `Agents.tsx`, WEBU-27): the repo of the project and its
 * base branch, the status per step to read (the steps belong to the workflow and are set in the workflow editor), and
 * the guard against an unauthorized merge: werkbuch detected a push of the app to the base branch that no merge of
 * werkbuch explains, every strand of the project pauses until a project admin confirms. Without all four steps, agents
 * are off in the project and say so. Everybody in the project reads; project admins change the repo and confirm.
 * Merge method, review agent, brakes, models, worktree commands and the project text come with WEBU-32.
 */

import { Link } from '@inertiajs/react';
import { CircleAlert, GitBranch, ShieldAlert } from 'lucide-react';
import { Fragment, useMemo, useRef, useState, type FormEvent } from 'react';
import { useQueries } from '@tanstack/react-query';
import { ApiError } from '@/api/client';
import { Banner } from '@/components/ui/Banner';
import { Button } from '@/components/ui/Button';
import { cx } from '@/components/ui/cx';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { StatusIcon } from '@/components/ui/StatusIcon';
import { toast } from '@/components/ui/toast';
import { AGENT_STEPS, missingSteps, STEP_CATEGORIES, stepsComplete } from '@/domain/agents';
import { useConfirmMergeGuard, useGitHub, useProjectRepository, useSetProjectRepository } from '@/hooks/github';
import { useSettle } from '@/hooks/mutation';
import { itemRefQuery } from '@/hooks/richText';
import { useWorkflows } from '@/hooks/workflows';
import { notifyError } from '@/lib/errors';
import { focusWhenLost } from '@/lib/focusOrigin';
import { intlLocale, t, tx, type TranslationKey } from '@/lib/i18n';
import { paths } from '@/lib/links';
import { usePermissions } from '@/lib/permissions';
import type { AgentStep, GitHubStatus, ListedItem, MergeGuard, Project, ProjectRepository, StateCategory, Workflow } from '@/types';
import { fieldErrors, noticeOf, useDraft, useFieldErrors, useSaveShortcut } from '../frame/form';
import { formatDateTime, useOrgZone } from '../frame/format';
import { LeaveGuard } from '../frame/LeaveGuard';
import { FormActions, Loaded, Measure, readOnlyField, ReadOnlyValue, SettingsCard, SettingsSkeleton } from '../frame/parts';
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

interface Fields {
  repository_id: string;
  base_branch: string;
}

const fieldsOf = (link: ProjectRepository | null): Fields => ({
  repository_id: link?.repository.id ?? NO_REPO,
  base_branch: link?.base_branch ?? '',
});

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

/* ------------------------------------------------------------------------- the screen */

type FormProps = ProjectSectionProps & { link: ProjectRepository | null; github: GitHubStatus; workflow: Workflow };

function AgentsForm({ project, canManage, readOnlyReason, link, github, workflow }: FormProps) {
  const form = useRef<HTMLFormElement>(null);
  const save = useSetProjectRepository();
  const settle = useSettle();
  const confirm = useConfirmMergeGuard();
  const { can } = usePermissions();
  const draft = useDraft(useMemo(() => fieldsOf(link), [link]));
  const problems = useFieldErrors(form);
  const [notice, setNotice] = useState<string | null>(null);
  useSaveShortcut(form, canManage);
  const { value } = draft;

  const complete = stepsComplete(workflow.states, workflow.agent_states);
  const none = missingSteps(workflow.agent_states).length === AGENT_STEPS.length;
  const catalog = can('org.manage_catalog');
  const connected = github.app !== null;

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

  function edit(patch: Partial<Fields>) {
    draft.set(patch);
    problems.clear(...Object.keys(patch));
    setNotice(null);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!canManage || save.isPending) return;
    if (!draft.dirty) {
      draft.tellNothingToSave();
      return;
    }
    const repository = value.repository_id === NO_REPO ? null : value.repository_id;
    try {
      await save.mutateAsync({ project: project.id, repository_id: repository, base_branch: repository === null || value.base_branch.trim() === '' ? null : value.base_branch.trim() });
      draft.reset();
      problems.clearAll();
      setNotice(null);
      toast({
        title: t('settings.project.agents.saved'),
        description: complete ? undefined : t('settings.project.agents.saved_off', { workflow: workflow.name }),
        tone: 'success',
      });
    } catch (error) {
      const fields = fieldErrors(error);
      if (Object.keys(fields).length > 0) problems.show(fields);
      if (error instanceof ApiError && error.status < 500) {
        setNotice(noticeOf(error, ['repository_id', 'base_branch']));
      } else notifyError(t('settings.project.agents.not_saved'), error, () => form.current?.requestSubmit());
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

      <SettingsCard
        focusableHeading
        title={t('settings.project.agents.repository.title')}
        description={t('settings.project.agents.repository.description')}
        footer={
          canManage ? (
            <FormActions
              dirty={draft.dirty}
              quiet={draft.quiet}
              pending={save.isPending}
              onReset={() => {
                draft.reset();
                problems.clearAll();
                setNotice(null);
              }}
            />
          ) : undefined
        }
      >
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
        {notice && (
          <Banner tone="danger" role="alert" title={t('settings.project.agents.not_saved')}>
            <Measure>{notice}</Measure>
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
    </form>
  );
}

export function Agents({ project, canManage, readOnlyReason }: ProjectSectionProps) {
  const link = useProjectRepository(project.id);
  const github = useGitHub();
  const workflows = useWorkflows();
  return (
    <Loaded queries={[link, github, workflows]} keepData failure={t('settings.project.agents.load_failed')} skeleton={<SettingsSkeleton rows={4} label={t('settings.project.agents.loading')} />}>
      {() => {
        const workflow = workflows.data!.items.find((entry) => entry.id === project.workflow_id);
        /* istanbul ignore next -- a project always has a workflow of the catalog (NOT NULL, restrictOnDelete) */
        if (!workflow) return null;
        return <AgentsForm project={project} canManage={canManage} readOnlyReason={readOnlyReason} link={link.data ?? null} github={github.data!} workflow={workflow} />;
      }}
    </Loaded>
  );
}
