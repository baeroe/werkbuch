/*
 * One line of the history: who (a bot carries the word "Bot" beside the name and its square avatar), what (the
 * phrases of every event of the line, joined: "hat die Priorität … geändert und das Due-Date … verschoben."), when
 * (in the organisation's time zone, the full moment as tooltip) and, under it, why: the reason of a change made for
 * the person ("Workflow gewechselt", "Automatisierung: Assignee beim Start").
 */

import { Zap } from 'lucide-react';
import { botWord } from '@/components/fields/format';
import { useToday } from '@/components/fields/itemData';
import { Avatar } from '@/components/ui/Avatar';
import { useOrganization } from '@/hooks/organization';
import { t } from '@/lib/i18n';
import type { User } from '@/types';
import { joined, phrasesOf, reasonText, tx, type PhraseContext } from './phrases';
import type { TimelineEntry } from './timeline';
import { formatMoment, formatWhen } from './when';

function When({ iso }: { iso: string }) {
  const { today } = useToday();
  const timeZone = useOrganization().data.timezone;
  return (
    <time dateTime={iso} title={formatMoment(iso, timeZone)} className="whitespace-nowrap text-muted tabular-nums">
      {formatWhen(iso, today, timeZone)}
    </time>
  );
}

function Actor({ user }: { user: User | undefined }) {
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

export function EventLine({ line, ctx }: { line: TimelineEntry; ctx: PhraseContext }) {
  const actor = ctx.users.get(line.actorId);
  const phrases = line.events.flatMap((event) => phrasesOf(event, ctx));
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
      </div>
    </li>
  );
}
