/*
 * Properties of an item (spec 4.7), one editor for all eight field types:
 * - `PropertyValueInput` is controlled, for forms: the required fields of a type change, the create dialog.
 * - `PropertyField` is bound to an item. A chosen value is saved at once, a typed one on Enter or when the focus leaves
 *   the field; Escape takes back what was typed.
 * Required: a required value cannot be emptied. An item without a value (the property became required later) stays
 * valid and shows a hint.
 * Rich text is a plain text area for now, and only for plain documents (paragraphs and line breaks): a blank line is a
 * new paragraph, a single line break a `hardBreak`. A richer document (lists, marks, links, mentions) is shown read-only
 * with "Im Editor bearbeiten", so the text area never flattens it; the editor comes with Task 8.
 */

import { ExternalLink } from 'lucide-react';
import { useEffect, useId, useState, type KeyboardEvent, type ReactElement } from 'react';
import { ApiError } from '@/api/client';
import { Avatar, UnassignedAvatar } from '@/components/ui/Avatar';
import { ToneDot } from '@/components/ui/Chip';
import { cx } from '@/components/ui/cx';
import { describedBy, Field } from '@/components/ui/Field';
import { fieldClass, fieldSize } from '@/components/ui/styles';
import { Switch } from '@/components/ui/Switch';
import { Tooltip } from '@/components/ui/Tooltip';
import { useUpdateWorkItem } from '@/hooks/workItems';
import { docToText, isBlankDoc, isPlainDoc, plainDocText, textDoc } from '@/lib/richtext';
import type { Property, PropertyValue, RichText, WorkItem } from '@/types';
import { DatePopover, DayValue } from './DateField';
import { botWord, formatDay, formatNumber, formatPropertyValue } from './format';
import { useEditReason, useProjectPeople, useToday, useUserMap } from './itemData';
import { Picker, PendingMark, ReadOnlyTrigger, type PickerOption } from './Picker';

const MAX_TEXT = 255;

/** Empty as the server counts it: nothing, blank text, an empty list, a rich text without content. */
export function isEmptyValue(value: PropertyValue | undefined): boolean {
  if (value === undefined || value === null) return true;
  if (typeof value === 'string') return value.trim() === '';
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === 'object') return isBlankDoc(value as RichText);
  return false;
}

const sameValue = (a: PropertyValue | undefined, b: PropertyValue | undefined) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

const idsOf = (value: PropertyValue | undefined): string[] => (Array.isArray(value) ? value.map(String) : typeof value === 'string' && value !== '' ? [value] : []);

type Parsed = { value: PropertyValue } | { error: string; partial: boolean };

/**
 * What a typed text means for a text, number or URL property. `partial`: the text may still become valid while one
 * types (an address, a number ending in a comma), so its error waits for Enter or for leaving the field.
 */
function parseTyped(property: Property, text: string): Parsed {
  const trimmed = text.trim();
  if (trimmed === '') return { value: null };
  switch (property.field_type) {
    case 'number': {
      const decimals = property.settings.decimals ?? 0;
      // German: the comma is the decimal sign; a point only groups thousands (1.500, 1.234,5)
      const match = /^(-?)(\d{1,3}(?:\.\d{3})+|\d+)(?:,(\d+))?$/.exec(trimmed);
      if (match) {
        const [, sign, whole, fraction] = match;
        const factor = 10 ** decimals;
        return { value: Math.round(Number(`${sign}${whole.replaceAll('.', '')}.${fraction ?? '0'}`) * factor) / factor };
      }
      // digits, points and a comma may still become a number while one types ("1." on the way to "1.500")
      const partial = /^-?[\d.]*,?\d*$/.test(trimmed);
      if (partial && trimmed.includes('.')) {
        return {
          error: decimals > 0 ? 'Nachkommastellen nach einem Komma, zum Beispiel 3,5. Der Punkt trennt nur Tausender' : 'Der Punkt trennt nur Tausender, zum Beispiel 1.500',
          partial,
        };
      }
      return { error: `Nur eine Zahl eingeben, zum Beispiel ${decimals > 0 ? '3,5' : '4'}`, partial };
    }
    case 'url':
      try {
        const url = new URL(trimmed);
        if (url.protocol === 'http:' || url.protocol === 'https:') return { value: trimmed };
      } catch {
        // not an address yet
      }
      return { error: 'Die Adresse beginnt mit http:// oder https://, zum Beispiel https://example.com', partial: true };
    default:
      return trimmed.length > MAX_TEXT ? { error: `Höchstens ${MAX_TEXT} Zeichen, jetzt sind es ${trimmed.length}`, partial: false } : { value: trimmed };
  }
}

/** The value as the field shows it while it is edited: numbers in German without thousands points, plain rich text. */
function shownText(property: Property, value: PropertyValue | undefined): string {
  if (value === undefined || value === null) return '';
  if (property.field_type === 'number' && typeof value === 'number') return formatNumber(value, property.settings.decimals ?? 0, { grouping: false });
  if (property.field_type === 'rich_text') return plainDocText(value as RichText);
  return String(value);
}

/** A rich text the text area cannot hold without losing its form (see the top of this file). */
const isLockedRichText = (property: Property, value: PropertyValue | undefined) =>
  property.field_type === 'rich_text' && value !== undefined && value !== null && !isPlainDoc(value as RichText);

/** What every editor gets: its control's id and description, the state of the field, and the ways to report. */
interface EditorProps {
  property: Property;
  value: PropertyValue | undefined;
  id: string;
  label: string;
  describedById?: string;
  invalid: boolean;
  required: boolean;
  pending: boolean;
  projectId: string;
  /** A valid value while typing (forms take it as it is). */
  onType: (value: PropertyValue) => void;
  /** A value to keep; answers false when it was refused (a required value cannot be emptied). */
  onAccept: (value: PropertyValue) => boolean;
  /** Shows or clears an error of the field itself. */
  setError: (error: string | null) => void;
}

/** Text, number and URL: typed, saved on Enter or when the focus leaves; Escape takes the typing back. */
function TypedEditor({ property, value, id, label, describedById, invalid, required, pending, onType, onAccept, setError }: EditorProps) {
  const shown = shownText(property, value);
  const [draft, setDraft] = useState(shown);
  const [focused, setFocused] = useState(false);
  const multiline = property.field_type === 'rich_text';

  // a value from outside (an optimistic change, a live event) shows unless the field is being edited; only a new
  // value resets the draft, so `focused` is read but not a dependency
  useEffect(() => {
    if (!focused) setDraft(shown);
  }, [shown]);

  const parse = (text: string): Parsed => (multiline ? { value: text.trim() === '' ? null : textDoc(text) } : parseTyped(property, text));

  function commit() {
    const parsed = parse(draft);
    if (!('value' in parsed)) {
      setError(parsed.error);
      return;
    }
    if (onAccept(parsed.value)) setDraft(shownText(property, parsed.value));
  }

  const common = {
    id,
    name: property.key,
    value: draft,
    'aria-label': label,
    'aria-describedby': describedById,
    'aria-invalid': invalid || undefined,
    'aria-required': required || undefined,
    'aria-busy': pending || undefined,
    autoComplete: 'off',
    onFocus: () => setFocused(true),
    onBlur: () => {
      setFocused(false);
      if (draft !== shown) commit();
    },
    onChange: (event: { target: { value: string } }) => {
      const text = event.target.value;
      setDraft(text);
      const parsed = parse(text);
      if ('value' in parsed) {
        setError(null);
        onType(parsed.value);
      } else {
        setError(parsed.partial ? null : parsed.error);
      }
    },
    onKeyDown: (event: KeyboardEvent) => {
      if (event.nativeEvent.isComposing || event.keyCode === 229) return;
      const submit = event.key === 'Enter' && (!multiline || event.metaKey || event.ctrlKey);
      if (submit) {
        // a form's mod+Enter still reaches the form: the value is in by then
        if (!multiline) event.preventDefault();
        commit();
      } else if (event.key === 'Escape' && draft !== shown) {
        // the typing is taken back; the Escape is used up and closes nothing else
        event.preventDefault();
        setDraft(shown);
        setError(null);
      }
    },
  };

  if (multiline) {
    return <textarea {...common} rows={3} className={cx(fieldClass(invalid), 'block max-h-80 min-h-24 resize-none px-3 py-2 text-input [field-sizing:content] md:text-md')} />;
  }

  const link = property.field_type === 'url' && typeof value === 'string' && draft === shown ? value : null;
  return (
    <div className="flex min-w-0 items-center gap-1.5">
      <input
        {...common}
        type={property.field_type === 'url' ? 'url' : 'text'}
        inputMode={property.field_type === 'number' ? 'decimal' : property.field_type === 'url' ? 'url' : undefined}
        spellCheck={property.field_type === 'text'}
        className={cx(fieldClass(invalid), fieldSize, 'min-w-0 flex-1', property.field_type === 'number' && 'tabular-nums')}
      />
      {pending && <PendingMark />}
      {link && (
        <Tooltip content="Adresse in neuem Tab öffnen">
          <a
            href={link}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`${label} in neuem Tab öffnen`}
            className="inline-flex size-11 shrink-0 items-center justify-center rounded-chip text-muted transition-colors duration-120 hover:bg-hover hover:text-ink md:size-8"
          >
            <ExternalLink className="size-4" aria-hidden="true" />
          </a>
        </Tooltip>
      )}
    </div>
  );
}

/** Yes or no, saved at once. "Ja"/"Nein" beside the switch belongs to its hit target; the name is the property's. */
function BooleanEditor({ value, id, label, describedById, pending, onAccept }: EditorProps) {
  const on = value === true;
  return (
    <div className="flex items-center gap-2">
      <Switch id={id} label={on ? 'Ja' : 'Nein'} checked={on} onCheckedChange={(checked) => onAccept(checked)} aria-label={label} aria-describedby={describedById} />
      {pending && <PendingMark />}
    </div>
  );
}

/** A day from the calendar. */
function DateEditor({ property, value, id, describedById, invalid, required, pending, onAccept }: EditorProps) {
  const { today } = useToday();
  const day = typeof value === 'string' ? value : null;
  return (
    <DatePopover
      look="form"
      id={id}
      label={property.label}
      value={day}
      describedBy={describedById}
      invalid={invalid}
      pending={pending}
      display={<DayValue value={day} today={today} overdue={false} empty="Datum wählen …" />}
      displayText={day ? formatDay(day) : 'kein Datum'}
      onChoose={(next) => {
        if (next === null && required && day) return `„${property.label}“ ist ein Pflichtfeld und lässt sich nicht leeren.`;
        onAccept(next);
        return null;
      }}
    />
  );
}

/** One or more options of a dropdown; archived options only while they are chosen. */
function DropdownEditor({ property, value, id, describedById, invalid, required, pending, onAccept }: EditorProps) {
  const ids = idsOf(value);
  const multiple = property.settings.multiple === true;
  const options: PickerOption[] = property.options
    .filter((option) => option.archived_at === null || ids.includes(option.id))
    .sort((a, b) => a.position - b.position)
    .map((option) => ({
      value: option.id,
      label: option.label,
      icon: <ToneDot tone={option.color} className="size-2" />,
      hint: option.archived_at ? 'archiviert' : undefined,
    }));
  const chosen = options.filter((option) => ids.includes(option.value));
  const display = chosen.length ? (
    <span className="flex min-w-0 items-center gap-2">
      {chosen.map((option) => (
        <span key={option.value} className="inline-flex min-w-0 items-center gap-1.5">
          {option.icon}
          <span className="truncate">{option.label}</span>
        </span>
      ))}
    </span>
  ) : (
    <span className="truncate text-muted">{multiple ? 'Optionen wählen …' : 'Option wählen …'}</span>
  );
  const common = {
    look: 'form' as const,
    id,
    label: property.label,
    display,
    displayText: chosen.map((option) => option.label).join(', ') || 'keine Auswahl',
    placeholder: 'Option suchen …',
    describedBy: describedById,
    invalid,
    pending,
  };

  if (multiple) {
    return <Picker {...common} multiple options={options} value={ids} onValueChange={(next) => onAccept(next.length ? next : null)} />;
  }
  const none: PickerOption[] = required ? [] : [{ value: '', label: 'Keine Auswahl', icon: <span className="size-2 rounded-full border border-dashed border-faint" /> }];
  return <Picker {...common} options={[...none, ...options]} value={ids[0] ?? ''} onValueChange={(next) => onAccept(next || null)} />;
}

/** People and bots of the project, one or several. */
function MemberEditor({ property, value, id, describedById, invalid, required, pending, projectId, onAccept }: EditorProps) {
  const { people, isLoading, error, retry, retrying } = useProjectPeople(projectId);
  const users = useUserMap();
  const ids = idsOf(value);
  const multiple = property.settings.multiple === true;
  const options: PickerOption[] = (people ?? []).map((user) => ({
    value: user.id,
    label: user.name,
    hint: botWord(user),
    keywords: [user.handle],
    icon: <Avatar user={user} size="sm" decorative />,
  }));
  const chosen = ids.flatMap((userId) => {
    const user = users.get(userId);
    return user ? [user] : [];
  });
  const display = chosen.length ? (
    <span className="flex min-w-0 items-center gap-2">
      {chosen.map((user) => (
        <span key={user.id} className="inline-flex min-w-0 items-center gap-1.5">
          <Avatar user={user} size="sm" decorative />
          <span className="truncate">{user.name}</span>
        </span>
      ))}
    </span>
  ) : (
    <span className="truncate text-muted">{multiple ? 'Personen wählen …' : 'Person wählen …'}</span>
  );
  const common = {
    look: 'form' as const,
    id,
    label: property.label,
    display,
    displayText: chosen.map((user) => user.name).join(', ') || 'niemand',
    placeholder: 'Person suchen …',
    load: { isLoading, error, retry, retrying },
    describedBy: describedById,
    invalid,
    pending,
  };

  if (multiple) {
    return <Picker {...common} multiple options={options} value={ids} onValueChange={(next) => onAccept(next.length ? next : null)} />;
  }
  const none: PickerOption[] = required ? [] : [{ value: '', label: 'Niemand', icon: <UnassignedAvatar /> }];
  return <Picker {...common} options={[...none, ...options]} value={ids[0] ?? ''} onValueChange={(next) => onAccept(next || null)} />;
}

/** A rich document the text area would flatten: shown read-only, to be edited in the editor (Task 8). */
function LockedRichText({ value, id, label, describedById }: EditorProps) {
  return (
    <textarea
      id={id}
      readOnly
      value={docToText(value as RichText)}
      aria-label={label}
      aria-describedby={describedById}
      rows={3}
      className="block max-h-80 min-h-24 w-full resize-none rounded-ctl border border-line bg-sunken px-3 py-2 text-input text-ink [field-sizing:content] md:text-md"
    />
  );
}

const EDITORS = {
  text: TypedEditor,
  number: TypedEditor,
  url: TypedEditor,
  rich_text: TypedEditor,
  boolean: BooleanEditor,
  date: DateEditor,
  dropdown: DropdownEditor,
  member: MemberEditor,
} satisfies Record<Property['field_type'], (props: EditorProps) => ReactElement>;

export type PropertyValueInputProps = {
  property: Property;
  value: PropertyValue | undefined;
  /** Every valid change. Typed fields report while one types, the others when a value is chosen. */
  onChange: (value: PropertyValue) => void;
  /** A value to keep: typed fields on Enter or when the focus leaves, the others right after `onChange`. */
  onCommit?: (value: PropertyValue) => void;
  /** The project: a member field offers its people. */
  projectId: string;
  required?: boolean;
  /** An error from outside, e.g. the server's refusal; it wins over the field's own. */
  error?: string | null;
  /** Shown under the field instead of the property's help. */
  hint?: string | null;
  /** In a grid that shows the label itself (detail panel): the label only names the control. */
  hideLabel?: boolean;
  /** Not allowed: the value is read-only and says why. */
  disabledReason?: string | null;
  pending?: boolean;
  id?: string;
};

export function PropertyValueInput({
  property,
  value,
  onChange,
  onCommit,
  projectId,
  required = false,
  error: outerError,
  hint: givenHint,
  hideLabel = false,
  disabledReason,
  pending = false,
  id: givenId,
}: PropertyValueInputProps) {
  const autoId = useId();
  const id = givenId ?? autoId;
  const users = useUserMap();
  const [ownError, setOwnError] = useState<string | null>(null);
  const error = outerError ?? ownError;
  const locked = isLockedRichText(property, value);
  const hint = locked ? 'Im Editor bearbeiten' : (givenHint ?? (hideLabel ? null : property.help || null));
  const label = (
    <>
      {property.label}
      {required && <span className="ml-1.5 font-normal text-muted">Pflicht</span>}
    </>
  );

  function accept(next: PropertyValue): boolean {
    if (required && isEmptyValue(next) && !isEmptyValue(value)) {
      setOwnError(`„${property.label}“ ist ein Pflichtfeld und lässt sich nicht leeren.`);
      return false;
    }
    setOwnError(null);
    onChange(next);
    onCommit?.(next);
    return true;
  }

  let control;
  if (disabledReason) {
    const text = formatPropertyValue(property, value, (userId) => users.get(userId)?.name ?? 'Unbekannt');
    control = (
      <ReadOnlyTrigger look="form" id={id} name={`${property.label}: ${text || 'kein Wert'}`} reason={disabledReason}>
        <span className={cx('truncate', !text && 'text-muted')}>{text || 'Kein Wert'}</span>
      </ReadOnlyTrigger>
    );
  } else {
    const Editor = locked ? LockedRichText : EDITORS[property.field_type];
    control = (
      <Editor
        property={property}
        value={value}
        id={id}
        label={property.label}
        describedById={describedBy(id, { hint, error })}
        invalid={Boolean(error)}
        required={required}
        pending={pending}
        projectId={projectId}
        onType={onChange}
        onAccept={accept}
        setError={setOwnError}
      />
    );
  }

  // the field is always there (with its live region), so an error that appears is announced and nothing remounts
  return (
    <Field id={id} label={hideLabel ? undefined : label} hint={hint} error={error}>
      {control}
    </Field>
  );
}

type PropertyFieldProps = {
  item: WorkItem;
  property: Property;
  /** Required for the item's type. */
  required: boolean;
  /** In a grid that shows the label itself (detail panel). */
  hideLabel?: boolean;
};

export function PropertyField({ item, property, required, hideLabel }: PropertyFieldProps) {
  const reason = useEditReason(item);
  const update = useUpdateWorkItem();
  const [refusal, setRefusal] = useState<string | null>(null);
  const value = item.values[property.key];

  function save(next: PropertyValue) {
    if (sameValue(next, value)) return;
    setRefusal(null);
    update.mutate(
      { id: item.id, patch: { values: { [property.key]: next } } },
      {
        // the toast names the cause too; the field shows the server's words where the change was made
        onError: (failure) => {
          const message = failure instanceof ApiError ? failure.errors?.[`values.${property.key}`]?.[0] : undefined;
          if (message) setRefusal(message);
        },
      },
    );
  }

  return (
    <PropertyValueInput
      property={property}
      value={value}
      onChange={() => undefined}
      onCommit={save}
      projectId={item.project_id}
      required={required}
      error={refusal}
      hint={required && isEmptyValue(value) ? 'Pflichtfeld, noch leer. Bitte ergänzen.' : undefined}
      hideLabel={hideLabel}
      disabledReason={reason}
      pending={update.isPending}
    />
  );
}
