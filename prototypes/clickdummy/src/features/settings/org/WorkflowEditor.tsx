/*
 * The workflow editor (spec 4.5): name, the statuses (name, shape and category, in an order that can be changed,
 * with one of them as the start), and either "frei" or the transition matrix. What `validateWorkflow` finds is listed
 * as it happens, in German. The page is a form: Enter in a field and ⌘↵ send it, and the button stays available, because
 * a form that can always be sent shows what is wrong; with problems left a send saves nothing and takes the focus to
 * their list. A status that is deleted but still holds items opens `StateMappingDialog` when saving is refused with 409
 * `state_in_use`; a copy of a workflow and a new one start from a draft with fresh status ids. Leaving with unsaved
 * changes asks first (`LeaveGuard`). Members get the same view without any way to change it.
 */

import { ArrowLeft, CircleAlert, CircleCheck, Plus, Trash2 } from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, type To } from 'react-router';
import type { WorkflowInput } from '@/api/workflows';
import { ApiError } from '@/api/client';
import { Banner } from '@/components/ui/Banner';
import { Button, buttonClass } from '@/components/ui/Button';
import { cx } from '@/components/ui/cx';
import { EmptyState } from '@/components/ui/EmptyState';
import { IconButton } from '@/components/ui/IconButton';
import { Input } from '@/components/ui/Input';
import { Menu, MenuContent, MenuRadioGroup, MenuRadioItem, MenuTrigger } from '@/components/ui/Menu';
import { Select } from '@/components/ui/Select';
import { fieldClass, fieldSize } from '@/components/ui/styles';
import { StatusIcon } from '@/components/ui/StatusIcon';
import { Switch } from '@/components/ui/Switch';
import { toast } from '@/components/ui/toast';
import { Textarea } from '@/components/ui/Textarea';
import { CATEGORY_ORDER, statesInOrder, validateWorkflow, type WorkflowIssue } from '@/domain/workflow';
import { useProjects } from '@/hooks/projects';
import { useSaveWorkflow, useWorkflows } from '@/hooks/workflows';
import { notifyError } from '@/lib/errors';
import { useDocumentTitle } from '@/lib/useDocumentTitle';
import { useShortcut } from '@/lib/shortcuts/useShortcut';
import type { Project, StateCategory, StateIcon, Transition, Workflow } from '@/types';
import { CATEGORY_NAMES, STATE_ICON_NAMES, STATE_ICONS } from './catalog';
import { fieldMessage, hasReason } from './errors';
import { counted } from './format';
import { localId } from './localId';
import { LeaveGuard } from './LeaveGuard';
import { FormSkeleton, Loaded, Measure, Panel, readOnlyField, SectionHeader } from './parts';
import { ReadOnlyNotice } from './access';
import { SortableList } from './Sortable';
import { StateMappingDialog, type AffectedState } from './StateMappingDialog';
import { TransitionMatrix } from './TransitionMatrix';

export interface WorkflowEditorProps {
  /** The workflow to edit; null starts a new one. */
  workflowId: string | null;
  /** A new workflow starts as a copy of this one. */
  copyOf?: string | null;
  onClose: () => void;
  /** Where "Alle Workflows" leads. With it the way back is a real link (new tab, ⌘-click); without it a button. */
  closeTo?: To;
  /** The workflow was saved; a new one has its id now. */
  onSaved?: (id: string) => void;
  /** Look but do not touch: members read workflows, admins change them. The reason is shown. */
  readOnlyReason?: string | null;
}

/* ------------------------------------------------------------------------ draft */

interface DraftState {
  id: string;
  name: string;
  icon: StateIcon;
  category: StateCategory;
}

/** What the editor holds while it is open: a workflow as the form changes it, before anything is saved. */
interface Draft {
  name: string;
  description: string;
  is_default: boolean;
  is_free: boolean;
  initial_state_id: string;
  states: DraftState[];
  transitions: Transition[];
}

const NEW_WORKFLOW_STATES: Omit<DraftState, 'id'>[] = [
  { name: 'Backlog', icon: 'dashed', category: 'backlog' },
  { name: 'Todo', icon: 'circle', category: 'unstarted' },
  { name: 'In Progress', icon: 'half', category: 'started' },
  { name: 'Done', icon: 'check', category: 'completed' },
  { name: 'Cancelled', icon: 'cross', category: 'canceled' },
];

function draftOf(workflow: Workflow): Draft {
  return {
    name: workflow.name,
    description: workflow.description,
    is_default: workflow.is_default,
    is_free: workflow.is_free,
    initial_state_id: workflow.initial_state_id,
    states: statesInOrder(workflow).map(({ id, name, icon, category }) => ({ id, name, icon, category })),
    transitions: workflow.transitions.map(([from, to]): Transition => [from, to]),
  };
}

/** A copy is a workflow of its own, so its statuses get new ids (the transitions follow). */
function copyDraftOf(workflow: Workflow): Draft {
  const draft = draftOf(workflow);
  const renamed = new Map(draft.states.map((state) => [state.id, localId('st')]));
  const next = (id: string) => renamed.get(id) ?? id;
  return {
    ...draft,
    name: `${draft.name} (Kopie)`,
    is_default: false,
    initial_state_id: next(draft.initial_state_id),
    states: draft.states.map((state) => ({ ...state, id: next(state.id) })),
    transitions: draft.transitions.map(([from, to]): Transition => [next(from), next(to)]),
  };
}

function blankDraft(): Draft {
  const states = NEW_WORKFLOW_STATES.map((state) => ({ ...state, id: localId('st') }));
  return { name: '', description: '', is_default: false, is_free: true, initial_state_id: states[0].id, states, transitions: [] };
}

/** The draft in a form that does not care for the order of transitions or for spaces around names. */
const comparable = (draft: Draft): string =>
  JSON.stringify({
    ...draft,
    name: draft.name.trim(),
    description: draft.description.trim(),
    states: draft.states.map((state) => ({ ...state, name: state.name.trim() })),
    transitions: draft.transitions.map(([from, to]) => `${from}>${to}`).sort(),
  });

function toWorkflow(draft: Draft, id: string): Workflow {
  return { ...draft, id, states: draft.states.map((state, position) => ({ ...state, position })) };
}

function toInput(draft: Draft, id: string | undefined): WorkflowInput {
  return {
    id,
    name: draft.name.trim(),
    description: draft.description.trim(),
    is_default: draft.is_default,
    is_free: draft.is_free,
    initial_state_id: draft.initial_state_id,
    states: draft.states.map((state, position) => ({ id: state.id, name: state.name.trim(), icon: state.icon, category: state.category, position })),
    transitions: draft.transitions,
  };
}

/** Every status may lead to every other: where a matrix starts when a free workflow gets one. */
const allPairs = (states: DraftState[]): Transition[] => states.flatMap((from) => states.filter((to) => to.id !== from.id).map((to): Transition => [from.id, to.id]));

/* ------------------------------------------------------------------------ issues */

interface IssueText {
  /** The finding, as one sentence without a full stop: "Review ist vom Startstatus aus nicht erreichbar". */
  text: string;
  /** What to do about it. */
  fix: string;
}

function describeIssue(issue: WorkflowIssue, states: DraftState[]): IssueText {
  switch (issue.code) {
    case 'no_initial_state':
      return { text: 'Der Workflow hat keinen Startstatus', fix: 'Wähle oben einen Startstatus.' };
    case 'no_completed_state':
      return { text: 'Der Workflow braucht mindestens einen Status der Kategorie Completed', fix: 'Stelle die Kategorie eines Status auf Completed oder lege einen neuen an.' };
    case 'unreachable_state': {
      const name = states.find((state) => state.id === issue.state_id)?.name.trim() || 'Ein unbenannter Status';
      return { text: `${name} ist vom Startstatus aus nicht erreichbar`, fix: 'Erlaube in der Matrix einen Übergang von einem erreichbaren Status in diesen.' };
    }
  }
}

/* ------------------------------------------------------------------ status rows */

function ShapeMenu({ state, disabled, onChange }: { state: DraftState; disabled: boolean; onChange: (icon: StateIcon) => void }) {
  return (
    <Menu>
      <MenuTrigger
        disabled={disabled}
        aria-label={`Form von ${state.name.trim() || 'diesem Status'}: ${STATE_ICON_NAMES[state.icon]}`}
        className={cx(
          'inline-flex size-11 shrink-0 items-center justify-center rounded-ctl border border-line bg-surface shadow-elev-1 transition-colors duration-120 md:size-9',
          disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer hover:border-line-input hover:bg-sunken',
        )}
      >
        <StatusIcon icon={state.icon} category={state.category} label={STATE_ICON_NAMES[state.icon]} aria-hidden="true" className="size-5" />
      </MenuTrigger>
      <MenuContent>
        <MenuRadioGroup value={state.icon} onValueChange={(next) => onChange(next as StateIcon)}>
          {STATE_ICONS.map((icon) => (
            <MenuRadioItem key={icon} value={icon}>
              <span className="flex items-center gap-2">
                <StatusIcon icon={icon} category={state.category} label={STATE_ICON_NAMES[icon]} aria-hidden="true" />
                {STATE_ICON_NAMES[icon]}
              </span>
            </MenuRadioItem>
          ))}
        </MenuRadioGroup>
      </MenuContent>
    </Menu>
  );
}

type StateRowProps = {
  state: DraftState;
  index: number;
  handle: ReactNode;
  readOnly: boolean;
  /** Why this status cannot be removed, or null. */
  keepReason: string | null;
  error: string | null;
  onChange: (partial: Partial<DraftState>) => void;
  onRemove: () => void;
};

function StateRow({ state, index, handle, readOnly, keepReason, error, onChange, onRemove }: StateRowProps) {
  const errorId = useId();
  const name = state.name.trim() || `Status ${index + 1}`;
  return (
    <div className="flex flex-wrap items-center gap-2 px-3 py-2">
      {!readOnly && handle}
      <ShapeMenu state={state} disabled={readOnly} onChange={(icon) => onChange({ icon })} />
      <input
        id={`state-name-${state.id}`}
        value={state.name}
        readOnly={readOnly}
        placeholder="Name des Status …"
        aria-label={`Name von Status ${index + 1}`}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        onChange={(event) => onChange({ name: event.target.value })}
        className={cx(fieldClass(Boolean(error)), fieldSize, 'min-w-0 flex-1 basis-40', readOnly && readOnlyField)}
      />
      {/* on a phone the category and the trash button share the second line */}
      <div className="flex basis-full items-center gap-2 sm:basis-auto">
        <Select
          aria-label={`Kategorie von ${name}`}
          className="min-w-0 flex-1 sm:w-44 sm:flex-none"
          disabled={readOnly}
          value={state.category}
          onValueChange={(next) => next && onChange({ category: next as StateCategory })}
          options={CATEGORY_ORDER.map((category) => ({
            value: category,
            label: CATEGORY_NAMES[category],
            icon: <StatusIcon icon={state.icon} category={category} label={CATEGORY_NAMES[category]} aria-hidden="true" />,
          }))}
        />
        {!readOnly && <IconButton icon={Trash2} label={`${name} entfernen`} disabledReason={keepReason} onClick={onRemove} />}
      </div>
      {/* the region is always there, so an error that appears is announced */}
      <div aria-live="polite" className="basis-full empty:hidden">
        {error && (
          <p id={errorId} className="flex items-start gap-1.5 text-sm font-medium text-danger">
            <CircleAlert className="mt-px size-3.5 shrink-0" aria-hidden="true" />
            {error}
          </p>
        )}
      </div>
    </div>
  );
}

/* ----------------------------------------------------------------------- editor */

type EditorFormProps = {
  initial: Draft;
  /** The saved workflow; null while the draft is a new one. */
  existing: Workflow | null;
  projects: Project[];
  readOnlyReason: string | null;
  onClose: () => void;
  closeTo?: To;
  onSaved?: (id: string) => void;
};

interface MappingRequest {
  /** Counts up with every request, so the dialog starts from fresh choices each time. */
  round: number;
  open: boolean;
  affected: AffectedState[];
}

function EditorForm({ initial, existing, projects, readOnlyReason, onClose, closeTo, onSaved }: EditorFormProps) {
  const readOnly = readOnlyReason !== null;
  const [draft, setDraft] = useState<Draft>(initial);
  const [attempted, setAttempted] = useState(false);
  const [mapping, setMapping] = useState<MappingRequest | null>(null);
  const [focusId, setFocusId] = useState<string | null>(null);
  const save = useSaveWorkflow();
  const problems = useRef<HTMLDivElement>(null);
  // set right before the move to the id of a workflow that was just saved, which the leave guard must let through
  const leaving = useRef(false);
  useDocumentTitle(`${draft.name.trim() || 'Neuer Workflow'} – Workflows`);

  // a status added by the button gets the focus in its name field, so typing can start at once
  useEffect(() => {
    if (!focusId) return;
    document.getElementById(`state-name-${focusId}`)?.focus();
    setFocusId(null);
  }, [focusId]);

  const baseline = useMemo(() => comparable(existing ? draftOf(existing) : initial), [existing, initial]);
  const dirty = comparable(draft) !== baseline;
  const issues = useMemo(() => validateWorkflow(toWorkflow(draft, existing?.id ?? 'draft')), [draft, existing]);
  const unreachable = useMemo(() => new Set(issues.flatMap((issue) => (issue.code === 'unreachable_state' && issue.state_id ? [issue.state_id] : []))), [issues]);
  const usedBy = existing ? projects.filter((project) => project.workflow_id === existing.id) : [];

  const nameError = attempted && draft.name.trim() === '' ? 'Gib dem Workflow einen Namen.' : fieldMessage(save.error, 'name');
  const startError = issues.some((issue) => issue.code === 'no_initial_state') ? 'Wähle den Status, in dem neue Items beginnen.' : undefined;

  const patch = (partial: Partial<Draft>) => setDraft((current) => ({ ...current, ...partial }));
  const patchState = (id: string, partial: Partial<DraftState>) =>
    setDraft((current) => ({ ...current, states: current.states.map((state) => (state.id === id ? { ...state, ...partial } : state)) }));

  function addState() {
    const state: DraftState = { id: localId('st'), name: '', icon: 'circle', category: 'started' };
    setDraft((current) => ({ ...current, states: [...current.states, state] }));
    setFocusId(state.id);
  }

  function removeState(id: string) {
    // the focus was on the trash button of this row: it goes to the next row, or to the one above when this was the last
    const index = draft.states.findIndex((state) => state.id === id);
    const neighbour = draft.states[index + 1] ?? draft.states[index - 1];
    if (neighbour) setFocusId(neighbour.id);
    setDraft((current) => ({
      ...current,
      states: current.states.filter((state) => state.id !== id),
      transitions: current.transitions.filter(([from, to]) => from !== id && to !== id),
    }));
  }

  function setFree(free: boolean) {
    // a matrix that starts empty would forbid everything: it starts with everything allowed, to take away from
    setDraft((current) => ({ ...current, is_free: free, transitions: !free && current.transitions.length === 0 ? allPairs(current.states) : current.transitions }));
  }

  function submit(options?: { state_mapping?: Record<string, string> }) {
    setAttempted(true);
    const blank = draft.states.find((state) => state.name.trim() === '');
    if (draft.name.trim() === '') {
      document.getElementById('workflow-name')?.focus();
      return;
    }
    if (blank) {
      document.getElementById(`state-name-${blank.id}`)?.focus();
      return;
    }
    if (issues.length > 0) {
      // the problems are listed above: they take the focus, so nobody has to look for what stops the save
      problems.current?.focus();
      return;
    }
    if (!dirty && existing) {
      toast({ title: 'Es gibt nichts zu speichern', description: 'Der Workflow ist so, wie er gespeichert ist.' });
      return;
    }

    save.mutate(
      { workflow: toInput(draft, existing?.id), options },
      {
        onSuccess: (saved) => {
          const moved = mapping?.affected.reduce((sum, entry) => sum + entry.items, 0) ?? 0;
          setMapping(null);
          toast({
            title: `Workflow „${saved.name}“ gespeichert`,
            description: moved > 0 ? `${counted(moved, 'Item hat', 'Items haben')} einen neuen Status.` : undefined,
            tone: 'success',
          });
          leaving.current = true;
          onSaved?.(saved.id);
          setTimeout(() => {
            leaving.current = false;
          }, 0);
        },
        onError: (error) => {
          if (hasReason(error, 'state_in_use')) {
            const listed = (error.extensions.states as { state_id: string; name: string; items: number }[] | undefined) ?? [];
            const affected = listed.map((entry) => ({ ...entry, category: existing?.states.find((state) => state.id === entry.state_id)?.category ?? 'backlog' }));
            setMapping((current) => ({ round: (current?.round ?? 0) + 1, open: true, affected }));
            return;
          }
          // field errors are shown where they belong; anything else is a toast
          if (!(error instanceof ApiError && error.status === 422)) notifyError('Workflow nicht gespeichert', error, () => submit(options));
        },
      },
    );
  }

  useShortcut({ id: 'workflow.save', keys: 'mod+enter', scope: 'detail', label: 'Workflow speichern', group: 'Workflow', run: () => submit(), when: () => !readOnly && (dirty || existing === null) });

  const back = closeTo ? (
    <Link to={closeTo} className={buttonClass({ variant: 'ghost', size: 'sm' }, '-ml-2.5')}>
      <ArrowLeft className="size-4 text-muted" aria-hidden="true" />
      Alle Workflows
    </Link>
  ) : (
    <Button variant="ghost" size="sm" icon={ArrowLeft} className="-ml-2.5" onClick={onClose}>
      Alle Workflows
    </Button>
  );

  return (
    <form
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        // a dialog of the editor is a portal, but its events still bubble to this form: only the form's own submit counts
        if (event.target === event.currentTarget && !save.isPending && !readOnly) submit();
      }}
      className="flex flex-col gap-4"
    >
      <SectionHeader
        back={back}
        title={draft.name.trim() || 'Neuer Workflow'}
        description={existing ? undefined : 'Lege Status, Übergänge und den Startstatus fest. Neue Projekte können ihn dann benutzen.'}
        actions={
          readOnly ? null : (
            <>
              {dirty && existing && (
                <Button variant="ghost" onClick={() => setDraft(draftOf(existing))}>
                  Verwerfen
                </Button>
              )}
              <Button variant="primary" type="submit" shortcut="mod+enter" pending={save.isPending}>
                Speichern
              </Button>
            </>
          )
        }
      />

      {readOnly && <ReadOnlyNotice reason={readOnlyReason} />}

      {usedBy.length > 0 && !readOnly && (
        <Banner title={`Wird von ${usedBy.map((project) => project.identifier).join(', ')} benutzt`}>
          <Measure>Neue Status und Übergänge gelten sofort. Löschst du einen Status, in dem Items liegen, bestimmst du beim Speichern, welcher Status sie übernimmt.</Measure>
        </Banner>
      )}

      <div ref={problems} tabIndex={-1} data-focus-ring="none" aria-live="polite" aria-atomic="false" className="outline-none">
        {issues.length === 0 ? (
          <Banner tone="neutral" icon={CircleCheck} title="Der Workflow ist gültig">
            <Measure>Er hat einen Startstatus, einen Status der Kategorie Completed, und jeder Status ist vom Startstatus aus erreichbar.</Measure>
          </Banner>
        ) : (
          <Banner tone="danger" icon={CircleAlert} title={issues.length === 1 ? 'Ein Problem verhindert das Speichern' : `${issues.length} Probleme verhindern das Speichern`}>
            <ul className="mt-1 flex flex-col gap-1">
              {issues.map((issue, index) => {
                const { text, fix } = describeIssue(issue, draft.states);
                return (
                  <li key={`${issue.code}:${issue.state_id ?? index}`}>
                    <span className="font-medium">{text}</span> <span className="text-muted">{fix}</span>
                  </li>
                );
              })}
            </ul>
          </Banner>
        )}
      </div>

      <Panel title="Allgemein">
        <div className="grid gap-4 p-4 md:grid-cols-2">
          <Input
            id="workflow-name"
            label="Name"
            value={draft.name}
            readOnly={readOnly}
            error={nameError}
            onChange={(event) => patch({ name: event.target.value })}
            autoComplete="off"
            className={readOnly ? readOnlyField : undefined}
          />
          <Select
            label="Startstatus"
            hint={startError ? undefined : 'Neue Items beginnen in diesem Status.'}
            error={startError}
            disabled={readOnly}
            value={draft.states.some((state) => state.id === draft.initial_state_id) ? draft.initial_state_id : null}
            onValueChange={(next) => next && patch({ initial_state_id: next })}
            options={draft.states.map((state, index) => ({
              value: state.id,
              label: state.name.trim() || `Status ${index + 1}`,
              icon: <StatusIcon icon={state.icon} category={state.category} label={state.name} aria-hidden="true" />,
            }))}
          />
          <div className="md:col-span-2">
            <Textarea
              label="Beschreibung"
              hint="Wofür dieser Workflow gedacht ist."
              rows={2}
              value={draft.description}
              readOnly={readOnly}
              className={readOnly ? readOnlyField : undefined}
              onChange={(event) => patch({ description: event.target.value })}
            />
          </div>
          <div className="flex flex-col gap-1">
            <Switch label="Frei: Jeder Status darf in jeden wechseln" checked={draft.is_free} disabled={readOnly} onCheckedChange={setFree} />
            <p className="pl-12 text-sm text-pretty text-muted">
              {draft.is_free ? 'Alles ist erlaubt. Schalte aus, um nur bestimmte Übergänge zuzulassen.' : 'Nur die Übergänge der Matrix unten sind erlaubt.'}
            </p>
          </div>
          <div className="flex flex-col gap-1">
            <Switch label="Standard-Workflow" checked={draft.is_default} disabled={readOnly || Boolean(existing?.is_default)} onCheckedChange={(next) => patch({ is_default: next })} />
            <p className="pl-12 text-sm text-pretty text-muted">
              {existing?.is_default ? 'Einer der Workflows muss der Standard sein. Mache einen anderen zum Standard, dann wechselt er.' : 'Jedes neue Projekt bekommt den Standard-Workflow.'}
            </p>
          </div>
        </div>
      </Panel>

      <Panel
        title="Status"
        description="Name, Form und Kategorie. Die Farbe folgt der Kategorie, die Form unterscheidet die Status einer Kategorie."
        actions={
          readOnly ? null : (
            <Button variant="secondary" size="sm" icon={Plus} onClick={addState}>
              Status hinzufügen
            </Button>
          )
        }
      >
        <SortableList
          items={draft.states}
          label="Status"
          disabled={readOnly}
          nameOf={(state) => state.name.trim()}
          onReorder={(states) => patch({ states })}
          className="divide-y divide-line"
          renderItem={(state, { handle, index }) => (
            <StateRow
              state={state}
              index={index}
              handle={handle}
              readOnly={readOnly}
              keepReason={state.id === draft.initial_state_id ? 'Das ist der Startstatus. Wähle zuerst einen anderen Startstatus.' : null}
              error={attempted && state.name.trim() === '' ? 'Gib dem Status einen Namen.' : null}
              onChange={(partial) => patchState(state.id, partial)}
              onRemove={() => removeState(state.id)}
            />
          )}
        />
        <p className="max-w-[65ch] border-t border-line px-4 py-3 text-sm text-pretty text-muted">
          {`${CATEGORY_NAMES.completed} und ${CATEGORY_NAMES.canceled} schließen ein Item, alle anderen Kategorien lassen es offen. Ein Workflow braucht mindestens einen Status der Kategorie ${CATEGORY_NAMES.completed}.`}
        </p>
      </Panel>

      <Panel
        title="Übergänge"
        description={draft.is_free ? 'Der Workflow ist frei: Jeder Status darf in jeden anderen wechseln.' : 'Die Zeilen sind der Status, aus dem ein Item kommt, die Spalten der Status, in den es wechselt. Pfeiltasten bewegen, die Leertaste schaltet.'}
      >
        {draft.is_free ? (
          <p className="max-w-[65ch] px-4 py-3 text-ui text-pretty text-muted">Schalte „Frei“ aus, wenn nur bestimmte Übergänge gelten sollen. Die Matrix beginnt dann mit allen erlaubten Übergängen, von denen du streichst, was nicht gelten soll.</p>
        ) : (
          <div className="py-3">
            <TransitionMatrix
              states={draft.states.map((state, position) => ({ ...state, position }))}
              transitions={draft.transitions}
              initialStateId={draft.initial_state_id}
              unreachable={unreachable}
              readOnly={readOnly}
              onChange={(transitions) => patch({ transitions })}
            />
            <p className="max-w-[65ch] px-4 pt-3 text-sm text-pretty text-muted">Ein neuer Status ist erst erreichbar, wenn ein Übergang in ihn führt.</p>
          </div>
        )}
      </Panel>

      <LeaveGuard dirty={dirty && !readOnly} what={`Deine Änderungen an „${draft.name.trim() || 'diesem Workflow'}“`} bypass={leaving} />

      {mapping && (
        <StateMappingDialog
          key={mapping.round}
          open={mapping.open}
          onOpenChange={(open) => setMapping((current) => (current ? { ...current, open } : current))}
          workflowName={draft.name.trim() || existing?.name || 'Workflow'}
          affected={mapping.affected}
          targets={draft.states.map((state, position) => ({ ...state, position }))}
          pending={save.isPending}
          onConfirm={(state_mapping) => submit({ state_mapping })}
        />
      )}
    </form>
  );
}

/* ----------------------------------------------------------------------- shell */

export function WorkflowEditor({ workflowId, copyOf, onClose, closeTo, onSaved, readOnlyReason = null }: WorkflowEditorProps) {
  const workflows = useWorkflows();
  const projects = useProjects({ include_archived: true });

  return (
    <Loaded queries={[workflows, projects]} failure="Die Workflows konnten nicht geladen werden" skeleton={<FormSkeleton label="Der Workflow wird geladen …" />}>
      {() => {
        const all = workflows.data?.items ?? [];
        const existing = workflowId ? (all.find((workflow) => workflow.id === workflowId) ?? null) : null;
        if (workflowId && !existing) {
          return (
            <EmptyState
              icon={CircleAlert}
              title="Diesen Workflow gibt es nicht"
              description="Er wurde gelöscht, oder der Link stimmt nicht."
              actions={
                closeTo ? (
                  <Link to={closeTo} className={buttonClass({ variant: 'secondary' })}>
                    <ArrowLeft className="size-4 text-muted" aria-hidden="true" />
                    Alle Workflows
                  </Link>
                ) : (
                  <Button variant="secondary" icon={ArrowLeft} onClick={onClose}>
                    Alle Workflows
                  </Button>
                )
              }
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
            projects={projects.data?.items ?? []}
            readOnlyReason={readOnlyReason}
            onClose={onClose}
            closeTo={closeTo}
            onSaved={onSaved}
          />
        );
      }}
    </Loaded>
  );
}
