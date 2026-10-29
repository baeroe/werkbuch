/*
 * The create dialog (`c`, spec 5.2): project, type, an optional template, title, description, the item's fields and
 * the properties of the type. Required fields are marked; what the server refuses shows at its field (422 `errors`).
 * "Weitere anlegen" keeps the dialog open for the next item (project, type, status and the other fields stay, title,
 * description and properties start empty). mod+enter creates.
 *
 * Contract with `CreateHost` (src/app/CreateHost.tsx): the named export `CreateItemDialog({ open, defaults,
 * onOpenChange })` is the create dialog (`c`). The host mounts it lazily on the first open and keeps it mounted, so
 * the dialog can animate out; `defaults` are what `openCreate(defaults)` was given, e.g. the project and status of
 * the board column it was opened from. `onOpenChange(false)` closes it.
 *
 * Property fields report only values that parse (`PropertyValueInput`): while one of them still shows a text it
 * refuses, the dialog does not create the item and puts the focus there.
 */

import { FileQuestionMark, RotateCw } from 'lucide-react';
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode, type RefObject } from 'react';
import { useLocation } from 'react-router';
import { ApiError } from '@/api/client';
import { personOption } from '@/components/fields/AssigneePicker';
import { DatePopover, DayValue } from '@/components/fields/DateField';
import { useProjectPeople, useToday } from '@/components/fields/itemData';
import { labelOption } from '@/components/fields/LabelsPicker';
import { noParentText, NO_PARENT_OPTION, parentCandidates, parentOption, useProjectItems } from '@/components/fields/ParentPicker';
import { Picker, type PickerOption } from '@/components/fields/Picker';
import { PRIORITY_OPTIONS } from '@/components/fields/PriorityPicker';
import { PropertyValueInput } from '@/components/fields/PropertyField';
import { stateOption } from '@/components/fields/StatePicker';
import { TypeGlyph } from '@/components/fields/TypePicker';
import { UnassignedAvatar } from '@/components/ui/Avatar';
import { Banner } from '@/components/ui/Banner';
import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';
import { Dialog, DialogClose } from '@/components/ui/Dialog';
import { EmptyState } from '@/components/ui/EmptyState';
import { Input } from '@/components/ui/Input';
import { ProjectBadge } from '@/components/ui/ProjectBadge';
import { Select } from '@/components/ui/Select';
import { Skeleton, SkeletonGroup } from '@/components/ui/Skeleton';
import { labelClass } from '@/components/ui/styles';
import { Switch } from '@/components/ui/Switch';
import { toast } from '@/components/ui/toast';
import { canHaveParent } from '@/domain/hierarchy';
import { renderTitle } from '@/domain/placeholders';
import { addDays as addDay } from '@/domain/tz';
import { allowedTargets } from '@/domain/workflow';
import { useLabels } from '@/hooks/catalog';
import { useOrganization } from '@/hooks/organization';
import { useProjects } from '@/hooks/projects';
import { useProperties } from '@/hooks/properties';
import { useTemplates } from '@/hooks/templates';
import { useWorkflows } from '@/hooks/workflows';
import { useCreateWorkItem } from '@/hooks/workItems';
import { useWorkItemTypes } from '@/hooks/workItemTypes';
import { useSettle } from '@/hooks/mutation';
import { now } from '@/lib/clock';
import { notifyError } from '@/lib/errors';
import { isMac } from '@/lib/platform';
import { usePermissions } from '@/lib/permissions';
import { useShortcut } from '@/lib/shortcuts/useShortcut';
import { UNDO_LABEL } from '@/lib/undo';
import type { CreateDefaults } from '@/store/ui';
import { useUiStore } from '@/store/ui';
import type { Label, Organization, Priority, Project, Property, PropertyValue, RichText, Template, WorkItemType, Workflow } from '@/types';
import { isEmptyDoc, RichTextEditor } from '@/features/editor/RichTextEditor';
import { useUnsavedGuard } from '@/features/item-detail/shared';

export type CreateItemDialogProps = {
  open: boolean;
  defaults: CreateDefaults | null;
  onOpenChange: (open: boolean) => void;
};

const MAX_TITLE = 255;

interface Draft {
  projectId: string;
  typeId: string;
  templateId: string | null;
  title: string;
  description: RichText | null;
  /** null: the workflow's start state. */
  stateId: string | null;
  priority: Priority;
  assigneeId: string | null;
  labelIds: string[];
  parentId: string | null;
  startDate: string | null;
  dueDate: string | null;
  values: Record<string, PropertyValue>;
}

/** Field errors of the form, by the paths of the API (`title`, `values.customer` …). */
type Errors = Record<string, string>;

/** The attachments a description holds (uploads made before the item exists; the server links them on create). */
function attachmentIds(doc: RichText | null): string[] {
  const ids: string[] = [];
  const visit = (node: RichText) => {
    if ((node.type === 'image' || node.type === 'attachment') && typeof node.attrs?.attachmentId === 'string') ids.push(node.attrs.attachmentId);
    node.content?.forEach(visit);
  };
  if (doc) visit(doc);
  return ids;
}

/**
 * The values as the request sends them: rich text without content is null. The form keeps the document until then,
 * so an empty list or heading stays in the editor while it is written.
 */
function withoutEmptyDocs(values: Record<string, PropertyValue>, properties: readonly Property[] | undefined): Record<string, PropertyValue> {
  const rich = new Set(properties?.filter((property) => property.field_type === 'rich_text').map((property) => property.key));
  return Object.fromEntries(Object.entries(values).map(([key, value]) => [key, rich.has(key) && isEmptyDoc(value as RichText | null) ? null : value]));
}

const isModEnter = (event: KeyboardEvent) => event.key === 'Enter' && (isMac() ? event.metaKey : event.ctrlKey);

/** Whether the form holds something typed that closing it would throw away. */
function hasContent(draft: Draft): boolean {
  return draft.title.trim() !== '' || !isEmptyDoc(draft.description) || Object.keys(draft.values).length > 0;
}

/** The draft of a dialog that was closed with content, until it is taken back or another one is parked. */
let parked: Draft | null = null;
let restoring = false;

/** Closing with content asks nothing (spec 5.1): a toast offers to take it back, mod+z too. */
function park(draft: Draft): void {
  parked = draft;
  restoring = false;
  toast({
    title: 'Entwurf verworfen',
    description: draft.title.trim() || 'Ein neues Item ohne Titel',
    keep: true,
    action: {
      label: UNDO_LABEL,
      onClick: () => {
        restoring = true;
        useUiStore.getState().openCreate(null);
      },
    },
  });
}

/**
 * The parked draft when its toast reopened the dialog and its project is still there. Only reads: rendering may run
 * twice (StrictMode) or be thrown away; the form that shows it lets go of it with `parkedTaken`.
 */
function parkedToRestore(projects: readonly Project[]): Draft | null {
  const draft = restoring ? parked : null;
  return draft && projects.some((project) => project.id === draft.projectId) ? draft : null;
}

/** A form appeared after "Rückgängig": the parked draft is its own now (or its project is gone), nothing to restore. */
function parkedTaken(): void {
  if (!restoring) return;
  parked = null;
  restoring = false;
}

/* ------------------------------------------------------------------------------ dialog */

export function CreateItemDialog({ open, defaults, onOpenChange }: CreateItemDialogProps) {
  const formId = useId();
  const [another, setAnother] = useState(false);
  const [pending, setPending] = useState(false);
  const title = useRef<HTMLInputElement>(null);
  /** What the form holds while it is shown and its item not yet created. */
  const unsaved = useRef<Draft | null>(null);
  const wasOpen = useRef(open);

  // Closing with typed text parks it. On the close itself, not when the form unmounts: StrictMode unmounts and mounts
  // every new form once more, which would park (and toast) a draft that "Rückgängig" just brought back.
  useEffect(() => {
    const closed = wasOpen.current && !open;
    wasOpen.current = open;
    if (!closed) return;
    const draft = unsaved.current;
    unsaved.current = null;
    if (draft && hasContent(draft)) park(draft);
  }, [open]);

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      size="lg"
      title="Neues Item"
      initialFocus={title}
      footer={
        <>
          <Switch label="Weitere anlegen" checked={another} onCheckedChange={setAnother} className="mr-auto" />
          <DialogClose render={<Button variant="ghost">Abbrechen</Button>} />
          <Button variant="primary" type="submit" form={formId} shortcut="mod+enter" pending={pending}>
            Anlegen
          </Button>
        </>
      }
    >
      <CreateForm formId={formId} defaults={defaults} another={another} titleRef={title} unsaved={unsaved} onPending={setPending} onClose={() => onOpenChange(false)} />
    </Dialog>
  );
}

type CreateFormProps = {
  formId: string;
  defaults: CreateDefaults | null;
  another: boolean;
  titleRef: RefObject<HTMLInputElement | null>;
  /** The form keeps its draft here while it is mounted, and null once the item is created: the dialog parks it on close. */
  unsaved: RefObject<Draft | null>;
  onPending: (pending: boolean) => void;
  onClose: () => void;
};

/** The project of the screen behind the dialog: /projects/WEB… or /items/WEB-47. */
function projectOnScreen(pathname: string, projects: readonly Project[]): Project | undefined {
  const identifier = (/^\/projects\/([^/]+)/.exec(pathname)?.[1] ?? /^\/items\/([A-Za-z][A-Za-z0-9]*)-\d+/.exec(pathname)?.[1])?.toUpperCase();
  return identifier ? projects.find((project) => project.identifier === identifier) : undefined;
}

/** Waits for the catalogs the form needs; then the form starts from the defaults. */
function CreateForm(props: CreateFormProps) {
  const projects = useProjects();
  const types = useWorkItemTypes();
  const workflows = useWorkflows();
  const organization = useOrganization();
  const { can } = usePermissions();
  const { pathname } = useLocation();
  const queries = [projects, types, workflows, organization];
  const failed = queries.find((query) => query.isError);

  if (failed) {
    return (
      <div role="alert" className="flex flex-wrap items-center gap-2 rounded-ctl bg-danger-soft px-3 py-2 text-ui text-ink">
        <p className="min-w-0 flex-1 text-pretty">Das Formular ließ sich nicht laden: {failed.error?.message}</p>
        <Button variant="secondary" size="sm" icon={RotateCw} onClick={() => queries.forEach((query) => void query.refetch())}>
          Erneut versuchen
        </Button>
      </div>
    );
  }
  if (!projects.data || !types.data || !workflows.data || !organization.data) {
    return (
      <SkeletonGroup label="Formular wird geladen …" className="flex flex-col gap-4">
        <div className="grid gap-4 md:grid-cols-2">
          <Skeleton className="h-9 rounded-ctl" />
          <Skeleton className="h-9 rounded-ctl" />
        </div>
        <Skeleton className="h-9 rounded-ctl" />
        <Skeleton className="h-28 rounded-ctl" />
      </SkeletonGroup>
    );
  }

  const choosable = projects.data.items.filter((project) => project.archived_at === null && can('item.create', project.id));
  if (choosable.length === 0) {
    return (
      <EmptyState
        icon={FileQuestionMark}
        title="Hier kannst du kein Item anlegen"
        description="In keinem Projekt hast du die Rolle Member oder Admin. Bitte eine Admin des Projekts, dich aufzunehmen."
      />
    );
  }
  const preferred = [props.defaults?.project_id, projectOnScreen(pathname, choosable)?.id].find((id) => id && choosable.some((project) => project.id === id));
  return (
    <FormBody
      {...props}
      projects={choosable}
      initialProjectId={preferred ?? choosable[0].id}
      types={types.data.items}
      workflows={workflows.data.items}
      organization={organization.data}
    />
  );
}

/* -------------------------------------------------------------------------------- form */

type FormBodyProps = CreateFormProps & {
  projects: Project[];
  initialProjectId: string;
  types: WorkItemType[];
  workflows: Workflow[];
  organization: Organization;
};

function FormBody({ formId, defaults, another, titleRef, unsaved, onPending, onClose, projects, initialProjectId, types, workflows, organization }: FormBodyProps) {
  const settle = useSettle();
  const properties = useProperties().data?.items;
  const labels = useLabels().data?.items;
  const { today } = useToday();
  const create = useCreateWorkItem();
  const form = useRef<HTMLFormElement>(null);
  const descriptionLabel = useId();

  const typesOf = (projectId: string) => {
    const project = projects.find((entry) => entry.id === projectId);
    return types.filter((type) => type.archived_at === null && project?.enabled_type_ids.includes(type.id));
  };
  const defaultType = (projectId: string) => {
    const project = projects.find((entry) => entry.id === projectId);
    const enabled = typesOf(projectId);
    return enabled.find((type) => type.id === project?.default_type_id)?.id ?? enabled[0]?.id ?? '';
  };

  const [draft, setDraft] = useState<Draft>(() => {
    // "Rückgängig" on the toast of a closed dialog brings its draft back
    const restored = parkedToRestore(projects);
    if (restored) return restored;
    const projectId = initialProjectId;
    const typeId = defaults?.type_id && typesOf(projectId).some((type) => type.id === defaults.type_id) ? defaults.type_id : defaultType(projectId);
    return {
      projectId,
      typeId,
      templateId: null,
      title: defaults?.title ?? '',
      description: null,
      stateId: defaults?.state_id ?? null,
      priority: defaults?.priority ?? 'none',
      assigneeId: defaults?.assignee_id ?? null,
      labelIds: [],
      parentId: defaults?.parent_id ?? null,
      startDate: null,
      dueDate: null,
      values: {},
    };
  });
  const [errors, setErrors] = useState<Errors>({});
  const [blocked, setBlocked] = useState<string | null>(null);
  const [focusError, setFocusError] = useState(0);
  /** The draft as it is now, for a submit that runs once pending field changes have landed. */
  const latest = useRef(draft);
  /** The last item was created and the dialog closes: nothing to keep. */
  const done = useRef(false);
  useLayoutEffect(() => {
    latest.current = draft;
    unsaved.current = done.current ? null : draft;
  });
  useLayoutEffect(
    () => () => {
      unsaved.current = null;
    },
    [unsaved],
  );
  useEffect(parkedTaken, []);
  const scheduled = useRef(false);

  // typed text is not lost: reloading asks first, closing parks it with "Rückgängig" (undo, not a question)
  useUnsavedGuard(hasContent(draft));

  const project = projects.find((entry) => entry.id === draft.projectId)!;
  const workflow = workflows.find((entry) => entry.id === project.workflow_id);
  const type = types.find((entry) => entry.id === draft.typeId);
  const templateList = useTemplates(draft.projectId);
  const templates = templateList.data?.items ?? [];
  const fields = useMemo(
    () =>
      [...(type?.properties ?? [])]
        .sort((a, b) => a.position - b.position)
        .flatMap((entry) => {
          const property = properties?.find((candidate) => candidate.id === entry.property_id);
          return property ? [{ property, required: entry.required }] : [];
        }),
    [type, properties],
  );

  const update = (patch: Partial<Draft>) => setDraft((current) => ({ ...current, ...patch }));
  const clearError = (...paths: string[]) => setErrors((current) => (paths.some((path) => path in current) ? Object.fromEntries(Object.entries(current).filter(([key]) => !paths.includes(key))) : current));

  useEffect(() => {
    onPending(create.isPending);
  }, [create.isPending, onPending]);

  // a dialog opened with a template applies it
  const appliedDefault = useRef(false);
  useEffect(() => {
    if (appliedDefault.current || !defaults?.template_id) return;
    const template = templates.find((entry) => entry.id === defaults.template_id);
    if (!template) return;
    appliedDefault.current = true;
    applyTemplate(template);
  });

  // after a refusal the focus goes to the first field that names a problem
  useEffect(() => {
    if (focusError > 0) form.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  }, [focusError]);

  // the form appears after the catalogs: then the title takes the focus
  useEffect(() => {
    titleRef.current?.focus();
  }, [titleRef]);

  function changeProject(projectId: string) {
    const enabled = typesOf(projectId);
    const typeId = enabled.some((entry) => entry.id === draft.typeId) ? draft.typeId : defaultType(projectId);
    const keep = new Set(
      (types.find((entry) => entry.id === typeId)?.properties ?? []).map((entry) => properties?.find((candidate) => candidate.id === entry.property_id)?.key),
    );
    setErrors({});
    update({
      projectId,
      typeId,
      templateId: null,
      // status, assignee and parent belong to the project
      stateId: null,
      assigneeId: null,
      parentId: null,
      values: Object.fromEntries(Object.entries(draft.values).filter(([key]) => keep.has(key))),
    });
  }

  function changeType(typeId: string) {
    const keep = new Set((types.find((entry) => entry.id === typeId)?.properties ?? []).map((entry) => properties?.find((candidate) => candidate.id === entry.property_id)?.key));
    clearError('type_id');
    update({ typeId, values: Object.fromEntries(Object.entries(draft.values).filter(([key]) => keep.has(key))) });
  }

  function applyTemplate(template: Template) {
    const { payload } = template;
    const typeId = typesOf(draft.projectId).some((entry) => entry.id === payload.type_id) ? payload.type_id : draft.typeId;
    setErrors({});
    update({
      templateId: template.id,
      typeId,
      title: renderTitle(payload.title, now(), organization.locale, organization.timezone),
      description: payload.description,
      priority: payload.priority,
      assigneeId: payload.assignee_id,
      labelIds: [...payload.label_ids],
      parentId: payload.parent_id,
      startDate: payload.start_offset_days === null ? null : addDay(today, payload.start_offset_days),
      dueDate: payload.due_offset_days === null ? null : addDay(today, payload.due_offset_days),
      values: { ...payload.values },
    });
    toast({ title: `Vorlage „${template.name}“ angewendet`, description: 'Titel, Beschreibung und Felder kommen aus der Vorlage. Du kannst alles ändern.' });
  }

  /** Creates once the fields that commit on Enter or blur have landed; a field that still refuses its text stops it. */
  function requestCreate() {
    if (scheduled.current || create.isPending) return;
    scheduled.current = true;
    setTimeout(() => {
      scheduled.current = false;
      createNow();
    }, 0);
  }

  function createNow() {
    const current = latest.current;
    const invalid = form.current?.querySelector<HTMLElement>('[data-property] [aria-invalid="true"]');
    if (invalid) {
      setBlocked('Ein Feld enthält noch eine Eingabe, die nicht passt. Korrigiere sie oder leere das Feld.');
      invalid.focus();
      return;
    }
    const title = current.title.trim();
    const own: Errors = {};
    if (title === '') own.title = 'Gib dem Item einen Titel.';
    else if (title.length > MAX_TITLE) own.title = `Höchstens ${MAX_TITLE} Zeichen, jetzt sind es ${title.length}.`;
    if (Object.keys(own).length > 0) {
      setErrors(own);
      setFocusError((count) => count + 1);
      return;
    }
    setBlocked(null);
    setErrors({});
    settle(
      create.mutateAsync({
        project_id: current.projectId,
        type_id: current.typeId,
        title,
        description: isEmptyDoc(current.description) ? null : current.description,
        state_id: current.stateId ?? undefined,
        assignee_id: current.assigneeId,
        priority: current.priority,
        label_ids: current.labelIds,
        start_date: current.startDate,
        due_date: current.dueDate,
        // an epic stands at the top: the parent its field held while hidden does not count
        parent_id: canHaveParent(types.find((type) => type.id === current.typeId)) ? current.parentId : null,
        values: withoutEmptyDocs(current.values, properties),
        template_id: current.templateId,
        attachment_ids: attachmentIds(current.description),
      }),
      {
        onSuccess: (item) => {
          useUiStore.getState().flash(item.id);
          toast({
            title: `${item.key} angelegt`,
            description: item.title,
            tone: 'success',
            action: { label: 'Öffnen', onClick: () => useUiStore.getState().openPeek(item.id) },
          });
          if (!another) {
            done.current = true;
            unsaved.current = null;
            onClose();
            return;
          }
          // the next one: same project, type and fields; new title, description and properties
          const next = { ...current, templateId: null, title: '', description: null, startDate: null, dueDate: null, values: {} };
          latest.current = next;
          setDraft(next);
          titleRef.current?.focus();
        },
        onError: (error) => {
          if (error instanceof ApiError && error.errors) {
            setErrors(Object.fromEntries(Object.entries(error.errors).map(([path, messages]) => [path, messages[0]])));
            setFocusError((count) => count + 1);
          } else if (error instanceof ApiError && error.status < 500) {
            setErrors({ form: error.message });
          } else {
            notifyError('Item nicht angelegt', error, requestCreate);
          }
        },
      },
    );
  }

  const known = new Set(['title', 'type_id', 'project_id', 'state_id', 'assignee_id', 'priority', 'label_ids', 'start_date', 'due_date', 'parent_id', 'form']);
  const otherErrors = Object.entries(errors).filter(([path]) => !known.has(path) && !path.startsWith('values.'));
  const formError = errors.form ?? (otherErrors.length > 0 ? otherErrors.map(([, message]) => message).join(' ') : null);

  return (
    <form
      ref={form}
      id={formId}
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        requestCreate();
      }}
      // a field that took mod+enter for itself (it commits its value on Enter) still creates the item
      onKeyDown={(event) => {
        if (isModEnter(event) && event.defaultPrevented) requestCreate();
      }}
      className="flex flex-col gap-4"
    >
      <CreateShortcut onCreate={requestCreate} />
      {(blocked || formError) && (
        <Banner tone="danger" role="alert" title={blocked ? 'Noch nicht angelegt' : 'Nicht angelegt'}>
          {blocked ?? formError}
        </Banner>
      )}
      <div className="grid gap-4 md:grid-cols-3">
        <Select
          label="Projekt"
          options={projects.map((entry) => ({ value: entry.id, label: entry.name, icon: <ProjectBadge project={entry} /> }))}
          value={draft.projectId}
          onValueChange={(next) => next && changeProject(next)}
          error={errors.project_id}
        />
        <Select
          label="Typ"
          options={typesOf(draft.projectId).map((entry) => ({ value: entry.id, label: entry.name, icon: <TypeGlyph type={entry} /> }))}
          value={draft.typeId}
          onValueChange={(next) => next && changeType(next)}
          error={errors.type_id}
        />
        <Select
          label="Vorlage anwenden"
          placeholder={templateList.isPending ? 'Lädt …' : templates.length > 0 ? 'Keine Vorlage' : 'Keine im Projekt'}
          disabled={templates.length === 0}
          options={templates.map((template) => ({ value: template.id, label: template.name }))}
          value={draft.templateId}
          onValueChange={(next) => {
            const template = templates.find((entry) => entry.id === next);
            if (template) applyTemplate(template);
          }}
        />
      </div>
      <Input
        ref={titleRef}
        label={
          <>
            Titel<span className="ml-1.5 font-normal text-muted">Pflicht</span>
          </>
        }
        name="title"
        autoComplete="off"
        placeholder="Kurz, was zu tun ist …"
        value={draft.title}
        error={errors.title}
        aria-required="true"
        // Enter here creates the item (the form's own submit), as mod+enter does anywhere in the dialog
        onChange={(event) => {
          update({ title: event.target.value });
          clearError('title');
        }}
      />
      <div className="flex flex-col">
        <p id={descriptionLabel} className={`${labelClass} mb-1.5`}>
          Beschreibung
        </p>
        <RichTextEditor
          value={draft.description}
          onChange={(description) => update({ description })}
          preset="description"
          projectId={draft.projectId}
          aria-labelledby={descriptionLabel}
        />
      </div>
      <ItemFields draft={draft} update={update} errors={errors} clearError={clearError} workflow={workflow} labels={labels} />
      {fields.length > 0 && (
        <section aria-labelledby={`${formId}-properties`} className="border-t border-edge pt-4">
          <h3 id={`${formId}-properties`} className="font-display text-md font-bold tracking-title text-ink">
            Properties von {type?.name}
          </h3>
          <div className="mt-3 grid gap-4 md:grid-cols-2">
            {fields.map(({ property, required }) => (
              <PropertyInput
                key={property.id}
                property={property}
                required={required}
                value={draft.values[property.key]}
                projectId={draft.projectId}
                error={errors[`values.${property.key}`] ?? null}
                onChange={(value) => {
                  setDraft((current) => ({ ...current, values: { ...current.values, [property.key]: value } }));
                  clearError(`values.${property.key}`);
                  setBlocked(null);
                }}
                onTyping={() => {
                  clearError(`values.${property.key}`);
                  setBlocked(null);
                }}
              />
            ))}
          </div>
        </section>
      )}
    </form>
  );
}

/** mod+enter creates, wherever the focus is in the dialog. */
function CreateShortcut({ onCreate }: { onCreate: () => void }) {
  useShortcut({ id: 'create.submit', keys: 'mod+enter', scope: 'dialog', label: 'Item anlegen', group: 'Dialog', run: onCreate });
  return null;
}

/* --------------------------------------------------------------------- fields of the item */

type ItemFieldsProps = {
  draft: Draft;
  update: (patch: Partial<Draft>) => void;
  errors: Errors;
  clearError: (...paths: string[]) => void;
  workflow: Workflow | undefined;
  labels: Label[] | undefined;
};

function FieldRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-muted">{label}</dt>
      <dd className="min-w-0">{children}</dd>
    </>
  );
}

/** A field error under the grid, for the fields that have no hint line of their own. */
function fieldErrors(errors: Errors): string[] {
  return ['state_id', 'assignee_id', 'priority', 'label_ids', 'start_date', 'due_date', 'parent_id'].flatMap((path) => (errors[path] ? [errors[path]] : []));
}

/** Status, priority, assignee, labels, dates and parent of the new item, as in the item's panel. */
function ItemFields({ draft, update, errors, clearError, workflow, labels }: ItemFieldsProps) {
  const { people, isLoading, error, retry, retrying } = useProjectPeople(draft.projectId);
  const projectItems = useProjectItems(draft.projectId);
  const types = useWorkItemTypes().data?.items;
  const { today } = useToday();

  const initial = workflow?.states.find((state) => state.id === workflow.initial_state_id);
  const startStates = workflow && initial ? [initial, ...allowedTargets(workflow, initial.id)] : [];
  const state = startStates.find((entry) => entry.id === draft.stateId) ?? initial;

  const assignee = people?.find((user) => user.id === draft.assigneeId);
  const sortedLabels = [...(labels ?? [])].sort((a, b) => a.name.localeCompare(b.name, 'de-DE'));
  const chosenLabels = sortedLabels.filter((label) => draft.labelIds.includes(label.id));
  const items = projectItems.data?.items ?? [];
  const parent = items.find((entry) => entry.id === draft.parentId);
  const typeOf = (typeId: string) => types?.find((type) => type.id === typeId);
  // two levels: the epics of the project are the parents, and an epic has none (the field hides)
  const takesParent = canHaveParent(typeOf(draft.typeId));
  const candidates = parentCandidates({ id: null, project_id: draft.projectId }, items, typeOf);
  const parentOptions: PickerOption[] = [...(draft.parentId ? [NO_PARENT_OPTION] : []), ...candidates.map((candidate) => parentOption(candidate, typeOf(candidate.type_id)))];
  const problems = fieldErrors(errors);

  const date = (field: 'startDate' | 'dueDate', path: 'start_date' | 'due_date', label: string) => {
    const value = draft[field];
    return (
      <DatePopover
        label={label}
        value={value}
        invalid={Boolean(errors[path])}
        display={<DayValue value={value} today={today} overdue={false} empty={path === 'start_date' ? 'Kein Start-Date' : 'Kein Due-Date'} />}
        displayText={value ?? 'kein Datum'}
        onChoose={(next) => {
          const other = field === 'startDate' ? draft.dueDate : draft.startDate;
          if (next && other && (field === 'startDate' ? next > other : next < other)) {
            return field === 'startDate' ? 'Der Start läge nach dem Due-Date. Verschiebe zuerst das Due-Date.' : 'Das Due-Date läge vor dem Start. Verschiebe zuerst den Start.';
          }
          update({ [field]: next } as Partial<Draft>);
          clearError(path);
          return null;
        }}
      />
    );
  };

  return (
    <div>
      <dl className="grid grid-cols-[5.5rem_minmax(0,1fr)] items-center gap-x-2 gap-y-0.5 text-ui md:grid-cols-[5.5rem_minmax(0,1fr)_5.5rem_minmax(0,1fr)]">
        <FieldRow label="Status">
          {state ? (
            <Picker
              label="Status"
              display={
                <>
                  {stateOption(state).icon}
                  <span className="truncate">{state.name}</span>
                </>
              }
              displayText={state.name}
              options={startStates.map(stateOption)}
              value={state.id}
              onValueChange={(next) => {
                update({ stateId: next === initial?.id ? null : next });
                clearError('state_id');
              }}
              placeholder="Status suchen …"
              invalid={Boolean(errors.state_id)}
            />
          ) : (
            <Skeleton className="h-4 w-24" />
          )}
        </FieldRow>
        <FieldRow label="Priorität">
          <Picker
            label="Priorität"
            display={
              <>
                {PRIORITY_OPTIONS.find((option) => option.value === draft.priority)?.icon}
                <span className="truncate">{PRIORITY_OPTIONS.find((option) => option.value === draft.priority)?.label}</span>
              </>
            }
            displayText={PRIORITY_OPTIONS.find((option) => option.value === draft.priority)?.label ?? ''}
            options={PRIORITY_OPTIONS}
            value={draft.priority}
            onValueChange={(next) => update({ priority: next as Priority })}
            placeholder="Priorität suchen …"
          />
        </FieldRow>
        <FieldRow label="Assignee">
          <Picker
            label="Assignee"
            display={
              assignee ? (
                <>
                  {personOption(assignee).icon}
                  <span className="truncate">{assignee.name}</span>
                </>
              ) : (
                <>
                  <UnassignedAvatar />
                  <span className="truncate text-muted">Nicht zugewiesen</span>
                </>
              )
            }
            displayText={assignee?.name ?? 'Nicht zugewiesen'}
            options={[{ value: '', label: 'Nicht zugewiesen', icon: <UnassignedAvatar /> }, ...(people ?? []).map(personOption)]}
            value={draft.assigneeId ?? ''}
            onValueChange={(next) => {
              update({ assigneeId: next || null });
              clearError('assignee_id');
            }}
            placeholder="Person suchen …"
            load={{ isLoading, error, retry, retrying }}
            invalid={Boolean(errors.assignee_id)}
          />
        </FieldRow>
        <FieldRow label="Labels">
          <Picker
            multiple
            label="Labels"
            display={
              chosenLabels.length > 0 ? (
                <span className="flex min-w-0 flex-wrap items-center gap-1">
                  {chosenLabels.map((label) => (
                    <Chip key={label.id} dot={label.color} className="bg-transparent">
                      {label.name}
                    </Chip>
                  ))}
                </span>
              ) : (
                <span className="truncate text-muted">Keine Labels</span>
              )
            }
            displayText={chosenLabels.map((label) => label.name).join(', ') || 'keine'}
            options={sortedLabels.map(labelOption)}
            value={draft.labelIds}
            onValueChange={(next) => update({ labelIds: next })}
            placeholder="Label suchen …"
          />
        </FieldRow>
        <FieldRow label="Start">{date('startDate', 'start_date', 'Start-Date')}</FieldRow>
        <FieldRow label="Due">{date('dueDate', 'due_date', 'Due-Date')}</FieldRow>
        {takesParent && (
          <FieldRow label="Eltern">
            <Picker
              label="Eltern-Item"
              display={
                parent ? (
                  <span className="flex min-w-0 items-center gap-1.5">
                    <span className="shrink-0 font-semibold text-muted tabular-nums">{parent.key}</span>
                    <span className="truncate">{parent.title}</span>
                  </span>
                ) : (
                  <span className="truncate text-muted">Kein Eltern-Item</span>
                )
              }
              displayText={parent ? `${parent.key} ${parent.title}` : 'keins'}
              options={parentOptions}
              value={draft.parentId ?? ''}
              onValueChange={(next) => {
                update({ parentId: next || null });
                clearError('parent_id');
              }}
              placeholder="Key oder Titel suchen …"
              emptyText={noParentText(candidates)}
              load={{ isLoading: projectItems.isPending, error: projectItems.error, retry: () => void projectItems.refetch(), retrying: projectItems.isFetching }}
              invalid={Boolean(errors.parent_id)}
            />
          </FieldRow>
        )}
      </dl>
      <div aria-live="polite">
        {problems.length > 0 && <p className="mt-2 text-sm font-medium text-pretty text-danger">{problems.join(' ')}</p>}
      </div>
    </div>
  );
}

/* --------------------------------------------------------------------------- properties */

type PropertyInputProps = {
  property: Property;
  required: boolean;
  value: PropertyValue | undefined;
  projectId: string;
  error: string | null;
  onChange: (value: PropertyValue) => void;
  /** Something was typed into the field, valid or not: an old refusal of the server no longer applies. */
  onTyping: () => void;
};

/** A property of the new item: the shared editors, the rich text editor for rich text. */
function PropertyInput({ property, required, value, projectId, error, onChange, onTyping }: PropertyInputProps) {
  const labelId = useId();
  const errorId = useId();
  if (property.field_type === 'rich_text') {
    return (
      <div data-property={property.key} className="flex flex-col md:col-span-2">
        <p id={labelId} className={`${labelClass} mb-1.5`}>
          {property.label}
          {required && <span className="ml-1.5 font-normal text-muted">Pflicht</span>}
        </p>
        <RichTextEditor
          value={(value ?? null) as RichText | null}
          // the document as it is, also while it has no text yet (an empty list): null only goes out on create
          onChange={onChange}
          preset="description"
          projectId={projectId}
          placeholder={property.help || `${property.label} …`}
          aria-labelledby={labelId}
          aria-describedby={error ? errorId : undefined}
        />
        <div aria-live="polite">
          {error && (
            <p id={errorId} className="mt-1.5 text-sm font-medium text-danger">
              {error}
            </p>
          )}
        </div>
      </div>
    );
  }
  return (
    <div data-property={property.key} onInput={onTyping} className="min-w-0">
      <PropertyValueInput property={property} value={value} onChange={onChange} projectId={projectId} required={required} error={error} />
    </div>
  );
}
