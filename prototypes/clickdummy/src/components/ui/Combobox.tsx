import { Combobox as BaseCombobox } from '@base-ui/react/combobox';
import { Check, ChevronDown, X } from 'lucide-react';
import { useId, type ReactNode } from 'react';
import { cx } from './cx';
import { describedBy, Field, type FieldText } from './Field';
import { fieldClass, fieldSize, keptSide, optionClass, popupFocus, popupSurface } from './styles';

export type ComboboxOption = { value: string; label: string; icon?: ReactNode; disabled?: boolean };

type ComboboxProps = FieldText & {
  options: ComboboxOption[];
  value: string | null;
  onValueChange: (value: string | null) => void;
  placeholder?: string;
  /** Shown when the search finds nothing. */
  emptyText?: string;
  disabled?: boolean;
  id?: string;
  /** The name of the search input (it takes no autofill: autocomplete is off). */
  name?: string;
  'aria-label'?: string;
  className?: string;
  defaultOpen?: boolean;
  defaultInputValue?: string;
  /** Keep the list below the field even without room. */
  keepSide?: boolean;
};

/** Pick one value from a long list by typing; the matches float on tracing paper below. */
export function Combobox({
  label,
  hint,
  error,
  options,
  value,
  onValueChange,
  placeholder = 'Suchen …',
  emptyText = 'Keine Treffer',
  disabled,
  id,
  className,
  defaultOpen,
  defaultInputValue,
  keepSide,
  ...rest
}: ComboboxProps) {
  const autoId = useId();
  const inputId = id ?? autoId;
  const selected = options.find((option) => option.value === value) ?? null;

  return (
    <BaseCombobox.Root
      items={options}
      value={selected}
      onValueChange={(next) => onValueChange(next?.value ?? null)}
      itemToStringLabel={(option) => option.label}
      itemToStringValue={(option) => option.value}
      isItemEqualToValue={(option, other) => option.value === other.value}
      // typing narrows the list and Enter takes the first match
      autoHighlight
      disabled={disabled}
      defaultOpen={defaultOpen}
      defaultInputValue={defaultInputValue}
    >
      <Field id={inputId} label={label} hint={hint} error={error} className={className}>
        <BaseCombobox.InputGroup className="relative flex">
          <BaseCombobox.Input
            id={inputId}
            placeholder={placeholder}
            autoComplete="off"
            {...rest}
            aria-invalid={error ? true : undefined}
            aria-describedby={describedBy(inputId, { hint, error })}
            className={cx(fieldClass(Boolean(error)), fieldSize, selected && !disabled ? 'pr-24 md:pr-16' : 'pr-12 md:pr-9')}
          />
          <span className="absolute inset-y-0 right-1 flex items-center">
            <BaseCombobox.Clear
              aria-label="Auswahl entfernen"
              className="inline-flex size-11 cursor-pointer items-center justify-center rounded-chip text-muted transition-colors duration-120 hover:bg-hover hover:text-ink data-disabled:hidden md:size-7"
            >
              <X className="size-3.5" aria-hidden="true" />
            </BaseCombobox.Clear>
            <BaseCombobox.Trigger
              aria-label="Liste öffnen"
              className="group inline-flex size-11 cursor-pointer items-center justify-center rounded-chip text-muted transition-colors duration-120 hover:bg-hover hover:text-ink md:size-7"
            >
              <ChevronDown className="size-4 transition-transform duration-160 group-data-popup-open:rotate-180" aria-hidden="true" />
            </BaseCombobox.Trigger>
          </span>
        </BaseCombobox.InputGroup>
      </Field>
      <BaseCombobox.Portal>
        <BaseCombobox.Positioner sideOffset={6} collisionAvoidance={keepSide ? keptSide : undefined} className="z-50 outline-none">
          <BaseCombobox.Popup {...popupFocus} className={cx(popupSurface, 'w-[var(--anchor-width)] max-w-[var(--available-width)]')}>
            <BaseCombobox.Empty className="px-3 py-2.5 text-ui text-muted empty:hidden">{emptyText}</BaseCombobox.Empty>
            <BaseCombobox.List className={cx('overflow-y-auto overscroll-contain p-1 empty:p-0', keepSide ? 'max-h-80' : 'max-h-[min(20rem,var(--available-height))]')}>
              {(option: ComboboxOption) => (
                <BaseCombobox.Item key={option.value} value={option} disabled={option.disabled} className={optionClass}>
                  {option.icon && (
                    <span className="inline-flex shrink-0" aria-hidden="true">
                      {option.icon}
                    </span>
                  )}
                  <span className="min-w-0 flex-1 truncate">{option.label}</span>
                  <BaseCombobox.ItemIndicator className="ml-auto inline-flex shrink-0 text-accent-text">
                    <Check className="size-4" aria-hidden="true" />
                  </BaseCombobox.ItemIndicator>
                </BaseCombobox.Item>
              )}
            </BaseCombobox.List>
          </BaseCombobox.Popup>
        </BaseCombobox.Positioner>
      </BaseCombobox.Portal>
    </BaseCombobox.Root>
  );
}
