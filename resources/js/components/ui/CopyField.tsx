/*
 * A value to take along: an invitation link, a token, a webhook secret. A read-only field with a button that copies
 * it. The clipboard can say no (no permission, no secure context, an old browser): the write is caught, the text is
 * selected instead and the message says to press the copy shortcut. Nothing is lost and the person is never left
 * guessing whether it worked.
 */

import { Check, Copy } from 'lucide-react';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { t } from '@/lib/i18n';
import { Button } from './Button';
import { cx } from './cx';
import { Kbd } from './Kbd';
import { fieldClass, fieldSize, labelClass } from './styles';

export type CopyState = 'idle' | 'copied' | 'failed';

const RESET_MS = 2500;
const SHORTCUT_SLOT = '\u0000';

/** Copies text; on failure it selects the field's text so that the keyboard shortcut can do it. */
export function useCopy(): { state: CopyState; copy: (text: string, field: HTMLInputElement | null) => Promise<void> } {
  const [state, setState] = useState<CopyState>('idle');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);

  async function copy(text: string, field: HTMLInputElement | null) {
    if (timer.current) clearTimeout(timer.current);
    try {
      // a browser without the clipboard API, or one in an insecure context, has no `navigator.clipboard` at all
      if (!navigator.clipboard) throw new Error('clipboard unavailable');
      await navigator.clipboard.writeText(text);
      setState('copied');
      timer.current = setTimeout(() => setState('idle'), RESET_MS);
    } catch {
      field?.focus();
      field?.select();
      setState('failed');
    }
  }

  return { state, copy };
}

type CopyFieldProps = {
  label: string;
  /** The field's name for the browser, e.g. "invitation_link"; a field without one is called "copy". */
  name?: string;
  value: string;
  /** Under the field while nothing was copied yet. */
  hint?: ReactNode;
  /** What the button is called ("Copy link"). */
  buttonLabel?: string;
  className?: string;
};

export function CopyField({ label, name = 'copy', value, hint, buttonLabel = t('common.copy'), className }: CopyFieldProps) {
  const id = useId();
  const field = useRef<HTMLInputElement>(null);
  const { state, copy } = useCopy();
  // the shortcut stands inside the sentence: the text of the language says where
  const [before, after] = t('ui.copy_field.failed', { shortcut: SHORTCUT_SLOT }).split(SHORTCUT_SLOT);

  return (
    <div className={cx('flex min-w-0 flex-col', className)}>
      <label htmlFor={id} className={cx(labelClass, 'mb-1.5')}>
        {label}
      </label>
      <div className="flex flex-wrap gap-2">
        <input
          ref={field}
          id={id}
          name={name}
          autoComplete="off"
          readOnly
          value={value}
          aria-describedby={`${id}-status`}
          // a click or a tab into the field selects all of it, so a copy by hand is one keystroke away
          onFocus={(event) => {
            const input = event.currentTarget;
            input.select();
            // selecting scrolls to the end of a long value; the start ("wb_", "https://") is what people look for
            requestAnimationFrame(() => {
              input.scrollLeft = 0;
            });
          }}
          className={cx(fieldClass(false), fieldSize, 'min-w-0 flex-1 basis-56 truncate')}
        />
        <Button variant="secondary" icon={state === 'copied' ? Check : Copy} onClick={() => void copy(value, field.current)}>
          {state === 'copied' ? t('common.copied') : buttonLabel}
        </Button>
      </div>
      <p id={`${id}-status`} role="status" className={cx('mt-1.5 min-h-4 text-sm text-pretty', state === 'failed' ? 'font-medium text-ink' : 'text-muted')}>
        {state === 'copied' && t('ui.copy_field.copied')}
        {state === 'failed' && (
          <>
            {before}
            <Kbd keys="mod+c" className="mx-0.5 align-middle" />
            {after}
          </>
        )}
        {state === 'idle' && hint}
      </p>
    </div>
  );
}
