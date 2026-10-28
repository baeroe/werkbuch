/*
 * The picker every field editor is built from: a trigger that shows the value, and a list on strong tracing paper with
 * a search field on top (Base UI Combobox with the input inside the popup). Typing filters, the arrows move, Enter
 * chooses, Escape closes and gives the focus back to the trigger.
 *
 * Looks of the trigger:
 * - `field`: a value in the fields of the detail panel (moodboard), a ghost button
 * - `chip`: inline in a list row
 * - `avatar`: the assignee of a row, only the avatar
 * - `bare`: no frame of its own, for content that brings its own chips (the labels of a row)
 * - `form`: a field of a dialog, with the writing line and a chevron
 * Without the right to change the item the trigger is read-only: still focusable, at full contrast, and its tooltip
 * says why (`disabledReason`).
 */

import { Combobox } from '@base-ui/react/combobox';
import { Check, ChevronDown, LoaderCircle, RotateCw, Search } from 'lucide-react';
import { useId, useRef, type ReactElement, type ReactNode, type Ref } from 'react';
import { Button } from '@/components/ui/Button';
import { cx } from '@/components/ui/cx';
import { ariaKeyshortcuts } from '@/components/ui/Kbd';
import { Skeleton, SkeletonGroup } from '@/components/ui/Skeleton';
import { fieldClass, fieldSize, keptSide, optionClass, popupFocus, popupSurface } from '@/components/ui/styles';
import { Tooltip } from '@/components/ui/Tooltip';

export interface PickerOption {
  value: string;
  label: string;
  /** 16 px slot before the label (status icon, avatar, tone dot …); decorative, the label says it. */
  icon?: ReactNode;
  /** Muted word after the label, e.g. "Bot". Part of the option's name. */
  hint?: string;
  /** More words that find the option: an item's key, a person's handle. */
  keywords?: string[];
  disabled?: boolean;
}

export type PickerLook = 'field' | 'chip' | 'avatar' | 'bare' | 'form';

/** What the list shows instead of options while they load or after they failed. */
export interface PickerLoad {
  isLoading: boolean;
  error: Error | null;
  retry: () => void;
  retrying: boolean;
}

const LOOKS: Record<Exclude<PickerLook, 'form'>, string> = {
  // the ghost button of the moodboard's panel; 44 px tall on phones
  field: '-mx-2 h-11 max-w-[calc(100%+1rem)] gap-1.5 rounded-ctl px-2 text-ui md:h-7',
  chip: 'h-6 max-w-full gap-1 rounded-chip border border-line bg-surface px-1.5 text-sm',
  avatar: 'size-6 justify-center rounded-full',
  bare: 'min-h-6 max-w-full flex-wrap gap-1 rounded-chip',
};

const HOVER: Record<PickerLook, string> = {
  field: 'hover:bg-hover data-popup-open:bg-hover',
  chip: 'hover:border-line-input data-popup-open:border-line-input',
  avatar: 'hover:bg-hover data-popup-open:bg-hover',
  bare: 'hover:bg-hover data-popup-open:bg-hover',
  form: '',
};

/** The class of a trigger in a look; the date fields use it for their popover triggers too. */
export function triggerClass(
  look: PickerLook,
  { readOnly = false, invalid = false, className }: { readOnly?: boolean; invalid?: boolean; className?: string } = {},
): string {
  return cx(
    'inline-flex min-w-0 shrink-0 items-center text-ink transition-colors duration-120 select-none',
    // read-only form fields sit in the sunken colour without the writing line: a value, not a field to fill in
    look === 'form' ? cx(readOnly ? 'rounded-ctl border border-line bg-sunken' : fieldClass(invalid), fieldSize, 'w-full gap-2 text-left') : LOOKS[look],
    readOnly ? 'cursor-default' : cx('cursor-pointer', HOVER[look]),
    className,
  );
}

/** The spinner of a change on its way (`aria-busy` on the trigger says it to screen readers). */
export function PendingMark() {
  return <LoaderCircle className="size-3.5 shrink-0 animate-spin text-muted" aria-hidden="true" />;
}

/** "Status ändern" with the shortcut, or the reason why it is read-only; no tooltip without content. */
export function withTooltip(trigger: ReactElement, content: string | null, shortcut?: string) {
  if (!content) return trigger;
  return (
    <Tooltip content={content} shortcut={shortcut}>
      {trigger}
    </Tooltip>
  );
}

type ReadOnlyTriggerProps = {
  look: PickerLook;
  className?: string;
  /** The accessible name: "Status: In Progress". */
  name: string;
  reason: string;
  children: ReactNode;
  tabIndex?: number;
  id?: string;
};

/** The value as a trigger that does nothing but say why (tooltip and description). */
export function ReadOnlyTrigger({ look, className, name, reason, children, tabIndex, id }: ReadOnlyTriggerProps) {
  const reasonId = useId();
  return withTooltip(
    <button
      type="button"
      id={id}
      aria-label={name}
      aria-disabled="true"
      aria-describedby={reasonId}
      tabIndex={tabIndex}
      className={triggerClass(look, { readOnly: true, className })}
    >
      {children}
      <span id={reasonId} hidden>
        {reason}
      </span>
    </button>,
    reason,
  );
}

/** Rows a list shows at once; longer lists (the items of a project) are narrowed by typing instead of virtualized. */
const LIMIT = 50;

const matches = (option: PickerOption, query: string): boolean => {
  const haystack = [option.label, option.hint, ...(option.keywords ?? [])].join(' ').toLocaleLowerCase('de-DE');
  return query
    .toLocaleLowerCase('de-DE')
    .split(/\s+/)
    .filter(Boolean)
    .every((term) => haystack.includes(term));
};

type Choice =
  | { multiple?: false; value: string | null; onValueChange: (value: string) => void }
  | { multiple: true; value: string[]; onValueChange: (values: string[]) => void };

export type PickerProps = Choice & {
  /** The field: "Status", "Assignee". The trigger is named "<label>: <displayText>", the list "<label> wählen". */
  label: string;
  /** What the trigger shows. */
  display: ReactNode;
  /** The value in words, for the trigger's name: "In Progress", "Nicht zugewiesen". */
  displayText: string;
  look?: PickerLook;
  options: PickerOption[];
  /** Placeholder of the search field, e.g. "Status suchen …". */
  placeholder: string;
  /** Shown when nothing matches (or there is nothing to choose). */
  emptyText?: string;
  /** Loading and error of the options. */
  load?: PickerLoad;
  /** Not allowed: the trigger is read-only and says why. */
  disabledReason?: string | null;
  /** A change is on its way. */
  pending?: boolean;
  /** The shortcut that does the same (register notation), for the tooltip and aria-keyshortcuts. */
  shortcut?: string;
  id?: string;
  /** Form look: the frame and writing line in the danger colour. */
  invalid?: boolean;
  /** Rows set -1: the row is the tab stop, the shortcuts change its fields. */
  tabIndex?: number;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  defaultOpen?: boolean;
  /** false: the page stays usable while the list is open (the gallery keeps lists open). */
  modal?: boolean;
  /** Keep the list below the trigger even without room. */
  keepSide?: boolean;
  /** The trigger, e.g. to give it the focus back after a follow-up dialog. */
  triggerRef?: Ref<HTMLButtonElement>;
  /** Extra classes of the trigger. */
  className?: string;
};

export function Picker(props: PickerProps) {
  const {
    label,
    display,
    displayText,
    look = 'field',
    options,
    placeholder,
    emptyText = 'Nichts gefunden.',
    load,
    disabledReason,
    pending = false,
    shortcut,
    id,
    invalid = false,
    tabIndex,
    open,
    onOpenChange,
    defaultOpen,
    modal,
    keepSide,
    triggerRef,
    className,
  } = props;
  const name = `${label}: ${displayText}`;
  // a list that starts open (the gallery's specimens) leaves the focus where it is that first time
  const startsOpen = useRef(Boolean(defaultOpen));
  const content = (
    <>
      {display}
      {pending && <PendingMark />}
      {look === 'form' && <ChevronDown className="ml-auto size-4 shrink-0 text-muted transition-transform duration-160 group-data-popup-open:rotate-180" aria-hidden="true" />}
    </>
  );

  if (disabledReason) {
    return (
      <ReadOnlyTrigger look={look} className={className} name={name} reason={disabledReason} tabIndex={tabIndex} id={id}>
        {content}
      </ReadOnlyTrigger>
    );
  }

  const chosen = props.multiple ? options.filter((option) => props.value.includes(option.value)) : options.filter((option) => option.value === props.value);
  const body = load?.isLoading ? (
    <SkeletonGroup label="Auswahl wird geladen …" className="flex flex-col gap-3.5 px-3 py-3">
      <Skeleton className="h-3.5 w-2/3" />
      <Skeleton className="h-3.5 w-1/2" />
      <Skeleton className="h-3.5 w-3/5" />
    </SkeletonGroup>
  ) : load?.error ? (
    <div role="alert" className="m-1.5 flex flex-col items-start gap-2 rounded-ctl bg-danger-soft px-3 py-2.5 text-ui text-ink">
      <p className="text-pretty">Die Auswahl konnte nicht geladen werden: {load.error.message}</p>
      <Button variant="secondary" size="sm" icon={RotateCw} pending={load.retrying} onClick={load.retry}>
        Erneut versuchen
      </Button>
    </div>
  ) : (
    <>
      <Combobox.Empty className="px-3 py-2.5 text-ui text-pretty text-muted empty:hidden">{emptyText}</Combobox.Empty>
      <Combobox.List className={cx('overflow-y-auto overscroll-contain p-1 empty:p-0', keepSide ? 'max-h-72' : 'max-h-[min(18rem,calc(var(--available-height)-3rem))]')}>
        {(option: PickerOption) => (
          <Combobox.Item key={option.value} value={option} disabled={option.disabled} className={optionClass}>
            {option.icon && (
              <span className="inline-flex size-4 shrink-0 items-center justify-center" aria-hidden="true">
                {option.icon}
              </span>
            )}
            <span className="min-w-0 flex-1 truncate">{option.label}</span>
            {option.hint && <span className="shrink-0 text-sm text-muted">{option.hint}</span>}
            <Combobox.ItemIndicator className="inline-flex shrink-0 text-accent-text">
              <Check className="size-4" aria-hidden="true" />
            </Combobox.ItemIndicator>
          </Combobox.Item>
        )}
      </Combobox.List>
    </>
  );

  return (
    <Combobox.Root
      items={options}
      multiple={props.multiple}
      value={props.multiple ? chosen : (chosen[0] ?? null)}
      onValueChange={(next: PickerOption | PickerOption[] | null) => {
        if (props.multiple) props.onValueChange(((next as PickerOption[] | null) ?? []).map((option) => option.value));
        // choosing the current value again changes nothing
        else if (next && !Array.isArray(next) && next.value !== props.value) props.onValueChange(next.value);
      }}
      itemToStringLabel={(option: PickerOption) => option.label}
      isItemEqualToValue={(option: PickerOption, other: PickerOption) => option.value === other.value}
      filter={(option: PickerOption, query: string) => matches(option, query)}
      limit={LIMIT}
      autoHighlight
      open={open}
      onOpenChange={onOpenChange ? (next) => onOpenChange(next) : undefined}
      defaultOpen={defaultOpen}
      modal={modal}
    >
      {withTooltip(
        <Combobox.Trigger
          ref={triggerRef}
          id={id}
          aria-label={name}
          aria-busy={pending || undefined}
          aria-invalid={invalid || undefined}
          aria-keyshortcuts={shortcut ? ariaKeyshortcuts(shortcut) : undefined}
          tabIndex={tabIndex}
          className={cx('group', triggerClass(look, { invalid, className }))}
        >
          {content}
        </Combobox.Trigger>,
        shortcut ? `${label} ändern` : null,
        shortcut,
      )}
      <Combobox.Portal>
        <Combobox.Positioner align="start" sideOffset={6} collisionAvoidance={keepSide ? keptSide : undefined} className="z-50 outline-none">
          <Combobox.Popup
            {...popupFocus}
            initialFocus={() => {
              if (!startsOpen.current) return true;
              startsOpen.current = false;
              return false;
            }}
            aria-label={`${label} wählen`}
            className={cx(popupSurface, 'flex w-72 max-w-[var(--available-width)] flex-col overflow-hidden')}
          >
            {/* the writing line of the search field turns to the focus colour while it has the focus */}
            <div className="flex shrink-0 items-center gap-2 border-b border-edge px-3 focus-within:shadow-[inset_0_-2px_0_var(--focus-ring)]">
              <Search className="size-4 shrink-0 text-muted" aria-hidden="true" />
              <Combobox.Input
                name="picker-query"
                placeholder={placeholder}
                aria-label={placeholder}
                data-focus-ring="none"
                autoComplete="off"
                spellCheck={false}
                className="h-11 min-w-0 flex-1 bg-transparent text-input text-ink outline-none placeholder:text-muted md:h-9 md:text-ui"
              />
            </div>
            {body}
            {options.length > LIMIT && !load?.isLoading && !load?.error && (
              <p className="border-t border-edge px-3 py-2 text-sm text-pretty text-muted">Die ersten {LIMIT} von {options.length}. Tippen grenzt die Liste ein.</p>
            )}
          </Combobox.Popup>
        </Combobox.Positioner>
      </Combobox.Portal>
    </Combobox.Root>
  );
}

/** What every field editor passes on to its picker: look, shortcut hint, open state, tab stop. */
export type PickerExtras = Pick<PickerProps, 'look' | 'shortcut' | 'open' | 'onOpenChange' | 'defaultOpen' | 'modal' | 'keepSide' | 'tabIndex' | 'id'>;
