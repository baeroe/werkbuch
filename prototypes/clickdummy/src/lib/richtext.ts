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

/** A document with one paragraph per blank-line-separated block of the text. */
export function textDoc(text: string): RichText {
  const blocks = text.split(/\n{2,}/).filter((block) => block.trim() !== '');
  return {
    type: 'doc',
    content: (blocks.length > 0 ? blocks : ['']).map((block) =>
      block === '' ? { type: 'paragraph' } : { type: 'paragraph', content: [{ type: 'text', text: block }] },
    ),
  };
}

/** Whether a document has no text and no mention (an editor that was emptied still holds an empty paragraph). */
export function isBlankDoc(doc: RichText | null | undefined): boolean {
  return plainText(doc) === '';
}
