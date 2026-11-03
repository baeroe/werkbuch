/*
 * Attachments (spec 4.16): pictures and files in texts (`kind: inline`) and in the file list of an item
 * (`kind: file`). The record comes from `/api/v1/attachments`, the file itself from the web route `/attachments/{id}`
 * (A235), which checks that the reader sees its owner. The names and signatures are the clickdummy's, with these
 * deviations: an upload into a text never names an owner, saving the text links it (A232); `uploadAttachment` reports
 * its progress and can be stopped.
 */

import type { Attachment } from '@/types';
import { del, get, one, upload } from './http';

const attachmentPath = (id: string) => `/attachments/${encodeURIComponent(id)}`;

export interface UploadOptions {
  /** The sent share of the file, 0 to 1. */
  onProgress?: (fraction: number) => void;
  signal?: AbortSignal;
}

/** One attachment by its id; 404 for one whose owner the reader does not see. */
export function getAttachment(id: string): Promise<Attachment> {
  return one(get<{ data: Attachment }>(attachmentPath(id)));
}

/**
 * Uploads a file into a project. `kind: inline` is a picture or file in a text: it belongs to nobody until the text is
 * saved, whatever `owner` says (A232). `kind: file` goes into the file list of the item named by `owner` (without one
 * it fails at once, nothing goes out). A file
 * larger than the instance allows is a 413 `payload_too_large`.
 */
export function uploadAttachment(
  project_id: string,
  file: File,
  owner: { type: 'work_item'; id: string } | null,
  kind: Attachment['kind'],
  { onProgress, signal }: UploadOptions = {},
): Promise<Attachment> {
  // a file of the file list without its item would only come back as a 422: a mistake of the caller (T15-M6)
  if (kind === 'file' && owner === null) return Promise.reject(new TypeError('A file of the file list needs its item (owner).'));
  const form = new FormData();
  form.append('project_id', project_id);
  form.append('kind', kind);
  if (kind === 'file' && owner !== null) form.append('work_item_id', owner.id);
  form.append('file', file);

  return one(upload<{ data: Attachment }>('/attachments', form, onProgress, { signal }));
}

/** Files of the file list (by those who may edit the item) and own uploads nobody owns yet; a picture in a text is a 409. */
export function deleteAttachment(id: string): Promise<void> {
  return del<void>(attachmentPath(id));
}

/** Where the file is: the preview when one was made and `preview` asks for it, the download of a picture with `download`. */
export function attachmentUrl(attachment: Attachment, { preview = false, download = false }: { preview?: boolean; download?: boolean } = {}): string {
  if (preview && attachment.preview_url !== null) return attachment.preview_url;

  return download ? `${attachment.url}?download=1` : attachment.url;
}
