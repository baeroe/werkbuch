/*
 * The fields of a template (spec 4.12), ported from the clickdummy's editor: its name, then what its items get: the
 * type, the title with its placeholders (`TitleField`), the description, priority, assignee, labels, the parent (an
 * epic of the project, not for an epic itself), start and due as days after the item is made, and the properties of
 * the type (`TemplateProperty`). The editor owns the draft; every field reports its change and takes the server's
 * refusal at its path (`payload.title`, `payload.values.<key>`, …).
 *
 * - The type offers the active types the project has; a stored one that was archived since stays, with a hint (runs
 *   fail until another is chosen).
 * - The description is written in the editor of the project (`/`, `@`, `#`, pictures and files), in an upload context
 *   of its own: "Speichern" waits for its uploads (13c). An upload belongs to nobody until the template is saved (A232).
 * - The offsets take whole days from 0 to `MAX_OFFSET`; a text that is none says so and keeps the template from saving.
 * - Whoever may not manage templates reads every field.
 */

import type { Editor } from '@tiptap/react';
import { useEffect, useId, useState, type ReactNode, type RefObject } from 'react';
import type { TemplatePayloadInput } from '@/api/templates';
import { personOption } from '@/components/fields/AssigneePicker';
import { useProjectPeople, useUserMap } from '@/components/fields/itemData';
import { labelOption } from '@/components/fields/LabelsPicker';
import { noParentText, NO_PARENT_OPTION, parentCandidates, parentOption, useProjectItems } from '@/components/fields/ParentPicker';
import { Picker, type PickerOption } from '@/components/fields/Picker';
import { PRIORITY_OPTIONS } from '@/components/fields/PriorityPicker';
import { TypeGlyph } from '@/components/fields/TypeGlyph';
import { typeOption } from '@/components/fields/TypePicker';
import { UnassignedAvatar } from '@/components/ui/Avatar';
import { Chip } from '@/components/ui/Chip';
import { cx } from '@/components/ui/cx';
import { Input } from '@/components/ui/Input';
import { labelClass } from '@/components/ui/styles';
import { canHaveParent } from '@/domain/hierarchy';
import { isEmptyDoc, RichTextEditor } from '@/editor/RichTextEditor';
import { RichTextView } from '@/editor/RichTextView';
import { UploadContext, type UploadCounter } from '@/editor/UploadContext';
import { useLabels } from '@/hooks/catalog';
import { useWorkItem } from '@/hooks/workItems';
import { intlLocale, t } from '@/lib/i18n';
import type { Priority, Project, Property, PropertyValue, Schedule, WorkItemType } from '@/types';
import { TemplateProperty } from './TemplateProperty';
import { TitleField } from './TitleField';

/** The days after the item is made an offset may name (`TemplateInput`, 0–3650). */
export const MAX_OFFSET = 3650;

/** What the editor holds of a template: what it sends. */
export interface Draft {
  name: string;
  payload: TemplatePayloadInput;
  schedule: Schedule | null;
}

/** Refusals by the paths of the API (`name`, `payload.title`, `schedule.time` …), the first message each. */
export type Errors = Record<string, string>;

export interface PropertyEntry {
  property: Property;
  required: boolean;
}

/** The properties of a type in its order, with whether each is required. */
export function propertiesOf(type: WorkItemType | undefined, properties: readonly Property[]): PropertyEntry[] {
  return [...(type?.properties ?? [])]
    .sort((a, b) => a.position - b.position)
    .flatMap((entry) => {
      const property = properties.find((candidate) => candidate.id === entry.property_id);
      return property ? [{ property, required: entry.required }] : [];
    });
}

/** A field whose control names itself ("Typ: Task"): the label above is for the eye only; the hint or refusal below. */
function FormRow({ label, note, noteId, danger, children, className }: { label: string; note?: string; noteId: string; danger?: boolean; children: ReactNode; className?: string }) {
  return (
    <div className={cx('flex min-w-0 flex-col', className)}>
      <span aria-hidden="true" className={cx(labelClass, 'mb-1.5')}>
        {label}
      </span>
      {children}
      <div aria-live="polite">
        {note && (
          <p id={noteId} className={cx('mt-1.5 text-sm text-pretty', danger ? 'font-medium text-danger' : 'text-muted')}>
            {note}
          </p>
        )}
      </div>
    </div>
  );
}

type OffsetFieldProps = {
  id: string;
  label: string;
  value: number | null;
  error?: string;
  readOnly: boolean;
  onChange: (value: number | null) => void;
  onUnreadable: (message: string | null) => void;
};

/** Days after the item is made; empty: no date. Reports only whole numbers from 0 to `MAX_OFFSET`. */
function OffsetField({ id, label, value, error, readOnly, onChange, onUnreadable }: OffsetFieldProps) {
  const [text, setText] = useState(value === null ? '' : String(value));
  const [own, setOwn] = useState<string | null>(null);
  // a value from outside (the saved template) shows, unless the text already reads as it
  useEffect(() => {
    setText((current) => (current.trim() === (value === null ? '' : String(value)) ? current : value === null ? '' : String(value)));
  }, [value]);
  return (
    <Input
      id={id}
      label={label}
      name={id}
      inputMode="numeric"
      autoComplete="off"
      readOnly={readOnly}
      value={text}
      placeholder={readOnly ? undefined : t('templates.editor.offset_placeholder')}
      hint={t('templates.editor.offset_hint')}
      error={own ?? error}
      onChange={(event) => {
        const next = event.target.value;
        setText(next);
        const trimmed = next.trim();
        if (trimmed === '' || (/^\d+$/.test(trimmed) && Number(trimmed) <= MAX_OFFSET)) {
          setOwn(null);
          onUnreadable(null);
          onChange(trimmed === '' ? null : Number(trimmed));
        } else {
          const message = t('templates.editor.offset_invalid', { max: MAX_OFFSET });
          setOwn(message);
          onUnreadable(message);
        }
      }}
      className="max-w-32 tabular-nums read-only:bg-sunken read-only:shadow-none"
    />
  );
}

type TemplateFieldsProps = {
  project: Project;
  formId: string;
  draft: Draft;
  types: readonly WorkItemType[];
  properties: readonly Property[];
  /** The types the template may take: the active ones of the project, and the stored one. */
  typeOptions: readonly WorkItemType[];
  /** The type stored with the template, which may stay even when it was archived since. */
  storedTypeId: string | null;
  /** The runs the template has had. */
  runCount: number;
  errors: Errors;
  /** Why the person may not change the template, or null. */
  denied: string | null;
  uploads: UploadCounter;
  nameRef: RefObject<HTMLInputElement | null>;
  titleRef: RefObject<HTMLInputElement | null>;
  editorRef: RefObject<Editor | null>;
  /** The id of the control of a field by its path (`payload.values.effort`, `payload.start_offset_days`). */
  fieldId: (path: string) => string;
  /** The text a property cannot read, by its path, once saving was tried. */
  unreadableOf: (path: string) => string | null;
  onName: (name: string) => void;
  /** Changes the payload and takes the refusals at `cleared` away. */
  onPayload: (patch: Partial<TemplatePayloadInput>, ...cleared: string[]) => void;
  onValue: (key: string, value: PropertyValue) => void;
  onType: (typeId: string) => void;
  /** A field shows a text it cannot read (a message), or none any more (null). */
  onUnreadable: (path: string, message: string | null) => void;
};

export function TemplateFields(props: TemplateFieldsProps) {
  const { project, formId, draft, types, properties, typeOptions, storedTypeId, runCount, errors, denied, uploads, nameRef, titleRef, editorRef, fieldId, unreadableOf, onPayload } = props;
  const readOnly = denied !== null;
  const { payload } = draft;
  const ids = useId();
  const noteId = (path: string) => `${ids}-${path}`;
  const people = useProjectPeople(project.id);
  const users = useUserMap();
  const labels = useLabels();
  // the epics of the project only while the parent list is open (A153); the one set shows from its detail
  const [parentOpen, setParentOpen] = useState(false);
  const projectItems = useProjectItems(project.id, parentOpen);
  const items = projectItems.data?.items ?? [];
  const listed = items.find((entry) => entry.id === payload.parent_id);
  const parentDetail = useWorkItem(payload.parent_id, { enabled: !listed }).data?.item;
  const parent = listed ?? (parentDetail?.id === payload.parent_id ? parentDetail : undefined);

  const type = types.find((entry) => entry.id === payload.type_id);
  const typeOf = (typeId: string) => types.find((entry) => entry.id === typeId);
  const candidates = parentCandidates({ id: null, project_id: project.id }, items, typeOf);
  const parentOptions: PickerOption[] = [...(payload.parent_id ? [NO_PARENT_OPTION()] : []), ...candidates.map((candidate) => parentOption(candidate, typeOf(candidate.type_id)))];
  const priority = PRIORITY_OPTIONS().find((option) => option.value === payload.priority) ?? PRIORITY_OPTIONS()[0];
  // the name shows at once from all accounts, also of one no longer in the project (A356); the project's people fill the list
  const assignee = payload.assignee_id ? (people.people?.find((user) => user.id === payload.assignee_id) ?? users.get(payload.assignee_id)) : undefined;
  const nobody = t('items.fields.assignee.nobody');
  const collator = new Intl.Collator(intlLocale());
  const sortedLabels = [...(labels.data?.items ?? [])].sort((a, b) => collator.compare(a.name, b.name));
  const chosenLabels = sortedLabels.filter((label) => payload.label_ids.includes(label.id));
  const fields = propertiesOf(type, properties);
  const archivedType = type !== undefined && type.archived_at !== null && type.id === storedTypeId;

  const typeNote = errors['payload.type_id'] ?? (archivedType ? t('templates.editor.type_archived') : undefined);
  const describe = (path: string, note: string | undefined) => (note ? noteId(path) : undefined);
  const descriptionError = errors['payload.description_json'] ?? errors['payload.description'];

  return (
    <section aria-labelledby={`${formId}-content`} className="min-w-0 rounded-card border border-line bg-surface px-4 py-4 shadow-elev-1 md:px-5 md:py-5">
      <h2 id={`${formId}-content`} className="scroll-mt-20 font-display text-lg font-bold tracking-title text-ink">
        {t('templates.editor.content')}
      </h2>
      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <Input
          ref={nameRef}
          label={t('templates.editor.name')}
          name="name"
          autoComplete="off"
          readOnly={readOnly}
          value={draft.name}
          hint={t('templates.editor.name_hint')}
          error={errors.name}
          onChange={(event) => props.onName(event.target.value)}
          className="read-only:bg-sunken read-only:shadow-none"
        />
        <FormRow label={t('items.fields.type.label')} note={typeNote} noteId={noteId('type')} danger={errors['payload.type_id'] !== undefined}>
          <Picker
            look="form"
            label={t('items.fields.type.label')}
            display={
              type ? (
                <span className="flex min-w-0 items-center gap-2">
                  <TypeGlyph type={type} />
                  <span className="truncate">{type.name}</span>
                </span>
              ) : (
                <span className="truncate text-muted">{t('templates.editor.type_choose')}</span>
              )
            }
            displayText={type?.name ?? t('templates.editor.type_none')}
            options={typeOptions.map(typeOption)}
            value={payload.type_id}
            onValueChange={props.onType}
            placeholder={t('items.fields.type.placeholder')}
            disabledReason={denied}
            invalid={errors['payload.type_id'] !== undefined}
            describedBy={describe('type', typeNote)}
          />
        </FormRow>
      </div>

      <div className="mt-4">
        <TitleField
          value={payload.title}
          onChange={(title) => onPayload({ title }, 'payload.title')}
          schedule={draft.schedule}
          runCount={runCount}
          error={errors['payload.title']}
          readOnly={readOnly}
          inputRef={titleRef}
        />
      </div>

      <div className="mt-4 flex flex-col">
        <p aria-hidden="true" className={cx(labelClass, 'mb-1.5')}>
          {t('editor.label.description')}
        </p>
        {readOnly ? (
          payload.description_json && !isEmptyDoc(payload.description_json) ? (
            <div className="rounded-ctl border border-line bg-sunken px-3 py-2">
              <RichTextView value={payload.description_json} preset="description" />
            </div>
          ) : (
            <p className="text-ui text-muted">{t('templates.editor.no_description')}</p>
          )
        ) : (
          <UploadContext value={uploads}>
            <RichTextEditor
              value={payload.description_json}
              onChange={(description_json) => onPayload({ description_json }, 'payload.description_json', 'payload.description')}
              preset="description"
              projectId={project.id}
              editorRef={editorRef}
              invalid={descriptionError !== undefined}
              describedBy={describe('description', descriptionError)}
            />
          </UploadContext>
        )}
        <div aria-live="polite">
          {descriptionError && (
            <p id={noteId('description')} className="mt-1.5 text-sm font-medium text-danger">
              {descriptionError}
            </p>
          )}
        </div>
      </div>

      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <FormRow label={t('items.fields.priority.label')} note={errors['payload.priority']} noteId={noteId('priority')} danger>
          <Picker
            look="form"
            label={t('items.fields.priority.label')}
            display={
              <>
                {priority.icon}
                <span className="truncate">{priority.label}</span>
              </>
            }
            displayText={priority.label}
            options={PRIORITY_OPTIONS()}
            value={payload.priority}
            onValueChange={(next) => onPayload({ priority: next as Priority }, 'payload.priority')}
            placeholder={t('items.fields.priority.placeholder')}
            disabledReason={denied}
            invalid={errors['payload.priority'] !== undefined}
            describedBy={describe('priority', errors['payload.priority'])}
          />
        </FormRow>
        <FormRow label={t('items.fields.assignee.label')} note={errors['payload.assignee_id']} noteId={noteId('assignee')} danger>
          <Picker
            look="form"
            label={t('items.fields.assignee.label')}
            display={
              assignee ? (
                <>
                  {personOption(assignee).icon}
                  <span className="truncate">{assignee.name}</span>
                </>
              ) : (
                <>
                  <UnassignedAvatar />
                  <span className="truncate text-muted">{nobody}</span>
                </>
              )
            }
            displayText={assignee?.name ?? nobody}
            options={[{ value: '', label: nobody, keywords: [t('items.fields.assignee.nobody_keywords')], icon: <UnassignedAvatar /> }, ...(people.people ?? []).map(personOption)]}
            value={payload.assignee_id ?? ''}
            onValueChange={(next) => onPayload({ assignee_id: next || null }, 'payload.assignee_id')}
            placeholder={t('items.fields.assignee.placeholder')}
            emptyText={t('items.fields.assignee.empty')}
            load={{ isLoading: people.isLoading, error: people.error, retry: people.retry, retrying: people.retrying }}
            disabledReason={denied}
            invalid={errors['payload.assignee_id'] !== undefined}
            describedBy={describe('assignee', errors['payload.assignee_id'])}
          />
        </FormRow>
        <FormRow label={t('items.fields.labels.label')} note={errors['payload.label_ids']} noteId={noteId('labels')} danger>
          <Picker
            look="form"
            multiple
            label={t('items.fields.labels.label')}
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
                <span className="truncate text-muted">{t('items.fields.labels.none')}</span>
              )
            }
            displayText={chosenLabels.map((label) => label.name).join(', ') || t('items.fields.labels.none_text')}
            options={sortedLabels.map(labelOption)}
            value={payload.label_ids}
            onValueChange={(next) => onPayload({ label_ids: next }, 'payload.label_ids')}
            placeholder={t('items.fields.labels.placeholder')}
            emptyText={t('items.fields.labels.empty')}
            load={{ isLoading: labels.isPending, error: labels.error, retry: () => void labels.refetch(), retrying: labels.isFetching }}
            disabledReason={denied}
            invalid={errors['payload.label_ids'] !== undefined}
            describedBy={describe('labels', errors['payload.label_ids'])}
          />
        </FormRow>
        {canHaveParent(type) && (
          <FormRow label={t('items.fields.parent.label')} note={errors['payload.parent_id']} noteId={noteId('parent')} danger>
            <Picker
              look="form"
              label={t('items.fields.parent.label')}
              display={
                parent ? (
                  <span className="flex min-w-0 items-center gap-1.5">
                    <span className="shrink-0 font-semibold text-muted tabular-nums">{parent.key}</span>
                    <span className="truncate">{parent.title}</span>
                  </span>
                ) : (
                  <span className="truncate text-muted">{t('items.fields.parent.none')}</span>
                )
              }
              displayText={parent ? `${parent.key} ${parent.title}` : t('items.fields.parent.none_text')}
              options={parentOptions}
              value={payload.parent_id ?? ''}
              onValueChange={(next) => onPayload({ parent_id: next || null }, 'payload.parent_id')}
              placeholder={t('items.fields.parent.placeholder')}
              emptyText={noParentText(candidates)}
              onOpenChange={setParentOpen}
              load={{ isLoading: projectItems.isPending, error: projectItems.error, retry: () => void projectItems.refetch(), retrying: projectItems.isFetching }}
              disabledReason={denied}
              invalid={errors['payload.parent_id'] !== undefined}
              describedBy={describe('parent', errors['payload.parent_id'])}
            />
          </FormRow>
        )}
        <OffsetField
          id={fieldId('payload.start_offset_days')}
          label={t('templates.editor.start_offset')}
          value={payload.start_offset_days}
          error={errors['payload.start_offset_days']}
          readOnly={readOnly}
          onChange={(start_offset_days) => onPayload({ start_offset_days }, 'payload.start_offset_days', 'payload.due_offset_days')}
          onUnreadable={(message) => props.onUnreadable('payload.start_offset_days', message)}
        />
        <OffsetField
          id={fieldId('payload.due_offset_days')}
          label={t('templates.editor.due_offset')}
          value={payload.due_offset_days}
          error={errors['payload.due_offset_days']}
          readOnly={readOnly}
          onChange={(due_offset_days) => onPayload({ due_offset_days }, 'payload.start_offset_days', 'payload.due_offset_days')}
          onUnreadable={(message) => props.onUnreadable('payload.due_offset_days', message)}
        />
      </div>

      {type && fields.length > 0 && (
        <section aria-labelledby={`${formId}-properties`} className="mt-5 border-t border-line pt-4">
          <h3 id={`${formId}-properties`} className="font-display text-md font-bold tracking-title text-ink">
            {t('templates.editor.properties', { type: type.name })}
          </h3>
          <div className="mt-3 grid gap-4 md:grid-cols-2">
            {fields.map(({ property, required }) => (
              <TemplateProperty
                key={property.id}
                property={property}
                required={required}
                value={payload.values[property.key]}
                projectId={project.id}
                id={fieldId(`payload.values.${property.key}`)}
                denied={denied}
                error={errors[`payload.values.${property.key}`] ?? unreadableOf(`payload.values.${property.key}`)}
                onChange={(value) => props.onValue(property.key, value)}
                onUnreadable={(message) => props.onUnreadable(`payload.values.${property.key}`, message)}
              />
            ))}
          </div>
        </section>
      )}
    </section>
  );
}
