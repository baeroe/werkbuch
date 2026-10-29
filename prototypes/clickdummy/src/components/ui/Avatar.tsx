import { Bot } from 'lucide-react';
import { useState } from 'react';
import type { TypeTone } from '@/types';
import { cx } from './cx';

export type AvatarUser = { name: string; type: 'person' | 'bot'; avatar_url?: string | null };
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

/**
 * People are round, bots square (DESIGN.md). With a picture (`avatar_url`) the avatar shows it; without one, or when it
 * does not load, people get their initials on a muted tone and bots the bot glyph in ink.
 */
export function Avatar({ user, size = 'md', decorative = false, className }: AvatarProps) {
  const a11y = decorative ? { 'aria-hidden': true as const } : { role: 'img', 'aria-label': user.type === 'bot' ? `${user.name} (Bot)` : user.name };
  // the address that failed, so a new picture gets its chance
  const [broken, setBroken] = useState<string | null>(null);
  const picture = user.avatar_url && user.avatar_url !== broken ? user.avatar_url : null;
  const shape = user.type === 'bot' ? 'rounded-chip' : 'rounded-full';

  if (picture) {
    return (
      <span {...a11y} className={cx('inline-flex shrink-0 overflow-hidden bg-sunken', shape, SIZES[size], className)}>
        {/* the name is the avatar's: the picture itself says nothing more */}
        <img src={picture} alt="" draggable={false} onError={() => setBroken(picture)} className="size-full object-cover" />
      </span>
    );
  }

  if (user.type === 'bot') {
    return (
      <span {...a11y} className={cx('inline-flex shrink-0 items-center justify-center bg-ink text-paper', shape, SIZES[size], className)}>
        <Bot aria-hidden="true" />
      </span>
    );
  }

  return (
    <span
      {...a11y}
      data-tone={toneFor(user.name)}
      className={cx('inline-flex shrink-0 items-center justify-center bg-[var(--tab-bg)] font-semibold text-[var(--tab-ink)]', shape, SIZES[size], className)}
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
