/*
 * Comments and reactions (spec 4.10, REST `/api/v1/work-items/{item}/comments`, `/api/v1/comments`). Everybody who sees
 * a project may comment and react, viewers too; own comments can be edited, own ones and (as project admin) all can be
 * deleted. The names and signatures are the clickdummy's, with these deviations: a comment holds its text as
 * `body_json` (Tiptap JSON) beside the Markdown `body` and is sent as `body_json` (A243); `toggleReaction` says with
 * `on` whether the reaction is to be there, because the server adds and takes back idempotently (A242).
 */

import type { Comment, RichText } from '@/types';
import type { Page, PageArgs } from './client';
import { del, getPage, one, patch, post, put } from './http';

const itemComments = (itemRef: string) => `/work-items/${encodeURIComponent(itemRef)}/comments`;
const commentPath = (id: string) => `/comments/${encodeURIComponent(id)}`;

/** A page of the comments of an item (by ULID or key), oldest first. */
export function listComments(itemRef: string, args: PageArgs = {}): Promise<Page<Comment>> {
  return getPage<Comment>(itemComments(itemRef), { ...args });
}

/** An empty text is a 422 at `body_json`; the uploads in the text become the comment's. */
export function addComment(work_item_id: string, body: RichText): Promise<Comment> {
  return one(post<{ data: Comment }>(itemComments(work_item_id), { body_json: body }));
}

/** Only its author may edit a comment; it is marked as edited, the history keeps the old text. */
export function editComment(id: string, body: RichText): Promise<Comment> {
  return one(patch<{ data: Comment }>(commentPath(id), { body_json: body }));
}

export function deleteComment(id: string): Promise<void> {
  return del<void>(commentPath(id));
}

/**
 * Adds the own reaction with this emoji (`on`) or takes it back; asking for the state it is in already changes nothing.
 * Answers the comment with its reactions.
 */
export function toggleReaction(comment_id: string, emoji: string, on: boolean): Promise<Comment> {
  const path = `${commentPath(comment_id)}/reactions`;

  return one(on ? put<{ data: Comment }>(path, { emoji }) : del<{ data: Comment }>(`${path}?emoji=${encodeURIComponent(emoji)}`));
}
