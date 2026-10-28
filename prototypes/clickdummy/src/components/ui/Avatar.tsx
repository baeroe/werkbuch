import { Bot } from 'lucide-react';
import type { TypeTone } from '@/types';
import { cx } from './cx';

export type AvatarUser = { name: string; type: 'person' | 'bot' };
type AvatarSize = 'sm' | 'md';

const TONES: TypeTone[] = ['sky', 'ochre', 'moss', 'plum', 'sand', 'slate'];

/** The same name always gets the same muted tone. */
function toneFor(name: string): TypeTone {
  let hash = 0;
  for (const char of name) hash = (hash * 31 + char.codePointAt(0)!) >>> 0;
  return TONES[hash % TONES.length];
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase();
}

const SIZES: Record<AvatarSize, string> = {
  sm: 'size-5 text-2xs [&>svg]:size-3.5',
  md: 'size-7 text-sm [&>svg]:size-4',
};

type AvatarProps = {
  user: AvatarUser;
  size?: AvatarSize;
  /** Next to the visible name the avatar is decoration and stays silent. */
  decorative?: boolean;
  className?: string;
};

/** People are round with initials on a muted tone; bots are square in ink with the bot glyph. */
export function Avatar({ user, size = 'md', decorative = false, className }: AvatarProps) {
  const a11y = decorative ? { 'aria-hidden': true as const } : { role: 'img', 'aria-label': user.type === 'bot' ? `${user.name} (Bot)` : user.name };

  if (user.type === 'bot') {
    return (
      <span {...a11y} className={cx('inline-flex shrink-0 items-center justify-center rounded-chip bg-ink text-paper', SIZES[size], className)}>
        <Bot aria-hidden="true" />
      </span>
    );
  }

  return (
    <span
      {...a11y}
      data-tone={toneFor(user.name)}
      className={cx('inline-flex shrink-0 items-center justify-center rounded-full bg-[var(--tab-bg)] font-semibold text-[var(--tab-ink)]', SIZES[size], className)}
    >
      {initials(user.name)}
    </span>
  );
}

/** Placeholder where nobody is assigned: a dashed circle. */
export function UnassignedAvatar({ size = 'sm', className }: { size?: AvatarSize; className?: string }) {
  return (
    <span role="img" aria-label="Nicht zugewiesen" className={cx('inline-block shrink-0 rounded-full border border-dashed border-faint', size === 'sm' ? 'size-5' : 'size-7', className)} />
  );
}
