/*
 * A comment in the activity (spec 4.10, port of the clickdummy): avatar, name (a bot with "Bot"), when, "bearbeitet"
 * with the moment of the edit as tooltip, the text and the reactions; an `article` named "Kommentar von <Name>".
 * - Its actions: "Bearbeiten" only for its author, "Löschen" for its author and project admins (`item.delete` stands in
 *   for the project role admin, A241). An archived item or project takes neither (A240), and no reaction either.
 * - Editing happens in place (`CommentEditor`); an edit waiting as a draft opens the editor again.
 * - Deleting waits for its undo toast (5 s, mod+z): the card goes at once, the focus moves on to the next card (else to
 *   the composer), the `DELETE` follows; a failure brings the card back and offers to try again. The cards hidden that
 *   way are the module's (`useHiddenComments`), so a view opened again meanwhile leaves them out too.
 */

import { Ellipsis, Pencil, Trash2 } from 'lucide-react';
import { useCallback, useRef, useState, useSyncExternalStore } from 'react';
import { ApiError } from '@/api/client';
import { archivedReason, useUserMap } from '@/components/fields/itemData';
import { Avatar } from '@/components/ui/Avatar';
import { IconButton } from '@/components/ui/IconButton';
import { Menu, MenuContent, MenuItem, MenuTrigger } from '@/components/ui/Menu';
import { Tooltip } from '@/components/ui/Tooltip';
import { RichTextView } from '@/editor/RichTextView';
import { useDeleteComment } from '@/hooks/comments';
import { useOrganization } from '@/hooks/organization';
import { useCurrentUser } from '@/hooks/users';
import { commentEditDraft, drafts } from '@/lib/drafts';
import { t } from '@/lib/i18n';
import { usePermissions } from '@/lib/permissions';
import { runWithUndo } from '@/lib/undo';
import type { Comment, WorkItem } from '@/types';
import { Actor, When } from '../activity/EventLine';
import { formatMoment } from '../activity/when';
import { focusWhenLost } from '../shared';
import { CommentEditor, hasEditDraft } from './CommentEditor';
import { Reactions } from './Reactions';

/* ------------------------------------------------------------------ hidden cards */

/** Comments deleted while their undo toast stands (and after: a deleted comment never comes back). */
let hidden: ReadonlySet<string> = new Set();
const listeners = new Set<() => void>();

function setHidden(id: string, on: boolean): void {
  if (hidden.has(id) === on) return;
  const next = new Set(hidden);
  if (on) next.add(id);
  else next.delete(id);
  hidden = next;
  listeners.forEach((listener) => listener());
}

/** The ids of the comments a deletion took off the screen. */
export function useHiddenComments(): ReadonlySet<string> {
  const subscribe = useCallback((listener: () => void) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }, []);
  return useSyncExternalStore(subscribe, () => hidden);
}

/* ------------------------------------------------------------------------- card */

export function CommentCard({ comment, item }: { comment: Comment; item: WorkItem }) {
  const me = useCurrentUser()?.id;
  const users = useUserMap();
  const { reason, can } = usePermissions();
  const remove = useDeleteComment();
  const timeZone = useOrganization().data.timezone;
  const [editing, setEditing] = useState(() => hasEditDraft(comment.id));
  const card = useRef<HTMLElement>(null);
  const actionsButton = useRef<HTMLButtonElement>(null);
  const author = users.get(comment.author_id);
  const name = author?.name ?? t('items.fields.property.unknown_person');

  const denied = item.archived_at !== null ? archivedReason(item.key) : reason('item.comment', item.project_id);
  const own = comment.author_id === me;
  const canEdit = own && denied === null;
  const canDelete = denied === null && (own || can('item.delete', item.project_id));

  const stopEditing = () => {
    setEditing(false);
    // the editor goes away: the focus returns to the comment's actions
    focusWhenLost(() => actionsButton.current);
  };

  function deleteIt() {
    const list = card.current?.closest('ol');
    const cards = Array.from(list?.querySelectorAll<HTMLElement>('[data-comment-card]') ?? []);
    const next = cards[cards.indexOf(card.current!) + 1];
    const section = card.current?.closest('section');
    setHidden(comment.id, true);
    // the card and its menu go: the focus moves on to the next card, else to the composer
    focusWhenLost(() => (next?.isConnected ? next : section?.querySelector<HTMLElement>('[aria-keyshortcuts="M"], [data-comment-composer] [contenteditable="true"]')));
    const back = () => setHidden(comment.id, false);
    runWithUndo({
      label: t('items.comments.deleted'),
      undo: back,
      failureTitle: t('items.comments.delete_failed'),
      run: async () => {
        try {
          await remove.mutateAsync(comment.id);
        } catch (error) {
          // deleted elsewhere meanwhile: gone either way (F26)
          if (!(error instanceof ApiError && error.status === 404)) {
            back();
            throw error;
          }
        }
        setHidden(comment.id, true);
        drafts.set(commentEditDraft(comment.id), null);
      },
    });
  }

  return (
    <li className="relative flex gap-2.5">
      {author ? <Avatar user={author} size="sm" decorative /> : <span className="size-5 shrink-0 rounded-full bg-line" aria-hidden="true" />}
      <article
        ref={card}
        tabIndex={-1}
        data-comment-card=""
        aria-label={t('items.comments.card', { name })}
        className="min-w-0 flex-1 rounded-ctl border border-line bg-surface p-3 shadow-elev-1"
      >
        <header className="flex min-w-0 flex-wrap items-baseline gap-x-2 text-ui">
          <span className="min-w-0">
            <Actor user={author} />
          </span>
          <When iso={comment.created_at} />
          {comment.edited_at && (
            <Tooltip content={formatMoment(comment.edited_at, timeZone)}>
              <span className="text-sm text-muted">
                {t('items.comments.edited')}
                {/* the moment for the keyboard and screen readers too, not only in the tooltip (F26) */}
                <time dateTime={comment.edited_at} className="sr-only">
                  {' '}
                  {formatMoment(comment.edited_at, timeZone)}
                </time>
              </span>
            </Tooltip>
          )}
          {(canEdit || canDelete) && !editing && (
            <span className="ml-auto self-center">
              <Menu>
                <MenuTrigger render={<IconButton ref={actionsButton} icon={Ellipsis} size="sm" label={t('items.comments.actions', { name })} tooltip={false} />} />
                <MenuContent align="end">
                  {canEdit && (
                    <MenuItem icon={Pencil} onClick={() => setEditing(true)}>
                      {t('items.comments.edit')}
                    </MenuItem>
                  )}
                  {canDelete && (
                    <MenuItem icon={Trash2} danger onClick={deleteIt}>
                      {t('items.comments.delete')}
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
            <RichTextView value={comment.body_json} preset="comment" className="mt-1" />
            <Reactions comment={comment} canReact={denied === null} />
          </>
        )}
      </article>
    </li>
  );
}
