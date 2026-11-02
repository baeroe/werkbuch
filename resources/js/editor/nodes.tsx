/*
 * Images and files of rich text (spec 4.16). The document keeps only the attachment's id, never a path or the file:
 * - `image`: a block with `attachmentId` and `alt`. It shows the attachment (`useAttachment`): its preview once the
 *   queue made one, else the file itself, as `<img loading="lazy">`. While it loads, and when it cannot be loaded (gone,
 *   not visible, the picture breaks), a box with the alternative text says so. In an editor a double click, or Enter
 *   on the selected image, edits the alternative text (Enter saves, Escape cancels, leaving the field keeps it; empty is
 *   none); while reading, a click opens the original in a new tab.
 * - `attachment`: a file in the text with `attachmentId` and `filename`: a chip with its name and size, a link that
 *   downloads it (`?download=1`).
 *
 * External images (`<img src>` from pasted HTML) are not taken over: only an `<img data-attachment-id>` becomes an
 * image (A236). Uploading is uploads.ts.
 */

import Image from '@tiptap/extension-image';
import { NodeSelection } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';
import { Extension, mergeAttributes, Node, NodeViewWrapper, ReactNodeViewRenderer, type ReactNodeViewProps } from '@tiptap/react';
import { ImageIcon, ImageOff, Paperclip } from 'lucide-react';
import { useEffect, useId, useState } from 'react';
import { attachmentUrl } from '@/api/attachments';
import { formatSize } from '@/components/fields/format';
import { useAttachment } from '@/hooks/attachments';
import { t } from '@/lib/i18n';

const attachmentId = {
  default: null,
  parseHTML: (element: HTMLElement) => element.getAttribute('data-attachment-id'),
  renderHTML: (attributes: Record<string, unknown>) => (attributes.attachmentId ? { 'data-attachment-id': attributes.attachmentId } : {}),
};

/* ----------------------------------------------------------------------------- image */

/** Asks the view of the image at a position to edit its alternative text (Enter on the selected image). */
const altRequests = new EventTarget();
type AltRequest = { view: EditorView; pos: number };

function ImageView({ node, editor, getPos, updateAttributes }: ReactNodeViewProps) {
  const id = node.attrs.attachmentId as string | null;
  const query = useAttachment(id);
  const attachment = query.data;
  const alt = typeof node.attrs.alt === 'string' ? node.attrs.alt : '';
  const [editing, setEditing] = useState(false);
  // the source that failed to load: a preview that comes later is tried again
  const [broken, setBroken] = useState<string | null>(null);

  useEffect(() => {
    const listen = (event: Event) => {
      const { view, pos } = (event as CustomEvent<AltRequest>).detail;
      if (view === editor.view && pos === getPos()) setEditing(true);
    };
    altRequests.addEventListener('edit', listen);
    return () => altRequests.removeEventListener('edit', listen);
  }, [editor, getPos]);

  const finish = (next: string | undefined, refocus: boolean) => {
    setEditing(false);
    if (next !== undefined) updateAttributes({ alt: next.trim() === '' ? null : next.trim() });
    if (!refocus) return;
    // back to the image, selected, so Enter edits it again and the arrows go on from there. At once: Tiptap's focus
    // command waits a frame, and would take the focus from a field opened meanwhile
    editor.commands.setNodeSelection(getPos()!);
    editor.view.focus();
  };

  const src = attachment ? (attachment.preview_url ?? attachment.url) : null;
  let content;
  if (attachment && src !== broken) {
    const picture = <img src={src!} alt={alt} loading="lazy" draggable={false} onError={() => setBroken(src)} />;
    content = editor.isEditable ? (
      picture
    ) : (
      <a href={attachment.url} target="_blank" rel="noopener noreferrer" title={t('editor.image.open')}>
        {picture}
      </a>
    );
  } else {
    const loading = query.isPending && id !== null;
    content = (
      <span className="rt-image-missing" aria-busy={loading || undefined}>
        {loading ? <ImageIcon aria-hidden="true" /> : <ImageOff aria-hidden="true" />}
        {[alt, t(loading ? 'editor.image.loading' : 'editor.image.unavailable')].filter(Boolean).join(': ')}
      </span>
    );
  }

  return (
    <NodeViewWrapper className="rt-image" data-drag-handle="" title={editor.isEditable ? t('editor.image.edit_alt') : undefined} onDoubleClick={() => editor.isEditable && setEditing(true)}>
      {content}
      {editing && <AltField initial={alt} onDone={finish} />}
    </NodeViewWrapper>
  );
}

/** The alternative text of an image being edited. */
function AltField({ initial, onDone }: { initial: string; onDone: (next: string | undefined, refocus: boolean) => void }) {
  const [value, setValue] = useState(initial);
  const hint = useId();
  return (
    <span className="rt-image-alt">
      <label>
        <span>{t('editor.image.alt')}</span>
        <input
          // opened on purpose, by Enter or a double click
          autoFocus
          value={value}
          aria-describedby={hint}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== 'Enter' && event.key !== 'Escape') return;
            event.preventDefault();
            // nothing around the editor (a dialog) may see it
            event.stopPropagation();
            onDone(event.key === 'Enter' ? value : undefined, true);
          }}
          onBlur={() => onDone(value, false)}
        />
      </label>
      <span id={hint} className="rt-image-alt-hint">
        {t('editor.image.alt_hint')}
      </span>
    </span>
  );
}

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
  addNodeView: () => ReactNodeViewRenderer(ImageView),
}).configure({ inline: false, allowBase64: false });

/**
 * Enter on a selected image edits its alternative text. An extension of its own, before the keymaps that would split
 * the line: given to the image node, a higher priority would move images before paragraphs in the schema.
 */
export const ImageAltKey = Extension.create({
  name: 'imageAltKey',
  priority: 150,
  addKeyboardShortcuts() {
    return {
      Enter: ({ editor }) => {
        const { selection } = editor.state;
        if (!(selection instanceof NodeSelection) || selection.node.type.name !== 'image') return false;
        altRequests.dispatchEvent(new CustomEvent<AltRequest>('edit', { detail: { view: editor.view, pos: selection.from } }));
        return true;
      },
    };
  },
});

/* ------------------------------------------------------------------------------ file */

function FileView({ node }: ReactNodeViewProps) {
  const attachment = useAttachment(node.attrs.attachmentId as string | null).data;
  const name = String(node.attrs.filename ?? attachment?.filename ?? t('editor.file.unknown'));
  return (
    <NodeViewWrapper as="span" className="rt-file">
      <Paperclip aria-hidden="true" />
      {attachment ? (
        <>
          <a href={attachmentUrl(attachment, { download: true })} download={name}>
            {name}
          </a>
          <span className="rt-file-size">{formatSize(attachment.size)}</span>
        </>
      ) : (
        <span>{name}</span>
      )}
    </NodeViewWrapper>
  );
}

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
  addNodeView: () => ReactNodeViewRenderer(FileView, { as: 'span' }),
});
