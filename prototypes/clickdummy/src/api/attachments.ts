/*
 * Attachments (spec 4.16). The prototype keeps a file as a data URL inside the stored document, so the size is
 * limited to what localStorage holds. The record has the shape of the real one, only `url` differs.
 */

import { attachmentIds } from '@/lib/richtext';
import type { Attachment, RichText } from '@/types';
import { canSeeProject, requireWritable } from './access';
import { ApiError, FieldErrors, newId, notFound, read, write } from './client';
import type { Db } from './db';
import { notifyPeople, recordEvent } from './events';
import { findProject } from './lookup';

/** The most a file may weigh in the prototype (the real app allows 25 MB by default). */
export const MAX_ATTACHMENT_BYTES = 1_000_000;

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error('Die Datei lässt sich nicht lesen.'));
    reader.readAsDataURL(file);
  });
}

/**
 * One attachment, for the editors and viewers that show it by its id (spec 4.16: the route checks the right to read
 * its owner, which the prototype takes as the right to see its project). 404 for one the person may not see.
 */
export function getAttachment(id: string): Promise<Attachment> {
  return read(({ db, me }) => {
    const attachment = db.attachments.find((entry) => entry.id === id);
    const project = attachment && db.projects.find((entry) => entry.id === attachment.project_id);
    if (!attachment || !project || !canSeeProject(db, me, project)) throw notFound('Der Anhang');
    return attachment;
  });
}

/**
 * The server reads the attachments of a text when it is saved (spec 4.16): an upload that belongs to nobody yet (made
 * before its comment, item or template existed) gets the owner of the text it stands in. Only uploads of the same
 * project; one that has an owner keeps it.
 */
export function linkAttachments(db: Db, projectId: string, docs: readonly (RichText | null | undefined)[], owner: NonNullable<Attachment['owner']>): void {
  const ids = new Set(docs.flatMap((doc) => attachmentIds(doc)));
  for (const attachment of db.attachments) {
    if (ids.has(attachment.id) && attachment.owner === null && attachment.project_id === projectId) attachment.owner = { ...owner };
  }
}

/** The rich text values of a property set (they hold uploads too). */
export const richValues = (values: Record<string, unknown> | undefined): RichText[] =>
  Object.values(values ?? {}).filter((value): value is RichText => typeof value === 'object' && value !== null && !Array.isArray(value) && (value as RichText).type === 'doc');

/** Whether the owner exists and belongs to the project. */
function ownerExists(db: Db, projectId: string, owner: NonNullable<Attachment['owner']>): boolean {
  switch (owner.type) {
    case 'work_item':
      return db.items.some((item) => item.id === owner.id && item.project_id === projectId);
    case 'page':
      return db.pages.some((page) => page.id === owner.id && page.project_id === projectId);
    case 'template':
      return db.templates.some((template) => template.id === owner.id && template.project_id === projectId);
    case 'comment':
      return db.comments.some((comment) => comment.id === owner.id && db.items.some((item) => item.id === comment.work_item_id && item.project_id === projectId));
  }
}

/**
 * Stores an uploaded file. `owner: null` is an upload for something that is not saved yet; `createWorkItem` takes
 * the ids and links them. `kind`: `inline` for images in the editor, `file` for the file list of an item.
 */
export async function uploadAttachment(
  project_id: string,
  file: File,
  owner: Attachment['owner'],
  kind: Attachment['kind'],
): Promise<Attachment> {
  if (file.size > MAX_ATTACHMENT_BYTES) {
    throw new ApiError({
      status: 413,
      reason: 'payload_too_large',
      detail: `„${file.name}“ ist zu groß: Im Klickdummy sind Anhänge auf 1 MB begrenzt.`,
    });
  }
  const url = await readAsDataUrl(file);

  return write((ctx) => {
    const { db, me } = ctx;
    const project = findProject(db, project_id);
    if (!project) throw notFound('Das Projekt');
    requireWritable(db, me, project, 'member', 'Dateien hochladen dürfen nur Member und Admins des Projekts.');
    if (owner !== null && !ownerExists(db, project.id, owner)) {
      const errors = new FieldErrors();
      errors.add('owner', 'Das Ziel der Datei gibt es nicht.');
      errors.throwIfAny();
    }

    const attachment: Attachment = {
      id: newId('att'),
      project_id: project.id,
      owner: owner === null ? null : { ...owner },
      kind,
      filename: file.name,
      mime: file.type || 'application/octet-stream',
      size: file.size,
      url,
    };
    db.attachments.push(attachment);
    if (owner?.type === 'work_item' && kind === 'file') {
      const event = recordEvent(ctx, {
        type: 'work_item.updated',
        actor_id: me.id,
        subject: { type: 'work_item', id: owner.id },
        project_id: project.id,
        changes: { attachment: { old: null, new: file.name } },
      });
      const item = db.items.find((entry) => entry.id === owner.id);
      // a file is one of the "sonstige Änderungen" (spec 4.14)
      if (item) notifyPeople(ctx, { event: 'item_changed', item, actor_id: me.id, event_id: event.id, data: { fields: ['attachment'] } });
    }
    return attachment;
  });
}

export function deleteAttachment(id: string): Promise<void> {
  return write((ctx) => {
    const { db, me } = ctx;
    const attachment = db.attachments.find((entry) => entry.id === id);
    const project = attachment && db.projects.find((entry) => entry.id === attachment.project_id);
    if (!attachment || !project) throw notFound('Der Anhang');
    requireWritable(db, me, project, 'member', 'Dateien löschen dürfen nur Member und Admins des Projekts.');

    db.attachments = db.attachments.filter((entry) => entry.id !== attachment.id);
    if (attachment.owner?.type === 'work_item' && attachment.kind === 'file') {
      const itemId = attachment.owner.id;
      const event = recordEvent(ctx, {
        type: 'work_item.updated',
        actor_id: me.id,
        subject: { type: 'work_item', id: itemId },
        project_id: project.id,
        changes: { attachment: { old: attachment.filename, new: null } },
      });
      const item = db.items.find((entry) => entry.id === itemId);
      if (item) notifyPeople(ctx, { event: 'item_changed', item, actor_id: me.id, event_id: event.id, data: { fields: ['attachment'] } });
    }
  });
}
