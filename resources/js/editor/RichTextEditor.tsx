/*
 * The one rich text editor of werkbuch (spec 4.16), Tiptap 3 with our own surface. Its level (`preset`) decides what
 * it knows (presets.ts); all levels have the Markdown shortcuts while typing (`## `, `- `, `1. `, `> `, ``` and, from
 * `description` on, `[ ] `), the `/` menu (slashMenu.tsx) and code blocks with highlighting (codeBlocks.ts). With a
 * project (`projectId`) `@` mentions its people and bots (mentions.tsx), `#` refers to items (references.tsx), and
 * pictures and files are pasted, dropped or chosen in the `/` menu and uploaded into the project (uploads.ts, shown by
 * the nodes of nodes.tsx); without one there is no list and no upload. A form counts the running uploads of its editors
 * (UploadContext.tsx) and hears of failed uploads (`EditorEnvContext`, EditorEnv.tsx).
 *
 *   <RichTextEditor value={doc} onChange={setDoc} preset="description" projectId={item.project_id} onSubmit={save} />
 *
 * - The schema is the server's (`App\RichText\Schema`): StarterKit without underline (the server has no such mark and
 *   would refuse the whole text), headings 1–3, links only to http, https and mailto, checklists and tables from
 *   `description` on, horizontal rules only on `page`. A document with blocks the level does not know (a table in a
 *   comment) shows their text in paragraphs.
 * - `value` is controlled: a document that differs from what the editor shows replaces it (a reload, a reset after
 *   sending: pass a new document, or null). A document the editor reported itself changes nothing, also an older one
 *   (with fast typing the parent may render one the editor has moved past), so the cursor and every key stay; the same
 *   holds for a null the editor reported (emptied) and the parent renders late. A null the parent passes later, after
 *   it took the editor's newer text, empties the editor.
 * - `onChange` gets the Tiptap JSON after every change, and null when the editor holds nothing at all (one empty
 *   paragraph, what null shows). `isEmptyDoc` tells a document without content (a list without text yet) apart; keep
 *   such a document as it comes and turn it into null only when sending.
 * - `mod+enter` calls `onSubmit` and never adds a line break; without `onSubmit` the key goes on to the page (a dialog's
 *   own mod+enter). Escape in an open `/`, `@` or `#` list closes the list and nothing else. Otherwise it calls
 *   `onEscape` and is used up there (nothing around the editor sees it, a dialog stays open); without `onEscape` it
 *   goes on to the page (a preview moves the focus out of the field).
 * - The editor's accessible name is its level's ("Kommentar", "Beschreibung", "Inhalt der Seite") unless `label` says
 *   otherwise; `invalid` and `describedBy` mark a field error. `editorRef` hands out the Tiptap editor.
 *
 * Tables and code highlighting come as chunks of their own (`preloadEditor`); an editor that renders before they
 * arrived waits once (a comment never waits for the tables, it has none). A chunk that failed to load is asked for
 * again the next time an editor renders: the editor says it did not load and offers to try again; any other error of
 * the editor goes on to the page's error boundary. Tests call `await preloadEditor()` first. `RichTextView` (RichTextView.tsx) shows a document read-only with the same nodes.
 */

import { QueryClientContext } from '@tanstack/react-query';
import { TaskItem, TaskList } from '@tiptap/extension-list';
import { Placeholder } from '@tiptap/extensions';
import type { Schema } from '@tiptap/pm/model';
import { Plugin } from '@tiptap/pm/state';
import { EditorContent, Extension, getSchema, useEditor, type AnyExtension, type Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { Component, Suspense, use, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, type ReactNode, type RefObject } from 'react';
import { Button } from '@/components/ui/Button';
import { cx } from '@/components/ui/cx';
import { qk } from '@/hooks/keys';
import { t } from '@/lib/i18n';
import { isMac } from '@/lib/platform';
import type { RichText } from '@/types';
import './editor.css';
import { EditorEnvContext, type EditorEnv, type EditorEnvRef } from './EditorEnv';
import { mentionExtension } from './mentions';
import { AttachmentFile, AttachmentImage, ImageAltKey } from './nodes';
import { PRESET_LABEL, PRESET_PLACEHOLDER, PRESET_PLACEHOLDER_PLAIN, PRESETS, type EditorPreset } from './presets';
import { referenceExtension } from './references';
import { slashMenu } from './slashMenu';
import { UploadContext } from './UploadContext';
import { pickFiles, uploadExtensions, uploadFiles, UploadSession } from './uploads';

export type { EditorPreset } from './presets';

export interface RichTextEditorProps {
  value: RichText | null;
  /** The document after every change; null when the editor holds nothing at all. */
  onChange: (doc: RichText | null) => void;
  preset: EditorPreset;
  /** The project of the text: `@` offers its people, `#` its items, uploads go into it. Without it there is none of them. */
  projectId?: string;
  /** The accessible name; by default the level's. */
  label?: string;
  placeholder?: string;
  autoFocus?: boolean;
  readOnly?: boolean;
  /** mod+enter: send or save. */
  onSubmit?: () => void;
  /** Escape: leave or cancel; the key goes no further. */
  onEscape?: () => void;
  invalid?: boolean;
  describedBy?: string;
  editorRef?: RefObject<Editor | null>;
}

/** What null shows: one empty paragraph. */
export const EMPTY_DOC: RichText = { type: 'doc', content: [{ type: 'paragraph' }] };

/** Nodes that are content on their own, without any text (`App\RichText\Document::isEmpty`). */
const CONTENT_ATOMS = new Set(['horizontalRule', 'table', 'image', 'mention', 'reference', 'attachment']);

/** Whether a document holds nothing: no text, no rule, no table, no image, mention, reference or file. */
export function isEmptyDoc(doc: RichText | null | undefined): boolean {
  if (!doc) return true;
  const visit = (node: RichText): boolean => {
    if (typeof node.text === 'string' && node.text.trim() !== '') return false;
    if (node.type && CONTENT_ATOMS.has(node.type)) return false;
    return (node.content ?? []).every(visit);
  };
  return visit(doc);
}

/** The protocols a link may have (`App\RichText\Schema::LINK_PROTOCOLS`); the server drops the mark of any other. */
const LINK_HREF = /^(?:https?|mailto):/i;

/** mod held alone with Enter: ⌘ on a Mac, Strg elsewhere, as the shortcut registry reads it. */
function isModEnter(event: KeyboardEvent): boolean {
  if (event.key !== 'Enter' || event.shiftKey || event.altKey || event.isComposing) return false;
  return isMac() ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
}

/* --------------------------------------------------------------------------- schema */

const INLINE = new Set(['text', 'hardBreak', 'mention', 'reference', 'attachment']);
const isInline = (node: RichText) => INLINE.has(node.type ?? '');

/** A node in a schema: one the level does not know gives way to its content, inline content in a paragraph. */
function fitNode(node: RichText, schema: Schema): RichText[] {
  const content = node.content?.flatMap((child) => fitNode(child, schema));
  if (node.type !== undefined && schema.nodes[node.type] !== undefined) return [content ? { ...node, content } : node];
  if (!content?.length) return [];
  return content.every(isInline) ? [{ type: 'paragraph', content }] : content;
}

/** A document as a level shows it (null: one empty paragraph). */
export function fitDoc(value: RichText | null, schema: Schema): RichText {
  const content = value?.content?.flatMap((child) => fitNode(child, schema)) ?? [];
  return content.length > 0 ? { ...value, content } : EMPTY_DOC;
}

/** Whether the editor shows this document already (both read through the schema, so defaults do not count). */
export function showsDoc(editor: Editor, doc: RichText): boolean {
  return JSON.stringify(editor.schema.nodeFromJSON(doc).toJSON()) === JSON.stringify(editor.state.doc.toJSON());
}

/** Whether a document is what null shows: one paragraph without anything in it. */
const holdsNothing = (doc: RichText) => doc.content?.length === 1 && doc.content[0].type === 'paragraph' && !doc.content[0].content?.length;

/* ----------------------------------------------------------------------- extensions */

/** A chunk of the editor that did not load: the one error LateBoundary takes on (F23). */
export class LateChunkError extends Error {
  constructor(cause: unknown) {
    super('A chunk of the editor did not load.', { cause });
    this.name = 'LateChunkError';
  }
}

/**
 * A chunk asked for once and kept. One that failed is not kept: the next call asks for it again (an editor rendered
 * after "Erneut versuchen"), instead of every editor failing with the same rejected promise until the page reloads.
 */
function lateChunk<T>(load: () => Promise<T>): () => Promise<T> {
  let loading: Promise<T> | null = null;
  return () => {
    if (!loading) {
      const current: Promise<T> = load().then(
        (value) => {
          // React's use() reads a promise marked as fulfilled at once: an editor rendered after the load never waits
          Object.assign(current, { status: 'fulfilled', value });
          return value;
        },
        (reason: unknown) => {
          loading = null;
          throw new LateChunkError(reason);
        },
      );
      loading = current;
    }
    return loading;
  };
}

/** The table support: most texts have no table, and a comment never has one. */
const loadTables = lateChunk(() => import('@tiptap/extension-table').then(({ TableKit }): AnyExtension => TableKit.configure({ table: { resizable: false } })));

/** Code blocks with highlighting (every level has code blocks). */
const loadCode = lateChunk(() => import('./codeBlocks').then(({ highlightedCodeBlock }): AnyExtension => highlightedCodeBlock));

/** What a level without tables reads instead of the table chunk: nothing, at once. */
const NO_TABLES: Promise<AnyExtension | null> = Object.assign(Promise.resolve(null), { status: 'fulfilled', value: null });

/** Loads what the editor loads late (tables, code highlighting); an editor rendered afterwards never waits. */
export async function preloadEditor(): Promise<void> {
  await Promise.all([loadTables(), loadCode()]);
}
// a failure here is no error yet: the first editor asks again and says so
preloadEditor().catch(() => {});

/**
 * The checkboxes of checklists in a text nobody may change (the view, `readOnly`): disabled, so they are no tab stop and
 * neither a click nor Space toggles them. Tiptap's own node view leaves them working and only flips them back. Plugin
 * views hear every new state and every new editable flag, also those that come without a transaction.
 */
const stillChecklists = Extension.create({
  name: 'stillChecklists',
  addProseMirrorPlugins: () => [
    new Plugin({
      view: (view) => {
        const sync = () => view.dom.querySelectorAll<HTMLInputElement>('input[type="checkbox"]').forEach((box) => (box.disabled = !view.editable));
        sync();
        return { update: sync };
      },
    }),
  ],
});

/**
 * The extensions of a level. `placeholder: null` builds a viewer: the same nodes, without the `/` menu, the uploads
 * and the placeholder. The placeholder is read when the editor draws, so a new one needs no new editor.
 */
function buildExtensions(preset: EditorPreset, env: EditorEnvRef, placeholder: (() => string) | null, code: AnyExtension, tables: AnyExtension | null): AnyExtension[] {
  const features = PRESETS[preset];
  return [
    StarterKit.configure({
      heading: features.headings ? { levels: [1, 2, 3] } : false,
      horizontalRule: features.horizontalRule ? {} : false,
      // every level has code blocks, highlighted (codeBlocks.ts)
      codeBlock: false,
      // the server knows no underline (Markdown has none); mod+u and a pasted <u> stay plain text
      underline: false,
      link: { openOnClick: false, autolink: true, linkOnPaste: true, defaultProtocol: 'https', isAllowedUri: (url) => LINK_HREF.test(url) },
      dropcursor: { color: 'var(--accent)', width: 2 },
    }),
    code,
    ...(features.taskList
      ? [
          TaskList,
          TaskItem.configure({
            nested: true,
            a11y: { checkboxLabel: (node, checked) => t(checked ? 'editor.task.checked' : 'editor.task.unchecked', { text: node.textContent || t('editor.task.empty') }) },
          }),
          stillChecklists,
        ]
      : []),
    ...(tables ? [tables] : []),
    AttachmentImage,
    AttachmentFile,
    mentionExtension(env),
    referenceExtension(env),
    ...(placeholder === null ? [] : [slashMenu(preset, env), ImageAltKey, ...uploadExtensions(env), Placeholder.configure({ placeholder })]),
  ];
}

/**
 * The extensions and the schema of a level. `use()` twice on every render, also once the chunks are there: React must
 * see the same calls before and after the wait (rules of hooks). A level without tables reads an answer that is
 * already there instead of the table chunk, so it never waits for it.
 */
export function useLevel(preset: EditorPreset, env: EditorEnvRef, placeholder: (() => string) | null): { extensions: AnyExtension[]; schema: Schema } {
  const code = use(loadCode());
  const tables = use(PRESETS[preset].table ? loadTables() : NO_TABLES);
  return useMemo(() => {
    const extensions = buildExtensions(preset, env, placeholder, code, tables);
    return { extensions, schema: getSchema(extensions) };
  }, [preset, env, placeholder, code, tables]);
}

/**
 * Stands in for an editor or a view whose chunks failed to load: says so, reports it and tries again on request. Trying
 * again renders the editor anew, which asks for the chunk again (`lateChunk`). Any other error (a node view that
 * breaks) is none of its business: it goes on to the error boundary of the page (F23).
 */
export class LateBoundary extends Component<{ frame: (failed: ReactNode) => ReactNode; children: ReactNode }, { error: unknown }> {
  state: { error: unknown } = { error: null };

  static getDerivedStateFromError(error: unknown) {
    return { error };
  }

  componentDidCatch(error: unknown) {
    if (error instanceof LateChunkError) console.error(error);
  }

  render() {
    const { error } = this.state;
    if (error === null) return this.props.children;
    // thrown again from here, it reaches the next boundary up
    if (!(error instanceof LateChunkError)) throw error;
    return this.props.frame(
      <div role="alert" className="flex flex-wrap items-center gap-2 px-3 py-2 text-ui text-muted">
        {t('editor.failed')}
        <Button variant="secondary" size="sm" onClick={() => this.setState({ error: null })}>
          {t('common.retry')}
        </Button>
      </div>,
    );
  }
}

/* --------------------------------------------------------------------------- editor */

export function RichTextEditor(props: RichTextEditorProps) {
  // the editor's frame while its chunks arrive, so nothing jumps when it is there
  const frame = (inside: ReactNode) => (
    <div className={cx('rt rt-editor', props.preset !== 'page' && 'rt-frame')} data-preset={props.preset} aria-busy={inside === null ? 'true' : undefined}>
      {inside ?? <div className="ProseMirror" />}
    </div>
  );
  return (
    <LateBoundary frame={frame}>
      <Suspense fallback={frame(null)}>
        <EditorBody {...props} />
      </Suspense>
    </LateBoundary>
  );
}

/**
 * What an editor reported, in order, so a value coming back can be told apart from one from outside. A document is
 * known by itself; a null (the editor was emptied) only by its place: it is the editor's own as long as the parent has
 * not passed anything the editor reported after it.
 */
class Reports {
  private count = 0;
  private nullAt = 0;
  private passed = 0;
  private readonly docs = new WeakMap<RichText, number>();

  add(doc: RichText | null): void {
    this.count += 1;
    if (doc === null) this.nullAt = this.count;
    else this.docs.set(doc, this.count);
  }

  /** Whether the parent passes something the editor reported itself; what it passes counts as seen. */
  isOwn(value: RichText | null): boolean {
    const at = value === null ? (this.nullAt > this.passed ? this.nullAt : undefined) : this.docs.get(value);
    // from outside: whatever the editor reported before is behind it
    this.passed = Math.max(this.passed, at ?? this.count);
    return at !== undefined;
  }
}

function EditorBody({ value, onChange, preset, projectId, label, placeholder, autoFocus = false, readOnly = false, onSubmit, onEscape, invalid = false, describedBy, editorRef }: RichTextEditorProps) {
  const name = label ?? t(PRESET_LABEL[preset]);
  const hint = placeholder ?? t((projectId ? PRESET_PLACEHOLDER : PRESET_PLACEHOLDER_PLAIN)[preset]);
  const latest = useRef({ onChange, onSubmit, onEscape, name, hint, describedBy, invalid, readOnly });
  const { onUploadError } = useContext(EditorEnvContext);
  const counter = useContext(UploadContext);
  const client = useContext(QueryClientContext);
  // made on mount, closed when the editor goes away (below); a StrictMode remount gets a new one
  const session = useRef<UploadSession | undefined>(undefined);
  const envNow = (): EditorEnv => ({
    projectId: projectId ?? null,
    onUploadError,
    chooseFiles: projectId ? (current) => pickFiles(current, (files) => uploadFiles(current, files, current.state.selection.from, env.current)) : undefined,
    uploads: session.current,
  });
  const env = useRef<EditorEnv>(envNow());
  /** The session reports to the form's counter and the cache of now. */
  const wire = (current: UploadSession) => {
    current.track = (delta) => counter?.add(delta);
    current.prime = (attachment) => client?.setQueryData(qk.attachments.detail(attachment.id), attachment);
  };
  useLayoutEffect(() => {
    latest.current = { onChange, onSubmit, onEscape, name, hint, describedBy, invalid, readOnly };
    env.current = envNow();
    if (session.current) wire(session.current);
  });

  const framed = preset !== 'page';
  const placeholderOf = useCallback(() => latest.current.hint, []);
  const { extensions, schema } = useLevel(preset, env, placeholderOf);
  /**
   * What the editor reported. One of them coming back as `value` changes nothing, also an older one: with fast typing
   * the parent may render a document (or a null) the editor has already moved past, and taking it would drop keys.
   */
  const reports = useRef(new Reports()).current;
  // read only when the editor is built: the document is fitted once per value, not on every render
  const content = useMemo(() => fitDoc(value, schema), [value, schema]);

  const editor = useEditor(
    {
      extensions,
      content,
      editable: !readOnly,
      autofocus: autoFocus ? 'end' : false,
      immediatelyRender: true,
      shouldRerenderOnTransaction: false,
      editorProps: {
        attributes: () => {
          const current = latest.current;
          return {
            'aria-label': current.name,
            'aria-multiline': 'true',
            ...(current.describedBy ? { 'aria-describedby': current.describedBy } : {}),
            ...(current.invalid ? { 'aria-invalid': 'true' } : {}),
            ...(current.readOnly ? { 'aria-readonly': 'true' } : {}),
            // the field around it shows the focus
            ...(framed ? { 'data-focus-ring': 'none' } : {}),
            class: 'rt-content',
          };
        },
        handleDOMEvents: {
          keydown: (view, event) => {
            // ProseMirror would use up every Escape (it reads the legacy keyCode 27); one that ends an IME composition
            // belongs to the composition, never to a dialog
            if (event.key === 'Escape' && !event.isComposing) {
              // an open /, @ or # list takes it and closes (the suggestion plugin, after this handler), nothing else.
              // Base UI dialogs and popups close on any Escape, preventDefault or not: nothing behind the editor may
              // see it. Not prevented: ProseMirror would read a prevented key as handled and never ask the plugin.
              if (view.dom.querySelector('.suggestion') !== null) {
                event.stopPropagation();
                return false;
              }
              const escape = latest.current.onEscape;
              if (escape) {
                event.preventDefault();
                event.stopPropagation();
                escape();
              }
              return true;
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
        const reportedDoc = holdsNothing(doc) ? null : doc;
        reports.add(reportedDoc);
        latest.current.onChange(reportedDoc);
      },
    },
    [extensions],
  );

  // the uploads of this editor: running ones stop when it goes away
  useEffect(() => {
    const current = new UploadSession();
    wire(current);
    session.current = current;
    env.current.uploads = current;
    return () => current.close();
    // once per mount: the counter and the cache are wired anew on every render (above)
  }, []);

  useEffect(() => {
    if (!editorRef) return;
    editorRef.current = editor;
    return () => {
      editorRef.current = null;
    };
  }, [editor, editorRef]);

  // a new name, placeholder, error or read-only state reaches the element at once, not only with the next change
  useEffect(() => {
    // an editor behind a Suspense boundary that hid and showed again was replaced; the next render brings the new one
    if (editor.isDestroyed) return;
    const changed = editor.isEditable === readOnly;
    // sets the props again, so the attributes above are read anew
    editor.setEditable(!readOnly, false);
    // a node view that reads the editable flag (a reference: a link while reading) hears of it through a transaction
    if (changed) editor.view.dispatch(editor.state.tr.setMeta('editable', !readOnly));
  }, [editor, name, hint, describedBy, invalid, readOnly]);

  // a document from outside (reload, reset) replaces what the editor shows; its own output changes nothing
  useEffect(() => {
    if (editor.isDestroyed || reports.isOwn(value)) return;
    if (!showsDoc(editor, content)) editor.commands.setContent(content, { emitUpdate: false });
  }, [editor, value, content, reports]);

  return (
    <div className={cx('rt rt-editor', framed && 'rt-frame')} data-preset={preset} data-invalid={invalid || undefined}>
      <EditorContent editor={editor} />
      {/* the editor's live region, empty when it mounts: uploads and the lists write into it (announcer.ts) */}
      <div aria-live="polite" aria-atomic="true" className="sr-only" data-editor-announcer="" />
    </div>
  );
}
