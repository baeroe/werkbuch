/*
 * Code blocks with syntax highlighting (spec 4.16), in every level of the editor and in the viewer: lowlight with a
 * small set of common languages. A block that names its language (```php, or `language` in the JSON) is read in it;
 * one that names none is read in the language that fits best. The editor loads this with the table support, as a chunk
 * of its own (RichTextEditor, preloadEditor). The colours are tokens of DESIGN.md, in editor.css: ink, pencil and the
 * ink blue of the accent, no colour of their own.
 */

import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight';
import { common, createLowlight } from 'lowlight';

/** What teams of werkbuch write about most; aliases come with them (js, ts, html, sh, yml …). */
const LANGUAGES = ['bash', 'css', 'diff', 'javascript', 'json', 'markdown', 'php', 'python', 'shell', 'sql', 'typescript', 'xml', 'yaml'] as const;

export const lowlight = createLowlight(Object.fromEntries(LANGUAGES.map((name) => [name, common[name]])));

/** StarterKit's code block with highlighting; the text stays plain text in the document. */
export const highlightedCodeBlock = CodeBlockLowlight.configure({
  lowlight,
  defaultLanguage: null,
  HTMLAttributes: { spellcheck: 'false', translate: 'no' },
});
