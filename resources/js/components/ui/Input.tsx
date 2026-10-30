import { useId, type ComponentProps } from 'react';
import { cx } from './cx';
import { describedBy, Field, type FieldText } from './Field';
import { fieldClass, fieldSize } from './styles';

type InputProps = ComponentProps<'input'> & FieldText;

/** Text input with the writing line. With label, hint or error it renders the whole field. */
export function Input({ id, label, hint, error, className, 'aria-describedby': extraDescribedBy, ...rest }: InputProps) {
  const autoId = useId();
  const inputId = id ?? autoId;

  const input = (
    <input
      id={inputId}
      aria-invalid={error ? true : undefined}
      aria-describedby={describedBy(inputId, { hint, error }, extraDescribedBy)}
      className={cx(fieldClass(Boolean(error)), fieldSize, className)}
      {...rest}
    />
  );

  if (!label && !hint && !error) return input;
  return (
    <Field id={inputId} label={label} hint={hint} error={error}>
      {input}
    </Field>
  );
}
