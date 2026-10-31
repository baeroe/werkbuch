/*
 * "Copy" for text that is shown on the page (a token, recovery codes, a setup snippet). `navigator.clipboard.writeText`
 * rejects when the page is not focused or the browser says no, and is missing without a secure context: then the text
 * is selected instead and a toast says to copy it by hand. The toast never repeats the text: it may be a secret.
 */

import { Check, Copy } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button, type ButtonSize, type ButtonVariant } from '@/components/ui/Button';
import { toast } from '@/components/ui/toast';
import { t } from '@/lib/i18n';
import { isMac } from '@/lib/platform';

/** Selects everything in an element, or the value of an input or a textarea. */
function selectAll(target: HTMLElement): void {
  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
    target.focus();
    target.select();
    return;
  }
  const selection = window.getSelection();
  if (!selection) return;
  selection.removeAllRanges();
  const range = document.createRange();
  range.selectNodeContents(target);
  selection.addRange(range);
}

/** Writes `text` to the clipboard; when that fails, selects the content of `target` and says `selected`. */
export async function copyOrSelect(text: string, target: HTMLElement | null): Promise<'copied' | 'selected'> {
  try {
    if (!navigator.clipboard) throw new Error('no clipboard');
    await navigator.clipboard.writeText(text);
    return 'copied';
  } catch {
    if (target) selectAll(target);
    return 'selected';
  }
}

type Props = {
  /** What lands on the clipboard. */
  text: string;
  /** The element that shows the text: it gets selected when copying fails. */
  target: () => HTMLElement | null;
  label?: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
};

export function CopyButton({ text, target, label = t('common.copy'), variant = 'secondary', size }: Props) {
  const [copied, setCopied] = useState(false);

  // the check mark stays for a moment
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);

  async function copy() {
    if ((await copyOrSelect(text, target())) === 'copied') {
      setCopied(true);
      toast({ title: t('common.copied'), tone: 'success' });
    } else {
      toast({ title: t('settings.tokens.copy_failed'), description: t('settings.tokens.copy_failed_description', { keys: isMac() ? '⌘C' : `${t('kbd.text.ctrl')}+C` }), tone: 'error' });
    }
  }

  return (
    <Button variant={variant} size={size} icon={copied ? Check : Copy} onClick={() => void copy()}>
      {copied ? t('common.copied') : label}
    </Button>
  );
}
