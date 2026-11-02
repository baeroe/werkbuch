/*
 * Pictures and files into a text (spec 4.16): pasting, dropping or choosing files (the `/` menu) uploads each of them
 * into the editor's project (`uploadAttachment`, kind `inline`, no owner: saving the text links it, A232). Meanwhile a
 * placeholder stands where the file will go: its name and a progress bar (`role="progressbar"`, `aria-valuenow` in
 * percent). Once stored, the file becomes a node at the placeholder's place: `image` for what a browser may show
 * (`inline`), `attachment` (a chip to download) for anything else. A failed upload takes its placeholder away and goes
 * to `onUploadError` (by default a toast with the server's sentence; "Erneut versuchen" puts it at the same place).
 *
 * - Only with a project: without one, files are neither pasted nor dropped.
 * - A paste that brings HTML along (a web page, an office document) is pasted as HTML, its files are not uploaded: an
 *   `<img src>` never becomes an image (A236), the server would refuse it as well.
 * - The editor's `UploadSession` counts the running uploads for the form (UploadContext.tsx), puts each answer into the
 *   cache (the new image shows without asking the server), stops running uploads when the editor goes away and names
 *   the uploads whose node is no longer in the text then (`onOrphanedUploads`).
 */

import FileHandler from '@tiptap/extension-file-handler';
import type { Node as PMNode } from '@tiptap/pm/model';
import { Plugin, PluginKey, type EditorState } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { Extension, type AnyExtension, type Editor } from '@tiptap/react';
import { uploadAttachment } from '@/api/attachments';
import { notifyError } from '@/lib/errors';
import { t } from '@/lib/i18n';
import type { Attachment, RichText } from '@/types';
import type { EditorEnv, EditorEnvRef } from './EditorEnv';

/** What a browser may show as a picture (`Attachment::inline` on the server, by content); the placeholder guesses by type. */
const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/avif'];

/* ---------------------------------------------------------------------------- session */

/** The uploads of one editor, from its first render until it goes away. */
export class UploadSession {
  private readonly controller = new AbortController();
  private readonly done = new Set<string>();
  /** The form's counter of running uploads: an upload started (1) or ended (-1). */
  track: (delta: number) => void = () => {};
  /** Puts a stored attachment into the cache, so its node shows at once. */
  prime: (attachment: Attachment) => void = () => {};

  get signal(): AbortSignal {
    return this.controller.signal;
  }

  get closed(): boolean {
    return this.controller.signal.aborted;
  }

  /** An upload of this editor became a node. */
  inserted(id: string): void {
    this.done.add(id);
  }

  /** Stops the running uploads; returns the uploads of this editor whose node is not in `doc`. */
  close(doc: PMNode): string[] {
    this.controller.abort();
    const present = new Set<unknown>();
    doc.descendants((node) => void present.add(node.attrs.attachmentId));
    return [...this.done].filter((id) => !present.has(id));
  }
}

/* ------------------------------------------------------------------------ placeholders */

type PlaceholderMeta = { add: { id: string; pos: number; element: HTMLElement } } | { remove: string };

const uploadKey = new PluginKey<DecorationSet>('uploads');

/** The box that stands where an upload will go: what is uploaded and a bar that fills as the file goes out. */
function placeholderElement(name: string, image: boolean): HTMLElement {
  const box = document.createElement('span');
  box.className = 'rt-upload';
  box.contentEditable = 'false';
  const label = t(image ? 'editor.upload.image' : 'editor.upload.file', { name });
  const text = document.createElement('span');
  text.className = 'rt-upload-label';
  text.textContent = label;
  const bar = document.createElement('span');
  bar.className = 'rt-upload-bar';
  bar.setAttribute('role', 'progressbar');
  bar.setAttribute('aria-label', label);
  bar.setAttribute('aria-valuemin', '0');
  bar.setAttribute('aria-valuemax', '100');
  const fill = document.createElement('span');
  fill.className = 'rt-upload-fill';
  bar.append(fill);
  box.append(text, bar);
  setProgress(box, 0);
  return box;
}

function setProgress(box: HTMLElement, fraction: number): void {
  const percent = Math.round(fraction * 100);
  box.querySelector('[role="progressbar"]')!.setAttribute('aria-valuenow', String(percent));
  box.querySelector<HTMLElement>('.rt-upload-fill')!.style.width = `${percent}%`;
}

/** Keeps the placeholders of running uploads in place while the text around them changes. */
function uploadPlaceholders(): Plugin<DecorationSet> {
  return new Plugin<DecorationSet>({
    key: uploadKey,
    state: {
      init: () => DecorationSet.empty,
      apply(tr, set) {
        const next = set.map(tr.mapping, tr.doc);
        const meta = tr.getMeta(uploadKey) as PlaceholderMeta | undefined;
        if (meta && 'add' in meta) {
          const { id, pos, element } = meta.add;
          return next.add(tr.doc, [Decoration.widget(pos, element, { id, key: id, side: -1 })]);
        }
        return meta ? next.remove(next.find(undefined, undefined, (spec) => spec.id === meta.remove)) : next;
      },
    },
    props: { decorations: (state) => uploadKey.getState(state) },
  });
}

function placeholderPos(state: EditorState, id: string): number | undefined {
  return uploadKey.getState(state)?.find(undefined, undefined, (spec) => spec.id === id)[0]?.from;
}

/* ---------------------------------------------------------------------------- uploads */

/** The node a stored upload becomes. */
export function nodeFor(attachment: Attachment): RichText {
  return attachment.inline
    ? { type: 'image', attrs: { attachmentId: attachment.id, alt: attachment.filename } }
    : { type: 'attachment', attrs: { attachmentId: attachment.id, filename: attachment.filename } };
}

let uploadCounter = 0;

/** Uploads files into the editor's project and puts each at `pos` once it is stored (see above). */
export function uploadFiles(editor: Editor, files: readonly File[], pos: number, env: EditorEnv): void {
  const { projectId, uploads: session } = env;
  if (projectId === null || session === undefined || session.closed) return;

  for (const file of files) {
    const id = `upload-${(uploadCounter += 1)}`;
    const element = placeholderElement(file.name, IMAGE_TYPES.includes(file.type));
    editor.view.dispatch(editor.state.tr.setMeta(uploadKey, { add: { id, pos, element } } satisfies PlaceholderMeta));
    session.track(1);

    uploadAttachment(projectId, file, null, 'inline', { onProgress: (fraction) => setProgress(element, fraction), signal: session.signal })
      .then(
        (attachment) => {
          session.prime(attachment);
          const at = placeholderPos(editor.state, id) ?? editor.state.selection.to;
          editor
            .chain()
            .command(({ tr }) => {
              tr.setMeta(uploadKey, { remove: id } satisfies PlaceholderMeta);
              return true;
            })
            .insertContentAt(at, nodeFor(attachment))
            .run();
          session.inserted(attachment.id);
        },
        (error: unknown) => {
          // the editor went away and stopped it: nothing to say
          if (session.closed) return;
          const at = placeholderPos(editor.state, id) ?? pos;
          editor.view.dispatch(editor.state.tr.setMeta(uploadKey, { remove: id } satisfies PlaceholderMeta));
          if (env.onUploadError) env.onUploadError(file, error);
          else notifyError(t('editor.upload.failed', { name: file.name }), error, () => uploadFiles(editor, [file], Math.min(at, editor.state.doc.content.size), env));
        },
      )
      .finally(() => session.track(-1));
  }
}

/** Opens the browser's file choice (several files at once) and hands over what was chosen. */
export function pickFiles(editor: Editor, onPick: (files: File[]) => void): void {
  const input = document.createElement('input');
  input.type = 'file';
  input.multiple = true;
  input.tabIndex = -1;
  input.setAttribute('aria-hidden', 'true');
  // rendered but out of sight: a file input that is not rendered at all opens no file choice in every browser
  input.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;pointer-events:none';
  // inside the editor's own box: a modal dialog around it must not count the click as one outside
  editor.view.dom.parentElement!.append(input);
  input.addEventListener('change', () => {
    input.remove();
    onPick([...input.files!]);
  });
  input.addEventListener('cancel', () => input.remove());
  input.click();
}

/** Pasting and dropping files, and the placeholders while they upload. */
export function uploadExtensions(env: EditorEnvRef): AnyExtension[] {
  return [
    FileHandler.configure({
      onPaste: (editor, files, html) => {
        // HTML is pasted as HTML (see above); the files that came along stay where they were
        if (!html) uploadFiles(editor, files, editor.state.selection.from, env.current);
      },
      onDrop: (editor, files, pos) => uploadFiles(editor, files, pos, env.current),
    }),
    Extension.create({ name: 'uploadPlaceholders', addProseMirrorPlugins: () => [uploadPlaceholders()] }),
  ];
}
