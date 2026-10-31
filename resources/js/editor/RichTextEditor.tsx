/*
 * The one rich text editor of werkbuch (spec 4.16), Tiptap 3 with our own surface. Its level (`preset`) decides what
 * it knows (presets.ts); all levels have the Markdown shortcuts while typing (`## `, `- `, `1. `, `> `, ``` and, from
 * `description` on, `[ ] `). Phase 7 adds the `/` menu, mentions, references, code highlighting and uploads.
 *
 *   <RichTextEditor value={doc} onChange={setDoc} preset="description" onSubmit={save} />
 *
 * - The schema is the server's (`App\RichText\Schema`): StarterKit without underline (the server has no such mark and
 *   would refuse the whole text), headings 1–3, links only to http, https and mailto, checklists and tables from
 *   `description` on, horizontal rules only on `page`. A document with blocks the level does not know (a table in a
 *   comment) shows their text in paragraphs.
 * - `value` is controlled: a document that differs from what the editor shows replaces it (a reload, a reset after
 *   sending: pass a new document, or null). A document the editor reported itself changes nothing, also an older one
 *   (with fast typing the parent may render one the editor has moved past), so the cursor and every key stay.
 * - `onChange` gets the Tiptap JSON after every change, and null when the editor holds nothing at all (one empty
 *   paragraph, what null shows). `isEmptyDoc` tells a document without content (a list without text yet) apart; keep
 *   such a document as it comes and turn it into null only when sending.
 * - `mod+enter` calls `onSubmit` and never adds a line break; without `onSubmit` the key goes on to the page (a dialog's
 *   own mod+enter). Escape calls `onEscape` and is used up there (nothing around the editor sees it, a dialog stays
 *   open); without `onEscape` it goes on to the page (a preview moves the focus out of the field).
 * - The editor's accessible name is its level's ("Kommentar", "Beschreibung", "Inhalt der Seite") unless `label` says
 *   otherwise; `invalid` and `describedBy` mark a field error. `editorRef` hands out the Tiptap editor.
 *
 * Tables come as a chunk of their own (`preloadEditor`); an editor that renders before it arrived waits once. Tests
 * call `await preloadEditor()` first. `RichTextView` (RichTextView.tsx) shows a document read-only with the same nodes.
 */

import { TaskItem, TaskList } from '@tiptap/extension-list';
import { Placeholder } from '@tiptap/extensions';
import type { Schema } from '@tiptap/pm/model';
import { Plugin } from '@tiptap/pm/state';
import { EditorContent, Extension, getSchema, useEditor, type AnyExtension, type Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { Suspense, use, useCallback, useEffect, useLayoutEffect, useMemo, useRef, type RefObject } from 'react';
import { cx } from '@/components/ui/cx';
import { t } from '@/lib/i18n';
import { isMac } from '@/lib/platform';
import type { RichText } from '@/types';
import './editor.css';
import { PRESET_LABEL, PRESET_PLACEHOLDER, PRESETS, type EditorPreset } from './presets';

export type { EditorPreset } from './presets';

export interface RichTextEditorProps {
  value: RichText | null;
  /** The document after every change; null when the editor holds nothing at all. */
  onChange: (doc: RichText | null) => void;
  preset: EditorPreset;
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
const CONTENT_ATOMS = new Set(['horizontalRule', 'table']);

/** Whether a document holds nothing: no text, no horizontal rule, no table. */
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

const isInline = (node: RichText) => node.type === 'text' || node.type === 'hardBreak';

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

let loadingTables: Promise<AnyExtension> | null = null;

/** The table support, a chunk of its own (most texts have no table); asked for as soon as the editor's code is there. */
function loadTables(): Promise<AnyExtension> {
  if (!loadingTables) {
    const loading = import('@tiptap/extension-table').then(({ TableKit }) => {
      const tables = TableKit.configure({ table: { resizable: false } });
      // React's use() reads a promise marked as fulfilled at once: an editor rendered after the load never waits
      Object.assign(loading, { status: 'fulfilled', value: tables });
      return tables;
    });
    loadingTables = loading;
  }
  return loadingTables;
}

/** Loads what the editor loads late (the tables); an editor rendered afterwards never waits. */
export async function preloadEditor(): Promise<void> {
  await loadTables();
}
void preloadEditor();

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
 * The extensions of a level. `placeholder: null` builds a viewer: the same nodes, without the placeholder. The
 * placeholder is read when the editor draws, so a new one needs no new editor.
 */
function buildExtensions(preset: EditorPreset, placeholder: (() => string) | null, tables: AnyExtension): AnyExtension[] {
  const features = PRESETS[preset];
  return [
    StarterKit.configure({
      heading: features.headings ? { levels: [1, 2, 3] } : false,
      horizontalRule: features.horizontalRule ? {} : false,
      // the server knows no underline (Markdown has none); mod+u and a pasted <u> stay plain text
      underline: false,
      link: { openOnClick: false, autolink: true, linkOnPaste: true, defaultProtocol: 'https', isAllowedUri: (url) => LINK_HREF.test(url) },
      dropcursor: { color: 'var(--accent)', width: 2 },
    }),
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
    ...(features.table ? [tables] : []),
    ...(placeholder === null ? [] : [Placeholder.configure({ placeholder })]),
  ];
}

/**
 * The extensions and the schema of a level. `use()` on every render, also once the tables are there: React must see
 * the same calls before and after the wait (rules of hooks).
 */
export function useLevel(preset: EditorPreset, placeholder: (() => string) | null): { extensions: AnyExtension[]; schema: Schema } {
  const tables = use(loadTables());
  return useMemo(() => {
    const extensions = buildExtensions(preset, placeholder, tables);
    return { extensions, schema: getSchema(extensions) };
  }, [preset, placeholder, tables]);
}

/* --------------------------------------------------------------------------- editor */

export function RichTextEditor(props: RichTextEditorProps) {
  // the editor's frame while the tables arrive, so nothing jumps when it is there
  const frame = (
    <div className={cx('rt rt-editor', props.preset !== 'page' && 'rt-frame')} data-preset={props.preset} aria-busy="true">
      <div className="ProseMirror" />
    </div>
  );
  return (
    <Suspense fallback={frame}>
      <EditorBody {...props} />
    </Suspense>
  );
}

function EditorBody({ value, onChange, preset, label, placeholder, autoFocus = false, readOnly = false, onSubmit, onEscape, invalid = false, describedBy, editorRef }: RichTextEditorProps) {
  const name = label ?? t(PRESET_LABEL[preset]);
  const hint = placeholder ?? t(PRESET_PLACEHOLDER[preset]);
  const latest = useRef({ onChange, onSubmit, onEscape, name, hint, describedBy, invalid, readOnly });
  useLayoutEffect(() => {
    latest.current = { onChange, onSubmit, onEscape, name, hint, describedBy, invalid, readOnly };
  });

  const framed = preset !== 'page';
  const placeholderOf = useCallback(() => latest.current.hint, []);
  const { extensions, schema } = useLevel(preset, placeholderOf);
  /**
   * The documents the editor reported. One of them coming back as `value` changes nothing, also an older one: with
   * fast typing the parent may render a document the editor has already moved past, and taking it would drop keys.
   */
  const emitted = useRef(new WeakSet<RichText>());

  const editor = useEditor(
    {
      extensions,
      content: fitDoc(value, schema),
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
          keydown: (_view, event) => {
            // ProseMirror would use up every Escape (it reads the legacy keyCode 27)
            if (event.key === 'Escape') {
              const escape = latest.current.onEscape;
              if (escape) {
                // Base UI dialogs and popups close on any Escape, preventDefault or not
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
        emitted.current.add(doc);
        latest.current.onChange(holdsNothing(doc) ? null : doc);
      },
    },
    [extensions],
  );

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
    // sets the props again, so the attributes above are read anew
    editor.setEditable(!readOnly, false);
  }, [editor, name, hint, describedBy, invalid, readOnly]);

  // a document from outside (reload, reset) replaces what the editor shows; its own output changes nothing
  useEffect(() => {
    if (editor.isDestroyed || (value !== null && emitted.current.has(value))) return;
    const doc = fitDoc(value, editor.schema);
    if (!showsDoc(editor, doc)) editor.commands.setContent(doc, { emitUpdate: false });
  }, [editor, value]);

  return (
    <div className={cx('rt rt-editor', framed && 'rt-frame')} data-preset={preset} data-invalid={invalid || undefined}>
      <EditorContent editor={editor} />
    </div>
  );
}
