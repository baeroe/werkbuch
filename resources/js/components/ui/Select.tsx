import { Select as BaseSelect } from '@base-ui/react/select';
import { Check, ChevronDown } from 'lucide-react';
import { useId, type ReactNode } from 'react';
import { t } from '@/lib/i18n';
import { cx } from './cx';
import { describedBy, Field, fieldIds, type FieldText } from './Field';
import { fieldClass, fieldSize, keptSide, optionClass, popupFocus, popupSurface } from './styles';

export type SelectOption = { value: string; label: string; icon?: ReactNode; disabled?: boolean };

type SelectProps = FieldText & {
  options: SelectOption[];
  value: string | null;
  onValueChange: (value: string | null) => void;
  placeholder?: string;
  disabled?: boolean;
  id?: string;
  /** Name without a visible label. */
  'aria-label'?: string;
  className?: string;
  defaultOpen?: boolean;
  /** false lets the page stay usable while the list is open (the gallery keeps one open). */
  modal?: boolean;
  /** Keep the list below the field even without room. */
  keepSide?: boolean;
};

/** Pick one value from a short list; the list floats on tracing paper below the field. */
export function Select({ label, hint, error, options, value, onValueChange, placeholder = t('ui.select.placeholder'), disabled, id, className, defaultOpen, modal, keepSide, 'aria-label': ariaLabel }: SelectProps) {
  const autoId = useId();
  const triggerId = id ?? autoId;
  const valueId = `${triggerId}-value`;
  const selected = options.find((option) => option.value === value);

  return (
    <BaseSelect.Root
      items={options.map((option) => ({ value: option.value, label: option.label }))}
      value={value}
      onValueChange={(next) => onValueChange(next)}
      disabled={disabled}
      defaultOpen={defaultOpen}
      modal={modal}
    >
      <Field id={triggerId} label={label} hint={hint} error={error} className={className}>
        <BaseSelect.Trigger
          id={triggerId}
          aria-label={ariaLabel}
          aria-labelledby={label ? `${fieldIds(triggerId).label} ${valueId}` : undefined}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy(triggerId, { hint, error })}
          className={cx(fieldClass(Boolean(error)), fieldSize, 'group flex cursor-pointer items-center gap-2 text-left data-disabled:cursor-not-allowed data-disabled:bg-sunken data-disabled:text-muted')}
        >
          {selected?.icon && (
            <span className="inline-flex shrink-0" aria-hidden="true">
              {selected.icon}
            </span>
          )}
          <BaseSelect.Value id={valueId} placeholder={placeholder} className="min-w-0 flex-1 truncate data-placeholder:text-muted" />
          <BaseSelect.Icon className="inline-flex shrink-0 text-muted">
            <ChevronDown className="size-4 transition-transform duration-160 group-data-popup-open:rotate-180" aria-hidden="true" />
          </BaseSelect.Icon>
        </BaseSelect.Trigger>
      </Field>
      <BaseSelect.Portal>
        <BaseSelect.Positioner alignItemWithTrigger={false} sideOffset={6} collisionAvoidance={keepSide ? keptSide : undefined} className="z-50 outline-none">
          <BaseSelect.Popup {...popupFocus} className={cx(popupSurface, 'min-w-[var(--anchor-width)]')}>
            <BaseSelect.List className={cx('overflow-y-auto overscroll-contain p-1', keepSide ? 'max-h-80' : 'max-h-[min(20rem,var(--available-height))]')}>
              {options.map((option) => (
                <BaseSelect.Item key={option.value} value={option.value} disabled={option.disabled} className={optionClass}>
                  {option.icon && (
                    <span className="inline-flex shrink-0" aria-hidden="true">
                      {option.icon}
                    </span>
                  )}
                  <BaseSelect.ItemText className="min-w-0 flex-1 truncate">{option.label}</BaseSelect.ItemText>
                  <BaseSelect.ItemIndicator className="ml-auto inline-flex shrink-0 text-accent-text">
                    <Check className="size-4" aria-hidden="true" />
                  </BaseSelect.ItemIndicator>
                </BaseSelect.Item>
              ))}
            </BaseSelect.List>
          </BaseSelect.Popup>
        </BaseSelect.Positioner>
      </BaseSelect.Portal>
    </BaseSelect.Root>
  );
}
