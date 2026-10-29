/*
 * One condition of the filter bar as a chip (moodboard "Status ist nicht Cancelled ×"): the field, the operator (a
 * menu with the operators of the field's kind), the value, and × to remove it.
 *
 * Values by kind (fieldOps.ts):
 * - enum and list: the shared picker with search, several values at once; people offer "Ich" (`me`) first.
 * - date: a popover with "heute", "diese Woche", "dieser Monat", a distance from today in days or weeks, or a day
 *   from the calendar; "zwischen" has two of them.
 * - flag: ja or nein. text and number: a small field in the chip, kept on Enter or when the focus leaves.
 * A new condition (`fresh`) opens its value at once; `onDone` tells when that editor closes, so the filter bar can
 * keep or drop the condition.
 */

import { ChevronDown, UserRoundCheck, X } from 'lucide-react';
import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { personOption } from '@/components/fields/AssigneePicker';
import { useToday } from '@/components/fields/itemData';
import { labelOption } from '@/components/fields/LabelsPicker';
import { Picker, type PickerOption } from '@/components/fields/Picker';
import { PRIORITY_OPTIONS } from '@/components/fields/PriorityPicker';
import { stateOption } from '@/components/fields/StatePicker';
import { TypeGlyph, typeOption } from '@/components/fields/TypePicker';
import { Button } from '@/components/ui/Button';
import { Calendar } from '@/components/ui/Calendar';
import { ToneDot } from '@/components/ui/Chip';
import { cx } from '@/components/ui/cx';
import { IconButton } from '@/components/ui/IconButton';
import { Input } from '@/components/ui/Input';
import { Menu, MenuContent, MenuRadioGroup, MenuRadioItem, MenuTrigger } from '@/components/ui/Menu';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/Popover';
import { ProjectBadge } from '@/components/ui/ProjectBadge';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { Select } from '@/components/ui/Select';
import { StatusIcon } from '@/components/ui/StatusIcon';
import { CATEGORY_ORDER, statesInOrder } from '@/domain/workflow';
import { useLabels } from '@/hooks/catalog';
import { useProjects } from '@/hooks/projects';
import { useCurrentUser, useUsers } from '@/hooks/users';
import { useWorkflows } from '@/hooks/workflows';
import { useWorkItems } from '@/hooks/workItems';
import { useWorkItemTypes } from '@/hooks/workItemTypes';
import type { Condition, ConditionOp, Project, User } from '@/types';
import { CATEGORY_ICONS } from '../display/GroupIcon';
import { CATEGORY_LABELS } from '../display/grouping';
import {
  dateValueLabel,
  isComplete,
  operatorFamily,
  operatorLabel,
  operatorsFor,
  parseGermanNumber,
  readRelative,
  relativeValue,
  VALUELESS,
  valuesOf,
  withOperator,
  withValues,
  type FieldDef,
} from './fieldOps';

const COLLATOR = new Intl.Collator('de-DE', { numeric: true });
const NUMBER = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 6, useGrouping: false });

/** The look of the parts of a chip that open something: quiet until hovered. */
const part = 'inline-flex h-11 min-w-0 shrink-0 cursor-pointer items-center gap-1 rounded-chip px-1.5 text-sm transition-colors duration-120 hover:bg-hover data-popup-open:bg-hover md:h-6';

/* ------------------------------------------------------------------------ value options */

const people = (users: readonly User[]) =>
  [...users].filter((user) => user.disabled_at === null).sort((a, b) => (a.type === b.type ? COLLATOR.compare(a.name, b.name) : a.type === 'person' ? -1 : 1));

/** The options of an enum or list field, and whether they are still loading. */
function useValueOptions(def: FieldDef, project?: Project): { options: PickerOption[]; loading: boolean; error: Error | null; retry: () => void } {
  const projects = useProjects();
  const workflows = useWorkflows();
  const types = useWorkItemTypes();
  const users = useUsers();
  const labels = useLabels();
  const me = useCurrentUser();
  const parents = useWorkItems({ filter: { version: 1, conditions: [{ field: 'has_children', op: 'is', value: true }] }, per_page: 100 }, { enabled: def.source === 'parent' });

  const meOption = (): PickerOption[] =>
    me ? [{ value: 'me', label: 'Ich', hint: me.name, keywords: ['mir', 'mich', me.name], icon: <UserRoundCheck className="size-4 text-muted" /> }] : [];
  const source = def.source;
  const used = source === 'project' ? [projects] : source === 'state' ? [projects, workflows] : source === 'type' ? [types] : source === 'person' || source === 'member' ? [users] : source === 'label' ? [labels] : source === 'parent' ? [parents] : [];
  const loading = used.some((entry) => entry.isPending);
  const error = used.find((entry) => entry.error)?.error ?? null;
  const retry = () => used.forEach((entry) => void entry.refetch());

  let options: PickerOption[] = [];
  switch (source) {
    case 'project':
      options = (projects.data?.items ?? []).map((entry) => ({ value: entry.id, label: entry.name, keywords: [entry.identifier], icon: <ProjectBadge project={entry} className="size-4" /> }));
      break;
    case 'type':
      options = (types.data?.items ?? []).filter((type) => type.archived_at === null).map(typeOption);
      break;
    case 'state': {
      // the workflows of the projects in view: the project's own on a project list
      const ids = project ? [project.workflow_id] : [...new Set((projects.data?.items ?? []).map((entry) => entry.workflow_id))];
      const shown = (workflows.data?.items ?? []).filter((workflow) => ids.includes(workflow.id));
      options = shown.flatMap((workflow) => statesInOrder(workflow).map((state) => ({ ...stateOption(state), hint: shown.length > 1 ? workflow.name : undefined })));
      break;
    }
    case 'category':
      options = CATEGORY_ORDER.map((category) => ({
        value: category,
        label: CATEGORY_LABELS[category],
        icon: <StatusIcon icon={CATEGORY_ICONS[category]} category={category} label={CATEGORY_LABELS[category]} aria-hidden="true" />,
      }));
      break;
    case 'person':
    case 'member':
      options = [...meOption(), ...people(users.data?.items ?? []).map(personOption)];
      break;
    case 'priority':
      options = PRIORITY_OPTIONS;
      break;
    case 'label':
      options = [...(labels.data?.items ?? [])].sort((a, b) => COLLATOR.compare(a.name, b.name)).map(labelOption);
      break;
    case 'parent': {
      const typeList = types.data?.items ?? [];
      options = (parents.data?.items ?? []).map((item) => {
        const type = typeList.find((entry) => entry.id === item.type_id);
        return { value: item.id, label: item.title, hint: item.key, keywords: [item.key], icon: type ? <TypeGlyph type={type} /> : undefined };
      });
      break;
    }
    case 'option':
      options = [...(def.property?.options ?? [])]
        .sort((a, b) => a.position - b.position)
        .map((option) => ({ value: option.id, label: option.label, hint: option.archived_at ? 'archiviert' : undefined, icon: <ToneDot tone={option.color} className="size-2" /> }));
      break;
  }
  return { options, loading, error, retry };
}

/** How chosen values read in the chip: the first name, then "+N" (a chip must fit a phone). */
function chosenDisplay(chosen: PickerOption[], values: unknown[]): { node: ReactNode; text: string } {
  if (values.length === 0) return { node: <span className="text-muted">Wert wählen …</span>, text: 'kein Wert' };
  const names = values.map((value) => chosen.find((option) => option.value === value)?.label ?? 'Unbekannt');
  const first = chosen.find((option) => option.value === values[0]);
  return {
    node: (
      <span className="flex min-w-0 items-center gap-1.5">
        <span className="inline-flex min-w-0 items-center gap-1">
          {first?.icon && (
            <span className="inline-flex size-4 shrink-0 items-center justify-center" aria-hidden="true">
              {first.icon}
            </span>
          )}
          <span className="max-w-24 truncate sm:max-w-40">{names[0]}</span>
        </span>
        {values.length > 1 && <span className="shrink-0 text-muted tabular-nums">+{values.length - 1}</span>}
      </span>
    ),
    text: names.join(', '),
  };
}

/* --------------------------------------------------------------------------- the editors */

type ValueEditorProps = {
  condition: Condition;
  def: FieldDef;
  onChange: (condition: Condition) => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  project?: Project;
};

function EnumValue({ condition, def, onChange, open, onOpenChange, project }: ValueEditorProps) {
  const { options, loading, error, retry } = useValueOptions(def, project);
  const values = valuesOf(condition).map(String);
  const { node, text } = chosenDisplay(options, values);
  return (
    <Picker
      look="bare"
      className="px-1 md:min-h-6"
      label={def.label}
      display={node}
      displayText={text}
      multiple
      options={options}
      value={values}
      onValueChange={(next) => onChange(withValues(condition, next))}
      placeholder={`${def.label} suchen …`}
      emptyText="Nichts passt."
      load={{ isLoading: loading, error, retry, retrying: false }}
      open={open}
      onOpenChange={onOpenChange}
    />
  );
}

const DATE_PRESETS = [
  { value: 'today', label: 'Heute' },
  { value: 'this_week', label: 'Diese Woche' },
  { value: 'this_month', label: 'Dieser Monat' },
] as const;

/** One date value: the quick choices, a distance from today ("in 7 Tagen", "vor 2 Wochen"), or a calendar day. */
function DateChoice({ label, value, onChoose, open, onOpenChange }: { label: string; value: unknown; onChoose: (value: unknown) => void; open: boolean; onOpenChange: (open: boolean) => void }) {
  const { today, weekStart } = useToday();
  const relative = readRelative(value);
  const [direction, setDirection] = useState<'in' | 'ago'>(relative && relative.amount < 0 ? 'ago' : 'in');
  const [amount, setAmount] = useState(relative ? String(Math.abs(relative.amount)) : '7');
  const [unit, setUnit] = useState<'d' | 'w'>(relative?.unit ?? 'd');
  const [error, setError] = useState<string | null>(null);
  const amountField = useRef<HTMLInputElement>(null);
  const ids = useId();
  const day = typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
  const empty = value === undefined || value === null;

  const choose = (next: unknown) => {
    onChoose(next);
    onOpenChange(false);
  };
  function applyRelative() {
    const trimmed = amount.trim();
    if (!/^\d{1,4}$/.test(trimmed)) {
      setError('Eine ganze Zahl von 0 bis 9999, zum Beispiel 7.');
      amountField.current?.focus();
      return;
    }
    setError(null);
    choose(relativeValue(Number(trimmed) * (direction === 'ago' ? -1 : 1), unit));
  }

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger render={<button type="button" aria-label={`${label}: ${empty ? 'kein Datum' : dateValueLabel(value)}`} className={cx(part, empty ? 'text-muted' : 'text-ink')} />}>
        <span className="truncate tabular-nums">{empty ? 'Datum wählen …' : dateValueLabel(value)}</span>
      </PopoverTrigger>
      <PopoverContent title={label} className="w-[min(21rem,calc(100vw-2rem))] p-3">
        <div className="mt-3 flex flex-col gap-4">
          <SegmentedControl
            label="Schnellauswahl"
            size="sm"
            value={DATE_PRESETS.some((preset) => preset.value === value) ? (value as string) : ''}
            onValueChange={choose}
            options={DATE_PRESETS.map((preset) => ({ value: preset.value, label: preset.label }))}
          />
          <form
            aria-labelledby={`${ids}-label`}
            onSubmit={(event) => {
              event.preventDefault();
              applyRelative();
            }}
          >
            <p id={`${ids}-label`} className="text-sm font-medium text-ink">
              Abstand zu heute
            </p>
            <div className="mt-1.5 flex items-center gap-2">
              <Select
                aria-label="Richtung"
                value={direction}
                onValueChange={(next) => next && setDirection(next as 'in' | 'ago')}
                options={[
                  { value: 'in', label: 'In' },
                  { value: 'ago', label: 'Vor' },
                ]}
                className="w-20 shrink-0"
              />
              {/* the field fills its box (w-full): the box sets the width */}
              <div className="w-16 shrink-0">
                <Input
                  ref={amountField}
                  name="relative-amount"
                  aria-label="Anzahl"
                  aria-describedby={`${ids}-note`}
                  aria-invalid={error ? true : undefined}
                  value={amount}
                  inputMode="numeric"
                  autoComplete="off"
                  onChange={(event) => setAmount(event.target.value)}
                  className="tabular-nums"
                />
              </div>
              <Select
                aria-label="Einheit"
                value={unit}
                onValueChange={(next) => next && setUnit(next as 'd' | 'w')}
                options={[
                  { value: 'd', label: 'Tagen' },
                  { value: 'w', label: 'Wochen' },
                ]}
                className="min-w-0 flex-1"
              />
            </div>
            <div className="mt-1.5 flex items-start justify-between gap-3">
              <p id={`${ids}-note`} aria-live="polite" className={cx('text-sm text-pretty', error ? 'font-medium text-danger' : 'text-muted')}>
                {error ?? '„In 0 Tagen“ ist heute.'}
              </p>
              <Button type="submit" variant="secondary" size="sm">
                Übernehmen
              </Button>
            </div>
          </form>
          <Calendar value={day} today={today} weekStartsOn={weekStart} label={label} onChange={(next) => next && choose(next)} />
        </div>
      </PopoverContent>
    </Popover>
  );
}

function DateValue({ condition, def, onChange, open, onOpenChange }: ValueEditorProps) {
  const [second, setSecond] = useState(false);
  if (condition.op === 'between') {
    const [from, to] = Array.isArray(condition.value) ? condition.value : [null, null];
    return (
      <>
        <DateChoice label={`${def.label} von`} value={from} open={open} onOpenChange={onOpenChange} onChoose={(next) => onChange({ ...condition, value: [next, to ?? next] })} />
        <span className="text-sm text-muted">und</span>
        <DateChoice label={`${def.label} bis`} value={to} open={second} onOpenChange={setSecond} onChoose={(next) => onChange({ ...condition, value: [from ?? next, next] })} />
      </>
    );
  }
  return <DateChoice label={def.label} value={condition.value} open={open} onOpenChange={onOpenChange} onChoose={(next) => onChange({ ...condition, value: next })} />;
}

/** A small field in the chip: kept on Enter or when the focus leaves; Escape takes the typing back. */
function InlineInput({
  label,
  value,
  parse,
  onCommit,
  autoFocus,
  onDone,
  numeric,
  name,
}: {
  name: string;
  label: string;
  value: string;
  parse: (text: string) => { value: unknown } | { error: string };
  onCommit: (value: unknown) => void;
  autoFocus: boolean;
  onDone: () => void;
  numeric?: boolean;
}) {
  const [draft, setDraft] = useState(value);
  const [error, setError] = useState<string | null>(null);
  const errorId = useId();
  /** Enter or Escape already decided; the blur that follows only closes. */
  const settled = useRef(false);
  useEffect(() => setDraft(value), [value]);

  /** Keeps a valid value; answers false (and shows why) for one that is not. */
  function commit(): boolean {
    const parsed = parse(draft);
    if ('error' in parsed) {
      setError(parsed.error);
      return false;
    }
    setError(null);
    onCommit(parsed.value);
    return true;
  }

  return (
    <span className="relative inline-flex">
      <input
        type="text"
        name={name}
        aria-label={label}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        // a new condition starts here: the person just chose the field
        autoFocus={autoFocus}
        value={draft}
        inputMode={numeric ? 'decimal' : undefined}
        autoComplete="off"
        spellCheck={false}
        onChange={(event) => {
          setDraft(event.target.value);
          setError(null);
        }}
        onBlur={() => {
          // leaving an untouched field changes nothing (and a new, empty one just goes away)
          if (!settled.current && draft !== value) commit();
          settled.current = false;
          onDone();
        }}
        onKeyDown={(event: KeyboardEvent<HTMLInputElement>) => {
          if (event.nativeEvent.isComposing || event.keyCode === 229) return;
          if (event.key === 'Enter') {
            // Enter applies and is done with the field; an invalid value keeps it, with the reason
            event.preventDefault();
            if (draft === value || commit()) {
              settled.current = true;
              event.currentTarget.blur();
            }
          } else if (event.key === 'Escape') {
            // the typing is taken back
            event.preventDefault();
            setDraft(value);
            setError(null);
            settled.current = true;
            event.currentTarget.blur();
          }
        }}
        className={cx(
          'h-11 rounded-chip bg-transparent px-1.5 text-input text-ink outline-none md:h-6 md:text-sm',
          numeric ? 'w-20 tabular-nums' : 'w-36',
          error ? 'shadow-[inset_0_-1.5px_0_var(--danger)]' : 'shadow-[inset_0_-1.5px_0_var(--line-input)] focus:shadow-[inset_0_-2px_0_var(--focus-ring)]',
        )}
      />
      {/* polite and always there, so an error that appears is announced */}
      <span aria-live="polite" className="absolute top-full left-0 z-10 mt-1">
        {error && (
          <span id={errorId} className="block w-max max-w-64 rounded-chip bg-danger px-2 py-1 text-sm font-medium text-on-danger shadow-elev-2">
            {error}
          </span>
        )}
      </span>
    </span>
  );
}

function TextValue({ condition, def, onChange, open, onOpenChange }: ValueEditorProps) {
  return (
    <InlineInput
      name="filter-text"
      label={`${def.label} ${operatorLabel(condition.op)}`}
      value={typeof condition.value === 'string' ? condition.value : ''}
      parse={(text) => (text.trim() === '' ? { error: 'Gib einen Text ein.' } : { value: text.trim() })}
      onCommit={(value) => onChange({ ...condition, value })}
      autoFocus={open}
      onDone={() => onOpenChange(false)}
    />
  );
}

const numberParse = (text: string) => {
  const value = parseGermanNumber(text);
  return value === null ? { error: 'Nur eine Zahl, zum Beispiel 3,5' } : { value };
};
const numberText = (value: unknown) => (typeof value === 'number' ? NUMBER.format(value) : '');

function NumberValue({ condition, def, onChange, open, onOpenChange }: ValueEditorProps) {
  if (condition.op === 'between') {
    const [from, to] = Array.isArray(condition.value) ? condition.value : [null, null];
    return (
      <>
        <InlineInput numeric name="filter-number-from" label={`${def.label} von`} value={numberText(from)} parse={numberParse} onCommit={(next) => onChange({ ...condition, value: [next, to] })} autoFocus={open} onDone={() => onOpenChange(false)} />
        <span className="text-sm text-muted">und</span>
        <InlineInput numeric name="filter-number-to" label={`${def.label} bis`} value={numberText(to)} parse={numberParse} onCommit={(next) => onChange({ ...condition, value: [from, next] })} autoFocus={false} onDone={() => onOpenChange(false)} />
      </>
    );
  }
  return <InlineInput numeric name="filter-number" label={`${def.label} ${operatorLabel(condition.op)}`} value={numberText(condition.value)} parse={numberParse} onCommit={(next) => onChange({ ...condition, value: next })} autoFocus={open} onDone={() => onOpenChange(false)} />;
}

function FlagValue({ condition, def, onChange }: ValueEditorProps) {
  const on = condition.value !== false;
  return (
    <Menu>
      <MenuTrigger render={<button type="button" aria-label={`${def.label}: ${on ? 'ja' : 'nein'}`} className={cx(part, 'text-ink')} />}>
        {on ? 'ja' : 'nein'}
        <ChevronDown className="size-3 text-muted" aria-hidden="true" />
      </MenuTrigger>
      <MenuContent className="min-w-32">
        <MenuRadioGroup value={on ? 'yes' : 'no'} onValueChange={(next) => onChange({ field: condition.field, op: 'is', value: next === 'yes' })}>
          <MenuRadioItem value="yes">ja</MenuRadioItem>
          <MenuRadioItem value="no">nein</MenuRadioItem>
        </MenuRadioGroup>
      </MenuContent>
    </Menu>
  );
}

/** The value of a condition in words, for the chip's name: "Todo, In Progress", "diese Woche", "3,5". */
export function useConditionText(condition: Condition, def: FieldDef | null, project?: Project): string {
  const { options } = useValueOptions(def ?? { field: condition.field, label: condition.field, kind: 'text', nullable: false }, project);
  if (!def || VALUELESS.has(condition.op)) return '';
  switch (def.kind) {
    case 'enum':
    case 'list':
      return chosenDisplay(options, valuesOf(condition).map(String)).text;
    case 'date':
      return condition.op === 'between' && Array.isArray(condition.value) ? `${dateValueLabel(condition.value[0])} und ${dateValueLabel(condition.value[1])}` : dateValueLabel(condition.value);
    case 'flag':
      return condition.value === false ? 'nein' : 'ja';
    case 'number':
      return condition.op === 'between' && Array.isArray(condition.value) ? `${numberText(condition.value[0])} und ${numberText(condition.value[1])}` : numberText(condition.value);
    default:
      return typeof condition.value === 'string' ? `„${condition.value}“` : '';
  }
}

/* ---------------------------------------------------------------------------- the chip */

type ConditionEditorProps = {
  condition: Condition;
  /** Null: a field the filter bar does not know (an old link); it can only be removed. */
  def: FieldDef | null;
  onChange: (condition: Condition) => void;
  onRemove: () => void;
  /** Just added: the value editor opens at once. */
  fresh?: boolean;
  /** The value editor closed (the filter bar drops a condition that still has no value). */
  onDone?: () => void;
  /** The project of a project list: its workflow's states. */
  project?: Project;
};

export function ConditionEditor({ condition, def, onChange, onRemove, fresh = false, onDone, project }: ConditionEditorProps) {
  const [open, setOpen] = useState(fresh);
  const text = useConditionText(condition, def, project);
  const count = valuesOf(condition).length;
  const operator = operatorLabel(condition.op, count);
  const name = def ? [def.label, operator, text].filter(Boolean).join(' ') : `Unbekanntes Feld ${condition.field}`;

  const setEditorOpen = (next: boolean) => {
    setOpen(next);
    if (!next) onDone?.();
  };

  let value: ReactNode = null;
  if (def && !VALUELESS.has(condition.op)) {
    const props = { condition, def, onChange, open, onOpenChange: setEditorOpen, project };
    if (def.kind === 'enum' || def.kind === 'list') value = <EnumValue {...props} />;
    else if (def.kind === 'date') value = <DateValue {...props} />;
    else if (def.kind === 'flag') value = <FlagValue {...props} />;
    else if (def.kind === 'number') value = <NumberValue {...props} />;
    else value = <TextValue {...props} />;
  }

  const ops: ConditionOp[] = def ? operatorsFor(def) : [];
  return (
    <div
      role="group"
      aria-label={`Filter: ${name}${isComplete(condition) ? '' : ', noch ohne Wert'}`}
      className="inline-flex h-11 max-w-full min-w-0 items-center gap-0.5 rounded-ctl border border-line bg-surface pr-0.5 pl-2 text-sm text-ink shadow-elev-1 md:h-7"
    >
      <span className="shrink-0 font-medium">{def?.label ?? condition.field}</span>
      {def && ops.length > 1 ? (
        <Menu>
          <MenuTrigger render={<button type="button" aria-label={`Operator: ${operator}`} className={cx(part, 'text-muted hover:text-ink')} />}>
            {operator}
          </MenuTrigger>
          <MenuContent className="min-w-44">
            <MenuRadioGroup
              value={operatorFamily(condition.op)}
              onValueChange={(next) => {
                const changed = withOperator(condition, next as ConditionOp, def);
                onChange(changed);
                // a value is missing now (e.g. after "ist leer"): ask for it
                if (!isComplete(changed)) setOpen(true);
              }}
            >
              {ops.map((op) => (
                <MenuRadioItem key={op} value={op}>
                  {operatorLabel(op)}
                </MenuRadioItem>
              ))}
            </MenuRadioGroup>
          </MenuContent>
        </Menu>
      ) : (
        <span className="shrink-0 px-1.5 text-muted">{def ? operator : ''}</span>
      )}
      {value}
      <IconButton icon={X} size="sm" label={`Filter „${def?.label ?? condition.field}“ entfernen`} tooltip={false} onClick={onRemove} />
    </div>
  );
}
