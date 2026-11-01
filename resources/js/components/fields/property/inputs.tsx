/*
 * One editor per field type, behind `PropertyValueInput`:
 * - text, number, URL and plain rich text are typed: a valid value is reported while one types, kept on Enter or when
 *   the focus leaves; a text that cannot be read shows its error and is never reported (Enter then stays in the field).
 *   Escape takes the typing back.
 * - yes/no, date, dropdown and people are chosen and kept at once.
 * Rich text is a text area only for plain documents (paragraphs and line breaks, R17): a blank line is a new paragraph, a
 * single line break a `hardBreak`. A richer document is shown read-only, so the text area never flattens it.
 */

import { ExternalLink } from 'lucide-react';
import { useEffect, useState, type KeyboardEvent, type ReactElement } from 'react';
import { Avatar, UnassignedAvatar } from '@/components/ui/Avatar';
import { ToneDot } from '@/components/ui/Chip';
import { cx } from '@/components/ui/cx';
import { fieldClass, fieldSize } from '@/components/ui/styles';
import { Switch } from '@/components/ui/Switch';
import { Tooltip } from '@/components/ui/Tooltip';
import { t } from '@/lib/i18n';
import { docToText } from '@/lib/richtext';
import type { Property, PropertyValue, RichText } from '@/types';
import { DatePopover, DayValue } from '../DateField';
import { botWord, formatDay } from '../format';
import { useProjectPeople, useToday, useUserMap } from '../itemData';
import { Picker, PendingMark, type PickerOption } from '../Picker';
import { idsOf, parseTyped, shownText, type Parsed } from './parse';

/** What every editor gets: its control's id and description, the state of the field, and the ways to report. */
export interface EditorProps {
  property: Property;
  value: PropertyValue | undefined;
  id: string;
  /** The name of the control (the property's label). */
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
  /** The typed text cannot be read (its error), or it can again (null). */
  onUnreadable: (error: string | null) => void;
}

/** Text, number, URL and plain rich text: typed, kept on Enter or when the focus leaves; Escape takes the typing back. */
function TypedEditor({ property, value, id, label, describedById, invalid, required, pending, onType, onAccept, setError, onUnreadable }: EditorProps) {
  const shown = shownText(property, value);
  const [draft, setDraft] = useState(shown);
  const [focused, setFocused] = useState(false);
  const multiline = property.field_type === 'rich_text';

  // a value from outside (an optimistic change, a live event) shows unless the field is being edited; only a new
  // value resets the draft, so `focused` is read but not a dependency
  useEffect(() => {
    if (!focused) setDraft(shown);
  }, [shown]);

  /** Keeps the draft; answers whether it was kept (a text that cannot be read, or an emptied required value, is not). */
  function commit(): boolean {
    const parsed = parseTyped(property, draft);
    if (!('value' in parsed)) {
      setError(parsed.error);
      return false;
    }
    if (!onAccept(parsed.value)) return false;
    setDraft(shownText(property, parsed.value));
    return true;
  }

  function report(parsed: Parsed) {
    if ('value' in parsed) {
      setError(null);
      onUnreadable(null);
      onType(parsed.value);
    } else {
      setError(parsed.partial ? null : parsed.error);
      onUnreadable(parsed.error);
    }
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
      setDraft(event.target.value);
      report(parseTyped(property, event.target.value));
    },
    onKeyDown: (event: KeyboardEvent) => {
      // Safari sends the Enter that ends a composition with isComposing false, but with keyCode 229
      if (event.nativeEvent.isComposing || event.keyCode === 229) return;
      if (event.key === 'Enter' && (!multiline || event.metaKey || event.ctrlKey)) {
        // a kept value lets the Enter go on to a form around the field; a refused one keeps it in the field
        if (!commit()) event.preventDefault();
      } else if (event.key === 'Escape' && draft !== shown) {
        // the typing is taken back; the Escape is used up and closes nothing else
        event.preventDefault();
        setDraft(shown);
        setError(null);
        onUnreadable(null);
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
        <Tooltip content={t('items.fields.property.open_link_tooltip')}>
          <a
            href={link}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={t('items.fields.property.open_link', { label })}
            className="inline-flex size-11 shrink-0 items-center justify-center rounded-chip text-muted transition-colors duration-120 hover:bg-hover hover:text-ink md:size-8"
          >
            <ExternalLink className="size-4" aria-hidden="true" />
          </a>
        </Tooltip>
      )}
    </div>
  );
}

/**
 * Yes or no, kept at once. "Ja"/"Nein" beside the switch belongs to its hit target; the name is the property's. Off
 * reads "Nein" with and without a stored value (A89); switching it off stores `false`.
 */
function BooleanEditor({ value, id, label, describedById, invalid, pending, onAccept }: EditorProps) {
  const on = value === true;
  return (
    <div className="flex items-center gap-2">
      <Switch
        id={id}
        label={on ? t('items.fields.yes') : t('items.fields.no')}
        checked={on}
        onCheckedChange={(checked) => onAccept(checked)}
        aria-label={label}
        aria-describedby={describedById}
        aria-invalid={invalid || undefined}
      />
      {pending && <PendingMark />}
    </div>
  );
}

/** A day from the calendar. */
function DateEditor({ property, value, id, label, describedById, invalid, required, pending, onAccept }: EditorProps) {
  const { today } = useToday();
  const day = typeof value === 'string' ? value : null;
  return (
    <DatePopover
      look="form"
      id={id}
      label={label}
      value={day}
      describedBy={describedById}
      invalid={invalid}
      pending={pending}
      display={<DayValue value={day} today={today} overdue={false} empty={t('items.fields.property.choose_date')} />}
      displayText={day ? formatDay(day) : t('items.fields.property.no_date')}
      onChoose={(next) => {
        if (next === null && required && day) return t('items.fields.property.required_kept', { label: property.label });
        onAccept(next);
        return null;
      }}
    />
  );
}

/** Several chosen ones in the order of the list (options, people), whatever order they were ticked in. */
const inOrder = (chosen: string[], options: PickerOption[]) => options.map((option) => option.value).filter((value) => chosen.includes(value));

/** One or more options of a dropdown; archived options only while they are chosen. */
function DropdownEditor({ property, value, id, label, describedById, invalid, required, pending, onAccept }: EditorProps) {
  const ids = idsOf(value);
  const multiple = property.settings.multiple === true;
  const options: PickerOption[] = property.options
    .filter((option) => option.archived_at === null || ids.includes(option.id))
    .sort((a, b) => a.position - b.position)
    .map((option) => ({
      value: option.id,
      label: option.label,
      icon: <ToneDot tone={option.color} className="size-2" />,
      hint: option.archived_at ? t('items.fields.property.archived') : undefined,
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
    <span className="truncate text-muted">{multiple ? t('items.fields.property.choose_options') : t('items.fields.property.choose_option')}</span>
  );
  const common = {
    look: 'form' as const,
    id,
    label,
    display,
    displayText: chosen.map((option) => option.label).join(', ') || t('items.fields.property.no_choice_text'),
    placeholder: t('items.fields.property.search_option'),
    describedBy: describedById,
    invalid,
    pending,
  };

  if (multiple) {
    return <Picker {...common} multiple options={options} value={ids} onValueChange={(next) => onAccept(next.length ? inOrder(next, options) : null)} />;
  }
  const none: PickerOption[] = required
    ? []
    : [{ value: '', label: t('items.fields.property.no_choice'), icon: <span className="size-2 rounded-full border border-dashed border-faint" /> }];
  return <Picker {...common} options={[...none, ...options]} value={ids[0] ?? ''} onValueChange={(next) => onAccept(next || null)} />;
}

/**
 * People and bots of the project, one or several. Someone the item has who can no longer be chosen (left the project,
 * deactivated) stays an option while they are set, like an archived option: a change of the others keeps them, as the
 * server does.
 */
function MemberEditor({ property, value, id, label, describedById, invalid, required, pending, projectId, onAccept }: EditorProps) {
  const { people, isLoading, error, retry, retrying } = useProjectPeople(projectId);
  const users = useUserMap();
  const ids = idsOf(value);
  const multiple = property.settings.multiple === true;
  const offered = new Set((people ?? []).map((user) => user.id));
  const options: PickerOption[] = [
    ...(people ?? []).map((user) => ({
      value: user.id,
      label: user.name,
      hint: botWord(user),
      keywords: [user.handle],
      icon: <Avatar user={user} size="sm" decorative />,
    })),
    ...ids
      .filter((userId) => !offered.has(userId))
      .map((userId) => {
        const user = users.get(userId);
        return {
          value: userId,
          label: user?.name ?? t('items.fields.property.unknown_person'),
          hint: t('items.fields.property.not_offered'),
          keywords: user ? [user.handle] : [],
          icon: user ? <Avatar user={user} size="sm" decorative /> : <UnassignedAvatar />,
        };
      }),
  ];
  const chosen = ids.flatMap((userId) => users.get(userId) ?? []);
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
    <span className="truncate text-muted">{multiple ? t('items.fields.property.choose_people') : t('items.fields.property.choose_person')}</span>
  );
  const common = {
    look: 'form' as const,
    id,
    label,
    display,
    displayText: chosen.map((user) => user.name).join(', ') || t('items.fields.property.nobody_text'),
    placeholder: t('items.fields.property.search_person'),
    load: { isLoading, error, retry, retrying },
    describedBy: describedById,
    invalid,
    pending,
  };

  if (multiple) {
    return <Picker {...common} multiple options={options} value={ids} onValueChange={(next) => onAccept(next.length ? inOrder(next, options) : null)} />;
  }
  const none: PickerOption[] = required ? [] : [{ value: '', label: t('items.fields.property.nobody'), icon: <UnassignedAvatar /> }];
  return <Picker {...common} options={[...none, ...options]} value={ids[0] ?? ''} onValueChange={(next) => onAccept(next || null)} />;
}

/** A rich document the text area would flatten: shown read-only, to be edited in the editor. */
export function LockedRichText({ value, id, label, describedById }: EditorProps) {
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

export const EDITORS = {
  text: TypedEditor,
  number: TypedEditor,
  url: TypedEditor,
  rich_text: TypedEditor,
  boolean: BooleanEditor,
  date: DateEditor,
  dropdown: DropdownEditor,
  member: MemberEditor,
} satisfies Record<Property['field_type'], (props: EditorProps) => ReactElement>;
