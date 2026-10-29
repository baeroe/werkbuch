/*
 * Images and files in rich text (spec 4.16). Pasting, dropping or choosing a file uploads it through
 * `uploadAttachment` (kind `inline`); meanwhile a placeholder with a progress bar stands where it will go. The document
 * keeps only the attachment's id, never a path or the file (`![alt](attachment:<id>)` in Markdown):
 * - `image` for the safe image formats, shown inline
 * - `attachment` for every other file, a chip to download it
 *
 * Who owns an upload comes from `UploadOwnerContext` (the item of a description, the comment being edited, the
 * template); without it the upload belongs to nobody until the text it stands in is saved: the server then makes the
 * new comment, item or template its owner (spec 4.16).
 *
 * The nodes show their attachment through `useAttachment(id)` (getAttachment); an upload puts its answer into that
 * cache, so the new image shows at once.
 */

import { Node, mergeAttributes, type Editor } from '@tiptap/react';
import { Plugin, PluginKey, type EditorState } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import Image from '@tiptap/extension-image';
import { createContext } from 'react';
import type { Attachment, RichText } from '@/types';
import { INLINE_IMAGE_TYPES } from './presets';

/* ----------------------------------------------------------------------------- owner */

/** The owner of what the editors below upload: `{ type: 'work_item', id }` in an item detail. */
export const UploadOwnerContext = createContext<Attachment['owner']>(null);

/* ------------------------------------------------------------------------------ nodes */

export const isInlineImage = (mime: string) => INLINE_IMAGE_TYPES.includes(mime);

/**
 * An image of the document: the attachment id and an alternative text. External images (`<img src>` from pasted
 * HTML, Markdown `![](https://…)`) are not taken over: everything shown comes from an attachment.
 */
export const AttachmentImage = Image.extend({
  draggable: true,
  addAttributes() {
    return {
      attachmentId: {
        default: null,
        parseHTML: (element: HTMLElement) => element.getAttribute('data-attachment-id'),
        renderHTML: (attributes: Record<string, unknown>) => (attributes.attachmentId ? { 'data-attachment-id': attributes.attachmentId } : {}),
      },
      alt: { default: null },
    };
  },
  parseHTML() {
    return [{ tag: 'img[data-attachment-id]' }];
  },
  addInputRules() {
    return [];
  },
}).configure({ inline: false, allowBase64: false });

/** A file of the document: a chip with its name that downloads it. */
export const AttachmentFile = Node.create({
  name: 'attachment',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  draggable: true,
  addAttributes() {
    return {
      attachmentId: {
        default: null,
        parseHTML: (element: HTMLElement) => element.getAttribute('data-attachment-id'),
        renderHTML: (attributes: Record<string, unknown>) => (attributes.attachmentId ? { 'data-attachment-id': attributes.attachmentId } : {}),
      },
      filename: {
        default: null,
        parseHTML: (element: HTMLElement) => element.getAttribute('data-filename'),
        renderHTML: (attributes: Record<string, unknown>) => (attributes.filename ? { 'data-filename': attributes.filename } : {}),
      },
    };
  },
  parseHTML() {
    return [{ tag: 'span[data-type="attachment"]' }];
  },
  renderHTML({ node, HTMLAttributes }) {
    return ['span', mergeAttributes({ 'data-type': 'attachment' }, HTMLAttributes), String(node.attrs.filename ?? 'Datei')];
  },
  renderText({ node }) {
    return String(node.attrs.filename ?? 'Datei');
  },
});

/** The node an upload becomes. */
export function nodeFor(attachment: Pick<Attachment, 'id' | 'filename' | 'mime'>): RichText {
  return isInlineImage(attachment.mime)
    ? { type: 'image', attrs: { attachmentId: attachment.id, alt: attachment.filename } }
    : { type: 'attachment', attrs: { attachmentId: attachment.id, filename: attachment.filename } };
}

/* ------------------------------------------------------------------- upload placeholders */

interface PlaceholderSpec {
  id: string;
  name: string;
  image: boolean;
}

type PlaceholderMeta = { add: PlaceholderSpec & { pos: number } } | { remove: string };

export const uploadKey = new PluginKey<DecorationSet>('uploads');

/** The box that stands where an upload will go: what is uploaded and a bar that fills while it waits. */
function placeholderWidget({ name, image }: PlaceholderSpec): HTMLElement {
  const box = document.createElement('span');
  box.className = 'rt-upload';
  box.setAttribute('data-upload', '');
  box.contentEditable = 'false';
  const label = document.createElement('span');
  label.className = 'rt-upload-label';
  label.textContent = `${image ? 'Bild' : 'Datei'} „${name}“ wird hochgeladen …`;
  const bar = document.createElement('span');
  bar.className = 'rt-upload-bar';
  bar.setAttribute('role', 'progressbar');
  bar.setAttribute('aria-label', `${name} wird hochgeladen`);
  const fill = document.createElement('span');
  fill.className = 'rt-upload-fill';
  bar.append(fill);
  box.append(label, bar);
  return box;
}

/** Keeps the placeholders of running uploads in place while the text around them changes. */
export function uploadPlaceholders(): Plugin<DecorationSet> {
  return new Plugin<DecorationSet>({
    key: uploadKey,
    state: {
      init: () => DecorationSet.empty,
      apply(tr, set) {
        let next = set.map(tr.mapping, tr.doc);
        const meta = tr.getMeta(uploadKey) as PlaceholderMeta | undefined;
        if (meta && 'add' in meta) {
          const { pos, ...spec } = meta.add;
          next = next.add(tr.doc, [Decoration.widget(pos, () => placeholderWidget(spec), { id: spec.id, side: -1 })]);
        } else if (meta && 'remove' in meta) {
          next = next.remove(next.find(undefined, undefined, (spec) => spec.id === meta.remove));
        }
        return next;
      },
    },
    props: {
      decorations: (state) => uploadKey.getState(state),
    },
  });
}

function placeholderPos(state: EditorState, id: string): number | null {
  const found = uploadKey.getState(state)?.find(undefined, undefined, (spec) => spec.id === id) ?? [];
  return found.length > 0 ? found[0].from : null;
}

/* ---------------------------------------------------------------------------- uploads */

/** What the editor's upload path needs from the screen it is on; kept current by the editor component. */
export interface EditorEnv {
  projectId: string;
  upload: (file: File) => Promise<Attachment>;
  /** An upload failed; `retry` tries the same file at the same place again. */
  fail: (file: File, error: unknown, retry: () => void) => void;
  /** For screen readers: an upload started or ended. */
  announce: (text: string) => void;
}

let uploadCounter = 0;

/**
 * Uploads files and puts each at `pos` once it is stored: an image node for the safe formats, a file chip otherwise.
 * The placeholder moves with the text; when the text around it is gone, the node goes where the cursor is.
 */
export function uploadFiles(editor: Editor, files: readonly File[], pos: number, env: EditorEnv): void {
  for (const file of files) {
    const id = `upload-${(uploadCounter += 1)}`;
    const image = isInlineImage(file.type);
    editor.view.dispatch(editor.state.tr.setMeta(uploadKey, { add: { id, pos, name: file.name, image } } satisfies PlaceholderMeta));
    env.announce(`${file.name} wird hochgeladen.`);

    env.upload(file).then(
      (attachment) => {
        if (editor.isDestroyed) return;
        const at = placeholderPos(editor.state, id) ?? editor.state.selection.to;
        editor
          .chain()
          .command(({ tr }) => {
            tr.setMeta(uploadKey, { remove: id } satisfies PlaceholderMeta);
            return true;
          })
          .insertContentAt(at, nodeFor(attachment))
          .run();
        env.announce(`${file.name} ist eingefügt.`);
      },
      (error: unknown) => {
        const at = editor.isDestroyed ? pos : (placeholderPos(editor.state, id) ?? pos);
        if (!editor.isDestroyed) editor.view.dispatch(editor.state.tr.setMeta(uploadKey, { remove: id } satisfies PlaceholderMeta));
        env.fail(file, error, () => {
          if (!editor.isDestroyed) uploadFiles(editor, [file], Math.min(at, editor.state.doc.content.size), env);
        });
      },
    );
  }
}

/** Opens the browser's file choice; `accept` narrows it, e.g. to images. */
export function pickFiles(editor: Editor, accept: string, onPick: (files: File[]) => void): void {
  const input = document.createElement('input');
  input.type = 'file';
  input.name = 'inline-files';
  input.accept = accept;
  input.multiple = true;
  input.tabIndex = -1;
  input.setAttribute('aria-hidden', 'true');
  // rendered but out of sight: a file input that is not rendered at all opens no file choice in every browser
  input.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;pointer-events:none';
  // inside the editor's own box: a modal dialog around it must not count the click as one outside
  (editor.view.dom.parentElement ?? document.body).append(input);
  input.addEventListener('change', () => {
    const files = [...(input.files ?? [])];
    input.remove();
    if (files.length > 0) onPick(files);
  });
  input.addEventListener('cancel', () => input.remove());
  input.click();
}
