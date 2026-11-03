/*
 * Pictures and files into a text (spec 4.16): pasting, dropping or choosing files (the `/` menu) uploads each of them
 * into the editor's project (`uploadAttachment`, kind `inline`, no owner: saving the text links it, A232). Meanwhile a
 * placeholder stands where the file will go: its name and a progress bar (`role="progressbar"`, `aria-valuenow` in
 * percent). Once stored, the file becomes a node at the placeholder's place: `image` for what a browser may show
 * (`inline`), `attachment` (a chip to download) for anything else. A failed upload takes its placeholder away and goes
 * to `onUploadError` (by default a toast with the server's sentence; "Erneut versuchen" puts it at the same place).
 *
 * - Only with a project: without one, files are neither pasted nor dropped, and a toast says why (F20).
 * - Leaving or reloading the page asks first while an upload runs (`drafts.hold()`); an upload that the editor going
 *   away stops is named in a toast (F18). The editor's live region says when an upload starts, ends or fails (F21).
 * - A finished upload whose placeholder is gone (its block was deleted) or whose editor was replaced meanwhile goes into
 *   no text (F19): it belongs to nobody, and the hourly job removes it.
 * - Pasted files replace the selection, like any paste. A browser's "Copy image" brings the picture along with HTML
 *   that holds nothing but the `<img>` (and a `<meta>`): that is a picture, uploaded like a screenshot (`onlyImages`).
 *   HTML with anything else (text of a web page, an office document, which adds a picture of the whole selection) is
 *   pasted as HTML, its files are not uploaded. An `<img src>` never becomes an image either way (A236): the picture
 *   comes from the uploaded file, whose kind the server reads from its content.
 * - A finished upload leaves the cursor where it is: whoever typed on meanwhile goes on at the same place.
 * - The editor's `UploadSession` counts the running uploads for the form (UploadContext.tsx), puts each answer into the
 *   cache (the new image shows without asking the server) and stops running uploads when the editor goes away.
 *   Uploads whose node left the text again are not deleted: they belong to nobody until a text names them, and the
 *   hourly job removes them after 24 hours (A239, ruling T17-I4); one that was saved meanwhile belongs to its text.
 */

import FileHandler from '@tiptap/extension-file-handler';
import { Plugin, PluginKey, type EditorState } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { Extension, type AnyExtension, type Editor } from '@tiptap/react';
import { uploadAttachment } from '@/api/attachments';
import { toast } from '@/components/ui/toast';
import { drafts } from '@/lib/drafts';
import { notifyError } from '@/lib/errors';
import { t } from '@/lib/i18n';
import type { Attachment, RichText } from '@/types';
import { announce } from './announcer';
import type { EditorEnv, EditorEnvRef } from './EditorEnv';

/** What a browser may show as a picture (`Attachment::inline` on the server, by content); the placeholder guesses by type. */
const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/avif'];

/* ---------------------------------------------------------------------------- session */

/** The uploads of one editor, from its first render until it goes away. */
export class UploadSession {
  private readonly controller = new AbortController();
  /** The names of the files on their way, by upload. */
  readonly running = new Map<string, string>();
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

  /** Stops the running uploads (the editor went away) and says which ones stopped. */
  close(): void {
    const stopped = [...this.running.values()];
    this.controller.abort();
    if (stopped.length > 0) toast({ title: t('editor.upload.stopped', { names: stopped.join(', ') }) });
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
  if (editor.isDestroyed || session === undefined || session.closed) return;
  if (projectId === null) {
    noProject(editor);
    return;
  }

  for (const file of files) {
    const id = `upload-${(uploadCounter += 1)}`;
    const image = IMAGE_TYPES.includes(file.type);
    const element = placeholderElement(file.name, image);
    editor.view.dispatch(editor.state.tr.setMeta(uploadKey, { add: { id, pos, element } } satisfies PlaceholderMeta));
    session.track(1);
    session.running.set(id, file.name);
    const release = drafts.hold();
    announce(editor.view.dom, t(image ? 'editor.upload.image' : 'editor.upload.file', { name: file.name }));

    uploadAttachment(projectId, file, null, 'inline', { onProgress: (fraction) => setProgress(element, fraction), signal: session.signal })
      .then(
        (attachment) => {
          session.prime(attachment);
          // the editor was replaced, or the block around the placeholder went: the file goes into no text
          const at = editor.isDestroyed ? undefined : placeholderPos(editor.state, id);
          if (at === undefined) return;
          announce(editor.view.dom, t('editor.upload.done', { name: file.name }));
          editor
            .chain()
            .command(({ tr }) => {
              tr.setMeta(uploadKey, { remove: id } satisfies PlaceholderMeta);
              return true;
            })
            // the cursor stays where the person went on typing meanwhile
            .insertContentAt(at, nodeFor(attachment), { updateSelection: false })
            .run();
        },
        (error: unknown) => {
          // the editor went away and stopped it: its toast said so
          if (session.closed || editor.isDestroyed) return;
          const at = placeholderPos(editor.state, id) ?? pos;
          editor.view.dispatch(editor.state.tr.setMeta(uploadKey, { remove: id } satisfies PlaceholderMeta));
          announce(editor.view.dom, t('editor.upload.failed', { name: file.name }));
          if (env.onUploadError) env.onUploadError(file, error);
          else notifyError(t('editor.upload.failed', { name: file.name }), error, () => uploadFiles(editor, [file], Math.min(at, editor.state.doc.content.size), env));
        },
      )
      .finally(() => {
        session.running.delete(id);
        session.track(-1);
        release();
      });
  }
}

/** Files pasted or dropped where they cannot go: the text belongs to no project (F20). */
function noProject(editor: Editor): void {
  const text = t('editor.upload.no_project');
  toast({ title: text });
  announce(editor.view.dom, text);
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

/** Whether pasted HTML is nothing but pictures: images, no text, no other element (what "Copy image" puts there). */
export function onlyImages(html: string): boolean {
  const body = new DOMParser().parseFromString(html, 'text/html').body;
  const elements = [...body.querySelectorAll('*')];
  return elements.length > 0 && elements.every((element) => element.tagName === 'IMG') && body.textContent!.trim() === '';
}

/** Pasting files: they replace the selection and upload (see above); mixed HTML goes on to ProseMirror. */
function pasteFiles(editor: Editor, env: EditorEnvRef): Plugin {
  return new Plugin({
    key: new PluginKey('pasteFiles'),
    props: {
      handlePaste(view, event) {
        const files = [...(event.clipboardData?.files ?? [])];
        const html = event.clipboardData?.getData('text/html') ?? '';
        if (files.length === 0 || (html !== '' && !onlyImages(html))) return false;
        event.preventDefault();
        // without a project nothing is uploaded; the paste is used up, so the browser does not paste the file itself
        if (env.current.projectId === null) {
          noProject(editor);
          return true;
        }
        view.dispatch(view.state.tr.deleteSelection());
        uploadFiles(editor, files, view.state.selection.from, env.current);
        return true;
      },
    },
  });
}

/** Pasting and dropping files, and the placeholders while they upload. */
export function uploadExtensions(env: EditorEnvRef): AnyExtension[] {
  return [
    // before the paste rules of links and lists, which would read the HTML
    Extension.create({
      name: 'pasteFiles',
      priority: 200,
      addProseMirrorPlugins() {
        return [pasteFiles(this.editor, env)];
      },
    }),
    FileHandler.configure({ onDrop: (editor, files, pos) => uploadFiles(editor, files, pos, env.current) }),
    Extension.create({ name: 'uploadPlaceholders', addProseMirrorPlugins: () => [uploadPlaceholders()] }),
  ];
}
