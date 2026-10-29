/*
 * One template (spec 4.12): the fields of the item it makes, the title's placeholders with a live preview, the schedule
 * with its next five runs, "Jetzt ausführen" and the log of the runs. TemplatesScreen shows it for
 * /projects/:identifier/templates/:templateId; `new` as id makes a new template.
 *
 * - "Speichern" (mod+enter) saves; leaving with unsaved changes asks first.
 * - Property fields report only values that parse (PropertyValueInput), and so do the typed numbers and the time of the
 *   schedule: while a field still shows a text it refuses, nothing is saved and the focus goes there.
 * - A required property of the type without a value is marked: a run would fail with "Pflicht-Property … fehlt".
 * - "Jetzt ausführen" runs the saved template as the scheduler would, as the default bot. The toast leads to the new
 *   item (preview); a failed run says why and lands in the log. With unsaved changes it waits for "Speichern".
 * - Viewers read: the fields are read-only, there is no saving and no running.
 */

import { CornerLeftUp, Ellipsis, Play, Save, Trash2 } from 'lucide-react';
import { useCallback, useContext, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';
import { Link, UNSAFE_DataRouterContext, useBlocker, useNavigate } from 'react-router';
import { ApiError } from '@/api/client';
import { personOption } from '@/components/fields/AssigneePicker';
import { useProjectPeople, useUserMap } from '@/components/fields/itemData';
import { labelOption } from '@/components/fields/LabelsPicker';
import { useProjectItems } from '@/components/fields/ParentPicker';
import { Picker, type PickerOption } from '@/components/fields/Picker';
import { PRIORITY_OPTIONS } from '@/components/fields/PriorityPicker';
import { isEmptyValue, PropertyValueInput } from '@/components/fields/PropertyField';
import { TypeGlyph, typeOption } from '@/components/fields/TypePicker';
import { AlertDialog } from '@/components/ui/AlertDialog';
import { UnassignedAvatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';
import { cx } from '@/components/ui/cx';
import { IconButton } from '@/components/ui/IconButton';
import { Input } from '@/components/ui/Input';
import { Menu, MenuContent, MenuItem, MenuTrigger } from '@/components/ui/Menu';
import { labelClass } from '@/components/ui/styles';
import { toast } from '@/components/ui/toast';
import { renderTitle } from '@/domain/placeholders';
import { nextOccurrences } from '@/domain/recurrence';
import { isEmptyDoc, RichTextEditor, RichTextView } from '@/features/editor/RichTextEditor';
import { UploadOwnerContext } from '@/features/editor/pasteImages';
import { useLabels } from '@/hooks/catalog';
import { useProperties } from '@/hooks/properties';
import { useRunTemplateNow, useSaveTemplate } from '@/hooks/templates';
import { useWorkItem } from '@/hooks/workItems';
import { useWorkItemTypes } from '@/hooks/workItemTypes';
import { now } from '@/lib/clock';
import { useCommand } from '@/lib/commands';
import { notifyError } from '@/lib/errors';
import { isMac } from '@/lib/platform';
import { useShortcut } from '@/lib/shortcuts/useShortcut';
import { useUiStore } from '@/store/ui';
import type { Label, Priority, Project, Property, PropertyValue, RichText, Schedule, Template, TemplatePayload, WorkItemType } from '@/types';
import { useOrgClock, useRunFormats } from './format';
import { readableSchedule, ScheduleEditor } from './ScheduleEditor';
import { RunLog } from './RunLog';

/** The id of the route that makes a new template. */
export const NEW_TEMPLATE = 'new';

/** The placeholders of a title (spec 4.12) with what they stand for. */
const PLACEHOLDERS: { token: string; meaning: string }[] = [
  { token: '{date}', meaning: 'Datum' },
  { token: '{week}', meaning: 'Kalenderwoche' },
  { token: '{month}', meaning: 'Monat als Zahl' },
  { token: '{month_name}', meaning: 'Monatsname' },
  { token: '{quarter}', meaning: 'Quartal' },
  { token: '{year}', meaning: 'Jahr' },
];

const MAX_OFFSET = 365;

/** mod held alone with Enter, as the shortcut registry reads it: ⌘ on a Mac, Strg elsewhere. */
const isModEnter = (event: { key: string; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean }) =>
  event.key === 'Enter' && !event.shiftKey && !event.altKey && (isMac() ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey);

/**
 * When the control that had the focus went away with its screen (a template made, deleted or brought back), the focus
 * would fall back to the document: once the next screen is drawn, its heading takes it, else the main area.
 */
export function focusHeadingWhenLost(): void {
  watchLostFocus(() => document.querySelector<HTMLElement>('[data-screen-heading]'));
}

/**
 * Watches the focus for a moment (the router draws a navigation as a transition, a closing menu gives the focus back to
 * its trigger first, a pending button is disabled and lets go of it): whenever it is lost meanwhile, `target` gets it,
 * once it can take it; the main area does when nothing could by the end.
 */
function watchLostFocus(target: () => HTMLElement | null | undefined, ms = 800): void {
  const until = performance.now() + ms;
  const lost = () => {
    const active = document.activeElement;
    return !active || active === document.body || !active.isConnected || active.id === 'main';
  };
  const look = () => {
    if (lost()) {
      const element = target();
      if (element?.isConnected && !(element instanceof HTMLButtonElement && element.disabled)) element.focus();
      else if (performance.now() >= until) return void document.getElementById('main')?.focus();
    }
    if (performance.now() < until) requestAnimationFrame(look);
  };
  requestAnimationFrame(look);
}

/** The control that started a call: a pending button lets go of the focus and gets it back when the call is over. */
const startedBy = (): HTMLElement | null => (document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : null);

interface Draft {
  name: string;
  payload: TemplatePayload;
  schedule: Schedule | null;
}

type Errors = Record<string, string>;

const snapshot = (draft: Draft) => JSON.stringify(draft);

function draftOf(template: Template | null, project: Project): Draft {
  if (template) return { name: template.name, payload: structuredClone(template.payload), schedule: template.schedule ? structuredClone(template.schedule) : null };
  return {
    name: '',
    payload: {
      type_id: project.default_type_id,
      title: '',
      description: null,
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

/** The properties of a type in their order, with whether each is required. */
function propertiesOf(type: WorkItemType | undefined, properties: Property[]): { property: Property; required: boolean }[] {
  return [...(type?.properties ?? [])]
    .sort((a, b) => a.position - b.position)
    .flatMap((entry) => {
      const property = properties.find((candidate) => candidate.id === entry.property_id);
      return property ? [{ property, required: entry.required }] : [];
    });
}

/* -------------------------------------------------------------------------- leave guard */

/**
 * While `dirty`, leaving the editor inside the app stops at "Änderungen verwerfen?" and closing the tab asks the
 * browser's question. A navigation that is meant (to a template just made, after a delete) sets `bypass` first.
 */
function LeaveGuard({ dirty, what, bypass }: { dirty: boolean; what: string; bypass: RefObject<boolean> }) {
  const inDataRouter = useContext(UNSAFE_DataRouterContext) !== null;
  useEffect(() => {
    if (!dirty) return;
    const ask = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', ask);
    return () => window.removeEventListener('beforeunload', ask);
  }, [dirty]);
  return inDataRouter ? <RouterGuard dirty={dirty} what={what} bypass={bypass} /> : null;
}

function RouterGuard({ dirty, what, bypass }: { dirty: boolean; what: string; bypass: RefObject<boolean> }) {
  const latest = useRef(dirty);
  useLayoutEffect(() => {
    latest.current = dirty;
  });
  const shouldBlock = useCallback(() => latest.current && bypass.current !== true, [bypass]);
  const blocker = useBlocker(shouldBlock);
  return (
    <AlertDialog
      open={blocker.state === 'blocked'}
      onOpenChange={(open) => !open && blocker.reset?.()}
      title="Änderungen verwerfen?"
      description={`${what} sind nicht gespeichert. Gehst du jetzt weiter, sind sie weg.`}
      confirmLabel="Verwerfen"
      cancelLabel="Weiter bearbeiten"
      onConfirm={() => blocker.proceed?.()}
    />
  );
}

/* ---------------------------------------------------------------------------- parts */

/** A field of the form whose control names itself ("Typ: Task"): the label above is for the eye only. */
function FormRow({ label, children, className }: { label: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={cx('flex min-w-0 flex-col', className)}>
      <span aria-hidden="true" className={cx(labelClass, 'mb-1.5')}>
        {label}
      </span>
      {children}
    </div>
  );
}

type OffsetFieldProps = {
  label: string;
  /** The field's name in the form. */
  name: string;
  value: number | null;
  onChange: (value: number | null) => void;
  readOnly: boolean;
};

/** Days after the item is made; empty: no date. Reports only whole numbers from 0 to 365. */
function OffsetField({ label, name, value, onChange, readOnly }: OffsetFieldProps) {
  const [text, setText] = useState(value === null ? '' : String(value));
  const [error, setError] = useState<string | null>(null);
  return (
    <Input
      label={label}
      name={name}
      inputMode="numeric"
      autoComplete="off"
      readOnly={readOnly}
      value={text}
      placeholder={readOnly ? undefined : 'z. B. 2'}
      hint="Tage nach dem Anlegen. Leer: kein Datum."
      error={error}
      onChange={(event) => {
        const next = event.target.value;
        setText(next);
        const trimmed = next.trim();
        if (trimmed === '') {
          setError(null);
          onChange(null);
        } else if (/^\d+$/.test(trimmed) && Number(trimmed) <= MAX_OFFSET) {
          setError(null);
          onChange(Number(trimmed));
        } else {
          setError(`Eine ganze Zahl von 0 bis ${MAX_OFFSET}, oder leer lassen.`);
        }
      }}
      className="max-w-32 tabular-nums read-only:bg-sunken read-only:shadow-none"
    />
  );
}

/* ------------------------------------------------------------------------------ editor */

type TemplateEditorProps = {
  project: Project;
  /** The stored template; null for a new one. */
  template: Template | null;
  /** The path of the template list, e.g. /projects/APP/templates. */
  base: string;
  /** Why the person may not manage templates of the project, or null. */
  denied: string | null;
  onDelete: (template: Template) => void;
};

export function TemplateEditor({ project, template, base, denied, onDelete }: TemplateEditorProps) {
  const navigate = useNavigate();
  const saveTemplate = useSaveTemplate();
  const runTemplate = useRunTemplateNow();
  const types = useWorkItemTypes().data?.items ?? [];
  const properties = useProperties().data?.items ?? [];
  const labels = useLabels().data?.items;
  const people = useProjectPeople(project.id);
  const users = useUserMap();
  const projectItems = useProjectItems(project.id);
  const formats = useRunFormats();
  const { zone, locale } = useOrgClock();
  const formId = useId();
  const form = useRef<HTMLFormElement>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  const bypass = useRef(false);
  const scheduled = useRef(false);

  const isNew = template === null;
  const canManage = denied === null;
  const readOnly = !canManage;

  const [draft, setDraft] = useState<Draft>(() => draftOf(template, project));
  const latest = useRef(draft);
  const [baseline, setBaseline] = useState(() => snapshot(draft));
  const [errors, setErrors] = useState<Errors>({});
  const [blocked, setBlocked] = useState<string | null>(null);
  const dirty = canManage && snapshot(draft) !== baseline;

  function update(change: (draft: Draft) => Draft) {
    const next = change(latest.current);
    latest.current = next;
    setDraft(next);
    setBlocked(null);
  }
  const setPayload = (patch: Partial<TemplatePayload>) => update((current) => ({ ...current, payload: { ...current.payload, ...patch } }));
  const clearError = (...paths: string[]) => setErrors((current) => (paths.some((path) => path in current) ? Object.fromEntries(Object.entries(current).filter(([path]) => !paths.includes(path))) : current));

  const { payload, schedule } = draft;
  const enabledTypes = types.filter((type) => project.enabled_type_ids.includes(type.id) && (type.archived_at === null || type.id === payload.type_id));
  const type = types.find((entry) => entry.id === payload.type_id);
  const typeProperties = propertiesOf(type, properties);

  // the preview of the title: at the next run, or now for a template without one
  const nextRun = schedule && readableSchedule(schedule) ? nextOccurrences(schedule, now(), 1, zone, template?.run_count ?? 0)[0] : undefined;
  const previewAt = nextRun ?? now();

  /* ------------------------------------------------------------------------- actions */

  /** Saves once the fields that commit on Enter or blur have landed; a field that still refuses its text stops it. */
  function requestSave() {
    if (!canManage || scheduled.current || saveTemplate.isPending) return;
    scheduled.current = true;
    setTimeout(() => {
      scheduled.current = false;
      void saveNow();
    }, 0);
  }

  async function saveNow() {
    const invalid = form.current?.querySelector<HTMLElement>('[data-typed] [aria-invalid="true"]');
    if (invalid) {
      setBlocked('Ein Feld enthält noch eine Eingabe, die nicht passt. Korrigiere sie oder leere das Feld.');
      invalid.focus();
      return;
    }
    const current = latest.current;
    const own: Errors = {};
    if (current.name.trim() === '') own.name = 'Gib der Vorlage einen Namen, etwa „Wöchentliche Wartung“.';
    if (current.payload.title.trim() === '') own['payload.title'] = 'Gib dem Item einen Titel. Platzhalter wie {week} sind erlaubt.';
    if (Object.keys(own).length > 0) {
      setErrors(own);
      requestAnimationFrame(() => form.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus());
      return;
    }
    setBlocked(null);
    setErrors({});
    const values = Object.fromEntries(Object.entries(current.payload.values).filter(([, value]) => !isEmptyValue(value)));
    const trigger = startedBy();
    try {
      const saved = await saveTemplate.mutateAsync({
        id: template?.id,
        project_id: project.id,
        name: current.name.trim(),
        payload: { ...current.payload, title: current.payload.title.trim(), description: isEmptyDoc(current.payload.description) ? null : current.payload.description, values },
        schedule: current.schedule,
      });
      setBaseline(snapshot(current));
      toast({ title: `„${saved.name}“ ${isNew ? 'angelegt' : 'gespeichert'}`, description: saved.schedule && !saved.schedule.paused ? `Nächster Lauf: ${saved.next_run_at ? formats.short(saved.next_run_at) : 'keiner geplant'}` : undefined, tone: 'success' });
      if (isNew) {
        bypass.current = true;
        void navigate(`${base}/${saved.id}`, { replace: true });
        // the editor of the new template replaces this one: its heading takes the focus
        focusHeadingWhenLost();
        return;
      }
    } catch (error) {
      if (error instanceof ApiError && error.status === 422 && error.errors) {
        setErrors(Object.fromEntries(Object.entries(error.errors).map(([path, messages]) => [path, messages[0]])));
        requestAnimationFrame(() => form.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus());
        return;
      }
      notifyError(isNew ? 'Vorlage nicht angelegt' : 'Vorlage nicht gespeichert', error, () => void saveNow());
    }
    watchLostFocus(() => trigger);
  }

  async function runNow() {
    if (!template) return;
    const trigger = startedBy();
    try {
      const { run, item } = await runTemplate.mutateAsync(template.id);
      if (item) {
        toast({ title: `${item.key} angelegt`, description: item.title, tone: 'success', action: { label: 'Öffnen', onClick: () => useUiStore.getState().openPeek(item.id) } });
      } else {
        toast({
          title: 'Lauf gescheitert',
          description: `${run.error ?? 'Unbekannter Fehler'}. Das Protokoll hält es fest; Lead und Ersteller der Vorlage sind benachrichtigt.`,
          tone: 'error',
        });
      }
    } catch (error) {
      notifyError(`„${template.name}“ nicht ausgeführt`, error, () => void runNow());
    }
    watchLostFocus(() => trigger);
  }

  function remove() {
    if (!template) return;
    bypass.current = true;
    onDelete(template);
  }

  const runReason = denied ?? (dirty ? 'Erst speichern: Der Lauf nimmt die gespeicherte Fassung der Vorlage.' : null);

  useShortcut({ id: 'template.save', keys: 'mod+enter', scope: 'detail', label: isNew ? 'Vorlage anlegen' : 'Vorlage speichern', group: 'Vorlage', run: requestSave, when: () => canManage });
  const group = `Vorlage „${template?.name ?? 'Neue Vorlage'}“`;
  useCommand({ id: 'template.save', label: isNew ? 'Vorlage anlegen' : 'Vorlage speichern', group, keys: 'mod+enter', icon: <Save />, run: requestSave, when: () => canManage });
  useCommand({ id: 'template.run', label: 'Vorlage jetzt ausführen', group, icon: <Play />, keywords: ['ausführen', 'lauf', 'anlegen'], run: () => void runNow(), when: () => !isNew && runReason === null });
  useCommand({ id: 'template.delete', label: 'Vorlage löschen', group, icon: <Trash2 />, keywords: ['entfernen'], run: remove, when: () => !isNew && canManage });

  /* --------------------------------------------------------------------------- fields */

  // the name shows at once from all accounts; the project's people only fill the list
  const assignee = payload.assignee_id ? (people.people?.find((user) => user.id === payload.assignee_id) ?? users.get(payload.assignee_id)) : undefined;
  const sortedLabels = [...(labels ?? [])].sort((a: Label, b: Label) => a.name.localeCompare(b.name, 'de-DE'));
  const chosenLabels = sortedLabels.filter((label) => payload.label_ids.includes(label.id));
  const items = projectItems.data?.items ?? [];
  const listedParent = items.find((entry) => entry.id === payload.parent_id);
  // the parent shows before the project's items have loaded
  const parentDetail = useWorkItem(payload.parent_id && !listedParent ? payload.parent_id : null);
  const parent = listedParent ?? parentDetail.data?.item;
  const priority = PRIORITY_OPTIONS.find((option) => option.value === payload.priority);
  const parentOptions: PickerOption[] = [
    { value: '', label: 'Kein Eltern-Item', icon: <CornerLeftUp className="size-4 text-muted" /> },
    ...[...items]
      .sort((a, b) => b.number - a.number)
      .map((entry) => {
        const itemType = types.find((candidate) => candidate.id === entry.type_id);
        return { value: entry.id, label: entry.title, hint: entry.key, keywords: [entry.key], icon: itemType ? <TypeGlyph type={itemType} /> : undefined };
      }),
  ];
  const owner = useMemo(() => (template ? { type: 'template' as const, id: template.id } : null), [template]);

  function insertPlaceholder(token: string) {
    const input = titleRef.current;
    const text = latest.current.payload.title;
    const start = input?.selectionStart ?? text.length;
    const end = input?.selectionEnd ?? start;
    setPayload({ title: `${text.slice(0, start)}${token}${text.slice(end)}` });
    clearError('payload.title');
    requestAnimationFrame(() => {
      input?.focus();
      input?.setSelectionRange(start + token.length, start + token.length);
    });
  }

  return (
    <div className="min-w-0">
      {/* below lg the actions take a row of their own, so the name keeps its width; the menu stays beside the name */}
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-3 gap-y-3 lg:grid-cols-[minmax(0,1fr)_auto_auto]">
        <div className="min-w-0">
          <h1 data-screen-heading="" tabIndex={-1} className="scroll-mt-20 font-display text-2xl font-bold tracking-title text-balance break-words text-ink">{template?.name ?? 'Neue Vorlage'}</h1>
          <p className="mt-1 max-w-[65ch] text-ui text-pretty text-muted">
            {isNew
              ? 'Eine Vorlage legt Items mit festen Feldern an, von Hand oder nach Zeitplan.'
              : template.schedule
                ? template.schedule.paused
                  ? 'Der Zeitplan ist pausiert. Von Hand lässt sich die Vorlage weiter anwenden.'
                  : `Legt nach Zeitplan Items an, als Bot „Automation“. ${template.run_count === 1 ? 'Ein Lauf' : `${template.run_count} Läufe`} bisher.`
                : 'Ohne Zeitplan: Die Vorlage wird von Hand angewendet.'}
          </p>
        </div>
        <div className="col-span-2 flex flex-wrap items-center gap-2 lg:col-span-1">
          {!isNew && (
            <Button variant="secondary" icon={Play} pending={runTemplate.isPending} disabledReason={runReason} onClick={() => void runNow()}>
              Jetzt ausführen
            </Button>
          )}
          {canManage && (
            <Button variant="primary" icon={Save} shortcut="mod+enter" pending={saveTemplate.isPending} onClick={requestSave}>
              {isNew ? 'Anlegen' : 'Speichern'}
            </Button>
          )}
        </div>
        {canManage && !isNew && (
          <div className="col-start-2 row-start-1 lg:col-start-3">
            <Menu>
              <MenuTrigger render={<IconButton icon={Ellipsis} label="Weitere Aktionen" tooltip={false} />} />
              <MenuContent align="end" className="w-56">
                <MenuItem icon={Trash2} danger onClick={remove}>
                  Löschen
                </MenuItem>
              </MenuContent>
            </Menu>
          </div>
        )}
      </div>
      <div aria-live="polite">{blocked && <p className="mt-3 text-sm font-medium text-pretty text-danger">{blocked}</p>}</div>
      {denied && <p className="mt-2 max-w-[65ch] text-sm text-pretty text-muted">Nur lesen: {denied}</p>}

      <form
        ref={form}
        id={formId}
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          requestSave();
        }}
        // a field that takes mod+enter for itself (it commits its value on Enter, so the shortcut sees a handled key)
        // still saves the template, as in the create dialog
        onKeyDown={(event) => {
          if (event.defaultPrevented && isModEnter(event)) requestSave();
        }}
        className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start xl:grid-cols-[minmax(0,1fr)_25rem]"
      >
        <section aria-labelledby={`${formId}-item`} className="min-w-0 rounded-card border border-line bg-surface px-4 py-4 shadow-elev-1 md:px-5 md:py-5">
          <h2 id={`${formId}-item`} className="scroll-mt-20 font-display text-lg font-bold tracking-title text-ink">
            Inhalt
          </h2>
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <Input
              label="Name"
              name="name"
              autoComplete="off"
              readOnly={readOnly}
              value={draft.name}
              hint="So heißt die Vorlage in Listen und im Anlegen-Dialog."
              error={errors.name}
              onChange={(event) => {
                const name = event.target.value;
                update((current) => ({ ...current, name }));
                clearError('name');
              }}
              className="read-only:bg-sunken read-only:shadow-none"
            />
            <FormRow label="Typ">
              <Picker
                look="form"
                label="Typ"
                display={
                  type ? (
                    <span className="flex min-w-0 items-center gap-2">
                      <TypeGlyph type={type} />
                      <span className="truncate">{type.name}</span>
                    </span>
                  ) : (
                    <span className="truncate text-muted">Typ wählen …</span>
                  )
                }
                displayText={type?.name ?? 'kein Typ'}
                options={enabledTypes.map(typeOption)}
                value={payload.type_id}
                onValueChange={(typeId) => {
                  const keep = new Set(propertiesOf(types.find((entry) => entry.id === typeId), properties).map((entry) => entry.property.key));
                  setPayload({ type_id: typeId, values: Object.fromEntries(Object.entries(latest.current.payload.values).filter(([key]) => keep.has(key))) });
                  clearError('payload.type_id');
                }}
                placeholder="Typ suchen …"
                disabledReason={denied}
                invalid={Boolean(errors['payload.type_id'])}
              />
              {errors['payload.type_id'] && <p className="mt-1.5 text-sm font-medium text-danger">{errors['payload.type_id']}</p>}
            </FormRow>
          </div>

          <div className="mt-4">
            <Input
              ref={titleRef}
              label="Titel"
              name="title"
              autoComplete="off"
              readOnly={readOnly}
              value={payload.title}
              hint="Platzhalter wie {week} füllt jeder Lauf mit seinem Datum."
              error={errors['payload.title']}
              aria-describedby={`${formId}-preview`}
              onChange={(event) => {
                setPayload({ title: event.target.value });
                clearError('payload.title');
              }}
              className="read-only:bg-sunken read-only:shadow-none"
            />
            <section aria-label="Vorschau des Titels" className="mt-2 rounded-ctl bg-sunken px-3 py-2.5">
              <p className="text-sm text-muted">{nextRun ? `So heißt das Item beim nächsten Lauf, ${formats.short(nextRun)}:` : 'So heißt das Item, wenn die Vorlage jetzt angewendet wird:'}</p>
              <p id={`${formId}-preview`} className="mt-0.5 font-display text-lg font-bold tracking-title break-words text-ink">
                {renderTitle(payload.title.trim() || 'Ohne Titel', previewAt, locale, zone)}
              </p>
              {!readOnly && (
                <div className="mt-2 flex flex-wrap gap-1.5" role="group" aria-label="Platzhalter einfügen">
                  {PLACEHOLDERS.map(({ token, meaning }) => {
                    const example = renderTitle(token, previewAt, locale, zone);
                    return (
                      <button
                        key={token}
                        type="button"
                        aria-label={`${token} einfügen: ${meaning}, jetzt ${example}`}
                        onClick={() => insertPlaceholder(token)}
                        className="inline-flex min-h-11 cursor-pointer items-center gap-1.5 rounded-chip border border-line bg-surface px-2 text-sm text-ink transition-colors duration-120 hover:border-line-input md:min-h-7"
                      >
                        <span translate="no" className="font-semibold">
                          {token}
                        </span>
                        <span className="text-muted">{example}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </section>
          </div>

          <div className="mt-4 flex flex-col">
            <span id={`${formId}-description`} className={cx(labelClass, 'mb-1.5')}>
              Beschreibung
            </span>
            {readOnly ? (
              payload.description && !isEmptyDoc(payload.description) ? (
                <div className="rounded-ctl border border-line bg-sunken px-3 py-2">
                  <RichTextView value={payload.description} />
                </div>
              ) : (
                <p className="text-ui text-muted">Keine Beschreibung.</p>
              )
            ) : (
              <UploadOwnerContext.Provider value={owner}>
                <RichTextEditor
                  value={payload.description}
                  onChange={(doc) => setPayload({ description: doc })}
                  preset="description"
                  projectId={project.id}
                  placeholder="Beschreibung des Items … / für Überschrift, Liste, Checkliste"
                  aria-labelledby={`${formId}-description`}
                />
              </UploadOwnerContext.Provider>
            )}
          </div>

          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <FormRow label="Priorität">
              <Picker
                look="form"
                label="Priorität"
                display={
                  <>
                    {priority?.icon}
                    <span className="truncate">{priority?.label}</span>
                  </>
                }
                displayText={priority?.label ?? ''}
                options={PRIORITY_OPTIONS}
                value={payload.priority}
                onValueChange={(next) => setPayload({ priority: next as Priority })}
                placeholder="Priorität suchen …"
                disabledReason={denied}
              />
            </FormRow>
            <FormRow label="Assignee">
              <Picker
                look="form"
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
                options={[{ value: '', label: 'Nicht zugewiesen', icon: <UnassignedAvatar /> }, ...(people.people ?? []).map(personOption)]}
                value={payload.assignee_id ?? ''}
                onValueChange={(next) => {
                  setPayload({ assignee_id: next || null });
                  clearError('payload.assignee_id');
                }}
                placeholder="Person suchen …"
                load={{ isLoading: people.isLoading, error: people.error, retry: people.retry, retrying: people.retrying }}
                disabledReason={denied}
              />
            </FormRow>
            <FormRow label="Labels">
              <Picker
                look="form"
                multiple
                label="Labels"
                display={
                  chosenLabels.length > 0 ? (
                    <span className="flex min-w-0 flex-wrap items-center gap-1">
                      {chosenLabels.map((label) => (
                        <Chip key={label.id} dot={label.color} className="h-5 bg-transparent">
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
                value={payload.label_ids}
                onValueChange={(next) => setPayload({ label_ids: next })}
                placeholder="Label suchen …"
                disabledReason={denied}
              />
            </FormRow>
            <FormRow label="Eltern-Item">
              <Picker
                look="form"
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
                value={payload.parent_id ?? ''}
                onValueChange={(next) => setPayload({ parent_id: next || null })}
                placeholder="Key oder Titel suchen …"
                load={{ isLoading: projectItems.isPending, error: projectItems.error, retry: () => void projectItems.refetch(), retrying: projectItems.isFetching }}
                disabledReason={denied}
              />
            </FormRow>
            <div data-typed="" className="contents">
              <OffsetField label="Start-Date" name="start_offset_days" value={payload.start_offset_days} readOnly={readOnly} onChange={(start_offset_days) => setPayload({ start_offset_days })} />
              <OffsetField label="Due-Date" name="due_offset_days" value={payload.due_offset_days} readOnly={readOnly} onChange={(due_offset_days) => setPayload({ due_offset_days })} />
            </div>
          </div>

          {typeProperties.length > 0 && (
            <div className="mt-5 border-t border-line pt-4">
              <h3 className="font-display text-md font-bold tracking-title text-ink">Felder des Typs {type?.name}</h3>
              <div className="mt-3 grid gap-4 md:grid-cols-2">
                {typeProperties.map(({ property, required }) => (
                  <TemplateProperty
                    key={property.id}
                    property={property}
                    required={required}
                    value={payload.values[property.key]}
                    projectId={project.id}
                    denied={denied}
                    onChange={(value) => setPayload({ values: { ...latest.current.payload.values, [property.key]: value } })}
                  />
                ))}
              </div>
            </div>
          )}
        </section>

        <ScheduleEditor
          schedule={schedule}
          onChange={(next) => {
            update((current) => ({ ...current, schedule: next }));
            clearError('schedule');
          }}
          readOnly={readOnly}
          title={payload.title}
          runCount={template?.run_count ?? 0}
          error={errors.schedule}
          className="lg:sticky lg:top-4 lg:col-start-2 lg:row-span-2 lg:row-start-1"
        />

        {template && <RunLog templateId={template.id} className="min-w-0" />}
      </form>

      {canManage && <LeaveGuard dirty={dirty} what={isNew ? 'Die Angaben der neuen Vorlage' : `Die Änderungen an „${template.name}“`} bypass={bypass} />}
      {!canManage && (
        <p className="mt-4 text-sm text-muted">
          <Link to={base} className="inline-flex min-h-11 items-center text-accent-text underline-offset-2 hover:underline md:min-h-0">
            Zu allen Vorlagen
          </Link>
        </p>
      )}
    </div>
  );
}

type TemplatePropertyProps = {
  property: Property;
  required: boolean;
  value: PropertyValue | undefined;
  projectId: string;
  denied: string | null;
  onChange: (value: PropertyValue) => void;
};

/** A property of the items: the shared editors, the rich text editor for rich text. */
function TemplateProperty({ property, required, value, projectId, denied, onChange }: TemplatePropertyProps) {
  const labelId = useId();
  const missing = required && isEmptyValue(value);
  const hint = missing ? 'Pflichtfeld: Ohne Wert scheitert der Lauf.' : undefined;
  if (property.field_type === 'rich_text') {
    return (
      <div className="flex flex-col md:col-span-2">
        <p id={labelId} className={cx(labelClass, 'mb-1.5')}>
          {property.label}
          {required && <span className="ml-1.5 font-normal text-muted">Pflicht</span>}
        </p>
        {denied ? (
          value && !isEmptyDoc(value as RichText) ? (
            <div className="rounded-ctl border border-line bg-sunken px-3 py-2">
              <RichTextView value={value as RichText} />
            </div>
          ) : (
            <p className="text-ui text-muted">Kein Wert.</p>
          )
        ) : (
          <RichTextEditor
            value={(value ?? null) as RichText | null}
            onChange={onChange}
            preset="description"
            projectId={projectId}
            placeholder={property.help || `${property.label} …`}
            aria-labelledby={labelId}
          />
        )}
        {hint && <p className="mt-1.5 text-sm text-muted">{hint}</p>}
      </div>
    );
  }
  return (
    <div data-typed="" data-property={property.key} className="min-w-0">
      <PropertyValueInput property={property} value={value} onChange={onChange} projectId={projectId} required={required} hint={hint} disabledReason={denied} />
    </div>
  );
}
