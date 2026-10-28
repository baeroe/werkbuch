/*
 * The `/` menu (spec 4.16): typed at the start of a line or after a space, it lists the blocks the editor's level
 * knows (presets.ts); typing narrows the list, Enter turns the line into the block. "Bild" opens the file choice and
 * uploads like pasting does. Each entry shows its Markdown shortcut, which works while typing as well.
 */

import type { Range } from '@tiptap/react';
import { Extension, type Editor } from '@tiptap/react';
import { PluginKey } from '@tiptap/pm/state';
import Suggestion from '@tiptap/suggestion';
import type { LucideIcon } from 'lucide-react';
import { Heading2, ImagePlus, List, ListChecks, ListOrdered, SquareCode, Table2, TextQuote } from 'lucide-react';
import type { RefObject } from 'react';
import { SuggestionMenu, popupRenderer, type PopupProps, type SuggestionEntry } from './mentions';
import { pickFiles, uploadFiles, type EditorEnv } from './pasteImages';
import { INLINE_IMAGE_TYPES, PRESETS, type EditorPreset, type PresetFeatures } from './presets';

export interface SlashItem {
  id: string;
  label: string;
  /** The Markdown shortcut that does the same while typing. */
  hint?: string;
  icon: LucideIcon;
  keywords: string[];
  /** Whether the level has the block. */
  offered: (features: PresetFeatures) => boolean;
  run: (editor: Editor, env: EditorEnv | null) => void;
}

const always = () => true;

export const SLASH_ITEMS: SlashItem[] = [
  {
    id: 'heading',
    label: 'Überschrift',
    hint: '##',
    icon: Heading2,
    keywords: ['titel', 'abschnitt', 'h2'],
    offered: (features) => features.headings,
    run: (editor) => editor.chain().focus().setNode('heading', { level: 2 }).run(),
  },
  { id: 'list', label: 'Liste', hint: '-', icon: List, keywords: ['aufzählung', 'punkte', 'bullet'], offered: always, run: (editor) => editor.chain().focus().toggleBulletList().run() },
  {
    id: 'ordered',
    label: 'Nummerierte Liste',
    hint: '1.',
    icon: ListOrdered,
    keywords: ['nummern', 'zahlen', 'schritte'],
    offered: always,
    run: (editor) => editor.chain().focus().toggleOrderedList().run(),
  },
  {
    id: 'tasks',
    label: 'Checkliste',
    hint: '[ ]',
    icon: ListChecks,
    keywords: ['aufgaben', 'todo', 'haken'],
    offered: (features) => features.taskList,
    run: (editor) => editor.chain().focus().toggleTaskList().run(),
  },
  { id: 'code', label: 'Code', hint: '```', icon: SquareCode, keywords: ['quelltext', 'snippet'], offered: always, run: (editor) => editor.chain().focus().toggleCodeBlock().run() },
  { id: 'quote', label: 'Zitat', hint: '>', icon: TextQuote, keywords: ['blockquote'], offered: always, run: (editor) => editor.chain().focus().toggleBlockquote().run() },
  {
    id: 'table',
    label: 'Tabelle',
    icon: Table2,
    keywords: ['spalten', 'zeilen'],
    offered: (features) => features.slashTable,
    run: (editor) => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(),
  },
  {
    id: 'image',
    label: 'Bild',
    icon: ImagePlus,
    keywords: ['foto', 'screenshot', 'grafik', 'hochladen'],
    offered: always,
    run: (editor, env) => {
      if (!env) return;
      pickFiles(editor, INLINE_IMAGE_TYPES.join(','), (files) => uploadFiles(editor, files, editor.state.selection.from, env));
    },
  },
];

/** The entries of a level that match what was typed after the slash. */
export function slashItemsFor(preset: EditorPreset, query: string): SlashItem[] {
  const needle = query.trim().toLocaleLowerCase('de-DE');
  return SLASH_ITEMS.filter((item) => item.offered(PRESETS[preset])).filter(
    (item) => needle === '' || [item.label, ...item.keywords].some((word) => word.toLocaleLowerCase('de-DE').includes(needle)),
  );
}

function SlashSuggestions({ suggestion, preset, ref }: PopupProps<{ preset: EditorPreset }>) {
  const entries: SuggestionEntry[] = slashItemsFor(preset, suggestion.query).map((item) => {
    const Icon = item.icon;
    return {
      key: item.id,
      content: (
        <>
          <Icon className="size-4 shrink-0 text-muted" aria-hidden="true" />
          <span className="min-w-0 flex-1 truncate">{item.label}</span>
          {item.hint && (
            <span aria-hidden="true" className="shrink-0 text-sm text-muted tabular-nums">
              {item.hint}
            </span>
          )}
        </>
      ),
      pick: () => suggestion.command(item),
    };
  });
  return <SuggestionMenu ref={ref} editor={suggestion.editor} label="Blöcke" sections={[{ entries }]} empty={`Kein Block heißt „${suggestion.query}“.`} />;
}

const slashKey = new PluginKey('slashMenu');

/**
 * The `/` menu of an editor level. The editor's environment comes in by closure: Tiptap deep-copies extension options
 * (`configure`), which would freeze a ref at the value it had when the editor was built.
 */
export function slashMenu(preset: EditorPreset, env: RefObject<EditorEnv | null>) {
  return Extension.create({
    name: 'slashMenu',
    addProseMirrorPlugins() {
      return [
        Suggestion<SlashItem, SlashItem>({
          editor: this.editor,
          pluginKey: slashKey,
          char: '/',
          items: () => [],
          command: ({ editor, range, props }: { editor: Editor; range: Range; props: SlashItem }) => {
            editor.chain().focus().deleteRange(range).run();
            props.run(editor, env.current);
          },
          render: popupRenderer(SlashSuggestions, env, { preset }),
        }),
      ];
    },
  });
}
