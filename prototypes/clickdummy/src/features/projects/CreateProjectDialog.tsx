/*
 * The dialog "Neues Projekt" (spec 4.4): name, identifier, visibility, workflow and types. The identifier follows the name
 * as a suggestion (`suggestIdentifier`, which knows the identifiers that are taken) until the person writes their own.
 * Errors of the server (422) stand at their field and the focus goes to the first one: the server alone knows
 * identifiers of private projects the person does not see.
 */

import { Globe, Lock } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { ApiError } from '@/api/client';
import type { CreateProjectInput } from '@/api/projects';
import { Banner } from '@/components/ui/Banner';
import { Button } from '@/components/ui/Button';
import { Checkbox } from '@/components/ui/Checkbox';
import { cx } from '@/components/ui/cx';
import { Dialog, DialogClose } from '@/components/ui/Dialog';
import { Field } from '@/components/ui/Field';
import { Input } from '@/components/ui/Input';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { Select } from '@/components/ui/Select';
import { Skeleton, SkeletonGroup } from '@/components/ui/Skeleton';
import { labelClass } from '@/components/ui/styles';
import { typeIcon } from '@/components/ui/TypeTab';
import { useCreateProject, useProjects } from '@/hooks/projects';
import { useWorkflows } from '@/hooks/workflows';
import { useWorkItemTypes } from '@/hooks/workItemTypes';
import { notifyError } from '@/lib/errors';
import { useShortcut } from '@/lib/shortcuts/useShortcut';
import type { Project, Workflow, WorkItemType } from '@/types';
import { suggestIdentifier } from './identifier';

type Visibility = Project['visibility'];
type FieldErrors = Record<string, string[]>;

const VISIBILITIES: { value: Visibility; label: string; icon: typeof Globe; hint: string }[] = [
  { value: 'public', label: 'Öffentlich', icon: Globe, hint: 'Alle in der Organisation sehen das Projekt und können mit einem Klick beitreten.' },
  { value: 'private', label: 'Privat', icon: Lock, hint: 'Nur Mitglieder und Org-Admins sehen das Projekt.' },
];

/** What a new project has switched on, as the API does it: Task, Bug and Epic (or the first type there is). */
const STARTER_TYPES = ['t_task', 't_bug', 't_epic'];
function starterTypes(types: WorkItemType[]): string[] {
  const starters = types.filter((type) => STARTER_TYPES.includes(type.id));
  return (starters.length > 0 ? starters : types.slice(0, 1)).map((type) => type.id);
}

type Values = Pick<CreateProjectInput, 'name' | 'identifier' | 'visibility' | 'workflow_id' | 'enabled_type_ids' | 'default_type_id'>;

type FormProps = {
  formId: string;
  workflows: Workflow[];
  types: WorkItemType[];
  /** Identifiers that exist, archived projects included. */
  taken: string[];
  errors: FieldErrors;
  /** Counts the sends that failed with field errors: each one brings the focus to the first error, nothing else does. */
  focusRequest: number;
  onEdit: (fields: string[]) => void;
  onSubmit: (values: Values) => void;
};

function ProjectForm({ formId, workflows, types, taken, errors, focusRequest, onEdit, onSubmit }: FormProps) {
  const form = useRef<HTMLFormElement>(null);
  const [name, setName] = useState('');
  // null: the identifier follows the suggestion; the first letter the person types is theirs
  const [typed, setTyped] = useState<string | null>(null);
  const [visibility, setVisibility] = useState<Visibility>('public');
  const [workflowId, setWorkflowId] = useState(() => (workflows.find((workflow) => workflow.is_default) ?? workflows[0])?.id ?? null);
  const [typeIds, setTypeIds] = useState<string[]>(() => starterTypes(types));

  const identifier = typed ?? suggestIdentifier(name, taken);
  const workflow = workflows.find((entry) => entry.id === workflowId);
  const chosen = types.filter((type) => typeIds.includes(type.id));
  const typesError = errors.enabled_type_ids?.[0] ?? errors.default_type_id?.[0];
  const known = new Set(['name', 'identifier', 'workflow_id', 'enabled_type_ids', 'default_type_id']);
  const other = Object.entries(errors).filter(([field]) => !known.has(field));

  useShortcut({ id: 'project.dialog.submit', keys: 'mod+enter', scope: 'dialog', label: 'Projekt anlegen', group: 'Dialog', run: () => form.current?.requestSubmit() });
  // The first field with an error takes the focus right after a send that failed, and only then. Not whenever the errors
  // change: an error that goes while the person types (the first letter of a name) must not move the focus (WCAG 3.2.2).
  const handled = useRef(focusRequest);
  useEffect(() => {
    if (focusRequest === handled.current) return;
    handled.current = focusRequest;
    form.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  }, [focusRequest]);

  const visible = VISIBILITIES.find((entry) => entry.value === visibility)!;
  const key = identifier || 'KEY';

  return (
    <form
      ref={form}
      id={formId}
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit({
          name: name.trim(),
          identifier: identifier.trim(),
          visibility,
          workflow_id: workflowId ?? undefined,
          enabled_type_ids: chosen.map((type) => type.id),
          default_type_id: chosen[0]?.id,
        });
      }}
      className="flex flex-col gap-4"
    >
      <Input
        label="Name"
        name="name"
        value={name}
        // the form can arrive after the dialog opened (the workflows and types load first): the name is where the typing starts
        autoFocus
        autoComplete="off"
        placeholder="Zum Beispiel „Website-Relaunch“ …"
        error={errors.name?.[0]}
        onChange={(event) => {
          setName(event.target.value);
          // a suggestion that changes with the name leaves its error behind as well
          onEdit(typed === null ? ['name', 'identifier'] : ['name']);
        }}
      />
      <Input
        label="Kennung"
        name="identifier"
        value={identifier}
        autoComplete="off"
        autoCapitalize="characters"
        spellCheck={false}
        translate="no"
        className="max-w-44 font-semibold tracking-wide tabular-nums"
        hint={`${typed === null ? 'Vorschlag aus dem Namen. ' : ''}2 bis 10\u00a0Großbuchstaben oder Ziffern, am Anfang ein Buchstabe. Die Items heißen dann ${key}-1, ${key}-2 und so weiter.`}
        error={errors.identifier?.[0]}
        // free text: only the case is put right, the server says what else is wrong
        onChange={(event) => {
          setTyped(event.target.value.toUpperCase());
          onEdit(['identifier']);
        }}
      />

      <div className="flex flex-col gap-1.5">
        <p className={labelClass}>Sichtbarkeit</p>
        <SegmentedControl
          label="Sichtbarkeit"
          value={visibility}
          onValueChange={setVisibility}
          options={VISIBILITIES.map(({ value, label, icon }) => ({ value, label, icon }))}
        />
        <p className="text-sm text-muted">{visible.hint}</p>
      </div>

      {workflow ? (
        <Select
          label="Workflow"
          value={workflowId}
          onValueChange={(next) => {
            if (next) setWorkflowId(next);
            onEdit(['workflow_id']);
          }}
          options={workflows.map((entry) => ({ value: entry.id, label: entry.name }))}
          hint={workflow.description}
          error={errors.workflow_id?.[0]}
        />
      ) : (
        <p className="text-sm text-danger">Es gibt keinen Workflow, den das Projekt bekommen könnte.</p>
      )}

      <fieldset className="flex min-w-0 flex-col">
        <legend className={cx(labelClass, 'mb-1')}>Typen</legend>
        <Field id={`${formId}-types`} error={typesError}>
          {types.map((type, index) => {
            const Icon = typeIcon(type.icon);
            return (
              <Checkbox
                key={type.id}
                checked={typeIds.includes(type.id)}
                aria-invalid={typesError && index === 0 ? true : undefined}
                onCheckedChange={(on) => {
                  setTypeIds((state) => (on ? [...state, type.id] : state.filter((id) => id !== type.id)));
                  onEdit(['enabled_type_ids', 'default_type_id']);
                }}
                label={
                  <span className="flex min-w-0 items-center gap-2">
                    <span data-tone={type.tone} aria-hidden="true" className="inline-flex shrink-0 text-[var(--tab-ink)]">
                      <Icon className="size-4" />
                    </span>
                    <span className="truncate">{type.name}</span>
                  </span>
                }
              />
            );
          })}
        </Field>
        {!typesError && <p className="mt-1 text-sm text-muted">{chosen.length > 0 ? `Standardtyp ist ${chosen[0].name}, der oberste angehakte.` : 'Mindestens ein Typ muss aktiviert sein.'}</p>}
      </fieldset>

      {other.length > 0 && (
        <Banner tone="danger" role="alert" title="Das Projekt ist nicht gültig">
          {other.map(([field, messages]) => (
            <p key={field}>{messages.join(' ')}</p>
          ))}
        </Banner>
      )}
    </form>
  );
}

type CreateProjectDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (project: Project) => void;
};

export function CreateProjectDialog({ open, onOpenChange, onCreated }: CreateProjectDialogProps) {
  const formId = useId();
  const create = useCreateProject();
  const projects = useProjects({ include_archived: true });
  const workflows = useWorkflows();
  const types = useWorkItemTypes();
  const [errors, setErrors] = useState<FieldErrors>({});
  const [focusRequest, setFocusRequest] = useState(0);

  // a dialog opened again starts without the errors of the last time
  useEffect(() => {
    if (open) setErrors({});
  }, [open]);

  const activeTypes = (types.data?.items ?? []).filter((type) => type.archived_at === null);
  const ready = workflows.data !== undefined && types.data !== undefined;

  /** The error of a field goes when the field is changed. */
  const clearErrors = (fields: string[]) =>
    setErrors((state) => (fields.some((field) => field in state) ? Object.fromEntries(Object.entries(state).filter(([field]) => !fields.includes(field))) : state));

  // One send at a time: mod+enter again before the first is answered would make a second project (which the server
  // refuses as taken), and the callbacks of `mutate` are only called for the last of several calls, so the first send
  // would never be heard.
  const sending = useRef(false);

  async function submit(values: Values) {
    if (sending.current) return;
    sending.current = true;
    setErrors({});
    let project: Project;
    try {
      project = await create.mutateAsync(values);
    } catch (error) {
      if (error instanceof ApiError && error.status === 422 && error.errors) {
        setErrors(error.errors);
        // the first error takes the focus now, as the form could not be sent
        setFocusRequest((count) => count + 1);
      } else notifyError('Projekt nicht angelegt', error, () => void submit(values));
      return;
    } finally {
      sending.current = false;
    }
    onCreated(project);
  }

  let body;
  if (workflows.isError || types.isError) {
    body = (
      <Banner
        tone="danger"
        role="alert"
        title="Workflows und Typen konnten nicht geladen werden"
        action={
          <Button
            variant="secondary"
            size="sm"
            pending={workflows.isFetching || types.isFetching}
            onClick={() => {
              void workflows.refetch();
              void types.refetch();
            }}
          >
            Erneut versuchen
          </Button>
        }
      >
        Ohne sie lässt sich kein Projekt anlegen.
      </Banner>
    );
  } else if (!workflows.data || !types.data) {
    body = (
      <SkeletonGroup label="Das Formular wird geladen …" className="flex flex-col gap-4">
        <Skeleton className="h-9 w-full rounded-ctl" />
        <Skeleton className="h-9 w-2/3 rounded-ctl" />
        <Skeleton className="h-24 w-full rounded-ctl" />
      </SkeletonGroup>
    );
  } else {
    body = (
      <ProjectForm
        formId={formId}
        workflows={workflows.data.items}
        types={activeTypes}
        taken={(projects.data?.items ?? []).map((project) => project.identifier)}
        errors={errors}
        focusRequest={focusRequest}
        onEdit={clearErrors}
        onSubmit={submit}
      />
    );
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Neues Projekt"
      description="In einem Projekt arbeitet das Team an Items. Name, Kennung und Workflow lassen sich später ändern."
      footer={
        <>
          <DialogClose
            render={
              <Button variant="ghost" shortcut="escape">
                Abbrechen
              </Button>
            }
          />
          <Button
            variant="primary"
            type="submit"
            form={formId}
            // stays focusable and says why while the workflows and types are missing
            disabledReason={ready ? null : workflows.isError || types.isError ? 'Ohne Workflows und Typen lässt sich kein Projekt anlegen.' : 'Das Formular lädt noch …'}
            pending={create.isPending}
            shortcut="mod+enter"
          >
            Projekt anlegen
          </Button>
        </>
      }
    >
      {body}
    </Dialog>
  );
}
