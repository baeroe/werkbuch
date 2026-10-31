/*
 * What the authenticator app takes during the setup of the second factor: the QR code the server drew (`qr_svg`, an SVG
 * as data URL, from Fortify) and the secret to type in when scanning does not work. The code stays dark on white in
 * both themes, like a printed one, with a quiet zone around it; the key reads in groups of four.
 */

import { useRef } from 'react';
import { t } from '@/lib/i18n';
import { CopyButton } from '../tokens/CopyButton';

/** `JBSWY3DPEHPK3PXP` as `JBSW Y3DP EHPK 3PXP`: easier to type in from the screen. */
export const groupKey = (secret: string): string => secret.replace(/(.{4})(?=.)/g, '$1 ');

export function QrCode({ src }: { src: string }) {
  return (
    <img
      src={src}
      alt={t('settings.two_factor.scan.qr_alt')}
      draggable={false}
      className="size-40 shrink-0 rounded-chip border border-line-strong bg-[var(--day-surface)] p-2"
    />
  );
}

/** The secret, grouped, with "Copy key" (the clipboard gets it without the spaces). */
export function SetupKey({ secret }: { secret: string }) {
  const text = useRef<HTMLElement>(null);
  return (
    <div className="flex min-w-0 flex-col items-start gap-2">
      <p className="text-sm text-muted">{t('settings.two_factor.key')}</p>
      <code ref={text} translate="no" className="rounded-chip bg-sunken px-2 py-1 text-md font-semibold tracking-wide whitespace-nowrap text-ink tabular-nums">
        {groupKey(secret)}
      </code>
      <CopyButton size="sm" text={secret} target={() => text.current} label={t('settings.two_factor.copy_key')} />
    </div>
  );
}
