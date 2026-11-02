/*
 * What an editor knows about where it stands (spec 4.16), read by its extensions while the person types:
 * - `projectId`: `@` offers the people and bots of this project, `#` searches items, uploads are stored in it. Without
 *   a project (a text that belongs to none) there is no `@`, no `#` and no upload.
 * - `onUploadError`: a failed upload (Task 17); the form around the editors gives it through `EditorEnvContext`.
 * - `chooseFiles`: opens the file choice of the `/` menu (Task 17); without it the menu offers no image or file.
 *
 * Uploads have no owner until the text is saved (A232), so the environment names none.
 *
 * Extensions get the environment as a ref, by closure: Tiptap deep-copies extension options (`configure`), which
 * would freeze a value at the moment the editor was built. The editor writes the ref on every render.
 */

import type { Editor } from '@tiptap/react';
import { createContext, type RefObject } from 'react';

export interface EditorEnv {
  projectId: string | null;
  onUploadError?: (file: File, error: unknown) => void;
  chooseFiles?: (editor: Editor) => void;
}

export type EditorEnvRef = RefObject<EditorEnv>;

/** What a form hands to every editor inside it. */
export const EditorEnvContext = createContext<Pick<EditorEnv, 'onUploadError'>>({});
