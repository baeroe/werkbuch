/*
 * The content of the create dialog: it waits for the catalogs, then the form starts from the defaults (or from a
 * parked draft that "Rückgängig" brought back). Project, type, the title first with the focus, the description in the
 * editor, the item's fields (`ItemFields`) and the properties of the type (`PropertyInputs`).
 *
 * - Without a project that takes new items it says so; a project the screen named but the person only reads is passed
 *   over with the reason beside the project.
 * - A catalog that fails to reload keeps the form and its draft: only one that never arrived stops it (13c).
 * - Creating waits a tick for fields that keep their value on Enter, then checks what only the form knows (a property
 *   that still shows a text it cannot read, the title) and sends once; a press during the call does nothing.
 * - Field errors of the server (422) show at their field and the focus goes to the first; an error disappears as soon
 *   as its field changes (13c). Any other refusal shows on top, a failure without an answer as a toast with a retry.
 */

import { usePage } from '@inertiajs/react';
import { FileQuestionMark, RotateCw } from 'lucide-react';
import { useEffect, useId, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { ApiError } from '@/api/client';
import type { CreateWorkItemInput } from '@/api/workItems';
import { TypeGlyph } from '@/components/fields/TypeGlyph';
import { Banner } from '@/components/ui/Banner';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { Input } from '@/components/ui/Input';
import { ProjectBadge } from '@/components/ui/ProjectBadge';
import { Select } from '@/components/ui/Select';
import { Skeleton, SkeletonGroup } from '@/components/ui/Skeleton';
import { labelClass } from '@/components/ui/styles';
import { canHaveParent } from '@/domain/hierarchy';
import { isEmptyDoc, RichTextEditor } from '@/editor/RichTextEditor';
import { useSettle } from '@/hooks/mutation';
import { useProjects } from '@/hooks/projects';
import { useProperties } from '@/hooks/properties';
import { useWorkflows } from '@/hooks/workflows';
import { useWorkItemTypes } from '@/hooks/workItemTypes';
import { notifyError } from '@/lib/errors';
import { t } from '@/lib/i18n';
import { usePermissions } from '@/lib/permissions';
import { useShortcut } from '@/lib/shortcuts/useShortcut';
import type { CreateDefaults } from '@/store/ui';
import type { Project, Property, PropertyValue, WorkItem, WorkItemType, Workflow } from '@/types';
import { useUnsavedGuard } from '@/features/item-detail/shared';
import { hasContent, nextDraft, parkedTaken, parkedToRestore, type Draft } from './draft';
import { ItemFields, startStates, type Errors } from './ItemFields';
import { PropertyInputs, type PropertyEntry } from './PropertyInputs';

/** As the server counts it (`ItemInput::TITLE_MAX`). */
const MAX_TITLE = 255;

export type CreateFormProps = {
  formId: string;
  defaults: CreateDefaults | null;
  /** "Weitere anlegen": after creating, the form stays for the next item. */
  another: boolean;
  titleRef: RefObject<HTMLInputElement | null>;
  /** The form keeps its draft here while it is mounted, and null once the item is created: the dialog parks it on close. */
  unsaved: RefObject<Draft | null>;
  /** Creates the item (the dialog's call, which toasts the new item). */
  send: (input: CreateWorkItemInput) => Promise<WorkItem>;
  pending: boolean;
  /** Why the form cannot create (loading, failed, no project), or null once it can. */
  onUnavailable: (reason: string | null) => void;
  onClose: () => void;
};

/** The identifier the address names: /projects/WEB/… or /items/WEB-47. */
function identifierOnScreen(url: string): string | undefined {
  const { pathname } = new URL(url, window.location.origin);
  return (/^\/projects\/([^/]+)/.exec(pathname)?.[1] ?? /^\/items\/([A-Za-z][A-Za-z0-9]*)-\d+/.exec(pathname)?.[1])?.toUpperCase();
}

/** Waits for the catalogs the form needs; then the form starts from the defaults. */
export function CreateForm(props: CreateFormProps) {
  const { onUnavailable } = props;
  const projects = useProjects({ include_archived: true });
  const types = useWorkItemTypes();
  const workflows = useWorkflows();
  const properties = useProperties();
  const { can, reason, loading } = usePermissions();
  const { url } = usePage();
  const queries = [projects, types, workflows, properties];
  // a failed reload keeps what arrived before, and the draft with it
  const failed = queries.find((query) => query.isError && !query.data);
  const ready = !loading && queries.every((query) => query.data);
  const all = projects.data?.items ?? [];
  const choosable = all.filter((project) => project.archived_at === null && can('item.create', project.id));

  const unavailable = failed
    ? t('items.create.load_failed', { message: failed.error!.message })
    : !ready
      ? t('items.create.loading')
      : choosable.length === 0
        ? reason('item.create')
        : null;
  useEffect(() => onUnavailable(unavailable), [unavailable, onUnavailable]);

  if (failed) {
    return (
      <div role="alert" className="flex flex-wrap items-center gap-2 rounded-ctl bg-danger-soft px-3 py-2 text-ui text-ink">
        <p className="min-w-0 flex-1 text-pretty">{unavailable}</p>
        <Button variant="secondary" size="sm" icon={RotateCw} onClick={() => queries.forEach((query) => void query.refetch())}>
          {t('common.retry')}
        </Button>
      </div>
    );
  }
  if (!ready) {
    return (
      <SkeletonGroup label={t('items.create.loading')} className="flex flex-col gap-4">
        <div className="grid gap-4 md:grid-cols-2">
          <Skeleton className="h-9 rounded-ctl" />
          <Skeleton className="h-9 rounded-ctl" />
        </div>
        <Skeleton className="h-9 rounded-ctl" />
        <Skeleton className="h-28 rounded-ctl" />
      </SkeletonGroup>
    );
  }
  if (choosable.length === 0) {
    return <EmptyState icon={FileQuestionMark} title={t('items.create.none.title')} description={t('items.create.none.description')} />;
  }

  // the project of "Kind-Item" or of the screen behind the dialog, if it takes new items; else the first that does
  const screen = identifierOnScreen(url);
  const named = all.find((project) => project.id === props.defaults?.project_id) ?? all.find((project) => project.identifier === screen);
  const preferred = named && choosable.includes(named) ? named : undefined;
  return (
    <FormBody
      {...props}
      projects={choosable}
      initialProjectId={(preferred ?? choosable[0]).id}
      passedOver={named && !preferred ? reason('item.create', named.id) : null}
      types={types.data!.items}
      workflows={workflows.data!.items}
      properties={properties.data!.items}
    />
  );
}

type FormBodyProps = CreateFormProps & {
  projects: Project[];
  initialProjectId: string;
  /** Why the project the screen named is not the one chosen (the person only reads it). */
  passedOver: string | null;
  types: WorkItemType[];
  workflows: Workflow[];
  properties: Property[];
};

/** The paths of the fields this form shows an error at; any other refusal stands on top. */
const FIELD_PATHS = new Set(['project_id', 'type_id', 'title', 'description_json', 'state_id', 'assignee_id', 'priority', 'label_ids', 'start_date', 'due_date', 'parent_id']);

function FormBody({
  formId,
  defaults,
  another,
  titleRef,
  unsaved,
  send,
  pending,
  onClose,
  projects,
  initialProjectId,
  passedOver,
  types,
  workflows,
  properties,
}: FormBodyProps) {
  const settle = useSettle();
  const form = useRef<HTMLFormElement>(null);
  const descriptionError = useId();
  const fieldId = (key: string) => `${formId}-value-${key}`;

  const typesOf = (projectId: string) => {
    const project = projects.find((entry) => entry.id === projectId);
    return types.filter((type) => type.archived_at === null && project?.enabled_type_ids.includes(type.id));
  };
  const defaultType = (projectId: string) => {
    const project = projects.find((entry) => entry.id === projectId);
    const enabled = typesOf(projectId);
    return (enabled.find((type) => type.id === project?.default_type_id) ?? enabled[0]).id;
  };
  /** The properties a type asks for, in its order. */
  const fieldsOf = (typeId: string): PropertyEntry[] =>
    [...(types.find((type) => type.id === typeId)?.properties ?? [])]
      .sort((a, b) => a.position - b.position)
      .flatMap((entry) => {
        const property = properties.find((candidate) => candidate.id === entry.property_id);
        return property ? [{ property, required: entry.required }] : [];
      });
  /** The values the new type keeps: those of its own properties. */
  const keptValues = (values: Record<string, PropertyValue>, typeId: string) => {
    const keys = new Set(fieldsOf(typeId).map(({ property }) => property.key));
    return Object.fromEntries(Object.entries(values).filter(([key]) => keys.has(key)));
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
  /** Typed values that cannot be read (a number, an address), by key: the form does not send while there is one. */
  const [unreadable, setUnreadable] = useState<Record<string, string>>({});
  const [attempted, setAttempted] = useState(false);
  const [blocked, setBlocked] = useState<string | null>(null);
  const [focusError, setFocusError] = useState(0);
  /** The draft and the unreadable fields as they are now, for a create that runs once pending field changes have landed. */
  const latest = useRef({ draft, unreadable });
  /** The last item was created and the dialog closes: nothing to keep. */
  const done = useRef(false);
  const scheduled = useRef(false);
  /** A create is on its way; a second press waits for its answer. */
  const sending = useRef(false);
  useLayoutEffect(() => {
    latest.current = { draft, unreadable };
    unsaved.current = done.current ? null : draft;
  });
  useLayoutEffect(
    () => () => {
      unsaved.current = null;
    },
    [unsaved],
  );
  useEffect(parkedTaken, []);

  // typed text is not lost: reloading asks first, closing parks it with "Rückgängig" (undo, not a question)
  useUnsavedGuard(hasContent(draft));

  // the form appears after the catalogs: then the title takes the focus
  useEffect(() => {
    titleRef.current?.focus();
  }, [titleRef]);

  // after a refusal the focus goes to the first field that names a problem
  useEffect(() => {
    if (focusError > 0) form.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  }, [focusError]);

  // mod+enter creates wherever the focus is in the dialog; a held key does not repeat it (the registry)
  useShortcut('dialog.submit', () => requestCreate());

  const type = types.find((entry) => entry.id === draft.typeId)!;
  const workflow = workflows.find((entry) => entry.id === projects.find((project) => project.id === draft.projectId)!.workflow_id);
  const fields = fieldsOf(draft.typeId);

  const update = (patch: Partial<Draft>) => setDraft((current) => ({ ...current, ...patch }));
  const clearError = (...paths: string[]) =>
    setErrors((current) => (paths.some((path) => path in current) ? Object.fromEntries(Object.entries(current).filter(([key]) => !paths.includes(key))) : current));

  function changeProject(projectId: string) {
    const typeId = typesOf(projectId).some((entry) => entry.id === draft.typeId) ? draft.typeId : defaultType(projectId);
    setErrors({});
    setBlocked(null);
    // status, assignee and parent belong to the project
    update({ projectId, typeId, stateId: null, assigneeId: null, parentId: null, values: keptValues(draft.values, typeId) });
  }

  function changeType(typeId: string) {
    clearError('type_id', 'parent_id');
    update({ typeId, values: keptValues(draft.values, typeId) });
  }

  /** Creates once the fields that keep their value on Enter or blur have landed. */
  function requestCreate() {
    if (scheduled.current || sending.current || pending) return;
    scheduled.current = true;
    setTimeout(() => {
      scheduled.current = false;
      createNow();
    }, 0);
  }

  function createNow() {
    const { draft: current, unreadable: stuckValues } = latest.current;
    const own = fieldsOf(current.typeId);
    setAttempted(true);
    // a value the form cannot read is no value: nothing is sent, the fix is at the field
    const stuck = own.find(({ property }) => stuckValues[property.key]);
    if (stuck) {
      setBlocked(t('items.create.blocked'));
      document.getElementById(fieldId(stuck.property.key))?.focus();
      return;
    }
    const title = current.title.trim();
    if (title === '' || title.length > MAX_TITLE) {
      setErrors({ title: title === '' ? t('items.create.title_required') : t('items.create.title_max', { max: MAX_TITLE, count: title.length }) });
      setFocusError((count) => count + 1);
      return;
    }
    setBlocked(null);
    setErrors({});
    sending.current = true;
    settle(send(toInput(current, title, own)), {
      onSuccess: () => {
        if (!another) {
          done.current = true;
          unsaved.current = null;
          onClose();
          return;
        }
        // the next one: same project, type, status and fields; new title, description and properties
        const next = nextDraft(current);
        latest.current = { draft: next, unreadable: {} };
        setDraft(next);
        setAttempted(false);
        titleRef.current?.focus();
      },
      onError: (error) => {
        if (error instanceof ApiError && error.errors) {
          setErrors(Object.fromEntries(Object.entries(error.errors).map(([path, messages]) => [path, messages[0]!])));
          setFocusError((count) => count + 1);
        } else if (error instanceof ApiError && error.status < 500) {
          setErrors({ form: error.message });
        } else {
          notifyError(t('items.create.failed'), error, requestCreate);
        }
      },
      onSettled: () => {
        sending.current = false;
      },
    });
  }

  /** The request: a status other than the start state only when the workflow offers it, a parent only below an epic. */
  function toInput(current: Draft, title: string, own: PropertyEntry[]): CreateWorkItemInput {
    const project = projects.find((entry) => entry.id === current.projectId)!;
    const states = startStates(workflows.find((entry) => entry.id === project.workflow_id));
    const target = states.slice(1).find((state) => state.id === current.stateId);
    // a required yes/no reads "Nein" until it is switched: that is what it sends (A89)
    const switches = own.filter(({ property, required }) => required && property.field_type === 'boolean' && !(property.key in current.values));
    return {
      project_id: current.projectId,
      type_id: current.typeId,
      title,
      description: isEmptyDoc(current.description) ? null : current.description,
      ...(target && { state_id: target.id }),
      assignee_id: current.assigneeId,
      priority: current.priority,
      label_ids: current.labelIds,
      start_date: current.startDate,
      due_date: current.dueDate,
      // an epic stands at the top: the parent its field held while hidden does not count
      parent_id: canHaveParent(types.find((entry) => entry.id === current.typeId)) ? current.parentId : null,
      values: { ...Object.fromEntries(switches.map(({ property }) => [property.key, property.default_value ?? false])), ...current.values },
    };
  }

  const otherErrors = Object.entries(errors).filter(([path]) => path !== 'form' && !FIELD_PATHS.has(path) && !path.startsWith('values.'));
  // a refusal at a property the type no longer shows still says so, never silently
  const shownValues = new Set(fields.map(({ property }) => `values.${property.key}`));
  const lostValues = Object.entries(errors).filter(([path]) => path.startsWith('values.') && !shownValues.has(path));
  const formError = [errors.form, ...[...otherErrors, ...lostValues].map(([, message]) => message)].filter(Boolean).join(' ') || null;

  return (
    <form
      ref={form}
      id={formId}
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        // the dialog is a portal, but React still bubbles its events to the form of the page that opened it
        event.stopPropagation();
        requestCreate();
      }}
      className="flex flex-col gap-4"
    >
      {(blocked || formError) && (
        <Banner tone="danger" role="alert" title={blocked ? t('items.create.blocked_title') : t('items.create.refused')}>
          {blocked ?? formError}
        </Banner>
      )}
      <div className="grid gap-4 md:grid-cols-2">
        <Select
          label={t('items.create.project')}
          options={projects.map((entry) => ({ value: entry.id, label: entry.name, icon: <ProjectBadge project={entry} /> }))}
          value={draft.projectId}
          onValueChange={(next) => next && changeProject(next)}
          hint={passedOver}
          error={errors.project_id}
        />
        <Select
          label={t('items.create.type')}
          options={typesOf(draft.projectId).map((entry) => ({ value: entry.id, label: entry.name, icon: <TypeGlyph type={entry} /> }))}
          value={draft.typeId}
          onValueChange={(next) => next && changeType(next)}
          error={errors.type_id}
        />
      </div>
      <Input
        ref={titleRef}
        label={
          <>
            {t('items.create.title_label')}
            <span className="ml-1.5 font-normal text-muted">{t('items.fields.property.required')}</span>
          </>
        }
        name="title"
        autoComplete="off"
        placeholder={t('items.create.title_placeholder')}
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
        <p className={`${labelClass} mb-1.5`} aria-hidden="true">
          {t('editor.label.description')}
        </p>
        <RichTextEditor
          value={draft.description}
          onChange={(description) => {
            update({ description });
            clearError('description_json');
          }}
          preset="description"
          invalid={Boolean(errors.description_json)}
          describedBy={errors.description_json ? descriptionError : undefined}
        />
        <div aria-live="polite">
          {errors.description_json && (
            <p id={descriptionError} className="mt-1.5 text-sm font-medium text-danger">
              {errors.description_json}
            </p>
          )}
        </div>
      </div>
      <ItemFields draft={draft} update={update} errors={errors} clearError={clearError} workflow={workflow} />
      <PropertyInputs
        formId={formId}
        type={type}
        fields={fields}
        values={draft.values}
        projectId={draft.projectId}
        fieldId={fieldId}
        errorOf={(key) => (attempted ? unreadable[key] : undefined) ?? errors[`values.${key}`] ?? null}
        onChange={(key, value) => {
          setDraft((current) => ({ ...current, values: { ...current.values, [key]: value } }));
          clearError(`values.${key}`);
          setBlocked(null);
        }}
        onUnreadable={(key, message) => {
          setUnreadable(({ [key]: _old, ...others }) => (message ? { ...others, [key]: message } : others));
          // something new was typed: an old refusal of the server no longer applies
          clearError(`values.${key}`);
          if (!message) setBlocked(null);
        }}
      />
    </form>
  );
}
