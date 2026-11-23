/*
 * A command to paste into a terminal: shown in full (it wraps, nothing is cut off), with a button that copies it.
 * When the clipboard says no, the text is selected and the line says to press the copy shortcut.
 */

import { Check, Copy } from 'lucide-react';
import { useId, useRef } from 'react';
import { Button } from '@/components/ui/Button';
import { cx } from '@/components/ui/cx';
import { Kbd } from '@/components/ui/Kbd';
import { useCopy } from '@/features/settings/org/CopyField';

type CommandBlockProps = {
  label: string;
  command: string;
  /** Under the block while nothing was copied. */
  hint?: string;
  className?: string;
};

export function CommandBlock({ label, command, hint, className }: CommandBlockProps) {
  const id = useId();
  const box = useRef<HTMLElement>(null);
  const { state, copy } = useCopy();

  function selectAll() {
    const selection = window.getSelection();
    if (!box.current || !selection) return;
    const range = document.createRange();
    range.selectNodeContents(box.current);
    selection.removeAllRanges();
    selection.addRange(range);
  }

  return (
    <div className={cx('flex min-w-0 flex-col', className)}>
      <p id={`${id}-label`} className="mb-1.5 text-ui font-medium text-ink">
        {label}
      </p>
      <div className="flex flex-col gap-2 rounded-ctl border border-line bg-sunken p-3 sm:flex-row sm:items-start">
        <code
          ref={box}
          aria-labelledby={`${id}-label`}
          translate="no"
          // the prompt sign is no part of what is copied
          className="min-w-0 flex-1 text-ui break-words text-ink tabular-nums before:mr-2 before:text-muted before:content-['$']"
        >
          {command}
        </code>
        <Button
          variant="secondary"
          size="sm"
          icon={state === 'copied' ? Check : Copy}
          aria-describedby={`${id}-status`}
          onClick={() =>
            void copy(command, null).then(() => {
              if (!navigator.clipboard) selectAll();
            })
          }
          className="self-start"
        >
          {state === 'copied' ? 'Kopiert' : 'Befehl kopieren'}
        </Button>
      </div>
      <p id={`${id}-status`} role="status" className={cx('mt-1.5 min-h-4 text-sm text-pretty', state === 'failed' ? 'font-medium text-ink' : 'text-muted')}>
        {state === 'copied' && 'In die Zwischenablage kopiert.'}
        {state === 'failed' && (
          <>
            Das Kopieren hat nicht geklappt. Markiere den Befehl und drücke <Kbd keys="mod+c" className="mx-0.5 align-middle" />.
          </>
        )}
        {state === 'idle' && hint}
      </p>
    </div>
  );
}
