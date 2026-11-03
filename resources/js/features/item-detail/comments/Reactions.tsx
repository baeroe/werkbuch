/*
 * The reactions under a comment (spec 4.10, port of the clickdummy): one chip per emoji with its count, pressed when the
 * own reaction is there; pressing it adds or takes back the own one. "Reaktion hinzufügen" opens the emoji picker for
 * any other emoji, once per person. A reaction shows at once and goes back with a toast of its own when the server
 * refuses it (`useToggleReaction`). Without the right to react (an archived item or project) the chips only show.
 * A chip that goes while it has the focus (the own, only reaction taken back, a new one refused) hands the focus on to
 * the chip in its place, else the one before it, else "Reaktion hinzufügen": never to the page.
 */

import { SmilePlus } from 'lucide-react';
import { useLayoutEffect, useRef, useState } from 'react';
import { useUserMap } from '@/components/fields/itemData';
import { EmojiPicker } from '@/components/ui/EmojiPicker';
import { IconButton } from '@/components/ui/IconButton';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/Popover';
import { Tooltip } from '@/components/ui/Tooltip';
import { useToggleReaction } from '@/hooks/comments';
import { useCurrentUser } from '@/hooks/users';
import { intlLocale, t, tn } from '@/lib/i18n';
import type { Comment } from '@/types';
import { focusWhenLost } from '../shared';

const CHIP =
  'inline-flex h-11 items-center gap-1 rounded-chip border border-line bg-sunken px-1.5 text-sm font-medium text-ink tabular-nums transition-colors duration-120 md:h-6';

export function Reactions({ comment, canReact }: { comment: Comment; canReact: boolean }) {
  const me = useCurrentUser()?.id;
  const users = useUserMap();
  const { toggle, isPending } = useToggleReaction();
  const [picking, setPicking] = useState(false);
  const group = useRef<HTMLDivElement>(null);
  /** The emoji whose chip had the focus last; it stays while the chip goes (a removed element sends no blur). */
  const focused = useRef<string | null>(null);
  const emojis = comment.reactions.map((reaction) => reaction.emoji);
  const shownBefore = useRef(emojis);

  // the chip with the focus went: the focus moves on to its neighbour
  useLayoutEffect(() => {
    const before = shownBefore.current;
    shownBefore.current = emojis;
    const lost = focused.current;
    if (lost === null || emojis.includes(lost)) return;
    focused.current = null;
    const index = before.indexOf(lost);
    focusWhenLost(() => {
      const chips = Array.from(group.current?.querySelectorAll<HTMLElement>('[data-reaction]') ?? []);
      return chips[index] ?? chips[index - 1] ?? group.current?.querySelector<HTMLElement>('[data-react-add]');
    });
  });

  if (comment.reactions.length === 0 && !canReact) return null;
  return (
    <div ref={group} role="group" aria-label={t('items.comments.reactions')} className="mt-2 flex flex-wrap items-center gap-1.5">
      {comment.reactions.map((reaction) => {
        const mine = me !== undefined && reaction.user_ids.includes(me);
        const count = reaction.user_ids.length;
        const names = reaction.user_ids.map((id) => users.get(id)?.name ?? t('items.fields.property.unknown_person')).join(', ');
        const label = tn('items.comments.reaction', count, { emoji: reaction.emoji, names });
        const shown = (
          <>
            <span aria-hidden="true">{reaction.emoji}</span>
            <span aria-hidden="true">{new Intl.NumberFormat(intlLocale()).format(count)}</span>
          </>
        );
        if (!canReact) {
          return (
            <span key={reaction.emoji} role="img" aria-label={label} title={names} className={CHIP}>
              {shown}
            </span>
          );
        }
        return (
          <Tooltip key={reaction.emoji} content={names}>
            <button
              type="button"
              aria-pressed={mine}
              aria-busy={isPending(comment.id, reaction.emoji) || undefined}
              aria-label={label}
              data-reaction=""
              onFocus={() => (focused.current = reaction.emoji)}
              onBlur={(event) => {
                // the focus moved on by itself; a chip that goes takes it nowhere
                if (event.relatedTarget) focused.current = null;
              }}
              onClick={() => toggle({ comment_id: comment.id, emoji: reaction.emoji, on: !mine })}
              className={`${CHIP} cursor-pointer hover:border-line-strong aria-pressed:border-accent aria-pressed:bg-accent-soft aria-pressed:text-accent-text`}
            >
              {shown}
            </button>
          </Tooltip>
        );
      })}
      {canReact && (
        <Popover open={picking} onOpenChange={setPicking}>
          <PopoverTrigger render={<IconButton icon={SmilePlus} size="sm" label={t('items.comments.react')} data-react-add="" />} />
          <PopoverContent className="p-3" title={t('items.comments.react_title')}>
            <EmojiPicker
              onPick={(emoji) => {
                setPicking(false);
                toggle({ comment_id: comment.id, emoji, on: true });
              }}
            />
          </PopoverContent>
        </Popover>
      )}
    </div>
  );
}
