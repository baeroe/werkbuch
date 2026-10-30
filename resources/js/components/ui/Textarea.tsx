import { useId, type ComponentProps } from 'react';
import { cx } from './cx';
import { describedBy, Field, type FieldText } from './Field';
import { fieldClass } from './styles';

type TextareaProps = ComponentProps<'textarea'> & FieldText;

/** Multi-line input with the writing line; it grows with its content up to a limit. */
export function Textarea({ id, label, hint, error, className, rows = 3, 'aria-describedby': extraDescribedBy, ...rest }: TextareaProps) {
  const autoId = useId();
  const textareaId = id ?? autoId;

  const textarea = (
    <textarea
      id={textareaId}
      rows={rows}
      aria-invalid={error ? true : undefined}
      aria-describedby={describedBy(textareaId, { hint, error }, extraDescribedBy)}
      className={cx(fieldClass(Boolean(error)), 'block max-h-80 min-h-24 resize-none px-3 py-2 text-input [field-sizing:content] md:text-md', className)}
      {...rest}
    />
  );

  if (!label && !hint && !error) return textarea;
  return (
    <Field id={textareaId} label={label} hint={hint} error={error}>
      {textarea}
    </Field>
  );
}
