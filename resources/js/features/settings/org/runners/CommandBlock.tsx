/*
 * A command to paste into a terminal (port of the clickdummy's CommandBlock): shown in full (it wraps, nothing is cut
 * off), with a button that copies it. When the clipboard says no, the command is selected and the line says to press
 * the copy shortcut, as `CopyField` does.
 */

import { Check, Copy } from 'lucide-react';
import { useEffect, useId, useRef } from 'react';
import { Button } from '@/components/ui/Button';
import { useCopy } from '@/components/ui/CopyField';
import { cx } from '@/components/ui/cx';
import { Kbd } from '@/components/ui/Kbd';
import { t } from '@/lib/i18n';

const SHORTCUT_SLOT = '\u0000';

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
  // the shortcut stands inside the sentence: the text of the language says where
  const [before, after] = t('ui.copy_field.failed', { shortcut: SHORTCUT_SLOT }).split(SHORTCUT_SLOT);

  // the clipboard said no: the command is selected, so the shortcut copies it
  useEffect(() => {
    const selection = window.getSelection();
    if (state !== 'failed' || !box.current || !selection) return;
    const range = document.createRange();
    range.selectNodeContents(box.current);
    selection.removeAllRanges();
    selection.addRange(range);
  }, [state]);

  return (
    // the group carries the name: a `code` element may not be named itself (axe aria-prohibited-attr)
    <div role="group" aria-labelledby={`${id}-label`} className={cx('flex min-w-0 flex-col', className)}>
      <p id={`${id}-label`} className="mb-1.5 text-ui font-medium text-ink">
        {label}
      </p>
      <div className="flex flex-col gap-2 rounded-ctl border border-line bg-sunken p-3 sm:flex-row sm:items-start">
        <code
          ref={box}
          translate="no"
          // the prompt sign is no part of what is copied
          className="min-w-0 flex-1 text-ui break-words text-ink tabular-nums before:mr-2 before:text-muted before:content-['$']"
        >
          {command}
        </code>
        <Button variant="secondary" size="sm" icon={state === 'copied' ? Check : Copy} aria-describedby={`${id}-status`} onClick={() => void copy(command, null)} className="self-start">
          {state === 'copied' ? t('common.copied') : t('settings.runners.command.copy')}
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
