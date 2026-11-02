/*
 * A small field in a chip (text and numbers): kept on Enter or when the focus leaves, Escape takes the typing back. A
 * text it cannot read stays with the reason below the field; leaving keeps nothing then.
 */

import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { cx } from '@/components/ui/cx';
import { MAX_TEXT } from '@/components/fields/property/parse';

export type InlineParse = (text: string) => { value: unknown } | { error: string };

type InlineInputProps = {
  name: string;
  label: string;
  value: string;
  parse: InlineParse;
  onCommit: (value: unknown) => void;
  /** A new condition starts here: the person just chose the field. */
  autoFocus: boolean;
  numeric?: boolean;
};

export function InlineInput({ name, label, value, parse, onCommit, autoFocus, numeric = false }: InlineInputProps) {
  const [draft, setDraft] = useState(value);
  const [error, setError] = useState<string | null>(null);
  const errorId = useId();
  /** Enter or Escape decided already; the blur that follows changes nothing. */
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
        autoFocus={autoFocus}
        value={draft}
        maxLength={MAX_TEXT}
        inputMode={numeric ? 'decimal' : undefined}
        autoComplete="off"
        spellCheck={false}
        onChange={(event) => {
          setDraft(event.target.value);
          setError(null);
          settled.current = false;
        }}
        onBlur={() => {
          // leaving an untouched field changes nothing
          if (!settled.current && draft !== value) commit();
          settled.current = false;
        }}
        onKeyDown={(event: KeyboardEvent<HTMLInputElement>) => {
          if (event.nativeEvent.isComposing || event.keyCode === 229) return;
          if (event.key === 'Enter') {
            // Enter applies; an invalid value stays, with the reason
            event.preventDefault();
            if (draft === value || commit()) settled.current = true;
          } else if (event.key === 'Escape' && (draft !== value || error)) {
            // the typing is taken back, the focus stays
            event.preventDefault();
            setDraft(value);
            setError(null);
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
