import { addComment, deleteComment, editComment, toggleReaction } from '@/api/comments';
import type { RichText } from '@/types';
import { qk } from './keys';
import { useApiMutation } from './mutation';

const COMMENT_KEYS = [qk.activity.all, qk.workItems.all, qk.notifications.all] as const;

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

/** Variables: `{ comment_id, emoji }`. */
export function useToggleReaction() {
  return useApiMutation(({ comment_id, emoji }: { comment_id: string; emoji: string }) => toggleReaction(comment_id, emoji), [qk.activity.all]);
}
