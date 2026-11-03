/*
 * Small helpers for Tiptap documents (the stored form of every rich text): plain text for previews, the people,
 * attachments and items a text names, and a document built from plain paragraphs and back. The nodes are those the
 * server takes (`App\RichText\Schema`); the text of a node reads as `Document::toText` reads it: a mention as `@` and
 * its label, a file by its name, an image by its alt text, a reference as nothing (its key belongs to the reader who
 * sees it, P7).
 */

import type { RichText } from '@/types';

/** Nodes that stand for a line break or a gap in the text. */
const SPACING_NODES = new Set(['hardBreak', 'horizontalRule']);

/** Nodes that stand inside a line of text. */
const INLINE_ATOMS = new Set(['mention', 'reference', 'attachment']);

/** Nodes that stand for something even without text (`ItemValue::CONTENT_NODES`). */
const CONTENT_NODES = new Set(['mention', 'reference', 'image', 'attachment']);

/** The text a node without text of its own reads as, or null for a node that has children instead. */
function nodeText(node: RichText): string | null {
  const attrs = node.attrs ?? {};
  switch (node.type) {
    case 'mention':
      return typeof attrs.label === 'string' ? `@${attrs.label}` : '';
    case 'reference':
      return '';
    case 'attachment':
      return typeof attrs.filename === 'string' ? attrs.filename : '';
    case 'image':
      return typeof attrs.alt === 'string' ? attrs.alt : '';
    default:
      return null;
  }
}

function collectText(node: RichText, out: string[]): void {
  if (typeof node.text === 'string') {
    out.push(node.text);
    return;
  }
  const own = nodeText(node);
  if (own !== null) {
    out.push(own);
    return;
  }
  if (node.type !== undefined && SPACING_NODES.has(node.type)) {
    out.push(' ');
    return;
  }
  const children: RichText[] = node.content ?? [];
  const inline = children.every((child) => typeof child.text === 'string' || child.type === 'hardBreak' || INLINE_ATOMS.has(child.type ?? ''));
  children.forEach((child, index) => {
    collectText(child, out);
    // blocks (paragraphs, list items, headings …) are told apart by a space
    if (!inline && index < children.length - 1) out.push(' ');
  });
}

/** The values of one attribute of the nodes of these types, in the order of the text and without repeats. */
function attributeOf(doc: RichText | null | undefined, types: readonly string[], attribute: string, accept: (node: RichText) => boolean = () => true): string[] {
  const found = new Set<string>();
  const visit = (node: RichText) => {
    const value: unknown = node.attrs?.[attribute];
    if (types.includes(node.type ?? '') && typeof value === 'string' && accept(node)) found.add(value);
    node.content?.forEach(visit);
  };
  if (doc) visit(doc);
  return [...found];
}

/** The user ids of all `mention` nodes of a document, in order of appearance and without repeats. */
export function mentionedIds(doc: RichText | null | undefined): string[] {
  return attributeOf(doc, ['mention'], 'id');
}

/** The attachment ids of the images and files of a document (`image`, `attachment` nodes), without repeats. */
export function attachmentIds(doc: RichText | null | undefined): string[] {
  return attributeOf(doc, ['image', 'attachment'], 'attachmentId');
}

/** The ids of the items a document refers to (`reference` nodes of `kind: item`; pages come with Phase 9), without repeats. */
export function referenceIds(doc: RichText | null | undefined): string[] {
  return attributeOf(doc, ['reference'], 'id', (node) => node.attrs?.kind === 'item');
}

/** The text of a document, blocks separated by a space. Empty for null. */
export function plainText(doc: RichText | null | undefined): string {
  if (!doc) return '';
  const out: string[] = [];
  collectText(doc, out);
  return out.join('').replace(/\s+/g, ' ').trim();
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
 * without losing anything (no lists, headings, marks or links).
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

/**
 * Whether a document has no text and none of the nodes that stand for something (a mention, a reference, an image, a
 * file), as `ItemValue::isBlankDoc` reads it: an editor that was emptied still holds an empty paragraph.
 */
export function isBlankDoc(doc: RichText | null | undefined): boolean {
  if (!doc) return true;
  if (typeof doc.text === 'string') return doc.text.trim() === '';
  if (CONTENT_NODES.has(doc.type ?? '')) return false;
  return (doc.content ?? []).every(isBlankDoc);
}
