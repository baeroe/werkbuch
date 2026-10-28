/*
 * "Kopieren" for text that is shown on the page (a token, recovery codes, a setup snippet). When the browser refuses
 * the clipboard, the text is selected instead and a toast says to copy it by hand (`copyOrSelect`). The toast never
 * repeats the text: it may be a secret.
 */

import { Check, Copy } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button, type ButtonSize, type ButtonVariant } from '@/components/ui/Button';
import { toast } from '@/components/ui/toast';
import { isMac } from '@/lib/platform';
import { copyOrSelect } from './clipboard';

type Props = {
  /** What lands on the clipboard. */
  text: string;
  /** The element that shows the text: it gets selected when copying fails. */
  target: () => HTMLElement | null;
  label?: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
};

export function CopyButton({ text, target, label = 'Kopieren', variant = 'secondary', size }: Props) {
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
      toast({ title: 'Kopiert', tone: 'success' });
    } else {
      toast({ title: 'Kopieren hat nicht geklappt', description: `Der Text ist markiert: Kopiere ihn mit ${isMac() ? '⌘C' : 'Strg+C'}.`, tone: 'error' });
    }
  }

  return (
    <Button variant={variant} size={size} icon={copied ? Check : Copy} onClick={() => void copy()}>
      {copied ? 'Kopiert' : label}
    </Button>
  );
}
