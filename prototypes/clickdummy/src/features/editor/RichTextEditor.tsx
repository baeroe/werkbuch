/*
 * The one rich text editor of werkbuch (spec 4.16), Tiptap 3 with our own surface. Its level (`preset`) decides what
 * it knows (presets.ts); all levels have the `/` menu, Markdown shortcuts while typing, `@` mentions, `#` references,
 * code blocks with syntax highlighting (codeBlocks.ts) and images or files by pasting and dropping, with a placeholder
 * and progress until the upload is stored.
 *
 *   <RichTextEditor value={doc} onChange={setDoc} preset="comment" projectId={item.project_id} onSubmit={send} />
 *
 * - `value` is controlled: a document that differs from what the editor shows replaces it (a reload, a reset after
 *   sending: pass a new document, or null). A document the editor reported itself changes nothing, also an older one
 *   (with fast typing the parent may render one the editor has moved past), so the cursor and every key stay.
 * - `onChange` gets the Tiptap JSON after every change; `isEmptyDoc` tells an emptied editor from one with content.
 *   Keep the document as it comes, also an "empty" one (a list without text yet), and turn it into null only when
 *   sending: null coming back as `value` resets the editor to an empty paragraph.
 * - `mod+enter` calls `onSubmit` and never adds a line break; without `onSubmit` the key goes on to the page (a dialog's
 *   own mod+enter). In the editor only mod+k, escape and mod+enter reach the page's shortcuts (the registry's rule).
 * - Escape in an open `@`, `#` or `/` list closes the list and is used up there: nothing around the editor sees it (a
 *   dialog or preview stays open). Without an open list it goes on to the page.
 * - Uploads belong to `UploadOwnerContext` (pasteImages.ts); the editor stores the attachment's id only.
 * - The editor's accessible name is its level's ("Kommentar", "Beschreibung", "Inhalt der Seite") unless
 *   `aria-label` or `aria-labelledby` says otherwise.
 *
 * `RichTextView` shows a document read-only with the same nodes: mentions, references resolved for the reader
 * ("verborgen" for what they may not see), images and files from their attachments.
 */

import FileHandler from '@tiptap/extension-file-handler';
import { TaskItem, TaskList } from '@tiptap/extension-list';
import { Placeholder } from '@tiptap/extensions';
import { EditorContent, Extension, NodeViewWrapper, ReactNodeViewRenderer, useEditor, type AnyExtension, type Editor, type ReactNodeViewProps } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { ImageIcon, ImageOff, Paperclip } from 'lucide-react';
import { Suspense, use, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { cx } from '@/components/ui/cx';
import { useAttachment, useUploadAttachment } from '@/hooks/attachments';
import { notifyError } from '@/lib/errors';
import { isMac } from '@/lib/platform';
import type { RichText } from '@/types';
import './editor.css';
import { mentionExtension, referenceExtension } from './mentions';
import { AttachmentFile, AttachmentImage, UploadOwnerContext, uploadFiles, uploadPlaceholders, type EditorEnv } from './pasteImages';
import { PRESET_LABEL, PRESET_PLACEHOLDER, PRESETS, type EditorPreset } from './presets';
import { slashMenu } from './slashMenu';

export type { EditorPreset } from './presets';

export interface RichTextEditorProps {
  value: RichText | null;
  onChange: (value: RichText) => void;
  preset: EditorPreset;
  /** The project: `@` offers its people and bots, uploads are stored in it. */
  projectId: string;
  placeholder?: string;
  /** mod+enter: send or save. */
  onSubmit?: () => void;
  autoFocus?: boolean;
  /** The accessible name; by default the level's. */
  'aria-label'?: string;
  /** Names the editor by a visible label instead. */
  'aria-labelledby'?: string;
  'aria-describedby'?: string;
}

const EMPTY_DOC: RichText = { type: 'doc', content: [{ type: 'paragraph' }] };

/** Nodes that are content on their own, without any text. */
const CONTENT_ATOMS = new Set(['mention', 'reference', 'image', 'attachment', 'horizontalRule', 'table']);

/** Whether a document holds nothing: no text, no mention, reference, image or file. */
export function isEmptyDoc(doc: RichText | null | undefined): boolean {
  if (!doc) return true;
  const visit = (node: RichText): boolean => {
    if (typeof node.text === 'string' && node.text.trim() !== '') return false;
    if (node.type && CONTENT_ATOMS.has(node.type)) return false;
    return (node.content ?? []).every(visit);
  };
  return visit(doc);
}

/** mod held alone with Enter: ⌘ on a Mac, Strg elsewhere, as the shortcut registry reads it. */
function isModEnter(event: KeyboardEvent): boolean {
  if (event.key !== 'Enter' || event.shiftKey || event.altKey || event.isComposing) return false;
  return isMac() ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
}

/** Whether the editor shows this document already (both read through the schema, so defaults do not count). */
function showsDoc(editor: Editor, doc: RichText): boolean {
  try {
    return JSON.stringify(editor.schema.nodeFromJSON(doc).toJSON()) === JSON.stringify(editor.state.doc.toJSON());
  } catch {
    return false;
  }
}

/* -------------------------------------------------------------------------- node views */

function ImageView({ node }: ReactNodeViewProps) {
  const id = node.attrs.attachmentId as string | null;
  const query = useAttachment(id);
  const attachment = query.data;
  // a disabled query (no id) is pending too, but nothing is on its way
  const loading = query.isPending && id !== null;
  const alt = typeof node.attrs.alt === 'string' ? node.attrs.alt : '';
  return (
    <NodeViewWrapper className="rt-image" data-drag-handle="">
      {attachment ? (
        <img src={attachment.url} alt={alt} draggable={false} />
      ) : loading ? (
        <span className="rt-image-missing" aria-busy="true">
          <ImageIcon className="size-4 shrink-0" aria-hidden="true" />
          {alt ? `${alt}: Bild wird geladen …` : 'Bild wird geladen …'}
        </span>
      ) : (
        <span className="rt-image-missing">
          <ImageOff className="size-4 shrink-0" aria-hidden="true" />
          {alt ? `${alt}: Bild nicht verfügbar` : 'Bild nicht verfügbar'}
        </span>
      )}
    </NodeViewWrapper>
  );
}

function FileView({ node }: ReactNodeViewProps) {
  const attachment = useAttachment(node.attrs.attachmentId as string | null).data;
  const name = String(node.attrs.filename ?? attachment?.filename ?? 'Datei');
  return (
    <NodeViewWrapper as="span" className="rt-file">
      <Paperclip aria-hidden="true" />
      {attachment ? (
        <a href={attachment.url} download={name}>
          {name}
        </a>
      ) : (
        <span>{name}</span>
      )}
    </NodeViewWrapper>
  );
}

/* ------------------------------------------------------------------------- extensions */

/** What comes as a chunk of its own: tables and the highlighting of code (most texts have neither). */
interface LateExtensions {
  tables: AnyExtension;
  code: AnyExtension;
}

let late: LateExtensions | null = null;
let loadingLate: Promise<LateExtensions> | null = null;

/**
 * Tables and code highlighting come as chunks of their own. They are asked for as soon as the editor's code is there;
 * an editor that renders before they arrived waits (Suspense) once. Tests call this first, so no editor waits.
 */
export function preloadEditor(): Promise<LateExtensions> {
  loadingLate ??= Promise.all([import('@tiptap/extension-table'), import('./codeBlocks')]).then(
    ([{ TableKit }, { highlightedCodeBlock }]) => (late = { tables: TableKit.configure({ table: { resizable: false } }), code: highlightedCodeBlock }),
  );
  return loadingLate;
}
void preloadEditor();

const useLateExtensions = (): LateExtensions => late ?? use(preloadEditor());

/**
 * The extensions of a level. `placeholder: null` builds a viewer: the same nodes, without the menus, the upload path
 * and the placeholder.
 */
function buildExtensions(preset: EditorPreset, env: RefObject<EditorEnv | null>, placeholder: string | null, { tables: tableKit, code }: LateExtensions): AnyExtension[] {
  const features = PRESETS[preset];
  const editing: AnyExtension[] =
    placeholder === null
      ? []
      : [
          slashMenu(preset, env),
          Placeholder.configure({ placeholder }),
          FileHandler.configure({
            onPaste: (editor, files) => {
              if (env.current) uploadFiles(editor, files, editor.state.selection.from, env.current);
            },
            onDrop: (editor, files, pos) => {
              if (env.current) uploadFiles(editor, files, pos, env.current);
            },
          }),
          Extension.create({ name: 'uploadPlaceholders', addProseMirrorPlugins: () => [uploadPlaceholders()] }),
        ];
  return [
    StarterKit.configure({
      heading: features.headings ? { levels: [1, 2, 3] } : false,
      horizontalRule: features.horizontalRule ? {} : false,
      // every level has code blocks, highlighted (below)
      codeBlock: false,
      link: { openOnClick: false, autolink: true, linkOnPaste: true, defaultProtocol: 'https', HTMLAttributes: { rel: 'noopener noreferrer nofollow', target: '_blank' } },
      dropcursor: { color: 'var(--accent)', width: 2 },
    }),
    ...(features.taskList
      ? [TaskList, TaskItem.configure({ nested: true, a11y: { checkboxLabel: (node, checked) => `${node.textContent || 'Leerer Punkt'}: ${checked ? 'erledigt' : 'offen'}` } })]
      : []),
    ...(features.table ? [tableKit] : []),
    code,
    AttachmentImage.extend({ addNodeView: () => ReactNodeViewRenderer(ImageView) }),
    AttachmentFile.extend({ addNodeView: () => ReactNodeViewRenderer(FileView, { as: 'span' }) }),
    mentionExtension(env),
    referenceExtension(env),
    ...editing,
  ];
}

/* ---------------------------------------------------------------------------- editor */

/** The editor's frame while its code arrives, so nothing jumps when it is there. */
function EditorFrame({ preset }: { preset: EditorPreset }) {
  return (
    <div className={cx('rt rt-editor', preset !== 'page' && 'rt-frame')} data-preset={preset} aria-busy="true">
      <div className="ProseMirror" />
    </div>
  );
}

export function RichTextEditor(props: RichTextEditorProps) {
  return (
    <Suspense fallback={<EditorFrame preset={props.preset} />}>
      <EditorBody {...props} />
    </Suspense>
  );
}

function EditorBody({
  value,
  onChange,
  preset,
  projectId,
  placeholder,
  onSubmit,
  autoFocus = false,
  'aria-label': ariaLabel,
  'aria-labelledby': labelledBy,
  'aria-describedby': describedBy,
}: RichTextEditorProps) {
  const owner = useContext(UploadOwnerContext);
  const upload = useUploadAttachment();
  const [announcement, setAnnouncement] = useState('');
  const env = useRef<EditorEnv | null>(null);
  const latest = useRef({ onChange, onSubmit, label: ariaLabel ?? PRESET_LABEL[preset], labelledBy, describedBy });
  useLayoutEffect(() => {
    latest.current = { onChange, onSubmit, label: ariaLabel ?? PRESET_LABEL[preset], labelledBy, describedBy };
    env.current = {
      projectId,
      upload: (file) => upload.mutateAsync({ project_id: projectId, file, owner, kind: 'inline' }),
      fail: (file, error, retry) => {
        setAnnouncement('');
        notifyError(`„${file.name}“ nicht hochgeladen`, error, retry);
      },
      announce: setAnnouncement,
    };
  });

  const framed = preset !== 'page';
  const lateExtensions = useLateExtensions();
  const extensions = useMemo(() => buildExtensions(preset, env, placeholder ?? PRESET_PLACEHOLDER[preset], lateExtensions), [preset, placeholder, lateExtensions]);
  /**
   * The documents the editor reported. One of them coming back as `value` changes nothing, also an older one: with
   * fast typing the parent may render a document the editor has already moved past, and taking it would drop keys.
   */
  const emitted = useRef(new WeakSet<RichText>());

  const editor = useEditor(
    {
      extensions,
      content: value ?? EMPTY_DOC,
      autofocus: autoFocus ? 'end' : false,
      immediatelyRender: true,
      shouldRerenderOnTransaction: false,
      editorProps: {
        attributes: () => {
          const { label, labelledBy: by, describedBy: described } = latest.current;
          return {
            'aria-multiline': 'true',
            ...(by ? { 'aria-labelledby': by } : { 'aria-label': label }),
            ...(described ? { 'aria-describedby': described } : {}),
            // the field around it shows the focus
            ...(framed ? { 'data-focus-ring': 'none' } : {}),
            class: 'rt-content',
          };
        },
        handleDOMEvents: {
          keydown: (view, event) => {
            // ProseMirror would use up every Escape (preventDefault). Without an open list it goes on to the page:
            // a preview first moves the focus out of the field, a field around the editor may cancel its edit.
            if (event.key === 'Escape') {
              if (view.dom.querySelector('.suggestion') === null) return true;
              // An open @, # or / list takes it and closes (ProseMirror's own handler, below). Nothing behind the
              // editor may see it: Base UI dialogs and popups close on any Escape, preventDefault or not.
              event.stopPropagation();
              return false;
            }
            if (!isModEnter(event)) return false;
            const submit = latest.current.onSubmit;
            if (submit) {
              event.preventDefault();
              submit();
            }
            // handled either way: no line break; without onSubmit the page's own mod+enter takes the key
            return true;
          },
        },
      },
      onUpdate: ({ editor: current }) => {
        const doc = current.getJSON();
        emitted.current.add(doc);
        latest.current.onChange(doc);
      },
    },
    [extensions],
  );

  // a new name or description (e.g. an error under the editor) reaches the element at once, not only with the next change
  useEffect(() => {
    if (editor && !editor.isDestroyed) editor.view.updateState(editor.view.state);
  }, [editor, ariaLabel, labelledBy, describedBy]);

  // a document from outside (reload, reset) replaces what the editor shows; its own output changes nothing
  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    if (value !== null && emitted.current.has(value)) return;
    const doc = value ?? EMPTY_DOC;
    if (!showsDoc(editor, doc)) editor.commands.setContent(doc, { emitUpdate: false });
  }, [editor, value]);

  return (
    <div className={cx('rt rt-editor', framed && 'rt-frame')} data-preset={preset}>
      <EditorContent editor={editor} />
      <span className="sr-only" aria-live="polite">
        {announcement}
      </span>
    </div>
  );
}

/* ---------------------------------------------------------------------------- viewer */

type RichTextViewProps = { value: RichText | null; className?: string };

/** A document read-only, with the nodes of every level. */
export function RichTextView(props: RichTextViewProps) {
  return (
    <Suspense fallback={<div className={cx('rt', props.className)} aria-busy="true" />}>
      <Viewer {...props} />
    </Suspense>
  );
}

function Viewer({ value, className }: RichTextViewProps) {
  const env = useRef<EditorEnv | null>(null);
  const lateExtensions = useLateExtensions();
  const extensions = useMemo(() => buildExtensions('page', env, null, lateExtensions), [lateExtensions]);
  const editor = useEditor(
    {
      extensions,
      content: value ?? EMPTY_DOC,
      editable: false,
      immediatelyRender: true,
      shouldRerenderOnTransaction: false,
      // text to read, no text box
      editorProps: { attributes: { role: 'presentation', class: 'rt-content' } },
    },
    [extensions],
  );

  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    const doc = value ?? EMPTY_DOC;
    if (!showsDoc(editor, doc)) editor.commands.setContent(doc, { emitUpdate: false });
  }, [editor, value]);

  return (
    <div className={cx('rt', className)}>
      <EditorContent editor={editor} />
    </div>
  );
}
