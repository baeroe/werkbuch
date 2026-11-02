/*
 * Images and files of rich text (spec 4.16) as the schema knows them: the editor holds every node the server stores
 * (`App\RichText\Schema`), so a text with an image or a file keeps it while someone edits it. The document keeps only
 * the attachment's id, never a path or the file:
 * - `image`: a block with `attachmentId` and `alt`
 * - `attachment`: a file in the text with `attachmentId` and `filename`
 *
 * External images (`<img src>` from pasted HTML) are not taken over: only an `<img data-attachment-id>` becomes an
 * image. Showing them (the picture, the chip to download) and uploading come with Task 17.
 */

import Image from '@tiptap/extension-image';
import { mergeAttributes, Node } from '@tiptap/react';

const attachmentId = {
  default: null,
  parseHTML: (element: HTMLElement) => element.getAttribute('data-attachment-id'),
  renderHTML: (attributes: Record<string, unknown>) => (attributes.attachmentId ? { 'data-attachment-id': attributes.attachmentId } : {}),
};

/** An image of the document: the attachment id and an alternative text, nothing else (no `src`). */
export const AttachmentImage = Image.extend({
  addAttributes() {
    return { attachmentId, alt: { default: null } };
  },
  parseHTML() {
    return [{ tag: 'img[data-attachment-id]' }];
  },
  // `![alt](url)` while typing would make an image of a web address
  addInputRules() {
    return [];
  },
}).configure({ inline: false, allowBase64: false });

/** A file of the document: its name, a chip to download it. */
export const AttachmentFile = Node.create({
  name: 'attachment',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  addAttributes() {
    return {
      attachmentId,
      filename: {
        default: null,
        parseHTML: (element: HTMLElement) => element.textContent,
        renderHTML: () => ({}),
      },
    };
  },
  parseHTML() {
    return [{ tag: 'span[data-type="attachment"]' }];
  },
  renderHTML({ node, HTMLAttributes }) {
    return ['span', mergeAttributes({ 'data-type': 'attachment' }, HTMLAttributes), String(node.attrs.filename ?? '')];
  },
  renderText({ node }) {
    return String(node.attrs.filename ?? '');
  },
});
