/*
 * The activity of an item (spec 4.10): comments and history in one timeline, oldest first, filtered to everything,
 * comments or changes.
 * - Changes by the same account within five minutes read as one line ("Ida Brenner hat die Priorität … geändert und
 *   das Due-Date … verschoben."); a comment in between starts a new line.
 * - Bots are recognisable (square avatar, "Bot"), and an automation's reason stands under its line.
 * - A related item the reader may not see is "verborgenes Item", without key.
 * - Comments: the author's own can be edited (marked "bearbeitet"; the old text stays in the history) and deleted,
 *   project admins delete any; deleting waits for its undo toast. Reactions: any emoji, once per person.
 */

import { Ellipsis, Pencil, RotateCw, SmilePlus, Trash2, Zap } from 'lucide-react';
import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { useSearchParams } from 'react-router';
import { addDays, formatDay, formatPropertyValue } from '@/components/fields/format';
import { archivedReason, useToday, useUserMap } from '@/components/fields/itemData';
import { ItemKey } from '@/components/items/ItemKey';
import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { EmojiPicker } from '@/components/ui/EmojiPicker';
import { IconButton } from '@/components/ui/IconButton';
import { Menu, MenuContent, MenuItem, MenuTrigger } from '@/components/ui/Menu';
import { PRIORITY_LABELS } from '@/components/ui/PriorityIcon';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/Popover';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { Skeleton, SkeletonGroup } from '@/components/ui/Skeleton';
import { toast } from '@/components/ui/toast';
import { Tooltip } from '@/components/ui/Tooltip';
import { cachedZone } from '@/domain/tz';
import { useLabels, useResolutions } from '@/hooks/catalog';
import { useDeleteComment, useEditComment, useToggleReaction } from '@/hooks/comments';
import { useOrganization } from '@/hooks/organization';
import { useProperties } from '@/hooks/properties';
import { useActivity, useWorkItem } from '@/hooks/workItems';
import { useWorkItemTypes } from '@/hooks/workItemTypes';
import { useSettle } from '@/hooks/mutation';
import { notifyError } from '@/lib/errors';
import { usePermissions } from '@/lib/permissions';
import { runWithUndo } from '@/lib/undo';
import { useSession } from '@/store/session';
import type { ActivityEntry, Comment, ItemEvent, Priority, Property, PropertyValue, RelationChange, RichText, User, WorkItem, WorkItemDetail } from '@/types';
import { isEmptyDoc, RichTextEditor, RichTextView } from '@/features/editor/RichTextEditor';
import { CommentComposer } from './CommentComposer';
import { focusWhenLost, Section, useDetail } from './shared';

/* ------------------------------------------------------------------------- timeline */

export type ActivityFilter = 'all' | 'comments' | 'changes';

export type TimelineEntry =
  | { kind: 'comment'; key: string; at: string; comment: Comment }
  | { kind: 'events'; key: string; at: string; actorId: string; reason: string | null; events: ItemEvent[] };

/** Changes by one account within this time read as one line (spec 4.10: "innerhalb weniger Minuten"). */
export const GROUP_WINDOW_MS = 5 * 60_000;

/** Events that trigger webhooks rather than tell the history (`bot.assigned`, `bot.mentioned`). */
const isHistory = (event: ItemEvent) => !event.type.startsWith('bot.');

/**
 * The lines of the timeline: comments one by one, changes grouped by account and reason while they follow each
 * other within `windowMs` of the group's first change.
 */
export function buildTimeline(entries: readonly ActivityEntry[], filter: ActivityFilter, windowMs = GROUP_WINDOW_MS): TimelineEntry[] {
  const lines: TimelineEntry[] = [];
  for (const entry of entries) {
    if (entry.kind === 'comment') {
      if (filter !== 'changes') lines.push({ kind: 'comment', key: entry.id, at: entry.at, comment: entry.comment });
      continue;
    }
    const { event } = entry;
    if (filter === 'comments' || !isHistory(event)) continue;
    const last = lines.at(-1);
    if (last?.kind === 'events' && last.actorId === event.actor_id && last.reason === event.reason && Date.parse(event.occurred_at) - Date.parse(last.at) <= windowMs) {
      last.events.push(event);
    } else {
      lines.push({ kind: 'events', key: event.id, at: event.occurred_at, actorId: event.actor_id, reason: event.reason, events: [event] });
    }
  }
  return lines;
}

/* -------------------------------------------------------------------------- phrases */

/** A value in a history line. */
function V({ children }: { children: ReactNode }) {
  return <span className="font-medium text-ink">{children}</span>;
}

/** Another item of the history by id: its key, or "verborgenes Item" when the reader may not see it (any more). */
function ItemRef({ id }: { id: string }) {
  const detail = useWorkItem(id);
  if (detail.data) return <ItemKey value={detail.data.item.key} className="text-ink" />;
  return <V>{detail.isError ? 'verborgenes Item' : '…'}</V>;
}

interface PhraseContext {
  detail: WorkItemDetail;
  users: Map<string, User>;
  labelName: (id: string) => string;
  resolutionName: (id: string) => string;
  typeName: (id: string) => string;
  propertyOf: (key: string) => Property | undefined;
}

const userName = (ctx: PhraseContext, id: unknown) => (typeof id === 'string' ? (ctx.users.get(id)?.name ?? 'Unbekannt') : 'niemand');
const stateName = (ctx: PhraseContext, id: unknown) => ctx.detail.workflow.states.find((state) => state.id === id)?.name ?? 'einen früheren Status';
const isEmpty = (value: unknown) => value === null || value === undefined || value === '' || (Array.isArray(value) && value.length === 0);

/** "A", "A und B", "A, B und C". */
function joined(parts: ReactNode[]): ReactNode {
  return parts.map((part, index) => (
    <span key={index}>
      {index > 0 && (index === parts.length - 1 ? ' und ' : ', ')}
      {part}
    </span>
  ));
}

const DATE_NAMES: Record<string, string> = { start_date: 'das Start-Date', due_date: 'das Due-Date' };

/** What one changed field reads as: "die Priorität von High auf Urgent geändert". */
function fieldPhrase(field: string, change: { old: unknown; new: unknown }, ctx: PhraseContext): ReactNode | null {
  const { old: before, new: after } = change;
  switch (field) {
    case 'state_id':
      return (
        <>
          den Status von <V>{stateName(ctx, before)}</V> auf <V>{stateName(ctx, after)}</V> gesetzt
        </>
      );
    case 'resolution_id':
      return after ? (
        <>
          die Resolution <V>{ctx.resolutionName(String(after))}</V> gesetzt
        </>
      ) : (
        'die Resolution entfernt'
      );
    case 'assignee_id':
      if (isEmpty(before))
        return (
          <>
            <V>{userName(ctx, after)}</V> als Assignee gesetzt
          </>
        );
      if (isEmpty(after))
        return (
          <>
            die Zuweisung an <V>{userName(ctx, before)}</V> entfernt
          </>
        );
      return (
        <>
          die Zuweisung von <V>{userName(ctx, before)}</V> auf <V>{userName(ctx, after)}</V> geändert
        </>
      );
    case 'title':
      return (
        <>
          den Titel von <V>„{String(before)}“</V> in <V>„{String(after)}“</V> geändert
        </>
      );
    case 'priority':
      return (
        <>
          die Priorität von <V>{PRIORITY_LABELS[before as Priority] ?? String(before)}</V> auf <V>{PRIORITY_LABELS[after as Priority] ?? String(after)}</V> geändert
        </>
      );
    case 'label_ids': {
      const was = (before as string[] | null) ?? [];
      const now = (after as string[] | null) ?? [];
      const added = now.filter((id) => !was.includes(id));
      const removed = was.filter((id) => !now.includes(id));
      const list = (ids: string[], verb: string) => (
        <>
          {ids.length === 1 ? 'das Label' : 'die Labels'} {joined(ids.map((id) => <V key={id}>{ctx.labelName(id)}</V>))} {verb}
        </>
      );
      const parts = [...(added.length ? [list(added, 'hinzugefügt')] : []), ...(removed.length ? [list(removed, 'entfernt')] : [])];
      return parts.length ? joined(parts) : null;
    }
    case 'start_date':
    case 'due_date': {
      const name = DATE_NAMES[field];
      if (isEmpty(before))
        return (
          <>
            {name} auf <V>{formatDay(String(after))}</V> gesetzt
          </>
        );
      if (isEmpty(after)) return `${name} entfernt`;
      return (
        <>
          {name} von <V>{formatDay(String(before))}</V> auf <V>{formatDay(String(after))}</V> verschoben
        </>
      );
    }
    case 'parent_id':
      return after ? (
        <>
          das Eltern-Item <ItemRef id={String(after)} /> gesetzt
        </>
      ) : (
        'das Eltern-Item entfernt'
      );
    case 'type_id':
      return (
        <>
          den Typ von <V>{ctx.typeName(String(before))}</V> auf <V>{ctx.typeName(String(after))}</V> geändert
        </>
      );
    case 'description':
      return 'die Beschreibung geändert';
    case 'attachment':
      return after ? (
        <>
          die Datei <V>„{String(after)}“</V> angehängt
        </>
      ) : (
        <>
          die Datei <V>„{String(before)}“</V> entfernt
        </>
      );
    case 'archived_at':
      return after ? 'das Item archiviert' : 'das Item wiederhergestellt';
    default: {
      if (!field.startsWith('values.')) return null;
      const property = ctx.propertyOf(field.slice('values.'.length));
      const label = <V>{property?.label ?? field.slice('values.'.length)}</V>;
      if (property?.field_type === 'rich_text') return <>{label} geändert</>;
      const show = (value: unknown) =>
        property ? formatPropertyValue(property, value as PropertyValue, (id) => ctx.users.get(id)?.name ?? 'Unbekannt') : String(value);
      if (isEmpty(before))
        return (
          <>
            {label} auf <V>{show(after)}</V> gesetzt
          </>
        );
      if (isEmpty(after)) return <>{label} geleert</>;
      return (
        <>
          {label} von <V>{show(before)}</V> auf <V>{show(after)}</V> geändert
        </>
      );
    }
  }
}

const FIELD_ORDER = ['state_id', 'resolution_id', 'assignee_id', 'title', 'priority', 'label_ids', 'start_date', 'due_date', 'parent_id', 'type_id', 'description', 'attachment', 'archived_at'];
const fieldRank = (field: string) => {
  const index = FIELD_ORDER.indexOf(field);
  return index === -1 ? FIELD_ORDER.length : index;
};

/** What one event reads as, after "<Name> hat": one phrase per change. */
function phrasesOf(event: ItemEvent, ctx: PhraseContext): ReactNode[] {
  switch (event.type) {
    case 'work_item.created':
      return ['das Item angelegt'];
    case 'work_item.archived':
      return ['das Item archiviert'];
    case 'work_item.restored':
      return ['das Item wiederhergestellt'];
    case 'work_item.relation_added':
    case 'work_item.relation_removed': {
      const added = event.type === 'work_item.relation_added';
      const change = (added ? event.changes.relation?.new : event.changes.relation?.old) as RelationChange | null | undefined;
      const other = change && !change.hidden && change.key ? <ItemKey value={change.key} className="text-ink" /> : <V>verborgenes Item</V>;
      return [
        <>
          die Relation <V>„{change?.label ?? 'verknüpft mit'}“</V> zu {other} {added ? 'hinzugefügt' : 'entfernt'}
        </>,
      ];
    }
    case 'comment.updated':
      return ['einen Kommentar bearbeitet'];
    case 'comment.deleted':
      return ['einen Kommentar gelöscht'];
    default: {
      const parts = Object.entries(event.changes)
        .sort(([a], [b]) => fieldRank(a) - fieldRank(b))
        .flatMap(([field, change]) => {
          const phrase = fieldPhrase(field, change, ctx);
          return phrase === null ? [] : [phrase];
        });
      return parts.length > 0 ? parts : ['das Item geändert'];
    }
  }
}

/* ------------------------------------------------------------------------------ time */

const ZONE = 'Europe/Berlin';

/** "heute 09:12", "gestern 14:05", "20.10. 11:30", "20.10.2025" in the organisation's time zone. */
export function formatWhen(iso: string, today: string, timeZone = ZONE): string {
  const date = new Date(iso);
  const day = cachedZone(timeZone).date(date);
  const time = new Intl.DateTimeFormat('de-DE', { hour: '2-digit', minute: '2-digit', timeZone }).format(date);
  if (day === today) return `heute ${time}`;
  if (day === addDays(today, -1)) return `gestern ${time}`;
  if (day.slice(0, 4) === today.slice(0, 4)) return `${new Intl.DateTimeFormat('de-DE', { day: '2-digit', month: '2-digit', timeZone }).format(date)} ${time}`;
  return new Intl.DateTimeFormat('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone }).format(date);
}

function When({ iso }: { iso: string }) {
  const { today } = useToday();
  const timeZone = useOrganization().data?.timezone ?? ZONE;
  const full = new Intl.DateTimeFormat('de-DE', { dateStyle: 'full', timeStyle: 'short', timeZone }).format(new Date(iso));
  return (
    <time dateTime={iso} title={full} className="whitespace-nowrap text-muted tabular-nums">
      {formatWhen(iso, today, timeZone)}
    </time>
  );
}

/* ---------------------------------------------------------------------------- lines */

function botWord(user: User | undefined): string | null {
  if (user?.type !== 'bot') return null;
  return user.owner_id ? 'Agent' : 'Bot';
}

function Actor({ user }: { user: User | undefined }) {
  const word = botWord(user);
  return (
    <>
      <span className="font-semibold text-ink">{user?.name ?? 'Unbekannt'}</span>
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

function EventLine({ line, ctx }: { line: Extract<TimelineEntry, { kind: 'events' }>; ctx: PhraseContext }) {
  const actor = ctx.users.get(line.actorId);
  const phrases = line.events.flatMap((event) => phrasesOf(event, ctx));
  const edited = line.events.find((event) => event.type === 'comment.updated');
  return (
    <li className="relative flex gap-2.5 text-ui">
      {actor ? <Avatar user={actor} size="sm" decorative /> : <span className="size-5 shrink-0 rounded-full bg-line" aria-hidden="true" />}
      <div className="min-w-0 flex-1">
        <p className="text-pretty text-muted">
          <Actor user={actor} /> hat {joined(phrases)}. <When iso={line.at} />
        </p>
        {line.reason && (
          <p className="mt-0.5 flex items-center gap-1 text-sm text-muted">
            <Zap className="size-3.5 shrink-0" aria-hidden="true" />
            {line.reason}
          </p>
        )}
        {edited && edited.changes.body?.old != null && (
          <details className="mt-1 text-sm">
            <summary className="inline-flex min-h-11 cursor-pointer items-center rounded-chip text-muted hover:text-ink md:min-h-6">Frühere Fassung zeigen</summary>
            <div className="mt-1 rounded-ctl border border-line bg-sunken px-3 py-2">
              <RichTextView value={edited.changes.body.old as RichText} />
            </div>
          </details>
        )}
      </div>
    </li>
  );
}

/* --------------------------------------------------------------------------- comments */

const EMOJI_NAMES: Record<string, string> = {
  '👍': 'Daumen hoch',
  '👎': 'Daumen runter',
  '❤️': 'Herz',
  '🎉': 'Party',
  '😄': 'Grinsen',
  '👀': 'Augen',
  '🚀': 'Rakete',
  '✅': 'Erledigt',
  '🙌': 'Hände hoch',
  '🙏': 'Danke',
  '👏': 'Applaus',
  '😂': 'Tränen lachen',
  '🤔': 'Nachdenken',
  '🔥': 'Feuer',
  '💯': 'Hundert',
};

function Reactions({ comment, users, canReact }: { comment: Comment; users: Map<string, User>; canReact: boolean }) {
  const settle = useSettle();
  const me = useSession((state) => state.userId);
  const toggle = useToggleReaction();
  const [picking, setPicking] = useState(false);
  const react = (emoji: string) =>
    settle(toggle.mutateAsync({ comment_id: comment.id, emoji }), { onError: (error) => notifyError('Reaktion nicht gespeichert', error, () => react(emoji)) });

  if (comment.reactions.length === 0 && !canReact) return null;
  return (
    <div className="mt-2 flex flex-wrap items-center gap-1.5">
      {comment.reactions.map((reaction) => {
        const mine = reaction.user_ids.includes(me);
        const count = reaction.user_ids.length;
        const names = reaction.user_ids.map((id) => users.get(id)?.name ?? 'Unbekannt').join(', ');
        const busy = toggle.isPending && toggle.variables?.emoji === reaction.emoji;
        return (
          <Tooltip key={reaction.emoji} content={names}>
            <button
              type="button"
              aria-pressed={mine}
              aria-busy={busy || undefined}
              aria-label={`${EMOJI_NAMES[reaction.emoji] ?? reaction.emoji}, ${count} ${count === 1 ? 'Reaktion' : 'Reaktionen'}: ${names}`}
              disabled={!canReact}
              onClick={() => react(reaction.emoji)}
              className="inline-flex h-11 cursor-pointer items-center gap-1 rounded-chip border border-line bg-sunken px-1.5 text-sm font-medium text-ink tabular-nums transition-colors duration-120 hover:border-line-strong disabled:cursor-default aria-pressed:border-accent aria-pressed:bg-accent-soft aria-pressed:text-accent-text md:h-6"
            >
              <span aria-hidden="true">{reaction.emoji}</span>
              {new Intl.NumberFormat('de-DE').format(count)}
            </button>
          </Tooltip>
        );
      })}
      {canReact && (
        <Popover open={picking} onOpenChange={setPicking}>
          <PopoverTrigger render={<IconButton icon={SmilePlus} size="sm" label="Reaktion hinzufügen" />} />
          <PopoverContent className="p-3" title="Reaktion">
            <EmojiPicker
              onPick={(emoji) => {
                setPicking(false);
                react(emoji);
              }}
            />
          </PopoverContent>
        </Popover>
      )}
    </div>
  );
}

function CommentEditor({ comment, projectId, onDone }: { comment: Comment; projectId: string; onDone: () => void }) {
  const edit = useEditComment();
  const [draft, setDraft] = useState<RichText | null>(comment.body);
  /** The text as it is now. Refs, because the retry of an error toast runs the `save` of an older render. */
  const latest = useRef<RichText | null>(comment.body);
  const saving = useRef(false);
  const [problem, setProblem] = useState<string | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const problemId = useId();
  const save = () => {
    if (saving.current) return;
    // "Erneut versuchen" saves what was written since the failed attempt, too
    const body = latest.current;
    if (!body || isEmptyDoc(body)) {
      // the button stays usable; an empty text says so at the editor
      setProblem('Der Kommentar ist leer. Schreib etwas oder lösch den Kommentar.');
      box.current?.querySelector<HTMLElement>('[contenteditable="true"]')?.focus();
      return;
    }
    saving.current = true;
    edit
      .mutateAsync({ id: comment.id, body })
      .then(
        () => {
          toast({ title: 'Kommentar geändert', tone: 'success' });
          // written on while it was on its way: the editor stays open with the newer text
          if (latest.current === body) onDone();
        },
        (error: unknown) => notifyError('Kommentar nicht geändert', error, save),
      )
      .finally(() => {
        saving.current = false;
      });
  };
  // Escape takes the edit back (and is used up there, so a preview stays open); an open @ list closes first
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== 'Escape' || event.defaultPrevented) return;
    event.preventDefault();
    onDone();
  };
  return (
    <div ref={box} className="mt-1" onKeyDown={onKeyDown}>
      <RichTextEditor
        value={draft}
        onChange={(doc) => {
          latest.current = doc;
          setDraft(doc);
          setProblem(null);
        }}
        preset="comment"
        projectId={projectId}
        onSubmit={save}
        autoFocus
        aria-label="Kommentar bearbeiten"
        aria-describedby={problem ? problemId : undefined}
      />
      <div aria-live="polite">
        {problem && (
          <p id={problemId} className="mt-1.5 text-sm font-medium text-danger">
            {problem}
          </p>
        )}
      </div>
      <div className="mt-2 flex justify-end gap-2">
        <Button variant="ghost" size="sm" shortcut="escape" onClick={onDone}>
          Abbrechen
        </Button>
        <Button variant="primary" size="sm" shortcut="mod+enter" pending={edit.isPending} onClick={save}>
          Speichern
        </Button>
      </div>
    </div>
  );
}

function CommentCard({ comment, item, users, onDelete }: { comment: Comment; item: WorkItem; users: Map<string, User>; onDelete: (comment: Comment) => void }) {
  const me = useSession((state) => state.userId);
  const { reason } = usePermissions();
  const [editing, setEditing] = useState(false);
  const actionsButton = useRef<HTMLButtonElement>(null);
  const author = users.get(comment.author_id);
  const name = author?.name ?? 'Unbekannt';
  const stopEditing = () => {
    setEditing(false);
    // the editor goes away: the focus returns to the comment's actions
    focusWhenLost(() => actionsButton.current);
  };
  const commentReason = item.archived_at !== null ? archivedReason(item.key) : reason('item.comment', item.project_id);
  const own = comment.author_id === me;
  const canEdit = own && commentReason === null;
  const canDelete = commentReason === null && (own || reason('item.delete', item.project_id) === null);

  return (
    <li className="relative flex gap-2.5">
      {author ? <Avatar user={author} size="sm" decorative /> : <span className="size-5 shrink-0 rounded-full bg-line" aria-hidden="true" />}
      <article aria-label={`Kommentar von ${name}`} className="min-w-0 flex-1 rounded-ctl border border-line bg-surface p-3 shadow-elev-1">
        <header className="flex min-w-0 flex-wrap items-baseline gap-x-2 text-ui">
          <span className="min-w-0">
            <Actor user={author} />
          </span>
          <When iso={comment.created_at} />
          {comment.edited_at && <span className="text-sm text-muted">bearbeitet</span>}
          {(canEdit || canDelete) && !editing && (
            <span className="ml-auto self-center">
              <Menu>
                <MenuTrigger render={<IconButton ref={actionsButton} icon={Ellipsis} size="sm" label={`Aktionen für den Kommentar von ${name}`} tooltip={false} />} />
                <MenuContent align="end">
                  {canEdit && (
                    <MenuItem icon={Pencil} onClick={() => setEditing(true)}>
                      Bearbeiten
                    </MenuItem>
                  )}
                  {canDelete && (
                    <MenuItem icon={Trash2} danger onClick={() => onDelete(comment)}>
                      Löschen
                    </MenuItem>
                  )}
                </MenuContent>
              </Menu>
            </span>
          )}
        </header>
        {editing ? (
          <CommentEditor comment={comment} projectId={item.project_id} onDone={stopEditing} />
        ) : (
          <>
            <RichTextView value={comment.body} className="mt-1" />
            <Reactions comment={comment} users={users} canReact={commentReason === null} />
          </>
        )}
      </article>
    </li>
  );
}

/* ---------------------------------------------------------------------------- section */

const FILTERS: { value: ActivityFilter; label: string }[] = [
  { value: 'all', label: 'Alles' },
  { value: 'comments', label: 'Kommentare' },
  { value: 'changes', label: 'Änderungen' },
];

const EMPTY_TEXT: Record<ActivityFilter, string> = {
  all: 'Noch keine Aktivität. Schreib den ersten Kommentar.',
  comments: 'Noch keine Kommentare.',
  changes: 'Noch keine Änderungen.',
};

export function Activity({ detail }: { detail: WorkItemDetail }) {
  const { item } = detail;
  const activity = useActivity(item.id);
  const users = useUserMap();
  const labels = useLabels().data?.items;
  const resolutions = useResolutions().data?.items;
  const types = useWorkItemTypes().data?.items;
  const properties = useProperties().data?.items;
  const remove = useDeleteComment();
  const { surface } = useDetail();
  // on the page the filter is part of the address (?activity=comments), so it can be linked; the preview keeps it
  const [params, setParams] = useSearchParams();
  const [ownFilter, setOwnFilter] = useState<ActivityFilter>('all');
  const linked = params.get('activity');
  const filter: ActivityFilter = surface === 'page' ? (FILTERS.some((entry) => entry.value === linked) ? (linked as ActivityFilter) : 'all') : ownFilter;
  const setFilter = (next: ActivityFilter) => {
    if (surface !== 'page') return setOwnFilter(next);
    setParams(
      (current) => {
        const updated = new URLSearchParams(current);
        if (next === 'all') updated.delete('activity');
        else updated.set('activity', next);
        return updated;
      },
      { replace: true },
    );
  };
  /** Deleted comments while their undo toast stands. */
  const [gone, setGone] = useState<string[]>([]);
  const timeline = useRef<HTMLDivElement>(null);

  const ctx: PhraseContext = {
    detail,
    users,
    labelName: (id) => labels?.find((label) => label.id === id)?.name ?? 'ein gelöschtes Label',
    resolutionName: (id) => resolutions?.find((resolution) => resolution.id === id)?.label ?? 'eine frühere Resolution',
    typeName: (id) => types?.find((type) => type.id === id)?.name ?? 'einen früheren Typ',
    propertyOf: (key) => properties?.find((property) => property.key === key),
  };

  function deleteComment(comment: Comment) {
    setGone((current) => [...current, comment.id]);
    // the comment and its menu go: the focus moves on to the comment box below
    focusWhenLost(() => timeline.current?.querySelector<HTMLElement>('[aria-keyshortcuts="M"], [contenteditable="true"]'));
    const back = () => setGone((current) => current.filter((id) => id !== comment.id));
    runWithUndo({
      label: 'Kommentar gelöscht',
      undo: back,
      failureTitle: 'Kommentar nicht gelöscht',
      run: async () => {
        try {
          await remove.mutateAsync(comment.id);
        } catch (error) {
          back();
          throw error;
        }
      },
    });
  }

  const entries = (activity.data?.items ?? []).filter((entry) => !(entry.kind === 'comment' && gone.includes(entry.id)));
  const lines = buildTimeline(entries, filter);

  return (
    <Section
      title="Aktivität"
      actions={<SegmentedControl label="Aktivität filtern" size="sm" value={filter} onValueChange={setFilter} options={FILTERS} />}
    >
      <div ref={timeline}>
        {activity.isError ? (
          <div role="alert" className="mt-3 flex flex-wrap items-center gap-2 rounded-ctl bg-danger-soft px-3 py-2 text-ui text-ink">
            <p className="min-w-0 flex-1 text-pretty">Die Aktivität ließ sich nicht laden: {activity.error.message}</p>
            <Button variant="secondary" size="sm" icon={RotateCw} pending={activity.isFetching} onClick={() => void activity.refetch()}>
              Erneut versuchen
            </Button>
          </div>
        ) : activity.isPending ? (
          <SkeletonGroup label="Aktivität wird geladen …" className="mt-3 flex flex-col gap-3">
            {[0, 1, 2].map((row) => (
              <div key={row} className="flex gap-2.5">
                <Skeleton className="size-5 rounded-full" />
                <Skeleton className={row === 1 ? 'h-16 flex-1 rounded-ctl' : 'mt-1 h-3.5 w-3/4'} />
              </div>
            ))}
          </SkeletonGroup>
        ) : lines.length === 0 ? (
          <p className="mt-2 text-ui text-muted">{EMPTY_TEXT[filter]}</p>
        ) : (
          <ol
            aria-label="Verlauf"
            className="relative mt-3 flex flex-col gap-3 before:absolute before:top-3 before:bottom-3 before:left-2.5 before:border-l before:border-dashed before:border-line-strong"
          >
            {lines.map((line) =>
              line.kind === 'comment' ? (
                <CommentCard key={line.key} comment={line.comment} item={item} users={users} onDelete={deleteComment} />
              ) : (
                <EventLine key={line.key} line={line} ctx={ctx} />
              ),
            )}
          </ol>
        )}
        <CommentComposer item={item} />
      </div>
    </Section>
  );
}
