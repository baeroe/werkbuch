import { getSchema } from '@tiptap/react';
import Mention from '@tiptap/extension-mention';
import StarterKit from '@tiptap/starter-kit';
import { describe, expect, it } from 'vitest';
import type { RichText } from '@/types';
import { createSeed } from './index';

const schema = getSchema([StarterKit, Mention]);

describe('seed documents', () => {
  it('every rich text of the seed is a document the editor schema accepts', () => {
    const db = createSeed();
    const documents: [string, RichText | null][] = [
      ...db.items.map((item): [string, RichText | null] => [`${item.key} description`, item.description]),
      ...db.items.flatMap((item) => Object.entries(item.values).flatMap(([key, value]): [string, RichText | null][] => (typeof value === 'object' && value !== null && !Array.isArray(value) ? [[`${item.key} ${key}`, value as RichText]] : []))),
      ...db.comments.map((comment): [string, RichText | null] => [`comment ${comment.id}`, comment.body]),
      ...db.pages.map((page): [string, RichText | null] => [`page ${page.title}`, page.content]),
      ...db.page_versions.map((version): [string, RichText | null] => [`version ${version.id}`, version.content]),
      ...db.templates.map((template): [string, RichText | null] => [`template ${template.name}`, template.payload.description]),
    ];

    // the check can fail: a node the schema does not know, and a list item outside of a list
    expect(() => schema.nodeFromJSON({ type: 'doc', content: [{ type: 'nope' }] }).check()).toThrow();
    expect(() => schema.nodeFromJSON({ type: 'doc', content: [{ type: 'listItem', content: [{ type: 'paragraph' }] }] }).check()).toThrow();

    expect(documents.length).toBeGreaterThan(50);
    for (const [name, doc] of documents) {
      if (doc !== null) expect(() => schema.nodeFromJSON(doc).check(), name).not.toThrow();
    }
  });

  it('mentions point at people who exist', () => {
    const db = createSeed();
    const people = new Set(db.users.map((user) => user.id));
    const ids: string[] = [];
    const visit = (node: RichText) => {
      if (node.type === 'mention') ids.push(node.attrs?.id);
      node.content?.forEach(visit);
    };
    db.comments.forEach((comment) => visit(comment.body));
    db.items.forEach((item) => item.description && visit(item.description));

    expect(ids.length).toBeGreaterThan(2);
    expect(ids.every((id) => people.has(id))).toBe(true);
  });
});
