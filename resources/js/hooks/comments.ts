/*
 * Comments and reactions. Adding, editing and deleting wait for the server and then make the comments, the activity
 * (an edit or deletion is an entry of the history) and the items (the search, the watchers) stale. A reaction shows at
 * once (optimistic): a refusal takes it back and reports itself, every call on its own (13c: "reactions toggle loses
 * earlier error toasts").
 */

import { useMutation, useMutationState, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { addComment, deleteComment, editComment, listComments, toggleReaction } from '@/api/comments';
import type { Page } from '@/api/client';
import { notifyError } from '@/lib/errors';
import { t } from '@/lib/i18n';
import type { Comment, RichText } from '@/types';
import { qk } from './keys';
import { useApiMutation, useSettle } from './mutation';
import { allPages } from './pages';
import { useCurrentUser } from './users';

/** Every comment of an item, oldest first (all pages, like the history, P3). */
export function useComments(itemId: string | null | undefined) {
  return useQuery({
    queryKey: qk.comments.list({ item: itemId, pages: 'all' }),
    queryFn: () => allPages((cursor) => listComments(itemId!, { cursor })),
    enabled: !!itemId,
  });
}

const COMMENT_KEYS = [qk.comments.all, qk.activity.all, qk.workItems.all] as const;

/** Variables: `{ work_item_id, body }`. */
export function useAddComment() {
  return useApiMutation(({ work_item_id, body }: { work_item_id: string; body: RichText }) => addComment(work_item_id, body), COMMENT_KEYS);
}

/** Variables: `{ id, body }`. */
export function useEditComment() {
  return useApiMutation(({ id, body }: { id: string; body: RichText }) => editComment(id, body), COMMENT_KEYS);
}

/** Deletes a comment; the UI calls this when the undo toast has run out. Variable: the comment id. */
export function useDeleteComment() {
  return useApiMutation(deleteComment, COMMENT_KEYS);
}

/* --------------------------------------------------------------------- reactions */

export interface ReactionVars {
  comment_id: string;
  emoji: string;
  /** Whether the own reaction is to be there afterwards. */
  on: boolean;
}

const REACTION_KEY = ['reaction'] as const;

/** The reactions with the own one added (at the end of its emoji, a new emoji at the end) or taken back. */
function reacted(reactions: Comment['reactions'], emoji: string, me: string, on: boolean): Comment['reactions'] {
  const group = reactions.find((reaction) => reaction.emoji === emoji);
  if (on) {
    if (group?.user_ids.includes(me)) return reactions;
    return group
      ? reactions.map((reaction) => (reaction === group ? { ...reaction, user_ids: [...reaction.user_ids, me] } : reaction))
      : [...reactions, { emoji, user_ids: [me] }];
  }
  if (!group?.user_ids.includes(me)) return reactions;
  return reactions
    .map((reaction) => (reaction === group ? { ...reaction, user_ids: reaction.user_ids.filter((id) => id !== me) } : reaction))
    .filter((reaction) => reaction.user_ids.length > 0);
}

/** Changes the comment in every cached list of comments; whether anything changed. */
function changeComment(queryClient: QueryClient, id: string, change: (comment: Comment) => Comment): boolean {
  let changed = false;
  queryClient.setQueriesData<Page<Comment>>({ queryKey: qk.comments.all }, (page) => {
    if (!page?.items.some((comment) => comment.id === id)) return page;
    return {
      ...page,
      items: page.items.map((comment) => {
        if (comment.id !== id) return comment;
        const next = change(comment);
        changed ||= next !== comment;
        return next;
      }),
    };
  });
  return changed;
}

/** The comment with the own reaction added or taken back; the same comment when it is that way already. */
function withReaction(comment: Comment, emoji: string, me: string, on: boolean): Comment {
  const reactions = reacted(comment.reactions, emoji, me, on);
  return reactions === comment.reactions ? comment : { ...comment, reactions };
}

/**
 * Adds or takes back the own reaction: `toggle({ comment_id, emoji, on })`. The reaction shows at once in the cached
 * comments; a failure takes exactly this change back (another reaction on its way stays) and says so in a toast of its
 * own, with "Erneut versuchen" after an outage. The comment of the answer replaces the cached one once no other
 * reaction is on its way, so an earlier answer never hides a later reaction. `isPending(comment_id, emoji)` tells a
 * reaction on its way.
 */
export function useToggleReaction() {
  const queryClient = useQueryClient();
  const me = useCurrentUser()?.id ?? '';
  const settle = useSettle();
  const mutation = useMutation<Comment, Error, ReactionVars, { changed: boolean }>({
    mutationKey: REACTION_KEY,
    mutationFn: ({ comment_id, emoji, on }) => toggleReaction(comment_id, emoji, on),
    onMutate: ({ comment_id, emoji, on }) => ({ changed: changeComment(queryClient, comment_id, (comment) => withReaction(comment, emoji, me, on)) }),
    onSuccess: (answer) => {
      // this call still counts as on its way here
      if (queryClient.isMutating({ mutationKey: REACTION_KEY }) <= 1) changeComment(queryClient, answer.id, () => answer);
    },
    // only what this call changed goes back: a reaction that was there already stays
    onError: (_error, { comment_id, emoji, on }, context) => {
      if (context?.changed) changeComment(queryClient, comment_id, (comment) => withReaction(comment, emoji, me, !on));
    },
  });
  const { mutateAsync } = mutation;

  const toggle = useCallback(
    (vars: ReactionVars) => {
      settle(mutateAsync(vars), { onError: (error) => notifyError(t('items.failed.reaction', { emoji: vars.emoji }), error, () => toggle(vars)) });
    },
    [settle, mutateAsync],
  );

  const pending = useMutationState({ filters: { mutationKey: REACTION_KEY, status: 'pending' }, select: (entry) => entry.state.variables as ReactionVars });
  const isPending = (comment_id: string, emoji: string) => pending.some((vars) => vars.comment_id === comment_id && vars.emoji === emoji);

  return { toggle, isPending };
}
