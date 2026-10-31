/*
 * The dialog "New project" (spec 4.4): name, identifier, visibility, workflow and types. The identifier follows the name
 * as a suggestion (`suggestIdentifier`, which knows the identifiers that are taken) until the person writes their own.
 * The default workflow and every active type are preselected (P10); the topmost type ticked becomes the default type.
 * The form waits until the workflows and types are there. Errors of the server (422) stand at their field and the focus
 * goes to the first one: the server alone knows identifiers of private projects the person does not see.
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
import { Field, fieldIds } from '@/components/ui/Field';
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
import { t, type TranslationKey } from '@/lib/i18n';
import { useShortcut } from '@/lib/shortcuts/useShortcut';
import type { Project, Workflow, WorkItemType } from '@/types';
import { suggestIdentifier } from './identifier';

type Visibility = Project['visibility'];
type FieldErrors = Record<string, string[]>;

const VISIBILITIES: { value: Visibility; label: TranslationKey; icon: typeof Globe; hint: TranslationKey }[] = [
  { value: 'public', label: 'projects.public', icon: Globe, hint: 'projects.create.public_hint' },
  { value: 'private', label: 'projects.private', icon: Lock, hint: 'projects.create.private_hint' },
];

type Values = Pick<CreateProjectInput, 'name' | 'identifier' | 'visibility' | 'workflow_id' | 'enabled_type_ids' | 'default_type_id'>;

type FormProps = {
  formId: string;
  workflows: Workflow[];
  /** The active types, in the order of the organisation. */
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
  const [workflowId, setWorkflowId] = useState(() => workflows.find((workflow) => workflow.is_default)?.id ?? null);
  const [typeIds, setTypeIds] = useState(() => types.map((type) => type.id));

  const identifier = typed ?? suggestIdentifier(name, taken);
  const workflow = workflows.find((entry) => entry.id === workflowId);
  const chosen = types.filter((type) => typeIds.includes(type.id));
  const typesError = errors.enabled_type_ids?.[0] ?? errors.default_type_id?.[0];
  const known = new Set(['name', 'identifier', 'workflow_id', 'enabled_type_ids', 'default_type_id']);
  const other = Object.entries(errors).filter(([field]) => !known.has(field));

  useShortcut('dialog.submit', () => form.current?.requestSubmit());
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
  const hint = t('projects.create.identifier_hint', { key });

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
        label={t('projects.create.name')}
        name="name"
        value={name}
        // the form arrives after the dialog opened (the workflows and types load first): the name is where typing starts
        autoFocus
        autoComplete="off"
        placeholder={t('projects.create.name_placeholder')}
        error={errors.name?.[0]}
        onChange={(event) => {
          setName(event.target.value);
          // a suggestion that changes with the name leaves its error behind as well
          onEdit(typed === null ? ['name', 'identifier'] : ['name']);
        }}
      />
      <Input
        label={t('projects.create.identifier')}
        name="identifier"
        value={identifier}
        autoComplete="off"
        autoCapitalize="characters"
        spellCheck={false}
        translate="no"
        className="max-w-44 font-semibold tracking-wide tabular-nums"
        hint={typed === null ? `${t('projects.create.identifier_suggested')} ${hint}` : hint}
        error={errors.identifier?.[0]}
        // free text: only the case is put right, the server says what else is wrong
        onChange={(event) => {
          setTyped(event.target.value.toUpperCase());
          onEdit(['identifier']);
        }}
      />

      <div className="flex flex-col gap-1.5">
        <p className={labelClass}>{t('projects.create.visibility')}</p>
        <SegmentedControl
          label={t('projects.create.visibility')}
          value={visibility}
          onValueChange={(next) => {
            setVisibility(next);
            onEdit(['visibility']);
          }}
          options={VISIBILITIES.map(({ value, label, icon }) => ({ value, label: t(label), icon }))}
        />
        <p className="text-sm text-muted">{t(visible.hint)}</p>
      </div>

      <Select
        label={t('projects.create.workflow')}
        value={workflowId}
        onValueChange={(next) => {
          if (next) setWorkflowId(next);
          onEdit(['workflow_id']);
        }}
        options={workflows.map((entry) => ({ value: entry.id, label: entry.name }))}
        hint={workflow?.description || undefined}
        error={errors.workflow_id?.[0]}
      />

      <fieldset className="flex min-w-0 flex-col">
        <legend className={cx(labelClass, 'mb-1')}>{t('projects.create.types')}</legend>
        <Field id={`${formId}-types`} error={typesError}>
          {types.map((type, index) => {
            const Icon = typeIcon(type.icon);
            return (
              <Checkbox
                key={type.id}
                checked={typeIds.includes(type.id)}
                // the first box carries the error, so the focus lands in the list after a refused send
                aria-invalid={typesError && index === 0 ? true : undefined}
                aria-describedby={typesError && index === 0 ? fieldIds(`${formId}-types`).error : undefined}
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
        {!typesError && (
          <p className="mt-1 text-sm text-muted">
            {chosen.length > 0 ? t('projects.create.default_type', { name: chosen[0]!.name }) : t('projects.create.types_required')}
          </p>
        )}
      </fieldset>

      {other.length > 0 && (
        <Banner tone="danger" role="alert" title={t('projects.create.invalid')}>
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

  const ready = workflows.data !== undefined && types.data !== undefined;
  // only a catalog that never came: a failed refetch in the background keeps the form and what is typed in it
  const failed = !ready && (workflows.isError || types.isError);

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
      } else notifyError(t('projects.create.failed'), error, () => void submit(values));
      return;
    } finally {
      sending.current = false;
    }
    onCreated(project);
  }

  let body;
  if (failed) {
    body = (
      <Banner
        tone="danger"
        role="alert"
        title={t('projects.create.catalog_failed')}
        action={
          <Button
            variant="secondary"
            size="sm"
            pending={workflows.isFetching || types.isFetching}
            onClick={() => {
              if (workflows.isError) void workflows.refetch();
              if (types.isError) void types.refetch();
            }}
          >
            {t('common.retry')}
          </Button>
        }
      >
        {t('projects.create.catalog_failed_text')}
      </Banner>
    );
  } else if (!ready) {
    body = (
      <SkeletonGroup label={t('projects.create.loading')} className="flex flex-col gap-4">
        <Skeleton className="h-9 w-full rounded-ctl" />
        <Skeleton className="h-9 w-2/3 rounded-ctl" />
        <Skeleton className="h-24 w-full rounded-ctl" />
      </SkeletonGroup>
    );
  } else {
    body = (
      <ProjectForm
        formId={formId}
        workflows={workflows.data!.items}
        types={types.data!.items.filter((type) => type.archived_at === null)}
        taken={(projects.data?.items ?? []).map((project) => project.identifier)}
        errors={errors}
        focusRequest={focusRequest}
        onEdit={clearErrors}
        onSubmit={(values) => void submit(values)}
      />
    );
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('projects.create.title')}
      description={t('projects.create.description')}
      footer={
        <>
          <DialogClose
            render={
              <Button variant="ghost" shortcut="escape">
                {t('common.cancel')}
              </Button>
            }
          />
          <Button
            variant="primary"
            type="submit"
            form={formId}
            // stays focusable and says why while the workflows and types are missing
            disabledReason={ready ? null : failed ? t('projects.create.catalog_blocked') : t('projects.create.still_loading')}
            pending={create.isPending}
            shortcut="mod+enter"
          >
            {t('projects.create.submit')}
          </Button>
        </>
      }
    >
      {body}
    </Dialog>
  );
}
