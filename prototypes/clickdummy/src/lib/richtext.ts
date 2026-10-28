/*
 * Small helpers for Tiptap documents (the stored form of every rich text): plain text for search and previews, the
 * people mentioned in a text, and a document built from plain paragraphs.
 */

import type { RichText } from '@/types';

/** Nodes that stand for a line break or a gap in the text. */
const SPACING_NODES = new Set(['hardBreak', 'horizontalRule']);

function collectText(node: RichText, out: string[]): void {
  if (typeof node.text === 'string') {
    out.push(node.text);
    return;
  }
  if (node.type === 'mention') {
    const label = node.attrs?.label ?? node.attrs?.id;
    out.push(label ? `@${label}` : '@');
    return;
  }
  if (node.type !== undefined && SPACING_NODES.has(node.type)) {
    out.push(' ');
    return;
  }
  const children: RichText[] = node.content ?? [];
  const inline = children.every((child) => typeof child.text === 'string' || child.type === 'mention' || child.type === 'hardBreak');
  children.forEach((child, index) => {
    collectText(child, out);
    // blocks (paragraphs, list items, headings …) are told apart by a space
    if (!inline && index < children.length - 1) out.push(' ');
  });
}

/** The text of a document, blocks separated by a space. Empty for null. */
export function plainText(doc: RichText | null | undefined): string {
  if (!doc) return '';
  const out: string[] = [];
  collectText(doc, out);
  return out.join('').replace(/\s+/g, ' ').trim();
}

/** The user ids of all `mention` nodes of a document, in order of appearance and without repeats. */
export function mentionedIds(doc: RichText | null | undefined): string[] {
  const found = new Set<string>();
  const visit = (node: RichText) => {
    if (node.type === 'mention' && typeof node.attrs?.id === 'string') found.add(node.attrs.id);
    node.content?.forEach(visit);
  };
  if (doc) visit(doc);
  return [...found];
}

/** One top-level block as plain text: list items on lines of their own, numbered or with a dash. */
function blockText(node: RichText): string {
  const items: RichText[] = node.content ?? [];
  if (node.type === 'orderedList') return items.map((item, index) => `${index + 1}. ${plainText(item)}`).join('\n');
  if (node.type === 'bulletList' || node.type === 'taskList') return items.map((item) => `- ${plainText(item)}`).join('\n');
  return plainText(node);
}

/**
 * The text of any document for reading: blocks separated by a blank line, list items on lines of their own. Empty for
 * null. (A plain document reads back with `textDoc`; a richer one loses its form that way, see `isPlainDoc`.)
 */
export function docToText(doc: RichText | null | undefined): string {
  if (!doc) return '';
  return (doc.content ?? [])
    .map(blockText)
    .filter((block) => block !== '')
    .join('\n\n');
}

/**
 * A document from plain text: a blank line starts a new paragraph, a single line break stays a line break
 * (`hardBreak`). The inverse of `plainDocText`.
 */
export function textDoc(text: string): RichText {
  const blocks = text
    .split(/\n\s*\n/)
    .map((block) => block.replace(/^\n+|\n+$/g, ''))
    .filter((block) => block.trim() !== '');
  return {
    type: 'doc',
    content: (blocks.length > 0 ? blocks : ['']).map((block): RichText => {
      if (block === '') return { type: 'paragraph' };
      const lines = block.split('\n');
      const content = lines.flatMap((line, index): RichText[] => [
        ...(line !== '' ? [{ type: 'text', text: line }] : []),
        ...(index < lines.length - 1 ? [{ type: 'hardBreak' }] : []),
      ]);
      return { type: 'paragraph', content };
    }),
  };
}

/**
 * Whether a document is only paragraphs of unmarked text and line breaks: what a plain text field can show and save
 * without losing anything (no lists, headings, marks, links or mentions).
 */
export function isPlainDoc(doc: RichText | null | undefined): boolean {
  if (!doc) return true;
  if (doc.type !== 'doc') return false;
  return (doc.content ?? []).every(
    (block) =>
      block.type === 'paragraph' &&
      (block.content ?? []).every((node) => node.type === 'hardBreak' || (node.type === 'text' && (node.marks ?? []).length === 0)),
  );
}

/** The text of a plain document (`isPlainDoc`): paragraphs separated by a blank line, line breaks as line breaks. */
export function plainDocText(doc: RichText | null | undefined): string {
  return (doc?.content ?? [])
    .map((block) => (block.content ?? []).map((node) => (node.type === 'hardBreak' ? '\n' : (node.text ?? ''))).join(''))
    .join('\n\n')
    .replace(/\n+$/, '');
}

/** Whether a document has no text and no mention (an editor that was emptied still holds an empty paragraph). */
export function isBlankDoc(doc: RichText | null | undefined): boolean {
  return plainText(doc) === '';
}
