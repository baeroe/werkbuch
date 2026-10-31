/*
 * The workflow editor (spec 4.5), a view of the workflows section (`?workflow=<id>`, `?workflow=new`,
 * `?workflow=new&from=<id>` for a copy; P17): name, description, the default mark, the start status, the statuses (name,
 * shape and category, in an order that can be changed) and either free transitions or the matrix. What
 * `validateWorkflow` finds is listed as it happens. The page is a form: Enter in a field and ⌘↵ send it, and the button
 * stays available, because a form that can always be sent shows what is wrong; with findings left a send saves nothing
 * and takes the focus to their list. The server's answers land where they belong: 422 `invalid_workflow` as findings
 * (the statuses found by the ids that were sent), a refused name at the name field, a refused status at its row, every
 * other refusal as a notice. A removed status goes with the save without a question: without items it needs no new
 * home (409 `state_in_use` and the mapping come with Phase 4, P28). Leaving with unsaved changes asks first
 * (`LeaveGuard`). Members get the same view without any way to change it.
 */

import { Link } from '@inertiajs/react';
import { ArrowLeft, CircleAlert, Lock, Plus } from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { ApiError } from '@/api/client';
import { Banner } from '@/components/ui/Banner';
import { Button, buttonClass } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { StatusIcon } from '@/components/ui/StatusIcon';
import { Switch } from '@/components/ui/Switch';
import { Textarea } from '@/components/ui/Textarea';
import { toast } from '@/components/ui/toast';
import { validateWorkflow, type WorkflowIssue } from '@/domain/workflow';
import { useSettle } from '@/hooks/mutation';
import { useProjects } from '@/hooks/projects';
import { useSaveWorkflow, useWorkflows } from '@/hooks/workflows';
import { notifyError } from '@/lib/errors';
import { t } from '@/lib/i18n';
import { paths } from '@/lib/links';
import type { Project, Workflow } from '@/types';
import { CATEGORY_LABELS } from '../../catalog/choices';
import { localId } from '../../catalog/localId';
import { ReadOnlyNotice } from '../../frame/access';
import { fieldMessage, hasReason, noticeOf, useSaveShortcut } from '../../frame/form';
import { LeaveGuard } from '../../frame/LeaveGuard';
import { FormSkeleton, Loaded, Measure, Panel, readOnlyField, SectionHeader } from '../../frame/parts';
import { allPairs, blankDraft, comparable, copyDraftOf, draftOf, toInput, toWorkflow, type Draft, type DraftState } from './draft';
import { IssueList } from './IssueList';
import { stateNameId, StateRows } from './StateRows';
import { TransitionMatrix } from './TransitionMatrix';

/** The id of the editor's title, which takes the focus after a new workflow moved to its own address. */
export const WORKFLOW_TITLE_ID = 'workflow-title';

/** The fields of a status the server may refuse at its row. */
const STATE_FIELDS = ['name', 'id', 'icon', 'category'] as const;

function BackLink({ variant = 'ghost' }: { variant?: 'ghost' | 'secondary' }) {
  return (
    <Link href={paths.settings('workflows')} className={buttonClass({ variant, size: variant === 'ghost' ? 'sm' : 'md' }, variant === 'ghost' ? '-ml-2.5' : undefined)}>
      <ArrowLeft className="size-4 text-muted" aria-hidden="true" />
      {t('settings.workflows.editor.back')}
    </Link>
  );
}

type EditorFormProps = {
  initial: Draft;
  /** The saved workflow; null while the draft is a new one. */
  existing: Workflow | null;
  projects: Project[];
  readOnlyReason: string | null;
  /** Take the focus to the title once drawn: the workflow was just created and moved to its own address. */
  focusTitle: boolean;
  /** The workflow to copy is not there (any more): the draft is a blank one, and the form says why. */
  missingTemplate: boolean;
  onCreated: (id: string) => void;
};

function EditorForm({ initial, existing, projects, readOnlyReason, focusTitle, missingTemplate, onCreated }: EditorFormProps) {
  const settle = useSettle();
  const save = useSaveWorkflow();
  const readOnly = readOnlyReason !== null;
  // the stored workflow the draft is compared with; after a save it is the answer, with the ids the server gave
  const [base, setBase] = useState<Workflow | null>(existing);
  // a new draft (blank or a copy) is drawn once: its fresh ids must not change under the comparison
  const [start] = useState<Draft>(initial);
  const [draft, setDraft] = useState<Draft>(start);
  const [attempted, setAttempted] = useState(false);
  const [focusId, setFocusId] = useState<string | null>(null);
  const form = useRef<HTMLFormElement>(null);
  const issueList = useRef<HTMLDivElement>(null);
  const notice = useRef<HTMLDivElement>(null);
  // set right before the move of a new workflow to its address, which the leave guard must let through
  const leaving = useRef(false);
  // the statuses and the draft as they were sent: a refusal at `states.<n>.name` belongs to the status that was n-th
  // then, and the findings of `invalid_workflow` hold as long as the draft is the one that was sent
  const sent = useRef<{ draft: Draft | null; states: string[] }>({ draft: null, states: [] });
  const defaultHint = useId();
  const freeHint = useId();

  useEffect(() => {
    if (focusTitle) document.getElementById(WORKFLOW_TITLE_ID)?.focus();
  }, [focusTitle]);

  // a status added by the button takes the focus in its name field, so typing can start at once
  useEffect(() => {
    if (!focusId) return;
    document.getElementById(stateNameId(focusId))?.focus();
    setFocusId(null);
  }, [focusId]);

  const baseline = useMemo(() => comparable(base ? draftOf(base) : start), [base, start]);
  const dirty = comparable(draft) !== baseline;
  const localIssues = useMemo(() => validateWorkflow(toWorkflow(draft, base?.id ?? 'draft')), [draft, base]);
  const refused = hasReason(save.error, 'invalid_workflow') && sent.current.draft === draft ? ((save.error.extensions.issues as WorkflowIssue[] | undefined) ?? []) : [];
  const issues = localIssues.length > 0 ? localIssues : refused;
  const unreachable = useMemo(() => new Set(issues.flatMap((issue) => (issue.code === 'unreachable_state' && issue.state_id ? [issue.state_id] : []))), [issues]);
  const matrixStates = useMemo(() => draft.states.map((state, position) => ({ ...state, position })), [draft.states]);
  const usedBy = base ? projects.filter((project) => project.workflow_id === base.id) : [];

  const statePaths = sent.current.states.flatMap((_, index) => STATE_FIELDS.map((field) => `states.${index}.${field}`));
  const unplaced = save.error instanceof ApiError && save.error.status === 422 && !hasReason(save.error, 'invalid_workflow') ? noticeOf(save.error, ['name', 'initial_state_id', ...statePaths]) : null;
  const nameError = attempted && draft.name.trim() === '' ? t('settings.workflows.editor.name_required') : fieldMessage(save.error, 'name');
  const startError = issues.some((issue) => issue.code === 'no_initial_state') ? t('settings.workflows.editor.start_required') : fieldMessage(save.error, 'initial_state_id');
  const stateError = (id: string): string | undefined => {
    if (attempted && draft.states.find((state) => state.id === id)?.name.trim() === '') return t('settings.workflows.state.name_required');
    const index = sent.current.states.indexOf(id);
    return index < 0 ? undefined : fieldMessage(save.error, ...STATE_FIELDS.map((field) => `states.${index}.${field}`));
  };

  // a refusal takes the focus where it shows: the findings, the first marked field, or the notice
  useEffect(() => {
    if (!(save.error instanceof ApiError) || save.error.status !== 422) return;
    if (hasReason(save.error, 'invalid_workflow')) issueList.current?.focus();
    else (form.current?.querySelector<HTMLElement>('[aria-invalid="true"]') ?? notice.current)?.focus();
  }, [save.error]);

  const patch = (partial: Partial<Draft>) => setDraft((current) => ({ ...current, ...partial }));
  const patchState = (id: string, partial: Partial<DraftState>) =>
    setDraft((current) => ({ ...current, states: current.states.map((state) => (state.id === id ? { ...state, ...partial } : state)) }));

  function addState() {
    const state: DraftState = { id: localId('st'), name: '', icon: 'circle', category: 'started' };
    setDraft((current) => ({ ...current, states: [...current.states, state] }));
    setFocusId(state.id);
  }

  function removeState(id: string) {
    // the trash button goes with its row: the focus goes to the name of the next row, or of the one above when this
    // was the last (the start status always stays, so there is one)
    const index = draft.states.findIndex((state) => state.id === id);
    setFocusId((draft.states[index + 1] ?? draft.states[index - 1])!.id);
    setDraft((current) => ({
      ...current,
      states: current.states.filter((state) => state.id !== id),
      transitions: current.transitions.filter(([from, to]) => from !== id && to !== id),
    }));
  }

  /** Back to the stored workflow, without the refusals of the last send. */
  function discard() {
    setDraft(draftOf(base!));
    setAttempted(false);
    save.reset();
  }

  function setFree(free: boolean) {
    // a matrix that starts empty would forbid everything: it starts with everything allowed, to take away from
    setDraft((current) => ({ ...current, is_free: free, transitions: !free && current.transitions.length === 0 ? allPairs(current.states) : current.transitions }));
  }

  function submit() {
    setAttempted(true);
    const blank = draft.states.find((state) => state.name.trim() === '');
    if (draft.name.trim() === '') {
      document.getElementById('workflow-name')?.focus();
      return;
    }
    if (blank) {
      document.getElementById(stateNameId(blank.id))?.focus();
      return;
    }
    if (localIssues.length > 0) {
      // the findings are listed above: they take the focus, so nobody has to look for what stops the save
      issueList.current?.focus();
      return;
    }
    if (!dirty && base) {
      toast({ title: t('settings.workflows.editor.nothing.title'), description: t('settings.workflows.editor.nothing.description') });
      return;
    }

    sent.current = { draft, states: draft.states.map((state) => state.id) };
    settle(save.mutateAsync({ workflow: toInput(draft, base?.id) }), {
      onSuccess: (saved) => {
        toast({ title: t('settings.workflows.editor.saved', { name: saved.name }), tone: 'success' });
        if (base) {
          // the new statuses have the server's ids now: the draft starts again from the answer
          setBase(saved);
          setDraft(draftOf(saved));
          setAttempted(false);
          return;
        }
        leaving.current = true;
        onCreated(saved.id);
      },
      onError: (error) => {
        // refusals show in the form; anything else is a toast
        if (!(error instanceof ApiError && error.status === 422)) notifyError(t('settings.workflows.editor.not_saved'), error, submit);
      },
    });
  }

  useSaveShortcut(form, !readOnly && !save.isPending);

  return (
    <form
      ref={form}
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        if (!readOnly && !save.isPending) submit();
      }}
      className="flex flex-col gap-4"
    >
      <SectionHeader
        back={<BackLink />}
        titleId={WORKFLOW_TITLE_ID}
        title={draft.name.trim() || t('settings.workflows.editor.new_title')}
        description={base ? undefined : t('settings.workflows.editor.new_description')}
        actions={
          readOnly ? null : (
            <>
              {dirty && base && (
                <Button variant="ghost" onClick={discard}>
                  {t('settings.workflows.editor.discard')}
                </Button>
              )}
              <Button variant="primary" type="submit" shortcut="mod+enter" pending={save.isPending}>
                {t('settings.frame.save')}
              </Button>
            </>
          )
        }
      />

      {readOnlyReason && <ReadOnlyNotice reason={readOnlyReason} />}

      {missingTemplate && (
        <Banner tone="info" role="status" title={t('settings.workflows.editor.unknown_template.title')}>
          <Measure>{t('settings.workflows.editor.unknown_template.description')}</Measure>
        </Banner>
      )}

      {usedBy.length > 0 && !readOnly && (
        <Banner title={t('settings.workflows.editor.used_by', { projects: usedBy.map((project) => project.identifier).join(', ') })}>
          <Measure>{t('settings.workflows.editor.used_by_description')}</Measure>
        </Banner>
      )}

      {unplaced && (
        <Banner ref={notice} tabIndex={-1} data-focus-ring="none" tone="danger" role="alert" title={t('settings.workflows.editor.failed')} className="outline-none">
          {unplaced}
        </Banner>
      )}

      <IssueList ref={issueList} issues={issues} states={draft.states} attempted={attempted} />

      <Panel title={t('settings.workflows.editor.general')}>
        <div className="grid gap-4 p-4 md:grid-cols-2">
          <Input
            id="workflow-name"
            name="name"
            label={t('settings.catalog.name')}
            value={draft.name}
            readOnly={readOnly}
            error={nameError}
            onChange={(event) => patch({ name: event.target.value })}
            autoComplete="off"
            className={readOnly ? readOnlyField : undefined}
          />
          <Select
            label={t('settings.workflows.editor.start')}
            hint={startError ? undefined : t('settings.workflows.editor.start_hint')}
            error={startError}
            disabled={readOnly}
            value={draft.states.some((state) => state.id === draft.initial_state_id) ? draft.initial_state_id : null}
            onValueChange={(next) => next && patch({ initial_state_id: next })}
            options={draft.states.map((state, index) => ({
              value: state.id,
              label: state.name.trim() || t('settings.workflows.state.fallback', { number: index + 1 }),
              icon: <StatusIcon icon={state.icon} category={state.category} label={state.name} aria-hidden="true" />,
            }))}
          />
          <div className="md:col-span-2">
            <Textarea
              label={t('settings.workflows.editor.description')}
              name="description"
              autoComplete="off"
              hint={t('settings.workflows.editor.description_hint')}
              rows={2}
              value={draft.description}
              readOnly={readOnly}
              className={readOnly ? readOnlyField : undefined}
              onChange={(event) => patch({ description: event.target.value })}
            />
          </div>
          <div className="flex flex-col gap-1">
            <Switch label={t('settings.workflows.editor.free')} aria-describedby={freeHint} checked={draft.is_free} disabled={readOnly} onCheckedChange={setFree} />
            <p id={freeHint} className="pl-12 text-sm text-pretty text-muted">
              {draft.is_free ? t('settings.workflows.editor.free_on') : t('settings.workflows.editor.free_off')}
            </p>
          </div>
          <div className="flex flex-col gap-1">
            <Switch
              label={t('settings.workflows.editor.default')}
              aria-describedby={defaultHint}
              checked={draft.is_default}
              disabled={readOnly || Boolean(base?.is_default)}
              onCheckedChange={(next) => patch({ is_default: next })}
            />
            <p id={defaultHint} className="pl-12 text-sm text-pretty text-muted">
              {base?.is_default ? t('settings.workflows.editor.default_locked') : t('settings.workflows.editor.default_hint')}
            </p>
          </div>
        </div>
      </Panel>

      <Panel
        title={t('settings.workflows.states.title')}
        description={t('settings.workflows.states.description')}
        actions={
          readOnly ? null : (
            <Button variant="secondary" size="sm" icon={Plus} onClick={addState}>
              {t('settings.workflows.states.add')}
            </Button>
          )
        }
      >
        <StateRows
          states={draft.states}
          initialStateId={draft.initial_state_id}
          readOnly={readOnly}
          unreachable={unreachable}
          errorOf={stateError}
          onChange={(states) => patch({ states })}
          onPatch={patchState}
          onRemove={removeState}
        />
        {/* the line runs across the whole panel, the text keeps its measure */}
        <div className="border-t border-line px-4 py-3">
          <p className="max-w-[65ch] text-sm text-pretty text-muted">
            {t('settings.workflows.states.note', { completed: t(CATEGORY_LABELS.completed), canceled: t(CATEGORY_LABELS.canceled) })}
          </p>
        </div>
      </Panel>

      <Panel title={t('settings.workflows.transitions.title')} description={draft.is_free ? t('settings.workflows.transitions.free') : t('settings.workflows.transitions.matrix')}>
        {draft.is_free ? (
          <p className="max-w-[65ch] px-4 py-3 text-ui text-pretty text-muted">{t('settings.workflows.transitions.free_body')}</p>
        ) : (
          <div className="py-3">
            <TransitionMatrix
              states={matrixStates}
              transitions={draft.transitions}
              initialStateId={draft.initial_state_id}
              unreachable={unreachable}
              readOnly={readOnly}
              onChange={(transitions) => patch({ transitions })}
            />
            <p className="max-w-[65ch] px-4 pt-3 text-sm text-pretty text-muted">{t('settings.workflows.transitions.new_note')}</p>
          </div>
        )}
      </Panel>

      <LeaveGuard dirty={dirty && !readOnly} what={t('settings.workflows.editor.leave_what')} bypass={leaving} />
    </form>
  );
}

export type WorkflowEditorProps = {
  /** The workflow to edit; null starts a new one. */
  workflowId: string | null;
  /** A new workflow starts as a copy of this one. */
  copyOf: string | null;
  readOnlyReason: string | null;
  /** The workflow whose title takes the focus once it is drawn (it was just created). */
  focusTitleOf: string | null;
  onCreated: (id: string) => void;
};

/** The editor once the workflows and projects are there: the form, or why there is none. */
export function WorkflowEditor({ workflowId, copyOf, readOnlyReason, focusTitleOf, onCreated }: WorkflowEditorProps) {
  const workflows = useWorkflows();
  const projects = useProjects({ include_archived: true });

  if (workflowId === null && readOnlyReason !== null) {
    // a member cannot create one: instead of an empty form that cannot be sent, the way back
    return (
      <div className="flex flex-col gap-4">
        <SectionHeader back={<BackLink />} title={t('settings.workflows.editor.new_title')} />
        <ReadOnlyNotice reason={readOnlyReason} />
        <EmptyState
          icon={Lock}
          title={t('settings.workflows.editor.members_new.title')}
          description={t('settings.workflows.editor.members_new.description')}
          actions={<BackLink variant="secondary" />}
        />
      </div>
    );
  }

  return (
    <Loaded queries={[workflows, projects]} failure={t('settings.workflows.load_failed')} skeleton={<FormSkeleton label={t('settings.workflows.editor.loading')} />}>
      {() => {
        const all = workflows.data!.items;
        const existing = workflowId ? (all.find((workflow) => workflow.id === workflowId) ?? null) : null;
        if (workflowId && !existing) {
          return (
            <EmptyState
              icon={CircleAlert}
              title={t('settings.workflows.editor.unknown.title')}
              description={t('settings.workflows.editor.unknown.description')}
              actions={<BackLink variant="secondary" />}
            />
          );
        }
        const copied = copyOf ? all.find((workflow) => workflow.id === copyOf) : undefined;
        const initial = existing ? draftOf(existing) : copied ? copyDraftOf(copied) : blankDraft();
        return (
          <EditorForm
            key={existing?.id ?? `new:${copyOf ?? ''}`}
            initial={initial}
            existing={existing}
            projects={projects.data!.items}
            readOnlyReason={readOnlyReason}
            focusTitle={existing !== null && existing.id === focusTitleOf}
            missingTemplate={copyOf !== null && copied === undefined}
            onCreated={onCreated}
          />
        );
      }}
    </Loaded>
  );
}
