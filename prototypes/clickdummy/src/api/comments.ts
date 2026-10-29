/*
 * Comments and reactions (spec 4.10). Everybody who sees a project may comment and react, even viewers. Own comments
 * can be edited, own ones and (as project admin) all can be deleted; both leave a mark in the history.
 */

import { isBlankDoc, mentionedIds, plainText } from '@/lib/richtext';
import type { Comment, RichText, WorkItemRecord } from '@/types';
import { isOrgAdmin, requireWritable } from './access';
import { linkAttachments } from './attachments';
import { clone, forbidden, invalid, newId, notFound, write } from './client';
import type { Db } from './db';
import { addSubscriber, notifyPeople, recordEvent } from './events';
import { handleMentions } from './itemRules';
import { projectOf } from './lookup';
import { requireItem } from './workItems';

function findComment(db: Db, id: string): { comment: Comment; item: WorkItemRecord } {
  const comment = db.comments.find((entry) => entry.id === id);
  const item = comment ? db.items.find((entry) => entry.id === comment.work_item_id) : undefined;
  if (!comment || !item) throw notFound('Der Kommentar');
  return { comment, item };
}

const MAX_EMOJI = 16;

export function addComment(work_item_id: string, body: RichText): Promise<Comment> {
  return write((ctx) => {
    const { db, me, stamp } = ctx;
    const { item, project } = requireItem(db, me, work_item_id);
    requireWritable(db, me, project, 'viewer');
    if (isBlankDoc(body)) throw invalid({ body: ['Der Kommentar ist leer.'] });

    const comment: Comment = {
      id: newId('c'),
      work_item_id: item.id,
      author_id: me.id,
      body: clone(body),
      created_at: stamp,
      edited_at: null,
      reactions: [],
    };
    db.comments.push(comment);
    // the images of the comment were uploaded before it existed: they belong to it now (spec 4.16)
    linkAttachments(db, project.id, [comment.body], { type: 'comment', id: comment.id });
    addSubscriber(db, item, me.id); // who comments watches (unless they switched it off by hand)

    const mentioned = mentionedIds(body);
    handleMentions(ctx, me, item, mentioned, body, comment.id);
    const event = recordEvent(ctx, {
      type: 'comment.created',
      actor_id: me.id,
      subject: { type: 'work_item', id: item.id },
      project_id: project.id,
      changes: { comment_id: { old: null, new: comment.id } },
    });
    // the people mentioned got their own notification; everybody else watching hears about the comment
    const others = new Set([...item.subscriber_ids, project.lead_id]);
    mentioned.forEach((id) => others.delete(id));
    notifyPeople(ctx, {
      event: 'comment',
      item,
      actor_id: me.id,
      event_id: event.id,
      data: { excerpt: plainText(body).slice(0, 160), comment_id: comment.id },
      recipients: others,
    });
    return comment;
  });
}

export function editComment(id: string, body: RichText): Promise<Comment> {
  return write((ctx) => {
    const { db, me, stamp } = ctx;
    const { comment, item } = findComment(db, id);
    const project = projectOf(db, item);
    requireWritable(db, me, project, 'viewer');
    if (comment.author_id !== me.id) throw forbidden('Nur die Autorin oder der Autor darf einen Kommentar bearbeiten.');
    if (isBlankDoc(body)) throw invalid({ body: ['Der Kommentar ist leer.'] });

    const before = new Set(mentionedIds(comment.body));
    const previous = comment.body;
    comment.body = clone(body);
    comment.edited_at = stamp;
    linkAttachments(db, project.id, [comment.body], { type: 'comment', id: comment.id });
    recordEvent(ctx, {
      type: 'comment.updated',
      actor_id: me.id,
      subject: { type: 'work_item', id: item.id },
      project_id: project.id,
      changes: { body: { old: previous, new: comment.body } },
    });
    handleMentions(ctx, me, item, mentionedIds(body).filter((mention) => !before.has(mention)), body, comment.id);
    return comment;
  });
}

export function deleteComment(id: string): Promise<void> {
  return write((ctx) => {
    const { db, me } = ctx;
    const { comment, item } = findComment(db, id);
    const project = projectOf(db, item);
    const role = requireWritable(db, me, project, 'viewer');
    if (comment.author_id !== me.id && role !== 'admin' && !isOrgAdmin(me)) {
      throw forbidden('Fremde Kommentare löschen nur Admins des Projekts.');
    }

    db.comments = db.comments.filter((entry) => entry.id !== comment.id);
    recordEvent(ctx, {
      type: 'comment.deleted',
      actor_id: me.id,
      subject: { type: 'work_item', id: item.id },
      project_id: project.id,
      changes: { body: { old: comment.body, new: null } },
    });
  });
}

/** Adds the signed-in person's reaction, or takes it back when it is there already (each person once per emoji). */
export function toggleReaction(comment_id: string, emoji: string): Promise<Comment> {
  return write(({ db, me }) => {
    const { comment, item } = findComment(db, comment_id);
    requireWritable(db, me, projectOf(db, item), 'viewer');
    if (emoji.trim() === '' || emoji.length > MAX_EMOJI) throw invalid({ emoji: ['Das ist kein Emoji.'] });

    const group = comment.reactions.find((reaction) => reaction.emoji === emoji);
    if (!group) {
      comment.reactions.push({ emoji, user_ids: [me.id] });
    } else if (group.user_ids.includes(me.id)) {
      group.user_ids = group.user_ids.filter((userId) => userId !== me.id);
      comment.reactions = comment.reactions.filter((reaction) => reaction.user_ids.length > 0);
    } else {
      group.user_ids.push(me.id);
    }
    return comment;
  });
}
