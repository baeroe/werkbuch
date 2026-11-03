/*
 * One line of the history: who (a bot carries the word "Bot" beside the name and its square avatar), what (the
 * phrases of every event of the line, joined: "hat die Priorität … geändert und das Due-Date … verschoben."), when
 * (in the organisation's time zone, the full moment as tooltip) and, under it, why: the reason of a change made for
 * the person ("Workflow gewechselt", "Automatisierung: Assignee beim Start"). A comment's edit offers its earlier
 * version under the line, folded ("Frühere Fassung anzeigen"); a comment deleted since has none to show (K15).
 */

import { ChevronRight, Zap } from 'lucide-react';
import { useId, useState } from 'react';
import { botWord } from '@/components/fields/format';
import { useToday } from '@/components/fields/itemData';
import { Avatar } from '@/components/ui/Avatar';
import { cx } from '@/components/ui/cx';
import { RichTextView } from '@/editor/RichTextView';
import { useOrganization } from '@/hooks/organization';
import { t } from '@/lib/i18n';
import type { RichText, User } from '@/types';
import { earlierVersions, joined, linePhrases, reasonText, tx, type PhraseContext } from './phrases';
import type { EventsLine } from './timeline';
import { formatMoment, formatWhen } from './when';

/** When something happened, in the organisation's time zone, the full moment as tooltip. */
export function When({ iso }: { iso: string }) {
  const { today } = useToday();
  const timeZone = useOrganization().data.timezone;
  return (
    <time dateTime={iso} title={formatMoment(iso, timeZone)} className="whitespace-nowrap text-muted tabular-nums">
      {formatWhen(iso, today, timeZone)}
    </time>
  );
}

/** Who: the name, a bot with the word "Bot" beside it, an unknown account as "Unbekannt". */
export function Actor({ user }: { user: User | undefined }) {
  const word = user && botWord(user);
  return (
    <>
      <span className="font-semibold text-ink">{user?.name ?? t('items.fields.property.unknown_person')}</span>
      {/* the space keeps name and word apart for screen readers ("Automation Bot") */}
      {word && (
        <>
          {' '}
          <span className="rounded-chip bg-sunken px-1 py-px align-[1px] text-xs font-semibold text-muted">{word}</span>
        </>
      )}
    </>
  );
}

/** The earlier version of an edited comment, folded until asked for. */
function EarlierVersion({ body }: { body: RichText }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <div className="mt-1 text-sm">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={() => setOpen((now) => !now)}
        className="inline-flex min-h-11 cursor-pointer items-center gap-1 rounded-chip text-muted hover:text-ink md:min-h-6"
      >
        <ChevronRight className={cx('size-3.5 shrink-0 transition-transform duration-120', open && 'rotate-90')} aria-hidden="true" />
        {t('items.activity.field.comment_earlier')}
      </button>
      {open && (
        <div id={id} className="mt-1 rounded-ctl border border-line bg-sunken px-3 py-2">
          <RichTextView value={body} preset="comment" />
        </div>
      )}
    </div>
  );
}

export function EventLine({ line, ctx }: { line: EventsLine; ctx: PhraseContext }) {
  const actor = ctx.users.get(line.actorId);
  const phrases = linePhrases(line.events, ctx);
  return (
    <li className="relative flex gap-2.5 text-ui">
      {actor ? <Avatar user={actor} size="sm" decorative /> : <span className="size-5 shrink-0 rounded-full bg-line" aria-hidden="true" />}
      <div className="min-w-0 flex-1">
        <p className="text-pretty text-muted">
          {tx('items.activity.line', { actor: <Actor user={actor} />, phrases: joined(phrases) })} <When iso={line.at} />
        </p>
        {line.reason && (
          <p className="mt-0.5 flex items-center gap-1 text-sm text-muted">
            <Zap className="size-3.5 shrink-0" aria-hidden="true" />
            {reasonText(line.reason)}
          </p>
        )}
        {earlierVersions(line.events).map((version) => (
          <EarlierVersion key={version.commentId} body={version.body} />
        ))}
      </div>
    </li>
  );
}
