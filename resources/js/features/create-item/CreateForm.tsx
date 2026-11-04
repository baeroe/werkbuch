/*
 * The content of the create dialog: it waits for the catalogs, then the form starts from the defaults (or from a
 * parked draft that "Rückgängig" brought back). Project, type, the title first with the focus, the description in the
 * editor, the item's fields (`ItemFields`) and the properties of the type (`PropertyInputs`).
 *
 * - Without a project that takes new items it says so; a project the screen named but the person only reads is passed
 *   over with the reason beside the project. When the last one goes while the form is shown (archived, the right lost,
 *   a live update), the typed draft is parked as on closing (`park`, "Rückgängig") and the notice stands instead.
 * - A project or type of the draft that leaves the lists makes the draft fall back to another one, with a notice
 *   (`items.create.draft_gone`) until the person changes project or type herself or starts the next item; refusals and
 *   the notice of a press about the old draft go, as after an own change.
 * - A catalog that fails to reload keeps the form and its draft: only one that never arrived stops it (13c).
 * - Sending is `useCreateSubmit`: once per press, never again after the item was created (the form fades out with
 *   the dialog). Field errors of the server (422) show at their field; an error disappears as soon as its field
 *   changes (13c). Any other refusal shows on top.
 * - The description is written in the chosen project: `/`, `@` its people, `#` items, and pictures and files pasted,
 *   dropped or chosen are uploaded into it. "Anlegen" waits for running uploads (`onHold`, the reason at the button);
 *   an upload belongs to nobody until the item is created (A232). After a change of project, pictures and files of
 *   another project do not fit (the server refuses the description, A233): a notice says so and marks the
 *   description, and "Anlegen" waits until they are removed or the project is changed back.
 */

import { usePage } from '@inertiajs/react';
import { useQueries } from '@tanstack/react-query';
import type { Editor } from '@tiptap/react';
import { FileQuestionMark, RotateCw } from 'lucide-react';
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react';
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
import { RichTextEditor } from '@/editor/RichTextEditor';
import { UploadContext, useUploadCounter, useUploadsPending } from '@/editor/UploadContext';
import { attachmentQuery } from '@/hooks/attachments';
import { useProjects } from '@/hooks/projects';
import { useProperties } from '@/hooks/properties';
import { useWorkflows } from '@/hooks/workflows';
import { useWorkItemTypes } from '@/hooks/workItemTypes';
import { t } from '@/lib/i18n';
import { usePermissions } from '@/lib/permissions';
import { attachmentIds } from '@/lib/richtext';
import { useShortcut } from '@/lib/shortcuts/useShortcut';
import type { CreateDefaults } from '@/store/ui';
import type { Project, Property, PropertyValue, WorkItem, WorkItemType, Workflow } from '@/types';
import { useUnsavedGuard } from '@/features/item-detail/shared';
import { hasContent, park, parkedTaken, parkedToRestore, seenNames, type Draft } from './draft';
import { ItemFields, type Errors } from './ItemFields';
import { PropertyInputs, type PropertyEntry } from './PropertyInputs';
import { useCreateSubmit } from './useCreateSubmit';

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
  /** Why the draft cannot go out yet (an upload runs, pictures of another project), or null. */
  onHold: (reason: string | null) => void;
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

  // the draft of a form that just unmounted (`FormBody`): parked when the last project that takes items went
  const left = useRef<Draft | null>(null);
  const noneLeft = ready && choosable.length === 0;
  useEffect(() => {
    if (!noneLeft) return;
    const draft = left.current;
    left.current = null;
    if (draft && hasContent(draft)) park(draft);
  }, [noneLeft]);

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
      left={left}
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
  /** Takes the draft when the form unmounts: the last project that takes items may have gone. */
  left: RefObject<Draft | null>;
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
  onHold,
  onClose,
  left,
  projects,
  initialProjectId,
  passedOver,
  types,
  workflows,
  properties,
}: FormBodyProps) {
  const form = useRef<HTMLFormElement>(null);
  const descriptionError = useId();
  const projectSelectId = `${formId}-project`;
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
  /** The refusals that stay with another type: those of the type, the parent and the properties it lacks go with the old one. */
  const errorsForType = (current: Errors, typeId: string): Errors => {
    const kept = new Set(fieldsOf(typeId).map(({ property }) => `values.${property.key}`));
    const stays = ([path]: [string, string]) => path !== 'type_id' && path !== 'parent_id' && (!path.startsWith('values.') || kept.has(path));
    return Object.entries(current).every(stays) ? current : Object.fromEntries(Object.entries(current).filter(stays));
  };

  const [stored, setDraft] = useState<Draft>(() => {
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
  // names of every project and type seen (also by the form of a parked draft), so the notice can name one that left
  for (const entry of [...projects, ...types]) seenNames.set(entry.id, entry.name);
  // project or type of the draft fell out of the lists while the dialog is open (archived, switched off, right lost):
  // the draft takes the first project that takes items, or the default type, and says so
  const projectGone = !projects.some((entry) => entry.id === stored.projectId);
  const typeGone = !projectGone && !typesOf(stored.projectId).some((entry) => entry.id === stored.typeId);
  const draft = useMemo<Draft>(() => {
    if (!projectGone && !typeGone) return stored;
    const projectId = projectGone ? projects[0].id : stored.projectId;
    const typeId = projectGone && typesOf(projectId).some((entry) => entry.id === stored.typeId) ? stored.typeId : defaultType(projectId);
    return projectGone
      ? { ...stored, projectId, typeId, stateId: null, assigneeId: null, parentId: null, values: keptValues(stored.values, typeId) }
      : { ...stored, typeId, values: keptValues(stored.values, typeId) };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the lists are what changes it
  }, [stored, projects, types, workflows, properties]);
  const [goneName, setGoneName] = useState<string | null>(null);
  const [focusProject, setFocusProject] = useState(0);
  const [errors, setErrors] = useState<Errors>({});
  /** Typed values that cannot be read (a number, an address), by key: the form does not send while there is one. */
  const [unreadable, setUnreadable] = useState<Record<string, string>>({});
  const [attempted, setAttempted] = useState(false);
  const [blocked, setBlocked] = useState<string | null>(null);
  useEffect(() => {
    if (!projectGone && !typeGone) return;
    setGoneName(seenNames.get(projectGone ? stored.projectId : stored.typeId) ?? '');
    // what the server refused and the notice of a press were about the old draft, as after an own change
    setErrors((current) => (projectGone ? {} : errorsForType(current, draft.typeId)));
    setBlocked(null);
    setDraft(draft);
    setFocusProject((count) => count + 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `errorsForType` reads the catalogs `draft` follows
  }, [projectGone, typeGone, stored, draft]);
  const [focusError, setFocusError] = useState(0);

  // the uploads of the description: "Anlegen" waits for them, and for pictures of another project to go
  const uploads = useUploadCounter();
  const uploading = useUploadsPending(uploads);
  const editor = useRef<Editor | null>(null);
  const foreignId = useId();
  const attached = useQueries({ queries: attachmentIds(draft.description).map(attachmentQuery) });
  // the project of an upload never changes; one that is still loading or not found is the server's to judge
  const foreign = attached.some((query) => query.data !== undefined && query.data.project_id !== draft.projectId);
  const uploadWait = t('editor.upload.pending');
  const hold = uploading > 0 ? uploadWait : foreign ? t('items.create.images_other_project') : null;
  useEffect(() => onHold(hold), [hold, onHold]);
  useEffect(() => () => onHold(null), [onHold]);
  // the uploads are stored, or the foreign pictures went: the notice of a press that waited for them goes
  const foreignWait = t('items.create.images_other_project');
  useEffect(() => {
    if (uploading === 0) setBlocked((current) => (current === uploadWait ? null : current));
  }, [uploading, uploadWait]);
  useEffect(() => {
    if (!foreign) setBlocked((current) => (current === foreignWait ? null : current));
  }, [foreign, foreignWait]);

  const requestCreate = useCreateSubmit({
    draft,
    unreadable,
    uploading: uploading > 0,
    foreign,
    focusDescription: () => editor.current?.commands.focus(),
    catalogs: { projects, types, workflows },
    fieldsOf,
    fieldId,
    another,
    send,
    pending,
    titleRef,
    unsaved,
    onClose,
    setDraft,
    setErrors,
    setAttempted,
    setBlocked,
    onNext: () => setGoneName(null),
    focusFirstError: () => setFocusError((count) => count + 1),
  });
  useLayoutEffect(
    () => () => {
      left.current = unsaved.current;
      unsaved.current = null;
    },
    [unsaved, left],
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
  // after a draft went stale the focus goes to the project, where the person checks what is left
  useEffect(() => {
    if (focusProject > 0) form.current?.querySelector<HTMLElement>(`[id="${projectSelectId}"]`)?.focus();
  }, [focusProject, projectSelectId]);

  const fields = fieldsOf(draft.typeId);

  const update = (patch: Partial<Draft>) => setDraft((current) => ({ ...current, ...patch }));
  const clearError = (...paths: string[]) =>
    setErrors((current) => (paths.some((path) => path in current) ? Object.fromEntries(Object.entries(current).filter(([key]) => !paths.includes(key))) : current));

  function changeProject(projectId: string) {
    const typeId = typesOf(projectId).some((entry) => entry.id === draft.typeId) ? draft.typeId : defaultType(projectId);
    setErrors({});
    setBlocked(null);
    setGoneName(null);
    // status, assignee and parent belong to the project
    update({ projectId, typeId, stateId: null, assigneeId: null, parentId: null, values: keptValues(draft.values, typeId) });
  }

  function changeType(typeId: string) {
    // a refusal of a property the new type does not have is about the old one: it goes with it
    setErrors((current) => errorsForType(current, typeId));
    setGoneName(null);
    update({ typeId, values: keptValues(draft.values, typeId) });
  }

  const otherErrors = Object.entries(errors).filter(([path]) => path !== 'form' && !FIELD_PATHS.has(path) && !path.startsWith('values.'));
  // a refusal at a property the type no longer shows still says so, never silently
  const shownValues = new Set(fields.map(({ property }) => `values.${property.key}`));
  const lostValues = Object.entries(errors).filter(([path]) => path.startsWith('values.') && !shownValues.has(path));
  const formError = [errors.form, ...[...otherErrors, ...lostValues].map(([, message]) => message)].filter(Boolean).join(' ') || null;

  const describedBy = [errors.description_json && descriptionError, foreign && foreignId].filter(Boolean).join(' ') || undefined;

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
      {goneName !== null && (
        <Banner tone="info" role="status" title={t('items.create.draft_gone', { name: goneName })} />
      )}
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
          id={projectSelectId}
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
        {/* a live region that is there from the start: a status mounted with its text is often not read (F21) */}
        <div aria-live="polite">{foreign && <Banner id={foreignId} tone="danger" title={t('items.create.images_other_project')} className="mb-2" />}</div>
        <UploadContext value={uploads}>
          <RichTextEditor
            value={draft.description}
            onChange={(description) => {
              update({ description });
              clearError('description_json');
            }}
            preset="description"
            projectId={draft.projectId}
            editorRef={editor}
            invalid={Boolean(errors.description_json) || foreign}
            describedBy={describedBy}
          />
        </UploadContext>
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
