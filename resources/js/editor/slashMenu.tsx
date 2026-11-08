/*
 * The `/` menu (spec 4.16): typed at the start of a line or after a space (not in code, not right after a mark or an
 * atom, `slashAllowed`), it lists the blocks the editor's level knows (presets.ts); typing narrows the list, Enter
 * turns the line into the block. Each entry shows its Markdown shortcut, which works while typing as well. Tables only
 * on `page` (`slashTable`), the rule only on `page`; inside a table a group "Tabelle" edits its rows, columns and
 * headers (tables.tsx); "Bild oder Datei" opens the file choice (Task 17) and is there only with a project and a way
 * to upload.
 */

import type { ResolvedPos } from '@tiptap/pm/model';
import { PluginKey } from '@tiptap/pm/state';
import { Extension, type Editor, type Range } from '@tiptap/react';
import Suggestion from '@tiptap/suggestion';
import type { LucideIcon } from 'lucide-react';
import { Heading1, Heading2, Heading3, ImagePlus, List, ListChecks, ListOrdered, Minus, SquareCode, Table2, TextQuote } from 'lucide-react';
import { t } from '@/lib/i18n';
import type { EditorEnv, EditorEnvRef } from './EditorEnv';
import { PRESETS, type EditorPreset, type PresetFeatures } from './presets';
import { popupRenderer, SuggestionMenu, type PopupProps, type SuggestionEntry, type SuggestionSection } from './suggestions';
import { tableSlashCommands } from './tables';

export interface SlashItem {
  id: string;
  label: () => string;
  /** The Markdown shortcut that does the same while typing. */
  hint?: string;
  icon: LucideIcon;
  /** Further words that find the entry, in the language of the page. */
  keywords: () => string;
  /** Whether the level (and the editor's environment) has the block. */
  offered: (features: PresetFeatures, env: EditorEnv) => boolean;
  run: (editor: Editor, env: EditorEnv) => void;
}

/** What taking an entry runs: a block of the list or a command of the table. */
type SlashPick = Pick<SlashItem, 'run'>;

const always = () => true;

const heading = (level: 1 | 2 | 3, icon: LucideIcon): SlashItem => ({
  id: `heading${level}`,
  label: () => t('editor.slash.heading', { level }),
  hint: '#'.repeat(level),
  icon,
  keywords: () => t('editor.slash.keywords.heading'),
  offered: (features) => features.headings,
  run: (editor) => editor.chain().focus().setNode('heading', { level }).run(),
});

export const SLASH_ITEMS: SlashItem[] = [
  heading(1, Heading1),
  heading(2, Heading2),
  heading(3, Heading3),
  {
    id: 'list',
    label: () => t('editor.slash.list'),
    hint: '-',
    icon: List,
    keywords: () => t('editor.slash.keywords.list'),
    offered: always,
    run: (editor) => editor.chain().focus().toggleBulletList().run(),
  },
  {
    id: 'ordered',
    label: () => t('editor.slash.ordered'),
    hint: '1.',
    icon: ListOrdered,
    keywords: () => t('editor.slash.keywords.ordered'),
    offered: always,
    run: (editor) => editor.chain().focus().toggleOrderedList().run(),
  },
  {
    id: 'tasks',
    label: () => t('editor.slash.tasks'),
    hint: '[ ]',
    icon: ListChecks,
    keywords: () => t('editor.slash.keywords.tasks'),
    offered: (features) => features.taskList,
    run: (editor) => editor.chain().focus().toggleTaskList().run(),
  },
  {
    id: 'code',
    label: () => t('editor.slash.code'),
    hint: '```',
    icon: SquareCode,
    keywords: () => t('editor.slash.keywords.code'),
    offered: always,
    run: (editor) => editor.chain().focus().toggleCodeBlock().run(),
  },
  {
    id: 'quote',
    label: () => t('editor.slash.quote'),
    hint: '>',
    icon: TextQuote,
    keywords: () => t('editor.slash.keywords.quote'),
    offered: always,
    run: (editor) => editor.chain().focus().toggleBlockquote().run(),
  },
  {
    id: 'table',
    label: () => t('editor.slash.table'),
    icon: Table2,
    keywords: () => t('editor.slash.keywords.table'),
    offered: (features) => features.slashTable,
    run: (editor) => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(),
  },
  {
    id: 'file',
    label: () => t('editor.slash.file'),
    icon: ImagePlus,
    keywords: () => t('editor.slash.keywords.file'),
    offered: (_features, env) => env.projectId !== null && env.chooseFiles !== undefined,
    run: (editor, env) => env.chooseFiles?.(editor),
  },
  {
    id: 'rule',
    label: () => t('editor.slash.rule'),
    hint: '---',
    icon: Minus,
    keywords: () => t('editor.slash.keywords.rule'),
    offered: (features) => features.horizontalRule,
    run: (editor) => editor.chain().focus().setHorizontalRule().run(),
  },
];

/** The entries of a level that match what was typed after the slash (label or keywords, any case). */
export function slashItemsFor(preset: EditorPreset, query: string, env: EditorEnv): SlashItem[] {
  const needle = query.trim().toLocaleLowerCase();
  return SLASH_ITEMS.filter((item) => item.offered(PRESETS[preset], env)).filter(
    (item) => needle === '' || `${item.label()} ${item.keywords()}`.toLocaleLowerCase().includes(needle),
  );
}

/** An entry of the list: its icon, its name and the Markdown shortcut, if it has one. */
function entryContent(icon: LucideIcon, label: string, hint?: string) {
  const Icon = icon;
  return (
    <>
      <Icon className="size-4 shrink-0 text-muted" aria-hidden="true" />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {hint && (
        <span aria-hidden="true" translate="no" className="shrink-0 text-sm text-muted tabular-nums">
          {hint}
        </span>
      )}
    </>
  );
}

const matches = (needle: string, text: string) => needle === '' || text.toLocaleLowerCase().includes(needle);

function SlashSuggestions({ suggestion, preset, env, ref }: PopupProps<{ preset: EditorPreset }>) {
  const entries: SuggestionEntry[] = slashItemsFor(preset, suggestion.query, env.current).map((item) => ({
    key: item.id,
    content: entryContent(item.icon, item.label(), item.hint),
    pick: () => suggestion.command(item),
  }));
  const needle = suggestion.query.trim().toLocaleLowerCase();
  // in a table: rows, columns and headers of it, after the blocks (tables.tsx)
  const table: SuggestionEntry[] = tableSlashCommands(suggestion.editor)
    .filter((command) => matches(needle, command.label()))
    .map((command) => ({
      key: command.id,
      content: entryContent(command.icon, command.label()),
      pick: () => suggestion.command({ run: command.run } satisfies SlashPick),
    }));
  const sections: SuggestionSection[] = table.length > 0 ? [{ label: t('editor.slash.label'), entries }, { label: t('editor.table.group'), entries: table }] : [{ entries }];
  return <SuggestionMenu ref={ref} editor={suggestion.editor} label={t('editor.slash.label')} sections={sections} status={t('editor.slash.none', { query: suggestion.query })} />;
}

const slashKey = new PluginKey('slashMenu');

/**
 * Whether a `/` at this place opens the menu: at the start of a line (also after a line break) or after a blank, never
 * in code (a path, a comment) and never right after the text of a mark or an atom (a bold „und“ before „/oder“,
 * `@mara/`), where Tiptap would see the start of a text node (F22).
 */
export function slashAllowed($at: ResolvedPos): boolean {
  if ($at.parent.type.spec.code) return false;
  const before = $at.nodeBefore;
  if (before === null || before.type.name === 'hardBreak') return true;
  return before.isText && /\s$/.test(before.text ?? '');
}

/** The `/` menu of an editor level; the environment comes in by closure (EditorEnv.tsx). */
export function slashMenu(preset: EditorPreset, env: EditorEnvRef) {
  return Extension.create({
    name: 'slashMenu',
    // before the keymaps of lists and code: an open list takes Enter and Tab
    priority: 200,
    addProseMirrorPlugins() {
      return [
        Suggestion<SlashItem, SlashPick>({
          editor: this.editor,
          pluginKey: slashKey,
          char: '/',
          items: () => [],
          allow: ({ state, range }) => slashAllowed(state.doc.resolve(range.from)),
          command: ({ editor, range, props }: { editor: Editor; range: Range; props: SlashPick }) => {
            editor.chain().focus().deleteRange(range).run();
            props.run(editor, env.current);
          },
          render: popupRenderer(SlashSuggestions, env, { preset }),
        }),
      ];
    },
  });
}
