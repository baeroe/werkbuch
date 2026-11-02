/*
 * What an editor knows about where it stands (spec 4.16), read by its extensions while the person types:
 * - `projectId`: `@` offers the people and bots of this project, `#` searches items, uploads are stored in it. Without
 *   a project (a text that belongs to none) there is no `@`, no `#` and no upload.
 * - `onUploadError`: a failed upload; the form around the editors gives it through `EditorEnvContext`. Without it a
 *   toast says what went wrong (the server's sentence; a 413 names the limit).
 * - `onOrphanedUploads`: uploads of this editor whose node was no longer in the text when the editor went away (the
 *   person removed the picture again). They belong to nobody (A232); the form may delete them at once.
 * - `chooseFiles`: opens the file choice of the `/` menu; the editor sets it when it can upload.
 * - `uploads`: the editor's running uploads (uploads.ts), stopped when the editor goes away.
 *
 * Uploads have no owner until the text is saved (A232), so the environment names none.
 *
 * Extensions get the environment as a ref, by closure: Tiptap deep-copies extension options (`configure`), which
 * would freeze a value at the moment the editor was built. The editor writes the ref on every render.
 */

import type { Editor } from '@tiptap/react';
import { createContext, type RefObject } from 'react';
import type { UploadSession } from './uploads';

export interface EditorEnv {
  projectId: string | null;
  onUploadError?: (file: File, error: unknown) => void;
  onOrphanedUploads?: (ids: string[]) => void;
  chooseFiles?: (editor: Editor) => void;
  uploads?: UploadSession;
}

export type EditorEnvRef = RefObject<EditorEnv>;

/** What a form hands to every editor inside it. */
export const EditorEnvContext = createContext<Pick<EditorEnv, 'onUploadError' | 'onOrphanedUploads'>>({});
