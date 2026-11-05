/*
 * One template (spec 4.12), ported from the clickdummy's TemplateEditor: the fields of the item it makes
 * (`TemplateFields`), the schedule, "Jetzt ausführen" and the log of its runs. `TemplatesScreen` shows it for
 * `/projects/<KENNUNG>/templates/<id>`; `new` makes a new template.
 *
 * - Saving is on purpose only (A336): "Speichern" / "Anlegen" and `template.save` (mod+enter, also from a field that
 *   keeps its Enter for itself). It waits a tick for fields that take their value on Enter, then sends once; a press
 *   while a call is on its way does nothing, and a held key repeats nothing (13c). Leaving with unsaved changes asks
 *   (`LeaveGuard`); two people editing at once: the last save wins (a whole `PUT`, A75).
 * - The schedule (`ScheduleEditor`) is part of the draft: switched on, its settings, the next five terms as the server
 *   counts them. Its typed fields (interval, time, count) report a text they cannot read like the other fields do.
 * - Before it sends: running uploads of the description, a field that still shows a text it cannot read (the focus goes
 *   there), a name and a title. Refusals of the server (422) stand at their fields (`payload.title`,
 *   `payload.values.<key>`, `schedule.<field>`) with the focus on the first; any other refusal on top; a failure without
 *   an answer in a toast with "Erneut versuchen".
 * - A new template leads to its own address once saved, and its heading takes the focus (`focusWhenLost`, 13c).
 * - A newer stored template (saved here or elsewhere) is taken over while nothing is typed.
 * - "Jetzt ausführen" runs the saved template as the scheduler would, as the default bot: the toast leads to the new
 *   item in the preview, or says why the run failed (it is logged, A350). It waits for "Speichern" while there are
 *   unsaved changes. The palette has it and the delete (`template.run`, `template.delete`).
 * - Deleting leads to the list with five seconds of undo; the call goes out when the toast runs out.
 * - Whoever may not manage templates reads every field, without saving, running or deleting.
 */

import { router } from '@inertiajs/react';
import type { Editor } from '@tiptap/react';
import { Ellipsis, Play, RotateCw, Save, Trash2 } from 'lucide-react';
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { ApiError } from '@/api/client';
import { isEmptyValue } from '@/components/fields/property/parse';
import { Banner } from '@/components/ui/Banner';
import { Button } from '@/components/ui/Button';
import { IconButton } from '@/components/ui/IconButton';
import { Menu, MenuContent, MenuItem, MenuTrigger } from '@/components/ui/Menu';
import { Skeleton, SkeletonGroup } from '@/components/ui/Skeleton';
import { toast } from '@/components/ui/toast';
import { canHaveParent } from '@/domain/hierarchy';
import { isEmptyDoc } from '@/editor/RichTextEditor';
import { useUploadCounter, useUploadsPending } from '@/editor/UploadContext';
import { LeaveGuard } from '@/features/settings/frame/LeaveGuard';
import { useSettle } from '@/hooks/mutation';
import { useProperties } from '@/hooks/properties';
import { useDeleteTemplate, useRunTemplateNow, useSaveTemplate } from '@/hooks/templates';
import { useWorkItemTypes } from '@/hooks/workItemTypes';
import { useCommand } from '@/lib/commands';
import { notifyError } from '@/lib/errors';
import { focusWhenLost } from '@/lib/focusOrigin';
import { t, tn } from '@/lib/i18n';
import { paths } from '@/lib/links';
import { isMac } from '@/lib/platform';
import { useShortcut } from '@/lib/shortcuts/useShortcut';
import { runWithUndo } from '@/lib/undo';
import { useUiStore } from '@/store/ui';
import type { Project, Property, Schedule, Template, WorkItemType } from '@/types';
import { useTemplateTimes } from './format';
import { hideTemplate, showTemplate } from './removed';
import { RunLog } from './RunLog';
import { ScheduleEditor } from './ScheduleEditor';
import { propertiesOf, TemplateFields, type Draft, type Errors } from './TemplateFields';

export type TemplateEditorProps = {
  project: Project;
  /** The stored template; null for a new one. */
  template: Template | null;
  /** Why the person may not manage templates of the project, or null. */
  denied: string | null;
  /** Whether the rights have loaded: until then `denied` says so, and the editor reads without saying "read only". */
  ready?: boolean;
};

/** mod alone with Enter, as the shortcut registry reads it: ⌘ on a Mac, Strg elsewhere. */
const isModEnter = (event: { key: string; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean }) =>
  event.key === 'Enter' && !event.shiftKey && !event.altKey && (isMac() ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey);

/** Object keys sorted: the editor and the cache spell the same document with keys in another order. */
const sortedKeys = (_key: string, value: unknown) =>
  value && typeof value === 'object' && !Array.isArray(value) ? Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b))) : value;

function draftOf(template: Template | null, project: Project): Draft {
  if (!template) {
    return {
      name: '',
      payload: {
        type_id: project.default_type_id,
        title: '',
        description_json: null,
        priority: 'none',
        assignee_id: null,
        label_ids: [],
        values: {},
        parent_id: null,
        start_offset_days: null,
        due_offset_days: null,
      },
      schedule: null,
    };
  }
  const { description: _markdown, values_markdown: _values, ...payload } = template.payload;
  return { name: template.name, payload: structuredClone(payload), schedule: template.schedule ? structuredClone(template.schedule) : null };
}

/** What a draft sends: trimmed, without empty values, without the parent an epic's hidden field still held. */
function toInput(draft: Draft, types: readonly WorkItemType[]): Draft {
  const { payload } = draft;
  return {
    name: draft.name.trim(),
    payload: {
      ...payload,
      title: payload.title.trim(),
      description_json: isEmptyDoc(payload.description_json) ? null : payload.description_json,
      values: Object.fromEntries(Object.entries(payload.values).filter(([, value]) => !isEmptyValue(value))),
      parent_id: canHaveParent(types.find((type) => type.id === payload.type_id)) ? payload.parent_id : null,
    },
    schedule: draft.schedule,
  };
}

const snapshot = (draft: Draft, types: readonly WorkItemType[]) => JSON.stringify(toInput(draft, types), sortedKeys);

/**
 * What was typed while a new template was being created (T16-I1): the editor at its new address starts with it, unsaved
 * against the stored template, instead of dropping it. A module map, because that editor is another instance.
 */
const handedOver = new Map<string, Draft>();

/** The line under the name: what the template does. */
function leadOf(template: Template | null): string {
  if (!template) return t('templates.editor.lead.new');
  if (!template.schedule) return t('templates.editor.lead.by_hand');
  if (template.schedule.paused) return t('templates.editor.lead.paused');
  return tn('templates.editor.lead.scheduled', template.run_count);
}

function Heading({ template }: { template: Template | null }) {
  return (
    <div className="min-w-0">
      <h1 data-screen-heading="" tabIndex={-1} className="scroll-mt-20 font-display text-2xl font-bold tracking-title text-balance break-words text-ink">
        {template?.name ?? t('templates.new')}
      </h1>
      <p className="mt-1 max-w-[65ch] text-ui text-pretty text-muted">{leadOf(template)}</p>
    </div>
  );
}

/** Waits for the types and properties the fields need; the heading stands meanwhile. */
export function TemplateEditor(props: TemplateEditorProps) {
  const types = useWorkItemTypes();
  const properties = useProperties();
  const queries = [types, properties];
  // a failed reload keeps what arrived before, and the draft with it
  const failed = queries.find((query) => query.isError && !query.data);
  if (types.data && properties.data) return <EditorBody {...props} types={types.data.items} properties={properties.data.items} />;
  return (
    <div className="min-w-0">
      <Heading template={props.template} />
      <div className="mt-5">
        {failed ? (
          <div role="alert" className="flex flex-wrap items-center gap-2 rounded-ctl bg-danger-soft px-3 py-2 text-ui text-ink">
            <p className="min-w-0 flex-1 text-pretty">{t('items.create.load_failed', { message: failed.error!.message })}</p>
            <Button variant="secondary" size="sm" icon={RotateCw} onClick={() => queries.forEach((query) => void query.refetch())}>
              {t('common.retry')}
            </Button>
          </div>
        ) : (
          <SkeletonGroup label={t('items.create.loading')} className="flex flex-col gap-4">
            <div className="grid gap-4 md:grid-cols-2">
              <Skeleton className="h-9 rounded-ctl" />
              <Skeleton className="h-9 rounded-ctl" />
            </div>
            <Skeleton className="h-9 rounded-ctl" />
            <Skeleton className="h-28 rounded-ctl" />
          </SkeletonGroup>
        )}
      </div>
    </div>
  );
}

type EditorBodyProps = TemplateEditorProps & { types: readonly WorkItemType[]; properties: readonly Property[] };

/** The paths of the fields this editor shows a refusal at (besides the values of the type's properties and the schedule). */
const FIELD_PATHS = new Set([
  'name',
  'payload.type_id',
  'payload.title',
  'payload.description',
  'payload.description_json',
  'payload.priority',
  'payload.assignee_id',
  'payload.label_ids',
  'payload.start_offset_days',
  'payload.due_offset_days',
]);
const isSchedulePath = (path: string) => path === 'schedule' || path.startsWith('schedule.');

function EditorBody({ project, template, denied, ready = true, types, properties }: EditorBodyProps) {
  const isNew = template === null;
  const canManage = denied === null;
  const formId = useId();
  const form = useRef<HTMLFormElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  const editorRef = useRef<Editor | null>(null);
  const bypass = useRef(false);
  const save = useSaveTemplate();
  const run = useRunTemplateNow();
  const deleteTemplate = useDeleteTemplate();
  const settle = useSettle();
  const times = useTemplateTimes();
  const uploads = useUploadCounter();
  const uploading = useUploadsPending(uploads) > 0;
  const fieldId = (path: string) => `${formId}-${path}`;

  const [draft, setDraft] = useState<Draft>(() => (template && handedOver.get(template.id)) || draftOf(template, project));
  const latest = useRef(draft);
  const [baseline, setBaseline] = useState(() => snapshot(draftOf(template, project), types));
  // taken over once: a later editor of the template starts from what is stored
  useEffect(() => {
    if (template) handedOver.delete(template.id);
  }, [template]);
  const [errors, setErrors] = useState<Errors>({});
  const [blocked, setBlocked] = useState<string | null>(null);
  /** Typed texts the fields cannot read, by path: nothing is saved while there is one. */
  const [unreadable, setUnreadable] = useState<Record<string, string>>({});
  const [attempted, setAttempted] = useState(false);
  const [focusError, setFocusError] = useState(0);
  const scheduled = useRef(false);
  const sending = useRef(false);
  const running = useRef(false);
  const dirty = canManage && snapshot(draft, types) !== baseline;
  const runReason = denied ?? (dirty ? t('templates.editor.run_save_first') : null);

  // what a press later reads: the render of the moment it runs, not of the one that scheduled it
  const live = useRef({ canManage, uploading, unreadable, runReason, dirty });
  useLayoutEffect(() => {
    live.current = { canManage, uploading, unreadable, runReason, dirty };
  });

  // a newer stored template (saved here, or by someone else) is taken over while nothing is typed
  const adopted = useRef(template?.updated_at ?? null);
  useEffect(() => {
    if (!template || template.updated_at === adopted.current || snapshot(latest.current, types) !== baseline) return;
    adopted.current = template.updated_at;
    const next = draftOf(template, project);
    latest.current = next;
    setDraft(next);
    setBaseline(snapshot(next, types));
  }, [template, baseline, types, project]);

  // a new template starts with its name
  useEffect(() => {
    if (isNew) nameRef.current?.focus();
  }, [isNew]);

  // after a refusal the focus goes to the first field that names a problem
  useEffect(() => {
    if (focusError > 0) form.current?.querySelector<HTMLElement>('[aria-invalid="true"], [data-refused]')?.focus();
  }, [focusError]);

  function change(next: Draft) {
    latest.current = next;
    setDraft(next);
    setBlocked(null);
  }
  const clearError = (...paths: string[]) =>
    setErrors((current) => (paths.some((path) => path in current) ? Object.fromEntries(Object.entries(current).filter(([path]) => !paths.includes(path))) : current));
  const fieldsOf = (typeId: string) => propertiesOf(types.find((type) => type.id === typeId), properties);

  function changePayload(patch: Partial<Draft['payload']>, ...cleared: string[]) {
    change({ ...latest.current, payload: { ...latest.current.payload, ...patch } });
    clearError(...cleared);
  }

  /** A field shows a text it cannot read (a message), or none any more (null). */
  function reportUnreadable(path: string, message: string | null) {
    setUnreadable(({ [path]: _old, ...others }) => (message ? { ...others, [path]: message } : others));
    // something new was typed: an old refusal of the server no longer applies
    clearError(path);
    if (!message) setBlocked(null);
  }

  /** Another schedule: the refusals of what changed in it (and of the whole) no longer apply. */
  function changeSchedule(schedule: Schedule | null) {
    const before: Partial<Record<string, unknown>> = { ...latest.current.schedule };
    const after: Partial<Record<string, unknown>> = { ...schedule };
    const changed = [...new Set([...Object.keys(before), ...Object.keys(after)])].filter((key) => JSON.stringify(before[key]) !== JSON.stringify(after[key]));
    change({ ...latest.current, schedule });
    clearError('schedule', ...changed.map((key) => `schedule.${key}`));
  }

  function changeType(typeId: string) {
    const keep = new Set(fieldsOf(typeId).map(({ property }) => property.key));
    const values = Object.fromEntries(Object.entries(latest.current.payload.values).filter(([key]) => keep.has(key)));
    changePayload({ type_id: typeId, values });
    // refusals of the type, the parent and of properties the new type lacks are about the old one
    setErrors((current) => Object.fromEntries(Object.entries(current).filter(([path]) => path !== 'payload.type_id' && path !== 'payload.parent_id' && (!path.startsWith('payload.values.') || keep.has(path.slice(15))))));
  }

  /* ------------------------------------------------------------------------ saving */

  function requestSave() {
    if (!live.current.canManage || scheduled.current || sending.current) return;
    scheduled.current = true;
    // a tick later: a field that takes its value on Enter has reported it by then
    setTimeout(() => {
      scheduled.current = false;
      saveNow();
    }, 0);
  }

  function saveNow() {
    if (sending.current) return;
    const current = latest.current;
    if (live.current.uploading) {
      setBlocked(t('editor.upload.pending'));
      return;
    }
    setAttempted(true);
    // a text a field cannot read is no value: nothing is sent, the fix is at the field
    const typed = [
      'payload.start_offset_days',
      'payload.due_offset_days',
      ...fieldsOf(current.payload.type_id).map(({ property }) => `payload.values.${property.key}`),
      ...(current.schedule ? ['schedule.interval', 'schedule.time', 'schedule.ends'] : []),
    ];
    const stuck = typed.find((path) => live.current.unreadable[path]);
    if (stuck) {
      setBlocked(t('items.create.blocked'));
      document.getElementById(fieldId(stuck))?.focus();
      return;
    }
    // nothing changed: nothing to send (T16-M3); a new template still says what it lacks
    if (!isNew && !live.current.dirty) {
      toast({ title: t('templates.editor.unchanged'), tone: 'neutral' });
      return;
    }
    const own: Errors = {};
    if (current.name.trim() === '') own.name = t('templates.editor.name_required');
    if (current.payload.title.trim() === '') own['payload.title'] = t('templates.editor.title_required');
    if (Object.keys(own).length > 0) {
      setErrors(own);
      setFocusError((count) => count + 1);
      return;
    }
    setBlocked(null);
    setErrors({});
    sending.current = true;
    settle(save.mutateAsync({ id: template?.id, project_id: project.id, ...toInput(current, types) }), {
      onSuccess: (saved) => {
        setBaseline(snapshot(current, types));
        // typed while it was being created: the editor at the new address goes on with it (T16-I1)
        if (isNew && snapshot(latest.current, types) !== snapshot(current, types)) handedOver.set(saved.id, latest.current);
        const next = saved.schedule && !saved.schedule.paused ? (saved.next_run_at ? t('templates.editor.next_run', { when: times.short(saved.next_run_at) }) : t('templates.editor.next_none')) : undefined;
        toast({ title: t(isNew ? 'templates.editor.created' : 'templates.editor.saved', { name: saved.name }), description: next, tone: 'success' });
        if (isNew) {
          // the editor of the new template takes over at its own address, and its heading takes the focus
          bypass.current = true;
          router.visit(paths.templates(project.identifier, saved.id), { replace: true });
          focusWhenLost(() => document.querySelector<HTMLElement>('[data-screen-heading]'), 800);
        }
      },
      onError: (error) => {
        if (error instanceof ApiError && error.errors) {
          setErrors(Object.fromEntries(Object.entries(error.errors).map(([path, messages]) => [path, messages[0]!])));
          setFocusError((count) => count + 1);
        } else if (error instanceof ApiError && error.status < 500) {
          setErrors({ form: error.message });
        } else {
          notifyError(t(isNew ? 'templates.editor.not_created' : 'templates.editor.not_saved'), error, requestSave);
        }
      },
      onSettled: () => {
        sending.current = false;
      },
    });
  }

  // with an item open in the preview, mod+enter outside this form is the preview's (T16-M2, like wiki.delete, A324)
  useShortcut('template.save', () => requestSave(), {
    when: () => canManage && (useUiStore.getState().peekItemId === null || (form.current?.contains(document.activeElement) ?? false)),
  });

  /* ----------------------------------------------------------------------- running */

  function runNow() {
    if (!template || live.current.runReason !== null || running.current) return;
    running.current = true;
    run
      .mutateAsync(template.id)
      .then(
        ({ run: done, item }) => {
          if (item) {
            toast({
              title: t('items.create.created', { key: item.key }),
              description: item.title,
              tone: 'success',
              action: { label: t('items.create.open'), onClick: () => useUiStore.getState().openPeek(item.id) },
            });
          } else {
            toast({ title: t('templates.editor.run_failed'), description: t('templates.editor.run_failed_description', { error: done.error ?? t('templates.runs.unknown_error') }), tone: 'error' });
          }
        },
        (error: unknown) => notifyError(t('templates.editor.run_not_run', { name: template.name }), error, runNow),
      )
      .finally(() => {
        running.current = false;
      });
  }

  /* ---------------------------------------------------------------------- deleting */

  function remove() {
    if (!template || !live.current.canManage) return;
    const { id, name } = template;
    const list = paths.templates(project.identifier);
    bypass.current = true;
    hideTemplate(id);
    router.visit(list);
    focusWhenLost(() => document.querySelector<HTMLElement>('[data-screen-heading]'), 800);
    runWithUndo({
      label: t('templates.deleted', { name }),
      failureTitle: t('templates.not_deleted', { name }),
      undo: () => {
        showTemplate(id);
        // still on the list the delete led to: back to the template
        if (window.location.pathname === list) router.visit(paths.templates(project.identifier, id));
      },
      run: async () => {
        try {
          await deleteTemplate.mutateAsync(id);
        } finally {
          showTemplate(id);
        }
      },
    });
  }

  const group = t('templates.editor.command_group', { name: template?.name ?? t('templates.new') });
  useCommand({
    id: 'template.run',
    label: t('templates.editor.command.run'),
    group,
    icon: <Play />,
    keywords: [t('templates.editor.command.run_keywords')],
    run: runNow,
    when: () => !isNew && runReason === null,
  });
  useCommand({
    id: 'template.delete',
    label: t('templates.editor.command.delete'),
    group,
    icon: <Trash2 />,
    keywords: [t('templates.editor.command.delete_keywords')],
    run: remove,
    when: () => !isNew && canManage,
  });

  /* ------------------------------------------------------------------------ render */

  const type = types.find((entry) => entry.id === draft.payload.type_id);
  const fields = fieldsOf(draft.payload.type_id);
  const typeOptions = types.filter((entry) => project.enabled_type_ids.includes(entry.id) && (entry.archived_at === null || entry.id === template?.payload.type_id));
  const shown = (path: string) =>
    FIELD_PATHS.has(path) ||
    isSchedulePath(path) ||
    (path === 'payload.parent_id' && canHaveParent(type)) ||
    fields.some(({ property }) => path === `payload.values.${property.key}`);
  const formError = [errors.form, ...Object.entries(errors).filter(([path]) => path !== 'form' && !shown(path)).map(([, message]) => message)].filter(Boolean).join(' ') || null;
  const scheduleErrors = Object.fromEntries(Object.entries(errors).filter(([path]) => isSchedulePath(path)));

  return (
    <div className="min-w-0">
      {/* below lg the actions take a row of their own, so the name keeps its width; the menu stays beside the name */}
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-3 gap-y-3 lg:grid-cols-[minmax(0,1fr)_auto_auto]">
        <Heading template={template} />
        <div className="col-span-2 flex flex-wrap items-center gap-2 lg:col-span-1">
          {!isNew && (
            <Button variant="secondary" icon={Play} pending={run.isPending} disabledReason={runReason} onClick={runNow}>
              {t('templates.editor.run')}
            </Button>
          )}
          {canManage && (
            <Button variant="primary" icon={Save} shortcut="mod+enter" pending={save.isPending} disabledReason={uploading ? t('editor.upload.pending') : null} onClick={requestSave}>
              {t(isNew ? 'templates.editor.create' : 'templates.editor.save')}
            </Button>
          )}
        </div>
        {canManage && !isNew && (
          <div className="col-start-2 row-start-1 lg:col-start-3">
            <Menu>
              <MenuTrigger render={<IconButton icon={Ellipsis} label={t('templates.editor.more')} tooltip={false} />} />
              <MenuContent align="end" className="w-56">
                <MenuItem icon={Trash2} danger onClick={remove}>
                  {t('templates.editor.delete')}
                </MenuItem>
              </MenuContent>
            </Menu>
          </div>
        )}
      </div>
      {ready && denied && <p className="mt-2 max-w-[65ch] text-sm text-pretty text-muted">{t('templates.editor.read_only', { reason: denied })}</p>}
      {(blocked || formError) && (
        <Banner tone="danger" role="alert" title={blocked ? t('templates.editor.blocked_title') : t('templates.editor.refused')} className="mt-3">
          {blocked ?? formError}
        </Banner>
      )}

      <form
        ref={form}
        id={formId}
        noValidate
        // never a submit of its own (Enter in a single field would reload the page, T16-M8)
        onSubmit={(event) => event.preventDefault()}
        // a field that keeps mod+enter for itself (it refused its text on Enter) still saves, which then says why not
        onKeyDown={(event) => {
          if (event.defaultPrevented && !event.repeat && isModEnter(event)) requestSave();
        }}
        className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start xl:grid-cols-[minmax(0,1fr)_25rem]"
      >
        <TemplateFields
          project={project}
          formId={formId}
          draft={draft}
          types={types}
          properties={properties}
          typeOptions={typeOptions}
          storedTypeId={template?.payload.type_id ?? null}
          runCount={template?.run_count ?? 0}
          errors={errors}
          denied={denied}
          uploads={uploads}
          nameRef={nameRef}
          titleRef={titleRef}
          editorRef={editorRef}
          fieldId={fieldId}
          unreadableOf={(path) => (attempted ? (unreadable[path] ?? null) : null)}
          onName={(name) => {
            change({ ...latest.current, name });
            clearError('name');
          }}
          onPayload={changePayload}
          onValue={(key, value) => changePayload({ values: { ...latest.current.payload.values, [key]: value } }, `payload.values.${key}`)}
          onType={changeType}
          onUnreadable={reportUnreadable}
        />

        <ScheduleEditor
          schedule={draft.schedule}
          onChange={changeSchedule}
          readOnly={!canManage}
          runCount={template?.run_count ?? 0}
          title={draft.payload.title}
          errors={scheduleErrors}
          fieldId={fieldId}
          onUnreadable={reportUnreadable}
          className="lg:sticky lg:top-4 lg:col-start-2 lg:row-span-2 lg:row-start-1"
        />

        {template && <RunLog templateId={template.id} className="min-w-0" />}
      </form>

      {canManage && <LeaveGuard dirty={dirty} what={isNew ? t('templates.leave_new') : t('templates.leave', { name: template.name })} bypass={bypass} />}
    </div>
  );
}
