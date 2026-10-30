import { CircleAlert } from 'lucide-react';
import type { ReactNode } from 'react';
import { cx } from './cx';
import { labelClass } from './styles';

export type FieldText = { label?: ReactNode; hint?: ReactNode; error?: ReactNode };

/** Ids of the parts, so a control can point at its label and description. */
export const fieldIds = (id: string) => ({ label: `${id}-label`, hint: `${id}-hint`, error: `${id}-error` });

/** aria-describedby for the control: the error replaces the hint while it is shown. */
export function describedBy(id: string, { hint, error }: FieldText, extra?: string): string | undefined {
  const own = error ? fieldIds(id).error : hint ? fieldIds(id).hint : undefined;
  return [own, extra].filter(Boolean).join(' ') || undefined;
}

type FieldProps = FieldText & { id: string; className?: string; children: ReactNode };

/**
 * Label, control and hint or error (with icon and the concrete fix) stacked like in the moodboard. The error
 * slot is a polite live region that stays rendered while empty, so an error that appears is announced.
 */
export function Field({ id, label, hint, error, className, children }: FieldProps) {
  const ids = fieldIds(id);
  return (
    <div className={cx('flex min-w-0 flex-col', className)}>
      {label && (
        <label id={ids.label} htmlFor={id} className={cx(labelClass, 'mb-1.5')}>
          {label}
        </label>
      )}
      {children}
      {hint && !error && (
        <p id={ids.hint} className="mt-1.5 text-sm text-muted">
          {hint}
        </p>
      )}
      <div aria-live="polite">
        {error && (
          <p id={ids.error} className="mt-1.5 flex items-start gap-1.5 text-sm font-medium text-danger">
            <CircleAlert className="mt-px size-3.5 shrink-0" aria-hidden="true" />
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
